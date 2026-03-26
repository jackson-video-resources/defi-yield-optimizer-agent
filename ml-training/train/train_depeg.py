"""
Train Isolation Forest depeg detector.
Detects anomalies in stablecoin peg data → probability of depeg in next 24h.
Exports to ONNX for use in ml-inference service.

Usage:
    python train_depeg.py
"""

import os
import json
import numpy as np
import pandas as pd
import psycopg2
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/defi_lp_engine")

STABLECOINS = ["USDC", "USDT", "DAI", "USDe", "USDbC"]


def load_peg_data() -> pd.DataFrame:
    conn = psycopg2.connect(DATABASE_URL)
    query = """
        SELECT symbol, timestamp, price, deviation_pct
        FROM stablecoin_peg_snapshots
        ORDER BY symbol, timestamp
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df


def build_features(df: pd.DataFrame) -> np.ndarray:
    """
    Build anomaly detection features from peg snapshots.
    Features (per snapshot, multi-coin aggregated):
      - deviation_pct: current deviation from $1
      - deviation_change_1h: rate of change in deviation
      - max_deviation_24h: worst deviation in last 24h
      - n_deviating_coins: number of stablecoins currently deviating > 0.1%
    """
    features_list = []

    # Pivot to wide format: rows = timestamps, cols = symbols
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    pivot = df.pivot_table(index="timestamp", columns="symbol", values="deviation_pct")
    pivot = pivot.sort_index()
    pivot = pivot.fillna(0)

    # Ensure all expected stablecoins are present
    for s in STABLECOINS:
        if s not in pivot.columns:
            pivot[s] = 0.0

    for i in range(len(pivot)):
        row = pivot.iloc[i]
        ts = pivot.index[i]

        # Current deviations
        devs = [row.get(s, 0) for s in STABLECOINS]
        max_dev = max(devs)
        avg_dev = np.mean(devs)
        n_deviating = sum(1 for d in devs if d > 0.1)

        # 1h change in max deviation
        if i > 0:
            prev_devs = [pivot.iloc[i - 1].get(s, 0) for s in STABLECOINS]
            prev_max = max(prev_devs)
            dev_change_1h = max_dev - prev_max
        else:
            dev_change_1h = 0.0

        # Max deviation in last 24h
        lookback_24h = pivot.iloc[max(0, i - 24) : i + 1]
        max_dev_24h = lookback_24h.max().max() if len(lookback_24h) > 0 else max_dev

        features_list.append(
            [
                max_dev,
                avg_dev,
                dev_change_1h,
                max_dev_24h,
                float(n_deviating),
            ]
        )

    return np.array(features_list, dtype=np.float32)


def train_isolation_forest(X: np.ndarray) -> Pipeline:
    """Train Isolation Forest with StandardScaler."""
    # contamination: expected fraction of anomalies (~0.5% for stablecoin depegs)
    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "iforest",
                IsolationForest(
                    n_estimators=200,
                    max_samples="auto",
                    contamination=0.005,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    pipeline.fit(X)
    return pipeline


def get_anomaly_scores(pipeline: Pipeline, X: np.ndarray) -> np.ndarray:
    """
    Convert IF decision_function to [0,1] depeg probability.
    decision_function: negative = anomaly, positive = normal
    Map: score = sigmoid(-decision_function * 5)
    """
    scores = pipeline.decision_function(X)
    # Normalize: anomaly score in [0,1]
    probs = 1 / (1 + np.exp(scores * 5))
    return probs


def export_onnx(pipeline: Pipeline, n_features: int):
    """Export the sklearn pipeline to ONNX."""
    output_dir = os.path.join(os.path.dirname(__file__), "../../models")
    os.makedirs(output_dir, exist_ok=True)

    onnx_path = os.path.join(output_dir, "depeg_iforest.onnx")

    initial_types = [("float_input", FloatTensorType([None, n_features]))]
    onnx_model = convert_sklearn(
        pipeline,
        initial_types=initial_types,
        target_opset={"": 17, "ai.onnx.ml": 3},
    )

    with open(onnx_path, "wb") as f:
        f.write(onnx_model.SerializeToString())

    print(f"  Saved: {onnx_path}")


def save_feature_config(n_features: int):
    """Save feature names and anomaly thresholds."""
    config = {
        "features": [
            "max_deviation_pct",
            "avg_deviation_pct",
            "deviation_change_1h",
            "max_deviation_24h",
            "n_deviating_coins",
        ],
        "n_features": n_features,
        "thresholds": {
            "alert": 0.1,  # P > 0.1: send alert
            "widen": 0.3,  # P > 0.3: widen LP ranges
            "exit": 0.7,  # P > 0.7 (3 consecutive): emergency exit
        },
        "stablecoins": STABLECOINS,
    }
    output_dir = os.path.join(os.path.dirname(__file__), "../../models")
    config_path = os.path.join(output_dir, "depeg_config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    print(f"  Config: {config_path}")


def main():
    print("Training Isolation Forest depeg detector...")

    df = load_peg_data()
    print(f"  Loaded {len(df)} peg snapshots")

    if len(df) < 50:
        print("  Insufficient peg data. Using default/untrained model.")
        # Create a dummy model with correct feature structure
        X_dummy = np.zeros((10, 5), dtype=np.float32)
        pipeline = train_isolation_forest(X_dummy)
    else:
        print("Building features...")
        X = build_features(df)
        print(f"  Feature matrix: {X.shape}")

        print("Training Isolation Forest...")
        pipeline = train_isolation_forest(X)

        # Show score distribution
        scores = get_anomaly_scores(pipeline, X)
        print(
            f"  Anomaly score stats: mean={scores.mean():.4f}, max={scores.max():.4f}"
        )
        print(
            f"  Flagged as potential anomalies (P>0.3): {(scores>0.3).sum()} / {len(scores)}"
        )

    print("Exporting to ONNX...")
    export_onnx(pipeline, 5)
    save_feature_config(5)

    print("\n✓ Depeg detector training complete")


if __name__ == "__main__":
    main()
