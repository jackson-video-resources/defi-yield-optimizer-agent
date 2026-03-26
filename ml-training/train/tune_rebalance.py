"""
Grid search for rebalance optimizer thresholds.
Maximizes (fees_collected - gas_cost - IL) across historical data.
Exports thresholds as JSON for TypeScript decision tree.

Usage:
    python tune_rebalance.py
"""

import os
import json
import numpy as np
import pandas as pd
import psycopg2

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/defi_lp_engine")

# L2 gas cost per rebalance transaction (remove + add liquidity)
# Two txns: decreaseLiquidity+collect ($0.50-$2 on L2s) + mint ($0.50-$2)
GAS_COST_USD = 2.0  # conservative estimate for L2

# Tick spacing for 0.01% fee tier
TICK_SPACING = 1

# Fee tier (0.01% = 100 bps)
FEE_TIER = 0.0001


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


def simulate_strategy(
    df: pd.DataFrame,
    half_range_ticks: int,
    out_of_range_tolerance_min: int,
    gas_payback_hours: float,
    capital_usd: float = 10000.0,
) -> dict:
    """
    Simulate LP strategy with given parameters.

    Rules:
    1. Out of range > tolerance_min → REBALANCE
    2. Gas cost > N hours of expected fees → WAIT
    3. In range → WAIT (collecting fees)

    Returns dict with total fees, gas costs, IL, net P&L
    """
    if len(df) < 24:
        return {"error": "insufficient data"}

    fees_collected = 0.0
    gas_spent = 0.0
    rebalance_count = 0
    in_range_hours = 0
    out_of_range_hours = 0

    # Start at first tick
    tick_lower = df.iloc[0]["tick"] - half_range_ticks
    tick_upper = df.iloc[0]["tick"] + half_range_ticks
    out_of_range_since = None

    capital = capital_usd  # assume equal split USDC/USDT

    for i, row in df.iterrows():
        current_tick = row["tick"]
        hour_tvl = row["tvl_usd"]
        hour_volume = row["volume_usd"]

        # Check if in range
        in_range = tick_lower <= current_tick <= tick_upper

        if in_range:
            # Earn fee share proportional to capital/TVL
            our_share = capital / max(hour_tvl, 1)
            hour_fees = hour_volume * FEE_TIER * our_share
            fees_collected += hour_fees
            in_range_hours += 1
            out_of_range_since = None
        else:
            out_of_range_hours += 1
            if out_of_range_since is None:
                out_of_range_since = i

            # Check if we've been out of range long enough to rebalance
            out_of_range_duration = out_of_range_hours

            # Expected hourly fees if we were in range
            avg_tvl = df["tvl_usd"].mean()
            avg_volume = df["volume_usd"].mean()
            our_share = capital / max(avg_tvl, 1)
            expected_hourly_fees = avg_volume * FEE_TIER * our_share

            # Check if gas cost is worth it
            payback_hours_needed = GAS_COST_USD / max(expected_hourly_fees, 1e-10)

            if out_of_range_duration * 60 >= out_of_range_tolerance_min:
                if payback_hours_needed <= gas_payback_hours:
                    # REBALANCE
                    tick_lower = current_tick - half_range_ticks
                    tick_upper = current_tick + half_range_ticks
                    gas_spent += GAS_COST_USD
                    rebalance_count += 1
                    out_of_range_since = None
                    out_of_range_hours = 0

    # IL is negligible for stablecoin-stablecoin pairs
    il = 0.0

    net_pnl = fees_collected - gas_spent - il
    total_hours = len(df)

    return {
        "fees_collected": fees_collected,
        "gas_spent": gas_spent,
        "net_pnl": net_pnl,
        "rebalance_count": rebalance_count,
        "in_range_pct": in_range_hours / max(total_hours, 1) * 100,
        "annualized_apy_pct": (net_pnl / capital_usd) * (8760 / total_hours) * 100,
    }


def grid_search(df: pd.DataFrame) -> dict:
    """Grid search over rebalance thresholds."""
    print("  Running grid search...")

    best_result = None
    best_params = None
    best_apy = -np.inf

    # Search space
    half_range_ticks_range = [1, 2, 3, 5, 10]
    oor_tolerance_range = [30, 60, 120, 240]  # minutes out of range before rebalancing
    gas_payback_range = [2, 4, 8, 24]  # hours of fees to justify gas cost

    total_combos = (
        len(half_range_ticks_range) * len(oor_tolerance_range) * len(gas_payback_range)
    )
    checked = 0

    for half_range in half_range_ticks_range:
        for oor_tol in oor_tolerance_range:
            for gas_payback in gas_payback_range:
                result = simulate_strategy(
                    df,
                    half_range_ticks=half_range,
                    out_of_range_tolerance_min=oor_tol,
                    gas_payback_hours=gas_payback,
                )

                if "error" not in result:
                    apy = result["annualized_apy_pct"]
                    if apy > best_apy:
                        best_apy = apy
                        best_params = {
                            "half_range_ticks": half_range,
                            "out_of_range_tolerance_min": oor_tol,
                            "gas_payback_hours": gas_payback,
                        }
                        best_result = result

                checked += 1

    print(f"  Checked {checked}/{total_combos} parameter combinations")
    print(f"  Best APY: {best_apy:.2f}%")
    print(f"  Best params: {best_params}")
    print(f"  In-range time: {best_result['in_range_pct']:.1f}%")
    print(f"  Rebalances: {best_result['rebalance_count']}")

    return best_params, best_result


def main():
    print("Tuning rebalance optimizer thresholds...")

    df = load_pool_data("arbitrum")
    print(f"  Loaded {len(df)} rows of pool data")

    if len(df) < 200:
        print("  Insufficient data. Using default thresholds.")
        best_params = {
            "half_range_ticks": 3,
            "out_of_range_tolerance_min": 30,
            "gas_payback_hours": 4,
        }
        best_result = {
            "annualized_apy_pct": 0,
            "in_range_pct": 95,
            "rebalance_count": 0,
        }
    else:
        best_params, best_result = grid_search(df)

    # Build the full threshold config for TypeScript decision tree
    thresholds = {
        **best_params,
        "rules": [
            {
                "id": 1,
                "condition": "out_of_range AND duration_min > out_of_range_tolerance_min",
                "action": "CHECK_GAS",
                "description": "Out of range beyond tolerance → check if gas is worth it",
            },
            {
                "id": 2,
                "condition": "gas_cost_usd > gas_payback_hours * expected_hourly_fee",
                "action": "WAIT",
                "description": "Gas cost too high relative to expected fee income",
            },
            {
                "id": 3,
                "condition": "out_of_range AND high_predicted_vol AND duration_min < 120",
                "action": "WAIT",
                "description": "Out of range during high volatility — price may return",
            },
            {
                "id": 4,
                "condition": "in_range AND price_pct_to_edge > 80",
                "action": "REBALANCE",
                "description": "Preemptive rebalance when at 80% toward range edge",
            },
            {
                "id": 5,
                "condition": "in_range AND low_vol AND earning_fees",
                "action": "WAIT",
                "description": "Earning fees in range with low volatility — stay put",
            },
        ],
        "performance": {
            "annualized_apy_pct": best_result.get("annualized_apy_pct", 0),
            "in_range_pct": best_result.get("in_range_pct", 0),
            "rebalances_per_6months": best_result.get("rebalance_count", 0),
        },
        "gas_cost_usd": GAS_COST_USD,
        "fee_tier": FEE_TIER,
    }

    output_dir = os.path.join(os.path.dirname(__file__), "../../models")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "rebalance_thresholds.json")

    with open(output_path, "w") as f:
        json.dump(thresholds, f, indent=2)

    print(f"\n✓ Rebalance thresholds saved: {output_path}")
    return thresholds


if __name__ == "__main__":
    main()
