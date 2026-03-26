"""
Backtest engine — simulates AI-driven LP strategy on historical pool data.
Compares against QHVN benchmark (fixed 4h rebalancing).

Usage:
    python backtest_engine.py [--chain arbitrum] [--capital 10000]
"""

import os
import sys
import json
import argparse
import numpy as np
import pandas as pd
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/defi_lp_engine")

# Load trained thresholds if available
MODELS_DIR = os.path.join(os.path.dirname(__file__), "../../models")


def load_pool_data(chain: str) -> pd.DataFrame:
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT hour_timestamp, volume_usd, fee_usd, tvl_usd, tick
        FROM pool_hour_data
        WHERE chain = %s
        ORDER BY hour_timestamp
    """
    df = pd.read_sql(query, conn, params=(chain,))
    conn.close()
    df["hour_timestamp"] = pd.to_datetime(df["hour_timestamp"])
    return df


def load_thresholds() -> dict:
    path = os.path.join(MODELS_DIR, "rebalance_thresholds.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    # Defaults
    return {
        "half_range_ticks": 3,
        "out_of_range_tolerance_min": 30,
        "gas_payback_hours": 4,
        "gas_cost_usd": 2.0,
        "fee_tier": 0.0001,
    }


def load_garch_params() -> dict:
    path = os.path.join(MODELS_DIR, "garch_params.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None


def garch_vol_forecast(
    returns: list,
    omega: float,
    alpha: float,
    beta: float,
    sigma2_prev: float,
) -> float:
    """Single-step GARCH(1,1) variance forecast."""
    if not returns:
        return omega / max(1 - alpha - beta, 1e-8)
    eps = returns[-1]
    return omega + alpha * (eps**2) + beta * sigma2_prev


def ai_strategy(
    df: pd.DataFrame,
    thresholds: dict,
    garch_params: dict = None,
    capital_usd: float = 10000.0,
) -> dict:
    """
    Simulate AI-driven strategy:
    - Dynamic range sizing from GARCH volatility forecast
    - Cost/benefit rebalance decision
    - Preemptive rebalance when approaching range edge
    """
    FEE_TIER = thresholds.get("fee_tier", 0.0001)
    GAS_COST = thresholds.get("gas_cost_usd", 2.0)
    OOR_TOLERANCE = thresholds.get("out_of_range_tolerance_min", 30)
    GAS_PAYBACK_HOURS = thresholds.get("gas_payback_hours", 4)
    BASE_HALF_RANGE = thresholds.get("half_range_ticks", 3)

    # GARCH parameters
    garch = None
    if garch_params:
        g = garch_params["garch"]
        range_cfg = garch_params["range_config"]
        omega, alpha, beta = g["omega"], g["alpha"], g["beta"]
        garch = {"omega": omega, "alpha": alpha, "beta": beta}
        range_cfg = range_cfg
    else:
        range_cfg = {
            "base_ticks": BASE_HALF_RANGE,
            "vol_multiplier": 5.0,
            "min_ticks": 1,
            "max_ticks": 50,
            "stress_threshold_bps": 2.0,
            "stress_multiplier": 3.0,
        }

    capital = capital_usd
    fees_total = 0.0
    gas_total = 0.0
    rebalances = 0
    snapshots = []

    tick_lower = df.iloc[0]["tick"] - BASE_HALF_RANGE
    tick_upper = df.iloc[0]["tick"] + BASE_HALF_RANGE
    oor_count = 0
    sigma2 = (
        garch["omega"] / max(1 - garch["alpha"] - garch["beta"], 1e-8)
        if garch
        else 0.01
    )
    tick_returns = []

    for idx in range(len(df)):
        row = df.iloc[idx]
        current_tick = int(row["tick"])
        tvl = row["tvl_usd"]
        volume = row["volume_usd"]
        ts = row["hour_timestamp"]

        # GARCH vol forecast
        if garch and len(tick_returns) > 0:
            sigma2 = garch_vol_forecast(
                tick_returns[-4:], garch["omega"], garch["alpha"], garch["beta"], sigma2
            )
        sigma_bps = np.sqrt(max(sigma2, 1e-12))

        # Dynamic range sizing
        stress = sigma_bps > range_cfg.get("stress_threshold_bps", 2.0)
        multiplier = range_cfg.get("stress_multiplier", 3.0) if stress else 1.0
        half_range = max(
            range_cfg.get("min_ticks", 1),
            min(
                range_cfg.get("max_ticks", 50),
                range_cfg.get("base_ticks", BASE_HALF_RANGE)
                + int(sigma_bps * range_cfg.get("vol_multiplier", 5.0) * multiplier),
            ),
        )

        in_range = tick_lower <= current_tick <= tick_upper

        if in_range:
            our_share = min(capital / max(tvl, 1), 1.0)
            hour_fees = volume * FEE_TIER * our_share
            fees_total += hour_fees
            capital += hour_fees
            oor_count = 0

            # Preemptive rebalance: price at >80% toward edge
            range_width = tick_upper - tick_lower
            if range_width > 0:
                dist_to_lower = current_tick - tick_lower
                dist_to_upper = tick_upper - current_tick
                pct_toward_edge = 1 - min(dist_to_lower, dist_to_upper) / (
                    range_width / 2
                )
                if pct_toward_edge > 0.8:
                    # Expected fees justify gas?
                    avg_tvl = df["tvl_usd"].mean()
                    avg_vol = df["volume_usd"].mean()
                    expected_hourly = avg_vol * FEE_TIER * (capital / max(avg_tvl, 1))
                    if (
                        expected_hourly > 0
                        and GAS_COST / expected_hourly <= GAS_PAYBACK_HOURS
                    ):
                        tick_lower = current_tick - half_range
                        tick_upper = current_tick + half_range
                        gas_total += GAS_COST
                        capital -= GAS_COST
                        rebalances += 1
        else:
            oor_count += 1

            if oor_count * 60 >= OOR_TOLERANCE:
                # Check gas payback
                avg_tvl = df["tvl_usd"].rolling(24, min_periods=1).mean().iloc[idx]
                avg_vol = df["volume_usd"].rolling(24, min_periods=1).mean().iloc[idx]
                expected_hourly = avg_vol * FEE_TIER * (capital / max(avg_tvl, 1))

                if (
                    expected_hourly > 0
                    and GAS_COST / expected_hourly <= GAS_PAYBACK_HOURS
                ):
                    tick_lower = current_tick - half_range
                    tick_upper = current_tick + half_range
                    gas_total += GAS_COST
                    capital -= GAS_COST
                    rebalances += 1
                    oor_count = 0

        # Track tick return for GARCH
        if idx > 0 and df.iloc[idx - 1]["tick"] != 0:
            ret = (current_tick - df.iloc[idx - 1]["tick"]) * np.log(1.0001) * 10000
            tick_returns.append(ret)

        snapshots.append(
            {
                "timestamp": ts,
                "capital": capital,
                "fees": fees_total,
                "gas": gas_total,
                "in_range": in_range,
                "tick": current_tick,
                "half_range": half_range,
            }
        )

    snap_df = pd.DataFrame(snapshots)
    total_hours = len(df)
    in_range_pct = snap_df["in_range"].mean() * 100
    net_pnl = fees_total - gas_total
    apy = (net_pnl / capital_usd) * (8760 / total_hours) * 100

    return {
        "strategy": "AI",
        "capital_initial": capital_usd,
        "fees_total": fees_total,
        "gas_total": gas_total,
        "net_pnl": net_pnl,
        "apy_pct": apy,
        "rebalances": rebalances,
        "in_range_pct": in_range_pct,
        "snapshots": snap_df,
        "period_hours": total_hours,
    }


def qhvn_benchmark(df: pd.DataFrame, capital_usd: float = 10000.0) -> dict:
    """
    Simulate QHVN's fixed strategy:
    - Fixed 4-hour rebalancing
    - Fixed range width (10 ticks)
    - No cost/benefit analysis
    """
    FEE_TIER = 0.0001
    GAS_COST = 2.0
    HALF_RANGE = 10
    REBALANCE_INTERVAL_HOURS = 4

    capital = capital_usd
    fees_total = 0.0
    gas_total = 0.0
    rebalances = 0
    snapshots = []

    tick_lower = df.iloc[0]["tick"] - HALF_RANGE
    tick_upper = df.iloc[0]["tick"] + HALF_RANGE

    for idx, row in df.iterrows():
        current_tick = int(row["tick"])
        tvl = row["tvl_usd"]
        volume = row["volume_usd"]
        ts = row["hour_timestamp"]

        in_range = tick_lower <= current_tick <= tick_upper

        if in_range:
            our_share = min(capital / max(tvl, 1), 1.0)
            hour_fees = volume * FEE_TIER * our_share
            fees_total += hour_fees
            capital += hour_fees

        # Fixed 4h rebalance
        if idx % REBALANCE_INTERVAL_HOURS == 0 and idx > 0:
            tick_lower = current_tick - HALF_RANGE
            tick_upper = current_tick + HALF_RANGE
            gas_total += GAS_COST
            capital -= GAS_COST
            rebalances += 1

        snapshots.append(
            {
                "timestamp": ts,
                "capital": capital,
                "fees": fees_total,
                "gas": gas_total,
                "in_range": in_range,
            }
        )

    snap_df = pd.DataFrame(snapshots)
    total_hours = len(df)
    in_range_pct = snap_df["in_range"].mean() * 100
    net_pnl = fees_total - gas_total
    apy = (net_pnl / capital_usd) * (8760 / total_hours) * 100

    return {
        "strategy": "QHVN (Fixed 4h)",
        "capital_initial": capital_usd,
        "fees_total": fees_total,
        "gas_total": gas_total,
        "net_pnl": net_pnl,
        "apy_pct": apy,
        "rebalances": rebalances,
        "in_range_pct": in_range_pct,
        "snapshots": snap_df,
        "period_hours": total_hours,
    }


def print_comparison(ai: dict, qhvn: dict):
    """Print side-by-side comparison."""
    print("\n" + "=" * 65)
    print(f"{'BACKTEST RESULTS':^65}")
    print("=" * 65)
    print(f"{'Metric':<30} {'AI Strategy':>16} {'QHVN Fixed':>16}")
    print("-" * 65)

    metrics = [
        ("APY (%)", "apy_pct", ".2f"),
        ("Net P&L ($)", "net_pnl", ".2f"),
        ("Fees Earned ($)", "fees_total", ".2f"),
        ("Gas Spent ($)", "gas_total", ".2f"),
        ("Rebalances", "rebalances", "d"),
        ("In-Range Time (%)", "in_range_pct", ".1f"),
    ]

    for label, key, fmt in metrics:
        ai_val = ai[key]
        qhvn_val = qhvn[key]
        if fmt == "d":
            print(f"  {label:<28} {int(ai_val):>16} {int(qhvn_val):>16}")
        else:
            print(f"  {label:<28} {ai_val:>16{fmt}} {qhvn_val:>16{fmt}}")

    uplift = ai["apy_pct"] - qhvn["apy_pct"]
    uplift_pct = uplift / max(abs(qhvn["apy_pct"]), 0.01) * 100
    print("-" * 65)
    print(f"  {'APY Improvement (abs)':28} {uplift:>16.2f}%")
    print(f"  {'APY Improvement (rel)':28} {uplift_pct:>15.1f}%")
    print("=" * 65)


def save_qhvn_benchmark(qhvn: dict, chain: str):
    """Store QHVN benchmark data to DB for dashboard comparison."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    snaps = qhvn["snapshots"]
    capital_init = qhvn["capital_initial"]

    # Compute cumulative return % over time
    rows = []
    prev_date = None
    for _, row in snaps.iterrows():
        date = row["timestamp"].date()
        if date != prev_date:
            cumulative_return = (row["capital"] - capital_init) / capital_init * 100
            rows.append((str(date), cumulative_return))
            prev_date = date

    # Upsert into qhvn_benchmark table
    for i, (date, cumret) in enumerate(rows):
        daily_ret = cumret - rows[i - 1][1] if i > 0 else 0.0
        cur.execute(
            """
            INSERT INTO qhvn_benchmark (date, cumulative_return_pct, daily_return_pct)
            VALUES (%s, %s, %s)
            ON CONFLICT (date) DO UPDATE
              SET cumulative_return_pct = EXCLUDED.cumulative_return_pct,
                  daily_return_pct = EXCLUDED.daily_return_pct
        """,
            (date, cumret, daily_ret),
        )

    conn.commit()
    cur.close()
    conn.close()
    print(f"  QHVN benchmark: {len(rows)} days saved to DB")


def main():
    parser = argparse.ArgumentParser(description="Run strategy backtest")
    parser.add_argument(
        "--chain", default="arbitrum", choices=["arbitrum", "base", "optimism"]
    )
    parser.add_argument(
        "--capital", type=float, default=10000.0, help="Starting capital in USD"
    )
    args = parser.parse_args()

    print(f"Loading pool data for {args.chain}...")
    df = load_pool_data(args.chain)
    print(f"  {len(df)} hours of data")
    print(
        f"  Period: {df.iloc[0]['hour_timestamp']} to {df.iloc[-1]['hour_timestamp']}"
    )

    thresholds = load_thresholds()
    garch_params = load_garch_params()

    print("\nRunning AI strategy simulation...")
    ai_result = ai_strategy(df, thresholds, garch_params, capital_usd=args.capital)

    print("Running QHVN benchmark simulation...")
    qhvn_result = qhvn_benchmark(df, capital_usd=args.capital)

    print_comparison(ai_result, qhvn_result)

    # Save QHVN benchmark to DB for dashboard
    print("\nSaving QHVN benchmark to database...")
    try:
        save_qhvn_benchmark(qhvn_result, args.chain)
    except Exception as e:
        print(f"  Warning: could not save to DB: {e}")

    # Save summary to file
    summary = {
        "chain": args.chain,
        "ai": {k: v for k, v in ai_result.items() if k != "snapshots"},
        "qhvn": {k: v for k, v in qhvn_result.items() if k != "snapshots"},
        "apy_improvement": ai_result["apy_pct"] - qhvn_result["apy_pct"],
    }
    output_path = os.path.join(MODELS_DIR, f"backtest_{args.chain}.json")
    with open(output_path, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\n✓ Summary saved: {output_path}")

    return summary


if __name__ == "__main__":
    main()
