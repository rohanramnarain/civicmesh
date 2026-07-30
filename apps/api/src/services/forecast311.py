from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from typing import Any

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

try:
    from xgboost import XGBRegressor
except Exception:  # pragma: no cover - optional dependency error handling
    XGBRegressor = None

try:
    from lightgbm import LGBMRegressor
except Exception:  # pragma: no cover - optional dependency error handling
    LGBMRegressor = None


@dataclass
class ForecastRow:
    zipcode: str
    complaint_type: str
    year: int
    complaint_count: float


@dataclass
class ModelComparison:
    model_name: str
    mae: float
    rmse: float
    trained_on_rows: int
    validation_rows: int


def validate_optional_model_dependencies() -> list[str]:
    missing: list[str] = []
    if XGBRegressor is None:
        missing.append("xgboost")
    if LGBMRegressor is None:
        missing.append("lightgbm")
    return missing


def run_forecasting_pipeline(
    rows: list[ForecastRow],
    *,
    source_year: int = 2025,
    target_year: int = 2026,
    embedding_dim: int = 16,
) -> dict[str, Any]:
    if target_year != source_year + 1:
        raise ValueError("target_year must be source_year + 1 for next-year forecasting.")

    if not rows:
        raise ValueError("No rows provided.")

    series = _build_series(rows)
    if not series:
        raise ValueError("Rows could not be grouped into series.")

    train_samples, validation_samples = _build_train_and_validation_samples(
        series=series,
        source_year=source_year,
        embedding_dim=embedding_dim,
    )

    # If no historical year pairs exist, train a weak baseline by self-targeting source_year counts.
    if not train_samples:
        train_samples = _build_self_supervised_samples(
            series=series,
            source_year=source_year,
            embedding_dim=embedding_dim,
        )

    if not train_samples:
        raise ValueError(
            "Insufficient data to train models. Provide at least source_year rows, and ideally multiple historical years."
        )

    predict_features, predict_index = _build_prediction_features(
        series=series,
        source_year=source_year,
        embedding_dim=embedding_dim,
    )

    if not predict_features:
        raise ValueError(f"No {source_year} rows found to generate {target_year} predictions.")

    x_train = np.asarray([sample[0] for sample in train_samples], dtype=np.float32)
    y_train = np.asarray([sample[1] for sample in train_samples], dtype=np.float32)

    x_val = np.asarray([sample[0] for sample in validation_samples], dtype=np.float32) if validation_samples else None
    y_val = np.asarray([sample[1] for sample in validation_samples], dtype=np.float32) if validation_samples else None

    x_predict = np.asarray(predict_features, dtype=np.float32)

    models = _build_model_registry()

    comparisons: list[ModelComparison] = []
    all_predictions: dict[str, list[dict[str, Any]]] = {}

    for model_name, model in models.items():
        model.fit(x_train, y_train)

        if x_val is not None and y_val is not None and len(y_val) > 0:
            val_pred = model.predict(x_val)
            mae = float(mean_absolute_error(y_val, val_pred))
            rmse = float(math.sqrt(mean_squared_error(y_val, val_pred)))
            validation_rows = int(len(y_val))
        else:
            # No holdout available in extremely small datasets.
            mae = 0.0
            rmse = 0.0
            validation_rows = 0

        future_pred = model.predict(x_predict)
        clipped = np.maximum(future_pred, 0.0)

        model_rows: list[dict[str, Any]] = []
        for i, (zipcode, complaint_type, source_count) in enumerate(predict_index):
            model_rows.append(
                {
                    "zipcode": zipcode,
                    "complaint_type": complaint_type,
                    "source_year": source_year,
                    "target_year": target_year,
                    "source_count": float(source_count),
                    "predicted_count": round(float(clipped[i]), 3),
                }
            )

        all_predictions[model_name] = model_rows
        comparisons.append(
            ModelComparison(
                model_name=model_name,
                mae=round(mae, 4),
                rmse=round(rmse, 4),
                trained_on_rows=int(len(y_train)),
                validation_rows=validation_rows,
            )
        )

    leaderboard = sorted(comparisons, key=lambda x: x.rmse)

    embeddings_2025 = [
        {
            "zipcode": zipcode,
            "complaint_type": complaint_type,
            "vector": _combined_embedding(zipcode, complaint_type, embedding_dim=embedding_dim),
        }
        for zipcode, complaint_type, _ in predict_index
    ]

    return {
        "source_year": source_year,
        "target_year": target_year,
        "model_comparison": [
            {
                "model_name": item.model_name,
                "mae": item.mae,
                "rmse": item.rmse,
                "trained_on_rows": item.trained_on_rows,
                "validation_rows": item.validation_rows,
            }
            for item in leaderboard
        ],
        "predictions": all_predictions,
        "embedding_count": len(embeddings_2025),
        "embedded_2025_keys": embeddings_2025,
    }


def _build_model_registry() -> dict[str, Any]:
    registry: dict[str, Any] = {
        "random_forest": RandomForestRegressor(
            n_estimators=300,
            max_depth=18,
            min_samples_leaf=1,
            random_state=42,
            n_jobs=-1,
        ),
    }

    if XGBRegressor is not None:
        registry["xgboost"] = XGBRegressor(
            n_estimators=350,
            max_depth=8,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="reg:squarederror",
            random_state=42,
            n_jobs=4,
        )

    if LGBMRegressor is not None:
        registry["lightgbm"] = LGBMRegressor(
            n_estimators=350,
            learning_rate=0.05,
            max_depth=-1,
            num_leaves=63,
            random_state=42,
            n_jobs=4,
        )

    return registry

def _build_series(rows: list[ForecastRow]) -> dict[tuple[str, str], dict[int, float]]:
    series: dict[tuple[str, str], dict[int, float]] = {}
    for row in rows:
        zipcode = str(row.zipcode).strip()
        complaint_type = str(row.complaint_type).strip().lower()
        if not zipcode or not complaint_type:
            continue

        key = (zipcode, complaint_type)
        year_map = series.setdefault(key, {})
        year_map[int(row.year)] = max(float(row.complaint_count), 0.0)

    return series


def _build_train_and_validation_samples(
    *,
    series: dict[tuple[str, str], dict[int, float]],
    source_year: int,
    embedding_dim: int,
) -> tuple[list[tuple[list[float], float]], list[tuple[list[float], float]]]:
    train_samples: list[tuple[list[float], float]] = []
    validation_samples: list[tuple[list[float], float]] = []

    for (zipcode, complaint_type), yearly_counts in series.items():
        years = sorted(yearly_counts)
        for year in years:
            if year + 1 not in yearly_counts:
                continue

            features = _compose_features(
                zipcode=zipcode,
                complaint_type=complaint_type,
                year=year,
                yearly_counts=yearly_counts,
                embedding_dim=embedding_dim,
            )
            target = yearly_counts[year + 1]

            # Keep source_year pair for pure next-year inference and use earlier years for training/validation.
            if year == source_year:
                continue

            # Use the latest observed historical pair as validation when possible.
            if year == max(y for y in years if y + 1 in yearly_counts and y < source_year):
                validation_samples.append((features, target))
            else:
                train_samples.append((features, target))

    if not train_samples and validation_samples:
        # Backfill tiny datasets where only one pair exists.
        train_samples = validation_samples
        validation_samples = []

    return train_samples, validation_samples


def _build_self_supervised_samples(
    *,
    series: dict[tuple[str, str], dict[int, float]],
    source_year: int,
    embedding_dim: int,
) -> list[tuple[list[float], float]]:
    samples: list[tuple[list[float], float]] = []
    for (zipcode, complaint_type), yearly_counts in series.items():
        if source_year not in yearly_counts:
            continue

        features = _compose_features(
            zipcode=zipcode,
            complaint_type=complaint_type,
            year=source_year,
            yearly_counts=yearly_counts,
            embedding_dim=embedding_dim,
        )
        samples.append((features, yearly_counts[source_year]))

    return samples


def _build_prediction_features(
    *,
    series: dict[tuple[str, str], dict[int, float]],
    source_year: int,
    embedding_dim: int,
) -> tuple[list[list[float]], list[tuple[str, str, float]]]:
    features: list[list[float]] = []
    index: list[tuple[str, str, float]] = []

    for (zipcode, complaint_type), yearly_counts in series.items():
        if source_year not in yearly_counts:
            continue

        feat = _compose_features(
            zipcode=zipcode,
            complaint_type=complaint_type,
            year=source_year,
            yearly_counts=yearly_counts,
            embedding_dim=embedding_dim,
        )
        features.append(feat)
        index.append((zipcode, complaint_type, yearly_counts[source_year]))

    return features, index


def _compose_features(
    *,
    zipcode: str,
    complaint_type: str,
    year: int,
    yearly_counts: dict[int, float],
    embedding_dim: int,
) -> list[float]:
    current = yearly_counts.get(year, 0.0)
    lag1 = yearly_counts.get(year - 1, current)
    lag2 = yearly_counts.get(year - 2, lag1)

    count_features = [
        float(current),
        float(lag1),
        float(lag2),
        float(current - lag1),
        float(lag1 - lag2),
        float(np.mean([current, lag1, lag2])),
    ]

    embed = _combined_embedding(zipcode, complaint_type, embedding_dim=embedding_dim)
    return count_features + embed


def _combined_embedding(zipcode: str, complaint_type: str, embedding_dim: int) -> list[float]:
    zip_vec = _hash_embed(f"zip::{zipcode}", embedding_dim)
    complaint_vec = _hash_embed(f"complaint::{complaint_type}", embedding_dim)
    return zip_vec + complaint_vec


def _hash_embed(text_value: str, dim: int) -> list[float]:
    seed_bytes = hashlib.sha256(text_value.encode("utf-8")).digest()[:8]
    seed = int.from_bytes(seed_bytes, byteorder="big", signed=False)
    rng = np.random.default_rng(seed)
    vec = rng.normal(size=dim).astype(np.float32)
    norm = float(np.linalg.norm(vec))
    if norm == 0:
        return vec.tolist()
    return (vec / norm).tolist()
