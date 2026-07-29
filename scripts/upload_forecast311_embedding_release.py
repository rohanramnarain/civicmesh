#!/usr/bin/env python3
"""Upload a Phase 2A 311 embedding release to Firestore.

Usage:
    export GOOGLE_APPLICATION_CREDENTIALS=/Users/jebonnesahossain/.keys/firebase-key.json
    cd /Users/jebonnesahossain/civicmesh
    uv run --project apps/api python scripts/upload_forecast311_embedding_release.py \
        --release-dir artifacts/forecast311/releases/20260728-164958

Requirements:
    uv add --project apps/api firebase-admin
"""
from __future__ import annotations

import argparse
import hashlib
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


def _complaint_type_hash(complaint_type: str) -> str:
    normalized = complaint_type.strip().lower()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def upload_release(release_dir: Path, *, dry_run: bool = False) -> dict[str, Any]:
    manifest_path = release_dir / "manifest.json"
    records_path = release_dir / "embedding_records.jsonl"

    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found at {manifest_path}")
    if not records_path.exists():
        raise FileNotFoundError(f"Records not found at {records_path}")

    manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    release_id = str(manifest["release_id"])

    if not dry_run:
        cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)
        db = firestore.client(database_id="nycdata")

    records: list[dict[str, Any]] = []
    with records_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    if dry_run:
        return {
            "release_id": release_id,
            "metadata_doc": f"forecast_releases/{release_id}/metadata/manifest",
            "embedding_records_collection": f"forecast_releases/{release_id}/embedding_records",
            "record_count": len(records),
            "sample_record_ids": [
                f"{r['source_year']}_{r['zipcode']}_{_complaint_type_hash(r['complaint_type'])}"
                for r in records[:3]
            ],
        }

    # Upload manifest as metadata document.
    metadata_ref = (
        db.collection("forecast_releases")
        .document(release_id)
        .collection("metadata")
        .document("manifest")
    )
    metadata_ref.set(manifest)
    print(f"Uploaded metadata to forecast_releases/{release_id}/metadata/manifest")

    # Upload each embedding record in batches.
    batch = db.batch()
    batch_count = 0
    uploaded = 0

    for record in records:
        record_id = f"{record['source_year']}_{record['zipcode']}_{_complaint_type_hash(record['complaint_type'])}"
        doc_ref = (
            db.collection("forecast_releases")
            .document(release_id)
            .collection("embedding_records")
            .document(record_id)
        )
        batch.set(doc_ref, record)
        batch_count += 1
        uploaded += 1

        if batch_count >= 500:
            batch.commit()
            print(f"Committed batch of {batch_count} records...")
            batch = db.batch()
            batch_count = 0

    if batch_count > 0:
        batch.commit()
        print(f"Committed final batch of {batch_count} records...")

    return {
        "release_id": release_id,
        "uploaded_records": uploaded,
        "metadata_path": f"forecast_releases/{release_id}/metadata/manifest",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload a Phase 2A embedding release to Firestore")
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true", help="Print what would be uploaded without uploading")
    args = parser.parse_args()

    result = upload_release(args.release_dir, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
