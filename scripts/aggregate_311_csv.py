#!/usr/bin/env python3
"""Aggregate civicmesh-1/nycdata/311data.csv into the featured dataset format.

This script reads the raw 17 GB NYC 311 CSV, filters to 2020-2025, groups by
year / incident_zip / complaint_type, keeps the top ZIPs for a few high-volume
civic complaint types, and writes apps/api/src/data/featured_311.json.

Requirements:
    uv run python scripts/aggregate_311_csv.py

The script uses DuckDB for streaming aggregation so it does not load the full
CSV into memory.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb

CSV_PATH = Path(__file__).resolve().parents[1] / "civicmesh-1" / "nycdata" / "311data.csv"
OUTPUT_PATH = (
    Path(__file__).resolve().parents[1] / "apps" / "api" / "src" / "data" / "featured_311.json"
)
YEARS = [2020, 2021, 2022, 2023, 2024, 2025]
COMPLAINT_TYPES = ["HEAT/HOT WATER", "Street Condition"]
ZIPS_PER_TYPE = 5


def main() -> None:
    if not CSV_PATH.exists():
        raise FileNotFoundError(f"311 CSV not found at {CSV_PATH}")

    con = duckdb.connect()
    con.execute(f"""
        CREATE OR REPLACE VIEW nyc311 AS
        SELECT
            CAST(created_date AS TIMESTAMP) AS created_date,
            complaint_type,
            incident_zip
        FROM read_csv_auto('{CSV_PATH}', header=true, all_varchar=true)
    """)

    # Identify top ZIPs per complaint type across the full 2020-2025 window.
    top_zips_sql = """
        SELECT incident_zip, complaint_type, SUM(n) AS total
        FROM (
            SELECT incident_zip, complaint_type, YEAR(created_date) AS y, COUNT(*) AS n
            FROM nyc311
            WHERE YEAR(created_date) BETWEEN 2020 AND 2025
              AND incident_zip IS NOT NULL
              AND incident_zip ~ '^[0-9]{5}$'
              AND complaint_type = ANY(?)
            GROUP BY incident_zip, complaint_type, y
        )
        GROUP BY incident_zip, complaint_type
        ORDER BY complaint_type, total DESC
    """
    top_rows = con.execute(top_zips_sql, [COMPLAINT_TYPES]).fetchall()

    selected: dict[str, list[str]] = {ct: [] for ct in COMPLAINT_TYPES}
    for zipcode, ctype, _total in top_rows:
        if len(selected[ctype]) < ZIPS_PER_TYPE:
            selected[ctype].append(zipcode)

    all_selected_zips = sorted({z for zips in selected.values() for z in zips})
    if len(all_selected_zips) < ZIPS_PER_TYPE:
        raise ValueError("Could not select enough ZIPs from the CSV.")

    # Aggregate counts for the selected ZIPs and complaint types.
    agg_sql = """
        SELECT incident_zip, complaint_type, YEAR(created_date) AS y, COUNT(*) AS n
        FROM nyc311
        WHERE YEAR(created_date) BETWEEN 2020 AND 2025
          AND incident_zip = ANY(?)
          AND complaint_type = ANY(?)
        GROUP BY incident_zip, complaint_type, YEAR(created_date)
        ORDER BY complaint_type, incident_zip, y
    """
    agg_rows = con.execute(agg_sql, [all_selected_zips, COMPLAINT_TYPES]).fetchall()

    # Fill missing year/type/zip combos with zero so the table is rectangular.
    counts: dict[tuple[str, str], dict[int, int]] = {}
    for zipcode, ctype, year, n in agg_rows:
        counts.setdefault((zipcode, ctype), {})[year] = int(n)

    rows: list[dict[str, Any]] = []
    for ctype in COMPLAINT_TYPES:
        for zipcode in selected[ctype]:
            for year in YEARS:
                rows.append(
                    {
                        "zipcode": zipcode,
                        "complaint_type": ctype,
                        "year": year,
                        "complaint_count": counts.get((zipcode, ctype), {}).get(year, 0),
                    }
                )

    payload = {
        "dataset_id": "nyc-311-zip-complaints-2020-2025",
        "title": "NYC 311 Service Requests by ZIP Code and Complaint Type (2020-2025)",
        "description": (
            "Annual counts of selected 311 complaint types grouped by incident ZIP code, "
            "derived from the raw 2010-present 311 export. Useful for tracking heat/hot-water "
            "burden and street-condition trends across New York City neighborhoods "
            "ahead of 2026 planning."
        ),
        "agency_name": "NYC 311 / Mayor's Office of Data Analytics",
        "category": "Social Services",
        "source_url": "https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9",
        "years": YEARS,
        "metrics": ["zipcode", "complaint_type", "year", "complaint_count"],
        "rows": rows,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)

    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")
    print("Selected ZIPs:")
    for ctype, zips in selected.items():
        print(f"  {ctype}: {', '.join(zips)}")


if __name__ == "__main__":
    main()
