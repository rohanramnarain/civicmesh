#!/usr/bin/env python3
"""List all invalid ZIP codes in the raw NYC 311 CSV.

Usage:
    cd /Users/jebonnesahossain/civicmesh
    uv run --project apps/api python scripts/list_invalid_zips.py
"""
from __future__ import annotations

from pathlib import Path

import duckdb

CSV_PATH = Path(__file__).resolve().parents[1] / "civicmesh-1" / "nycdata" / "311data.csv"


def main() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"311 CSV not found at {CSV_PATH}")

    con = duckdb.connect()
    con.execute(f"""
        CREATE OR REPLACE VIEW nyc311 AS
        SELECT
            strptime("Created Date", '%m/%d/%Y %I:%M:%S %p') AS created_ts,
            "Problem (formerly Complaint Type)" AS complaint_type,
            "Incident Zip" AS incident_zip
        FROM read_csv_auto('{CSV_PATH}', header=true, all_varchar=true)
    """)

    print("=== All invalid or missing ZIP codes ===")
    rows = con.execute("""
        SELECT incident_zip, COUNT(*) AS n
        FROM nyc311
        WHERE incident_zip IS NULL OR NOT REGEXP_MATCHES(incident_zip, '^[0-9]{5}$')
        GROUP BY incident_zip
        ORDER BY n DESC
    """).fetchall()

    print(f"Total distinct invalid ZIP values: {len(rows)}")
    print()
    for zipcode, n in rows:
        print(f"{n:>10} | {zipcode!r}")


if __name__ == "__main__":
    main()
