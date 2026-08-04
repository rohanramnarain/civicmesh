#!/usr/bin/env python3
"""Check if a specific forecast release exists in Firestore nycdata."""
from __future__ import annotations

import argparse
import sys

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except ImportError as exc:  # pragma: no cover
    raise ImportError("firebase-admin is required") from exc


def check_release(release_id: str) -> bool:
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)
    db = firestore.client(database_id="nycdata")

    metadata_ref = (
        db.collection("forecast_releases")
        .document(release_id)
        .collection("metadata")
        .document("manifest")
    )
    manifest = metadata_ref.get().to_dict()
    if not manifest:
        print(f"Release {release_id}: NOT FOUND")
        return False

    records_ref = (
        db.collection("forecast_releases")
        .document(release_id)
        .collection("embedding_records")
    )
    count = sum(1 for _ in records_ref.limit(1).stream())

    print(f"Release {release_id}: FOUND")
    print(f"  Manifest keys: {sorted(manifest.keys())}")
    print(f"  Has embedding_records: {'yes' if count > 0 else 'no'}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-id", type=str, required=True)
    args = parser.parse_args()
    found = check_release(args.release_id)
    sys.exit(0 if found else 1)


if __name__ == "__main__":
    main()
