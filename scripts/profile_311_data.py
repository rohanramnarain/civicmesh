#!/usr/bin/env python3
"""Profile the raw NYC 311 CSV to inform Phase 2A cleaning rules.

Usage:
    cd /Users/jebonnesahossain/civicmesh
    uv run --project apps/api python scripts/profile_311_data.py

Output:
    Prints summaries of complaint types, invalid ZIPs, valid ZIPs,
    year distribution, and top outlier counts. Copy the output to a
    notes file for rule documentation.
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

    print("=== Complaint types matching heat or street ===")
    rows = con.execute("""
        SELECT DISTINCT complaint_type, COUNT(*) AS n
        FROM nyc311
        WHERE LOWER(complaint_type) LIKE '%heat%' OR LOWER(complaint_type) LIKE '%street%'
        GROUP BY complaint_type
        ORDER BY n DESC
    """).fetchall()
    for ctype, n in rows:
        print(f"{n:>10} | {ctype}")

    print("\n=== Invalid or missing ZIP examples ===")
    rows = con.execute("""
        SELECT incident_zip, COUNT(*) AS n
        FROM nyc311
        WHERE incident_zip IS NULL OR NOT REGEXP_MATCHES(incident_zip, '^[0-9]{5}$')
        GROUP BY incident_zip
        ORDER BY n DESC
        LIMIT 30
    """).fetchall()
    for zipcode, n in rows:
        print(f"{n:>10} | {zipcode!r}")

    print("\n=== Valid 5-digit ZIP examples ===")
    rows = con.execute("""
        SELECT incident_zip, COUNT(*) AS n
        FROM nyc311
        WHERE REGEXP_MATCHES(incident_zip, '^[0-9]{5}$')
        GROUP BY incident_zip
        ORDER BY n DESC
        LIMIT 20
    """).fetchall()
    for zipcode, n in rows:
        print(f"{n:>10} | {zipcode}")

    print("\n=== Year distribution 2020-2025 ===")
    rows = con.execute("""
        SELECT YEAR(created_ts) AS y, COUNT(*) AS n
        FROM nyc311
        WHERE YEAR(created_ts) BETWEEN 2020 AND 2025
        GROUP BY y
        ORDER BY y
    """).fetchall()
    for y, n in rows:
        print(f"{y}: {n}")

    print("\n=== Top outlier counts per ZIP + type + year ===")
    rows = con.execute("""
        SELECT incident_zip, complaint_type, YEAR(created_ts) AS y, COUNT(*) AS n
        FROM nyc311
        WHERE incident_zip IS NOT NULL AND complaint_type IS NOT NULL
        GROUP BY incident_zip, complaint_type, YEAR(created_ts)
        ORDER BY n DESC
        LIMIT 30
    """).fetchall()
    for zipcode, ctype, y, n in rows:
        print(f"{n:>10} | {zipcode} | {ctype} | {y}")


if __name__ == "__main__":
    main()
