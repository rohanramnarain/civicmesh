#!/usr/bin/env python3
"""Download a Phase 2A 311 embedding release from Firestore.

Usage:
    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/firebase-key.json
    uv run --project apps/api python scripts/download_forecast311_embedding_release.py \
        --release-id 20260728-164958

Requirements:
    uv add --project apps/api firebase-admin
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "firebase-admin is required. Run: uv add --project apps/api firebase-admin"
    ) from exc


def download_release(
    release_id: str,
    output_dir: Path,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    records_path = output_dir / "embedding_records.jsonl"

    if not dry_run:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
        db = firestore.client(database_id="nycdata")

    if dry_run:
        return {
            "release_id": release_id,
            "output_dir": str(output_dir),
            "manifest_path": str(manifest_path),
            "records_path": str(records_path),
            "dry_run": True,
        }

    # Download manifest.
    metadata_ref = (
        db.collection("forecast_releases")
        .document(release_id)
        .collection("metadata")
        .document("manifest")
    )
    manifest = metadata_ref.get().to_dict()
    if not manifest:
        raise ValueError(f"Manifest not found for release {release_id}")

    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Downloaded manifest to {manifest_path}")

    # Download embedding records in batches.
    records_ref = (
        db.collection("forecast_releases")
        .document(release_id)
        .collection("embedding_records")
    )

    downloaded = 0
    with records_path.open("w", encoding="utf-8") as fh:
        for doc in records_ref.stream():
            record = doc.to_dict()
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            downloaded += 1
            if downloaded % 500 == 0:
                print(f"Downloaded {downloaded} records...")

    print(f"Downloaded {downloaded} records to {records_path}")

    return {
        "release_id": release_id,
        "output_dir": str(output_dir),
        "manifest_path": str(manifest_path),
        "records_path": str(records_path),
        "downloaded_records": downloaded,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download a Phase 2A embedding release from Firestore"
    )
    parser.add_argument("--release-id", type=str, required=True)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("artifacts/forecast311/releases"),
        help="Root directory where release_id/ will be created",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be downloaded without downloading",
    )
    args = parser.parse_args()

    release_dir = args.output_dir / args.release_id
    result = download_release(
        args.release_id,
        release_dir,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
