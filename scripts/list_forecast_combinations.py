#!/usr/bin/env python3
"""List available ZIP + complaint-type combinations in a Firestore release.

Run from repo root:
    uv run --project apps/api python scripts/list_forecast_combinations.py
"""
from __future__ import annotations

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


def load_api_key() -> str:
    if ENV_PATH.exists():
        match = re.search(r'^VITE_FIREBASE_API_KEY=(.+)$', ENV_PATH.read_text(), re.MULTILINE)
        if match:
            return match.group(1).strip()
    key = os.environ.get("VITE_FIREBASE_API_KEY", "")
    if key:
        return key
    raise RuntimeError("VITE_FIREBASE_API_KEY not found in apps/web/.env or environment")


def firestore_list_documents(collection_path: str) -> list[dict]:
    api_key = load_api_key()
    url = (
        f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/"
        f"databases/{DATABASE_ID}/documents/{collection_path}?key={api_key}&pageSize=1000"
    )
    req = Request(url, method="GET")
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Firestore request failed: {exc.code} {body}") from exc

    docs = data.get("documents", [])
    return [doc.get("fields", {}) for doc in docs]


def main() -> int:
    collection_path = f"forecast_releases/{RELEASE_ID}/embedding_records"
    print(f"Listing embedding records from Firestore: {collection_path}")

    try:
        records = firestore_list_documents(collection_path)
    except RuntimeError as exc:
        print(f"Error: {exc}")
        return 1

    if not records:
        print("No embedding records found.")
        return 0

    combinations: set[tuple[str, str]] = set()
    invalid = 0
    for fields in records:
        zipcode = fields.get("zipcode", {}).get("stringValue", "")
        complaint_type = fields.get("complaint_type", {}).get("stringValue", "")
        if zipcode and complaint_type:
            combinations.add((zipcode, complaint_type))
        else:
            invalid += 1

    print(f"\nTotal records: {len(records)}")
    print(f"Unique ZIP + complaint-type combinations: {len(combinations)}")
    if invalid:
        print(f"Records missing zipcode or complaint_type: {invalid}")

    print("\nFirst 20 combinations:")
    for zipcode, complaint_type in sorted(combinations)[:20]:
        print(f"  {zipcode} / {complaint_type}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
