#!/usr/bin/env python3
"""Fix number normalization and recompute checksums for an existing release.

Python's json.dumps serializes whole-number floats as '1.0', while JavaScript's
JSON.stringify serializes them as '1'. This causes frontend checksum validation
failures. This script converts whole-number floats to integers in the existing
release records and recomputes their checksums so the frontend can validate them.

Usage:
    uv run --project apps/api --python python3.11 python scripts/fix_forecast311_record_numbers.py \
        --release-dir artifacts/forecast311/releases/20260728-164958
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def _normalize_number(value: Any) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {k: _normalize_number(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_number(v) for v in value]
    return value


def compute_checksum(record: dict[str, Any]) -> str:
    import hashlib

    body = {k: v for k, v in record.items() if k != "checksum"}
    canonical = json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def fix_release(release_dir: Path) -> dict[str, Any]:
    records_path = release_dir / "embedding_records.jsonl"
    if not records_path.exists():
        raise FileNotFoundError(f"Records not found at {records_path}")

    records: list[dict[str, Any]] = []
    with records_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                records.append(json.loads(line))

    fixed_records: list[dict[str, Any]] = []
    changed = 0
    for record in records:
        fixed = _normalize_number({k: v for k, v in record.items() if k != "checksum"})
        fixed["checksum"] = compute_checksum(fixed)
        if fixed != record:
            changed += 1
        fixed_records.append(fixed)

    backup_path = records_path.with_suffix(".jsonl.bak")
    records_path.rename(backup_path)

    with records_path.open("w", encoding="utf-8") as fh:
        for record in fixed_records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    return {
        "release_dir": str(release_dir),
        "records_processed": len(fixed_records),
        "records_changed": changed,
        "backup_path": str(backup_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fix number normalization and recompute checksums for a release"
    )
    parser.add_argument("--release-dir", type=Path, required=True)
    args = parser.parse_args()

    result = fix_release(args.release_dir)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
