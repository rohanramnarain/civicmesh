#!/usr/bin/env python3
"""Build a Phase 2A 311 embedding release.

This script loads the raw Data.gov NYC 311 CSV, applies the cleaning rules
defined in apps/api/src/data/forecast-features-v1.json, generates deterministic
hash embeddings, quantizes them to int8, and writes compact embedding records,
a release manifest, and a coverage report to a local output directory.

Usage:
    cd /Users/jebonnesahossain/civicmesh
    uv run --project apps/api python scripts/build_forecast311_embedding_release.py

Output:
    artifacts/forecast311/releases/{release_id}/
        manifest.json
        coverage_report.json
        embedding_records.jsonl
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import duckdb
import numpy as np

CSV_PATH = Path(__file__).resolve().parents[1] / "civicmesh-1" / "nycdata" / "311data.csv"
SCHEMA_PATH = Path(__file__).resolve().parents[1] / "apps" / "api" / "src" / "data" / "forecast-features-v1.json"
OUTPUT_ROOT = Path(__file__).resolve().parents[1] / "artifacts" / "forecast311" / "releases"

SCHEMA_VERSION = "forecast-embedding-record-v1"
DATASET_VERSION = "nyc311-2025-v1"
EMBEDDING_VERSION = "311-embed-v1"
FEATURE_SCHEMA_VERSION = "forecast-features-v1"
EMBEDDING_MODEL = "hash-embed-v1"

ALIAS_MAP: dict[str, str] = {
    "heat/hot water": "HEAT/HOT WATER",
    "street condition": "Street Condition",
}

SCOPE_TYPES = {"HEAT/HOT WATER", "Street Condition"}


def standardize_zip(raw_zip: str | None) -> str:
    if raw_zip is None:
        return "MISSING"
    cleaned = str(raw_zip).strip()
    digits = re.sub(r"\D", "", cleaned)
    if re.fullmatch(r"\d{5}", digits):
        return digits
    return "MISSING"


def standardize_complaint_type(raw_type: str | None) -> str:
    if raw_type is None:
        return "MISSING"
    cleaned = str(raw_type).strip().lower()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def apply_alias(standardized_type: str) -> str:
    return ALIAS_MAP.get(standardized_type, standardized_type)


def normalize_for_record_id(complaint_type: str) -> str:
    return complaint_type.strip().lower()


def complaint_type_hash(complaint_type: str) -> str:
    normalized = normalize_for_record_id(complaint_type)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def record_id(source_year: int, zipcode: str, complaint_type: str) -> str:
    return f"{source_year}_{zipcode}_{complaint_type_hash(complaint_type)}"


def _hash_embed(text_value: str, dim: int) -> list[float]:
    digest = hashlib.sha256(text_value.encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big", signed=False)
    rng = np.random.default_rng(seed)
    vec = rng.normal(size=dim).astype(np.float32)
    norm = float(np.linalg.norm(vec))
    if norm == 0:
        return vec.tolist()
    return (vec / norm).tolist()


def generate_embedding(zipcode: str, complaint_type: str, dim: int) -> list[float]:
    half_dim = dim // 2
    zip_vec = _hash_embed(f"zip::{zipcode}", half_dim)
    complaint_vec = _hash_embed(f"complaint::{complaint_type}", half_dim)
    return zip_vec + complaint_vec


def quantize_vector(vec: list[float]) -> dict[str, Any]:
    arr = np.asarray(vec, dtype=np.float32)
    max_abs = float(np.max(np.abs(arr)))
    if max_abs == 0:
        scale = 1.0
    else:
        scale = max_abs / 127.0

    quantized = np.clip(np.round(arr / scale), -127, 127).astype(np.int8)
    encoded = base64.b64encode(quantized.tobytes()).decode("utf-8")

    return {
        "encoding": "int8-scale",
        "dimension": int(len(vec)),
        "scale": scale,
        "values_base64": encoded,
    }


def decode_vector(payload: dict[str, Any]) -> list[float]:
    raw = base64.b64decode(payload["values_base64"])
    int8_arr = np.frombuffer(raw, dtype=np.int8)
    return (int8_arr * payload["scale"]).astype(np.float32).tolist()


def compute_checksum(record: dict[str, Any]) -> str:
    body = {k: v for k, v in record.items() if k != "checksum"}
    canonical = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _normalize_number(value: Any) -> Any:
    """Convert whole-number floats to ints so Python/JS JSON serialization matches."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize_number(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_number(v) for v in value]
    return value


def build_feature_record(
    zipcode: str,
    complaint_type: str,
    source_year: int,
    yearly_counts: dict[int, int],
    embedding_dim: int,
) -> dict[str, Any]:
    current = float(yearly_counts.get(source_year, 0))
    lag1 = float(yearly_counts.get(source_year - 1, current))
    lag2 = float(yearly_counts.get(source_year - 2, lag1))

    counts = {
        "current": current,
        "lag_1": lag1,
        "lag_2": lag2,
    }

    trend_features = [
        round(current - lag1, 2),
        round(lag1 - lag2, 2),
        round(np.mean([current, lag1, lag2]), 2),
    ]

    embedding_vec = generate_embedding(zipcode, complaint_type, embedding_dim)
    embedding_payload = quantize_vector(embedding_vec)

    record: dict[str, Any] = _normalize_number({
        "schema_version": SCHEMA_VERSION,
        "dataset_version": DATASET_VERSION,
        "embedding_version": EMBEDDING_VERSION,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "zipcode": zipcode,
        "complaint_type": complaint_type,
        "source_year": source_year,
        "counts": counts,
        "trend_features": trend_features,
        "embedding": embedding_payload,
        "generated_at": datetime.now(tz=UTC).isoformat(),
    })

    record["checksum"] = compute_checksum(record)
    return record


def load_and_clean_rows(
	csv_path: Path, 
	min_year: int,
	max_year: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    con = duckdb.connect()
    con.execute(f"""
        CREATE OR REPLACE VIEW nyc311 AS
        SELECT
            cast("created_date" as date) AS created_ts,
            "complaint_type" AS complaint_type,
            "incident_zip" AS incident_zip
        FROM read_csv_auto('{csv_path}', header=true, all_varchar=true)
    """)

    query = f"""
        SELECT incident_zip, complaint_type, YEAR(created_ts) AS y, COUNT(*) AS n
        FROM nyc311
        WHERE YEAR(created_ts) BETWEEN {min_year} AND {max_year}
        GROUP BY incident_zip, complaint_type, YEAR(created_ts)
    """
    raw_rows = con.execute(query).fetchall()

    cleaned: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()

    for raw_zip, raw_type, year, count in raw_rows:
        zipcode = standardize_zip(raw_zip)
        standardized_type = standardize_complaint_type(raw_type)
        canonical_type = apply_alias(standardized_type)

        if zipcode == "MISSING":
            rejected.append({
                "incident_zip": raw_zip,
                "complaint_type": raw_type,
                "year": year,
                "count": count,
                "rejection_reason": "invalid_or_missing_zip",
            })
            continue

        if canonical_type not in SCOPE_TYPES:
            rejected.append({
                "incident_zip": raw_zip,
                "complaint_type": raw_type,
                "year": year,
                "count": count,
                "rejection_reason": "outside_phase2a_scope",
            })
            continue

        key = (zipcode, canonical_type, year)
        if key in seen:
            rejected.append({
                "zipcode": zipcode,
                "complaint_type": canonical_type,
                "year": year,
                "count": count,
                "rejection_reason": "exact_duplicate",
            })
            continue

        seen.add(key)
        cleaned.append({
            "zipcode": zipcode,
            "complaint_type": canonical_type,
            "year": year,
            "complaint_count": max(int(count), 0),
        })

    return cleaned, rejected


def aggregate_series(rows: list[dict[str, Any]]) -> dict[tuple[str, str], dict[int, int]]:
    series: dict[tuple[str, str], dict[int, int]] = {}
    for row in rows:
        key = (row["zipcode"], row["complaint_type"])
        year_map = series.setdefault(key, {})
        year_map[row["year"]] = max(year_map.get(row["year"], 0) + row["complaint_count"], 0)
    return series


def build_release_artifacts(
    *,
    csv_path: Path,
    output_dir: Path,
    source_years: list[int],
    embedding_dim: int,
    release_id: str,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    min_year = min(source_years) - 2
    max_year = max(source_years)
    cleaned_rows, rejected_rows = load_and_clean_rows(csv_path, min_year, max_year)
    series = aggregate_series(cleaned_rows)

    records_path = output_dir / "embedding_records.jsonl"
    records: list[dict[str, Any]] = []

    with records_path.open("w", encoding="utf-8") as fh:
        for source_year in sorted(source_years):
            for (zipcode, complaint_type), yearly_counts in sorted(series.items()):
                if source_year not in yearly_counts:
                    continue

                record = build_feature_record(
                    zipcode=zipcode,
                    complaint_type=complaint_type,
                    source_year=source_year,
                    yearly_counts=yearly_counts,
                    embedding_dim=embedding_dim,
                )
                records.append(record)
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    # Validate quantization parity for a sample of records.
    parity_errors = 0
    for record in records[:100]:
        decoded = decode_vector(record["embedding"])
        original = generate_embedding(record["zipcode"], record["complaint_type"], embedding_dim)
        max_error = max(abs(d - o) for d, o in zip(decoded, original))
        if max_error > 0.01:
            parity_errors += 1

    rejected_by_reason: dict[str, int] = Counter(
        row.get("rejection_reason", "unknown") for row in rejected_rows
    )

    all_counts = [record["counts"]["current"] for record in records]
    outlier_threshold = float(np.percentile(all_counts, 99)) if all_counts else 0.0
    outliers = [
        {
            "zipcode": r["zipcode"],
            "complaint_type": r["complaint_type"],
            "source_year": r["source_year"],
            "current_count": r["counts"]["current"],
        }
        for r in records
        if r["counts"]["current"] > outlier_threshold
    ]

    manifest = {
        "release_id": release_id,
        "dataset_version": DATASET_VERSION,
        "embedding_version": EMBEDDING_VERSION,
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dimension": embedding_dim,
        "source_years": source_years,
        "target_year": max(source_years) + 1,
        "record_count": len(records),
        "records_path": str(records_path),
        "generated_at": datetime.now(tz=UTC).isoformat(),
    }

    coverage_report = {
        "release_id": release_id,
        "source_csv": str(csv_path),
        "cleaned_rows": len(cleaned_rows),
        "rejected_rows": len(rejected_rows),
        "rejected_by_reason": dict(rejected_by_reason),
        "embedding_records": len(records),
        "unique_zipcodes": len({r["zipcode"] for r in records}),
        "complaint_type_breakdown": dict(
            Counter(r["complaint_type"] for r in records)
        ),
        "year_coverage": {
            str(year): sum(1 for r in records if r["source_year"] == year)
            for year in source_years
        },
        "quantization_parity_errors": parity_errors,
        "outlier_threshold": round(outlier_threshold, 2),
        "flagged_outliers": outliers[:20],
    }

    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "coverage_report.json").write_text(
        json.dumps(coverage_report, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"Wrote {len(records)} records to {records_path}")
    print(f"Manifest: {output_dir / 'manifest.json'}")
    print(f"Coverage report: {output_dir / 'coverage_report.json'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Phase 2A 311 embedding release")
    parser.add_argument("--input", type=Path, default=CSV_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_ROOT)
    parser.add_argument(
        "--source-years", 
        type=int, 
        nargs="+",
        default=[2021, 2022, 2023, 2024, 2025],
        help="Source years to generate embedding records for",
    )
    parser.add_argument("--embedding-dim", type=int, default=32)
    parser.add_argument(
        "--release-id",
        type=str,
        default=datetime.now(tz=UTC).strftime("%Y%m%d-%H%M%S"),
    )
    args = parser.parse_args()

    output_dir = args.output / args.release_id
    build_release_artifacts(
        csv_path=args.input,
        output_dir=output_dir,
        source_years=args.source_years,
        embedding_dim=args.embedding_dim,
        release_id=args.release_id,
    )


if __name__ == "__main__":
    main()
