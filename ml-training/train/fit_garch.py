"""
Fit GARCH(1,1) model on pool tick log-returns.
Exports parameters as JSON for TypeScript recursion in ml-inference service.

GARCH(1,1): sigma_t^2 = omega + alpha * epsilon_{t-1}^2 + beta * sigma_{t-1}^2
Regime switching: EWMA when depeg_prob > 0.3 or realized_vol > 3x forecast.

Usage:
    python fit_garch.py
"""

import os
import json
import numpy as np
import pandas as pd
import psycopg2
from arch import arch_model

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/defi_lp_engine")


def load_tick_returns(chain: str) -> np.ndarray:
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT tick
        FROM pool_hour_data
        WHERE chain = %s AND tick IS NOT NULL AND tick != 0
        ORDER BY hour_timestamp
    """
    df = pd.read_sql(query, conn, params=(chain,))
    conn.close()

    ticks = df["tick"].values.astype(float)
    if len(ticks) < 2:
        return np.array([])

    # Log returns of tick price (1.0001^tick)
    # tick_price = 1.0001^tick, so log(price_ratio) = (tick_t - tick_{t-1}) * log(1.0001)
    returns = np.diff(ticks) * np.log(1.0001)
    # Scale to basis points for numerical stability
    returns = returns * 10000

    return returns


def fit_garch(returns: np.ndarray) -> dict:
    """Fit GARCH(1,1) with Student-t innovations for fat tails."""
    # Filter out zeros and extreme outliers
    returns = returns[returns != 0]
    q99 = np.percentile(np.abs(returns), 99)
    returns = returns[np.abs(returns) < q99 * 5]

    print(f"  Fitting GARCH on {len(returns)} observations")
    print(f"  Return stats: mean={returns.mean():.4f}, std={returns.std():.4f}")

    model = arch_model(
        returns,
        vol="Garch",
        p=1,
        q=1,
        dist="t",  # Student-t for fat tails
        mean="Zero",
    )

    result = model.fit(disp="off", show_warning=False)
    params = result.params

    omega = float(params["omega"])
    alpha = float(params["alpha[1]"])
    beta = float(params["beta[1]"])
    nu = float(params.get("nu", 10.0))  # degrees of freedom

    # Compute unconditional variance
    unconditional_var = omega / max(1 - alpha - beta, 1e-8)
    unconditional_vol = np.sqrt(unconditional_var)

    print(
        f"  GARCH params: omega={omega:.6f}, alpha={alpha:.4f}, beta={beta:.4f}, nu={nu:.2f}"
    )
    print(f"  Persistence (alpha+beta): {alpha+beta:.4f}")
    print(f"  Unconditional vol: {unconditional_vol:.4f} bps/hr")

    return {
        "omega": omega,
        "alpha": alpha,
        "beta": beta,
        "nu": nu,
        "unconditional_vol_bps": unconditional_vol,
        "persistence": alpha + beta,
    }


def compute_ewma_halflife(returns: np.ndarray, halflife_hours: float = 6.0) -> dict:
    """
    Compute EWMA parameters for stress regime.
    halflife=6h means shocks decay to 50% weight after 6 hours.
    """
    lambda_decay = np.exp(-np.log(2) / halflife_hours)
    return {
        "halflife_hours": halflife_hours,
        "lambda": float(lambda_decay),
    }


def main():
    print("Fitting GARCH(1,1) volatility model...")

    # Use arbitrum data (all chains use same mainnet pool, patterns identical)
    returns = load_tick_returns("arbitrum")

    if len(returns) < 100:
        print("Insufficient data. Using default parameters.")
        garch_params = {
            "omega": 0.01,
            "alpha": 0.1,
            "beta": 0.85,
            "nu": 10.0,
            "unconditional_vol_bps": 0.5,
            "persistence": 0.95,
        }
    else:
        garch_params = fit_garch(returns)

    ewma_params = compute_ewma_halflife(returns)

    # Range mapping config
    # range_ticks = base_ticks + ceil(vol_bps * multiplier)
    # For USDC/USDT: vol_bps ~0.5 bps/hr → range ≈ 1-3 ticks
    range_config = {
        "base_ticks": 2,  # minimum range half-width
        "vol_multiplier": 5.0,  # scale factor: bps → ticks
        "min_ticks": 1,  # absolute minimum (±1 tick = ±0.01%)
        "max_ticks": 50,  # absolute maximum (±50 ticks = ±0.5%)
        "stress_multiplier": 3.0,  # widen by 3x in stress regime
        "stress_threshold_bps": 2.0,  # switch to stress if vol > 2 bps/hr
        "depeg_threshold": 0.3,  # switch to stress if depeg_prob > 0.3
    }

    output = {
        "garch": garch_params,
        "ewma": ewma_params,
        "range_config": range_config,
        "description": "GARCH(1,1) + EWMA dual-regime volatility model for stablecoin LP range sizing",
    }

    output_dir = os.path.join(os.path.dirname(__file__), "../../models")
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "garch_params.json")

    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ GARCH params saved: {output_path}")
    return output


if __name__ == "__main__":
    main()
