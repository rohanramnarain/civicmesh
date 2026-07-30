#!/usr/bin/env python3
"""Train 311 forecast models and export them to ONNX.

Usage:
    uv run --project apps/api python scripts/train_forecast311_models.py \
        --release-dir artifacts/forecast311/releases/20260729-022708
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as rt
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from onnxmltools import convert_xgboost, convert_lightgbm
from xgboost import XGBRegressor
from lightgbm import LGBMRegressor


OUTPUT_DIR = Path("public/models/forecast311/v1")
FEATURE_SCHEMA_PATH = Path("apps/api/src/data/forecast-features-v1.json")


def load_records(records_path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with records_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            records.append(json.loads(line))
    return records


def decode_embedding(embedding_payload: dict[str, Any]) -> np.ndarray:
    raw = base64.b64decode(embedding_payload["values_base64"])
    int8_arr = np.frombuffer(raw, dtype=np.int8)
    return (int8_arr * embedding_payload["scale"]).astype(np.float32)


def build_feature_vector(record: dict[str, Any]) -> np.ndarray:
    counts = record["counts"]
    trend = record["trend_features"]
    embedding = decode_embedding(record["embedding"])
    return np.concatenate(
        [
            np.array([counts["current"], counts["lag_1"], counts["lag_2"]], dtype=np.float32),
            np.array(trend, dtype=np.float32),
            embedding,
        ]
    )


def build_training_samples(records: list[dict[str, Any]]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Build train/validation samples from year-pairs.

    Uses 2024 -> 2025 as validation, all earlier pairs for training.
    """
    by_series: dict[tuple[str, str], dict[int, dict[str, Any]]] = {}
    for record in records:
        key = (record["zipcode"], record["complaint_type"])
        by_series.setdefault(key, {})[record["source_year"]] = record

    x_train: list[np.ndarray] = []
    y_train: list[float] = []
    x_val: list[np.ndarray] = []
    y_val: list[float] = []

    for _key, by_year in by_series.items():
        years = sorted(by_year)
        for year in years:
            if year + 1 not in by_year:
                continue
            x = build_feature_vector(by_year[year])
            y = float(by_year[year + 1]["counts"]["current"])
            if year == 2024:
                x_val.append(x)
                y_val.append(y)
            else:
                x_train.append(x)
                y_train.append(y)

    return (
        np.stack(x_train) if x_train else np.empty((0, 0), dtype=np.float32),
        np.array(y_train, dtype=np.float32),
        np.stack(x_val) if x_val else np.empty((0, 0), dtype=np.float32),
        np.array(y_val, dtype=np.float32),
    )


def train_random_forest(x_train: np.ndarray, y_train: np.ndarray) -> RandomForestRegressor:
    model = RandomForestRegressor(
        n_estimators=300,
        max_depth=18,
        min_samples_leaf=1,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(x_train, y_train)
    return model


def train_xgboost(x_train: np.ndarray, y_train: np.ndarray) -> XGBRegressor:
    model = XGBRegressor(
        n_estimators=350,
        max_depth=8,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="reg:squarederror",
        random_state=42,
        n_jobs=4,
    )
    model.fit(x_train, y_train)
    return model


def train_lightgbm(x_train: np.ndarray, y_train: np.ndarray) -> LGBMRegressor:
    model = LGBMRegressor(
        n_estimators=350,
        learning_rate=0.05,
        max_depth=-1,
        num_leaves=63,
        random_state=42,
        n_jobs=4,
        verbosity=-1,
    )
    model.fit(x_train, y_train)
    return model


def export_onnx(
    model: Any,
    model_name: str,
    input_dim: int,
    output_path: Path,
) -> None:
    initial_type = [("float_input", FloatTensorType([None, input_dim]))]

    if isinstance(model, RandomForestRegressor):
        onnx_model = convert_sklearn(model, initial_types=initial_type)
    elif isinstance(model, XGBRegressor):
        onnx_model = convert_xgboost(model, initial_types=initial_type)
    elif isinstance(model, LGBMRegressor):
        onnx_model = convert_lightgbm(model, initial_types=initial_type)
    else:
        raise ValueError(f"Unsupported model type: {type(model)}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as f:
        f.write(onnx_model.SerializeToString())


def verify_parity(model: Any, onnx_path: Path, x: np.ndarray, tolerance: float = 0.01) -> float:
    if x.shape[0] == 0:
        return 0.0

    if isinstance(model, (XGBRegressor, LGBMRegressor)):
        python_pred = model.predict(x)
    else:
        python_pred = model.predict(x)

    session = rt.InferenceSession(str(onnx_path))
    input_name = session.get_inputs()[0].name
    onnx_pred = session.run(None, {input_name: x.astype(np.float32)})[0].flatten()

    max_error = float(np.max(np.abs(onnx_pred - python_pred)))
    if max_error > tolerance:
        raise AssertionError(
            f"Parity check failed for {onnx_path.name}: max_error={max_error}, tolerance={tolerance}"
        )
    return max_error


def compute_checksum(path: Path) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return f"sha256:{digest}"


def evaluate_model(model: Any, x: np.ndarray, y: np.ndarray) -> dict[str, float]:
    if x.shape[0] == 0:
        return {"mae": 0.0, "rmse": 0.0}
    pred = model.predict(x)
    mae = float(mean_absolute_error(y, pred))
    rmse = float(np.sqrt(mean_squared_error(y, pred)))
    return {"mae": round(mae, 4), "rmse": round(rmse, 4)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train 311 forecast models and export to ONNX")
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    args = parser.parse_args()

    records_path = args.release_dir / "embedding_records.jsonl"
    records = load_records(records_path)
    print(f"Loaded {len(records)} records from {records_path}")

    x_train, y_train, x_val, y_val = build_training_samples(records)
    print(f"Training samples: {x_train.shape[0]}, Validation samples: {x_val.shape[0]}")
    print(f"Feature dimension: {x_train.shape[1]}")

    if x_train.shape[0] == 0 or x_val.shape[0] == 0:
        raise ValueError("Insufficient data to train or validate models")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    trainers = {
        "random_forest": train_random_forest,
        "xgboost": train_xgboost,
        "lightgbm": train_lightgbm,
    }

    model_cards: list[dict[str, Any]] = []
    checksums: dict[str, str] = {}
    fixtures: dict[str, dict[str, Any]] = {}

    for model_name, train_fn in trainers.items():
        print(f"\nTraining {model_name}...")
        model = train_fn(x_train, y_train)

        train_metrics = evaluate_model(model, x_train, y_train)
        val_metrics = evaluate_model(model, x_val, y_val)

        onnx_path = args.output_dir / f"{model_name.replace('_', '-')}.onnx"
        export_onnx(model, model_name, x_train.shape[1], onnx_path)
        print(f"Exported {onnx_path}")

        max_error = verify_parity(model, onnx_path, x_val)
        print(f"Parity check passed: max_error={max_error:.6f}")

        checksums[onnx_path.name] = compute_checksum(onnx_path)

        model_cards.append({
            "model_name": model_name,
            "model_version": f"{model_name.replace('_', '-')}-2026-v1",
            "feature_schema_version": "forecast-features-v1",
            "embedding_version": "311-embed-v1",
            "mae": val_metrics["mae"],
            "rmse": val_metrics["rmse"],
            "train_mae": train_metrics["mae"],
            "train_rmse": train_metrics["rmse"],
            "training_rows": x_train.shape[0],
            "validation_rows": x_val.shape[0],
            "onnx_file": onnx_path.name,
            "checksum": checksums[onnx_path.name],
        })

        # Save a parity fixture using the first validation sample.
        fixtures[model_name] = {
            "input": x_val[0].tolist(),
            "expected_prediction": float(model.predict(x_val[0:1])[0]),
            "tolerance": 0.01,
        }

    # Write metadata files.
    (args.output_dir / "model-card.json").write_text(
        json.dumps({"models": model_cards}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (args.output_dir / "checksums.json").write_text(
        json.dumps(checksums, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    (args.output_dir / "feature-schema.json").write_text(
        FEATURE_SCHEMA_PATH.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (args.output_dir / "parity-fixtures.json").write_text(
        json.dumps(fixtures, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    print(f"\nAll models exported to {args.output_dir}")
    for card in model_cards:
        print(f"  {card['model_name']}: MAE={card['mae']}, RMSE={card['rmse']}")


if __name__ == "__main__":
    main()
