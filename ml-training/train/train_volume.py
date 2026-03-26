"""
Train LightGBM volume predictor.
Predicts log(volume_next_4h) from 14 features.
Exports to ONNX for use in ml-inference service.

Usage:
    python train_volume.py [--chain arbitrum|base|optimism] [--all]
"""

import os
import sys
import json
import argparse
import numpy as np
import pandas as pd
import psycopg2
import lightgbm as lgb
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import mean_squared_error
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import onnxmltools
from onnxmltools.convert import convert_lightgbm

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/defi_lp_engine")

FEATURE_COLS = [
    "hour_of_day_sin",
    "hour_of_day_cos",
    "day_of_week_sin",
    "day_of_week_cos",
    "volume_lag_1h",
    "volume_lag_4h",
    "volume_lag_24h",
    "volume_lag_7d",
    "volume_rolling_mean_24h",
    "cex_volume_ratio",
    "realized_vol_4h",
    "gas_price_gwei",
    "pool_tvl_log",
    "large_swap_count_1h",
]


def load_features(chain: str) -> pd.DataFrame:
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT
            f.timestamp,
            f.features->>'hourOfDaySin' as hour_of_day_sin,
            f.features->>'hourOfDayCos' as hour_of_day_cos,
            f.features->>'dayOfWeekSin' as day_of_week_sin,
            f.features->>'dayOfWeekCos' as day_of_week_cos,
            f.features->>'volumeLag1h' as volume_lag_1h,
            f.features->>'volumeLag4h' as volume_lag_4h,
            f.features->>'volumeLag24h' as volume_lag_24h,
            f.features->>'volumeLag7d' as volume_lag_7d,
            f.features->>'volumeRollingMean24h' as volume_rolling_mean_24h,
            f.features->>'cexVolumeRatio' as cex_volume_ratio,
            f.features->>'realizedVol4h' as realized_vol_4h,
            f.features->>'gasPriceGwei' as gas_price_gwei,
            f.features->>'poolTvlLog' as pool_tvl_log,
            f.features->>'largeSwapCount1h' as large_swap_count_1h,
            -- Target: volume 4 hours ahead
            (
                SELECT p.volume_usd
                FROM pool_hour_data p
                WHERE p.chain = f.chain
                  AND p.pool_address = f.pool_address
                  AND p.hour_timestamp = f.timestamp + interval '4 hours'
            ) as volume_next_4h
        FROM feature_store f
        WHERE f.chain = %s
        ORDER BY f.timestamp
    """
    df = pd.read_sql(query, conn, params=(chain,))
    conn.close()
    return df


def prepare_data(df: pd.DataFrame):
    """Convert features to float, compute log target, drop NaN."""
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=FEATURE_COLS + ["volume_next_4h"])
    df = df[df["volume_next_4h"] > 0]

    X = df[FEATURE_COLS].astype(np.float32).values
    y = np.log(df["volume_next_4h"].values)

    return X, y, df["timestamp"].values


def train_model(X: np.ndarray, y: np.ndarray, chain: str) -> lgb.LGBMRegressor:
    """Train with time-series cross-validation."""
    tscv = TimeSeriesSplit(n_splits=5)

    params = {
        "n_estimators": 500,
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": -1,
        "min_child_samples": 20,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 0.1,
        "random_state": 42,
        "n_jobs": -1,
        "verbose": -1,
    }

    rmse_scores = []
    for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
        X_train, X_val = X[train_idx], X[val_idx]
        y_train, y_val = y[train_idx], y[val_idx]

        model = lgb.LGBMRegressor(**params)
        model.fit(
            X_train,
            y_train,
            eval_set=[(X_val, y_val)],
            callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
        )

        preds = model.predict(X_val)
        rmse = np.sqrt(mean_squared_error(y_val, preds))
        rmse_scores.append(rmse)
        print(f"  Fold {fold+1}/5 RMSE (log scale): {rmse:.4f}")

    print(f"  Mean CV RMSE: {np.mean(rmse_scores):.4f} ± {np.std(rmse_scores):.4f}")

    # Final model trained on all data
    final_model = lgb.LGBMRegressor(**params)
    final_model.fit(X, y, callbacks=[lgb.log_evaluation(0)])
    return final_model


def export_onnx(model: lgb.LGBMRegressor, chain: str, n_features: int):
    """Export LightGBM model to ONNX format."""
    output_dir = os.path.join(os.path.dirname(__file__), "../../models")
    os.makedirs(output_dir, exist_ok=True)

    onnx_path = os.path.join(output_dir, f"volume_lgb_{chain}.onnx")

    initial_types = [("float_input", FloatTensorType([None, n_features]))]
    onnx_model = convert_lightgbm(
        model.booster_, initial_types=initial_types, target_opset=12
    )

    with open(onnx_path, "wb") as f:
        f.write(onnx_model.SerializeToString())

    print(f"  Saved: {onnx_path}")
    return onnx_path


def save_feature_stats(X: np.ndarray, chain: str):
    """Save feature mean/std for normalization in inference service."""
    stats = {
        "features": FEATURE_COLS,
        "mean": X.mean(axis=0).tolist(),
        "std": X.std(axis=0).tolist(),
    }
    output_dir = os.path.join(os.path.dirname(__file__), "../../models")
    stats_path = os.path.join(output_dir, f"volume_stats_{chain}.json")
    with open(stats_path, "w") as f:
        json.dump(stats, f, indent=2)
    print(f"  Stats: {stats_path}")


def train_chain(chain: str):
    print(f"\n{'='*60}")
    print(f"Training volume predictor for: {chain}")
    print(f"{'='*60}")

    print("Loading features from DB...")
    df = load_features(chain)
    print(f"  Loaded {len(df)} rows")

    if len(df) < 200:
        print(f"  Insufficient data ({len(df)} rows). Run the feature builder first.")
        print("  Falling back to pool_hour_data for training...")
        df = load_from_pool_hour_data(chain)
        if len(df) < 100:
            print(f"  Still insufficient. Skipping {chain}.")
            return

    print("Preparing features...")
    X, y, timestamps = prepare_data(df)
    print(f"  Training samples: {len(X)}")
    print(f"  Date range: {timestamps[0]} to {timestamps[-1]}")

    print("Training model...")
    model = train_model(X, y, chain)

    print("Exporting to ONNX...")
    export_onnx(model, chain, X.shape[1])
    save_feature_stats(X, chain)

    print(f"Done: {chain} ✓")


def load_from_pool_hour_data(chain: str) -> pd.DataFrame:
    """
    Fallback: build features directly from pool_hour_data when feature_store is empty.
    Generates the same 14 features as feature-builder.ts.
    """
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT hour_timestamp as timestamp, volume_usd, fee_usd, tvl_usd, tick
        FROM pool_hour_data
        WHERE chain = %s
        ORDER BY hour_timestamp
    """
    df = pd.read_sql(query, conn, params=(chain,))
    conn.close()

    if len(df) < 200:
        return pd.DataFrame()

    df = df.sort_values("timestamp").reset_index(drop=True)
    ts = pd.to_datetime(df["timestamp"])

    # Cyclical temporal
    df["hour_of_day_sin"] = np.sin(2 * np.pi * ts.dt.hour / 24)
    df["hour_of_day_cos"] = np.cos(2 * np.pi * ts.dt.hour / 24)
    df["day_of_week_sin"] = np.sin(2 * np.pi * ts.dt.dayofweek / 7)
    df["day_of_week_cos"] = np.cos(2 * np.pi * ts.dt.dayofweek / 7)

    # Volume lags
    df["volume_lag_1h"] = df["volume_usd"].shift(1)
    df["volume_lag_4h"] = df["volume_usd"].shift(4)
    df["volume_lag_24h"] = df["volume_usd"].shift(24)
    df["volume_lag_7d"] = df["volume_usd"].shift(168)
    df["volume_rolling_mean_24h"] = df["volume_usd"].shift(1).rolling(24).mean()

    # CEX ratio (no CEX data available, use proxy: rolling vol / TVL)
    df["cex_volume_ratio"] = (
        df["volume_rolling_mean_24h"] / df["tvl_usd"].clip(lower=1)
    ).fillna(1.0)

    # Realized vol 4h from tick log-returns
    df["tick_return"] = np.where(
        df["tick"].shift(1) != 0,
        np.log((df["tick"] / df["tick"].shift(1)).clip(lower=1e-10, upper=1e10)),
        0,
    )
    df["realized_vol_4h"] = df["tick_return"].rolling(4).std().fillna(0)

    # Gas price (L2 constant)
    df["gas_price_gwei"] = 0.1

    # Pool TVL log
    df["pool_tvl_log"] = np.log(df["tvl_usd"].clip(lower=1))

    # Large swap count (no swap events table for this fallback, use 0)
    df["large_swap_count_1h"] = 0

    # Target: 4h ahead volume
    df["volume_next_4h"] = df["volume_usd"].shift(-4)

    return df


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train volume predictor")
    parser.add_argument(
        "--chain", choices=["arbitrum", "base", "optimism"], default=None
    )
    parser.add_argument("--all", action="store_true", help="Train all chains")
    args = parser.parse_args()

    chains = (
        ["arbitrum", "base", "optimism"] if args.all else [args.chain or "arbitrum"]
    )

    for chain in chains:
        train_chain(chain)

    print("\n✓ Volume predictor training complete")
