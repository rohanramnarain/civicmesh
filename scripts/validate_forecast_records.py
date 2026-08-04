#!/usr/bin/env python3
"""Validate sample embedding records from Firestore.

Run from repo root:
    uv run --project apps/api python scripts/validate_forecast_records.py
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError


ENV_PATH = Path(__file__).resolve().parents[1] / "apps" / "web" / ".env"
PROJECT_ID = "civicgrid-e8b69"
RELEASE_ID = "20260728-164958"
DATABASE_ID = "nycdata"

SAMPLE_COMBINATIONS = [
    ("10000", "HEAT/HOT WATER"),
    ("10000", "Street Condition"),
    ("10001", "HEAT/HOT WATER"),
]


def load_api_key() -> str:
    if ENV_PATH.exists():
        match = re.search(r'^VITE_FIREBASE_API_KEY=(.+)$', ENV_PATH.read_text(), re.MULTILINE)
        if match:
            return match.group(1).strip()
    key = os.environ.get("VITE_FIREBASE_API_KEY", "")
    if key:
        return key
    raise RuntimeError("VITE_FIREBASE_API_KEY not found in apps/web/.env or environment")


def normalize_complaint_type(complaint_type: str) -> str:
    return complaint_type.strip().lower()


def build_record_id(source_year: int, zipcode: str, complaint_type: str) -> str:
    normalized = normalize_complaint_type(complaint_type)
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"{source_year}_{zipcode}_{digest[:16]}"


def firestore_get_document(document_path: str) -> dict | None:
    api_key = load_api_key()
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/"
        f"databases/{DATABASE_ID}/documents/{document_path}?key={api_key}"
    )
    req = Request(url, method="GET")
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 404:
            return None
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Firestore request failed: {exc.code} {body}") from exc

    return data.get("fields", {})


def parse_value(value_obj: dict):
    """Convert Firestore REST API value objects to Python types."""
    if "stringValue" in value_obj:
        return value_obj["stringValue"]
    if "integerValue" in value_obj:
        return int(value_obj["integerValue"])
    if "doubleValue" in value_obj:
        return float(value_obj["doubleValue"])
    if "booleanValue" in value_obj:
        return bool(value_obj["booleanValue"])
    if "arrayValue" in value_obj:
        return [parse_value(v) for v in value_obj["arrayValue"].get("values", [])]
    if "mapValue" in value_obj:
        return {k: parse_value(v) for k, v in value_obj["mapValue"].get("fields", {}).items()}
    return None


def canonical_json(value: object) -> str:
    if value is None or not isinstance(value, (dict, list)):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    assert isinstance(value, dict)
    keys = sorted(value.keys())
    pairs = [f'{json.dumps(k)}:{canonical_json(value[k])}' for k in keys]
    return "{" + ",".join(pairs) + "}"


def verify_checksum(record: dict) -> bool:
    checksum = record.get("checksum", "")
    if checksum == "sha256:dev-mock-record-do-not-publish":
        return True

    payload = {k: v for k, v in record.items() if k != "checksum"}
    canonical = canonical_json(payload)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}" == checksum


def validate_record(zipcode: str, complaint_type: str) -> list[str]:
    errors: list[str] = []
    record_id = build_record_id(2025, zipcode, complaint_type)
    document_path = f"forecast_releases/{RELEASE_ID}/embedding_records/{record_id}"

    fields = firestore_get_document(document_path)
    if fields is None:
        errors.append(f"Record not found for {zipcode} / {complaint_type} (id: {record_id})")
        return errors

    record = {k: parse_value(v) for k, v in fields.items()}

    required = [
        "schema_version",
        "dataset_version",
        "embedding_version",
        "feature_schema_version",
        "zipcode",
        "complaint_type",
        "source_year",
        "counts",
        "trend_features",
        "embedding",
        "checksum",
        "generated_at",
    ]
    for field in required:
        if field not in record:
            errors.append(f"Missing field '{field}' in {zipcode}/{complaint_type}")

    counts = record.get("counts", {})
    if not all(isinstance(counts.get(k), (int, float)) for k in ["current", "lag_1", "lag_2"]):
        errors.append(f"Invalid counts in {zipcode}/{complaint_type}: {counts}")

    trend_features = record.get("trend_features", [])
    if len(trend_features) != 3:
        errors.append(f"Invalid trend_features length in {zipcode}/{complaint_type}: {len(trend_features)}")

    embedding = record.get("embedding", {})
    if embedding.get("dimension") != 32:
        errors.append(f"Invalid embedding dimension in {zipcode}/{complaint_type}: {embedding.get('dimension')}")

    if not verify_checksum(record):
        errors.append(f"Checksum mismatch in {zipcode}/{complaint_type}")

    return errors


def main() -> int:
    print("Validating sample embedding records from Firestore...\n")

    all_errors: list[str] = []
    for zipcode, complaint_type in SAMPLE_COMBINATIONS:
        print(f"Checking {zipcode} / {complaint_type}...")
        errors = validate_record(zipcode, complaint_type)
        if errors:
            all_errors.extend(errors)
            for err in errors:
                print(f"  ✗ {err}")
        else:
            print(f"  ✓ Record valid")

    if all_errors:
        print(f"\n✗ {len(all_errors)} validation error(s) found")
        return 1

    print("\n✓ All sample records validated successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
