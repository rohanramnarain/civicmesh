#!/usr/bin/env python3
"""Seed the featured 311 dataset into Firestore config/featuredDataset.

This script is optional. The CivicGrid web app falls back to the API endpoint
/datasets/featured when Firestore is not configured or the document does not
exist. Run this script only when you want to demo the Firebase read path.

Requirements:
    pip install firebase-admin
    GOOGLE_APPLICATION_CREDENTIALS must point to a service-account JSON file
    with permission to write to Firestore.

Example:
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
        python scripts/seed_featured_firestore.py
"""
from __future__ import annotations

import json
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


DATA_PATH = Path(__file__).resolve().parents[1] / "apps" / "api" / "src" / "data" / "featured_311.json"


def main() -> None:
    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Featured dataset not found at {DATA_PATH}")

    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    with DATA_PATH.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)

    db.collection("config").document("featuredDataset").set(payload)
    print(f"Seeded config/featuredDataset with {len(payload.get('rows', []))} rows.")


if __name__ == "__main__":
    main()
