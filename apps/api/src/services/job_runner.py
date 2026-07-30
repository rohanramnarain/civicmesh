from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Any

from sqlalchemy import create_engine, text

from src.services.job_registry import JobSpec, MVP_JOB_SPECS
from src.services.soql import SoqlClient


@dataclass
class DatasetMatch:
    role: str
    dataset_id: str
    title: str
    source_url: str


@dataclass
class JobRunResult:
    job_id: str
    title: str
    objective: str
    datasets: list[DatasetMatch]
    output_rows: list[dict[str, Any]]
    reproducibility: dict[str, Any]
    caveats: list[str]


class JobRunner:
    def __init__(self, *, database_url: str, soql_client: SoqlClient) -> None:
        self.engine = create_engine(database_url, pool_pre_ping=True)
        self.soql = soql_client

    def list_jobs(self) -> list[JobSpec]:
        return list(MVP_JOB_SPECS.values())

    def run_job(self, job_id: str, limit: int = 10) -> JobRunResult:
        spec = MVP_JOB_SPECS.get(job_id)
        if spec is None:
            raise ValueError(f"Unknown job_id: {job_id}")

        datasets = self._resolve_required_datasets(spec)
        signal_rows: list[dict[str, Any]] = []
        query_log: list[dict[str, Any]] = []

        for match in datasets:
            summary, query = self._run_dataset_signal(match.dataset_id)
            query_log.append({"role": match.role, "dataset_id": match.dataset_id, "query": query})
            signal_rows.extend(
                {
                    "geography": row["geography"],
                    f"{match.role}_signal": row["signal"],
                }
                for row in summary
            )

        combined = _merge_signals(signal_rows)
        scored = _score_rows(combined)
        output_rows = scored[:limit]

        caveats = [
            "Signals are proxy metrics derived from available public columns and may not represent causal effects.",
            "Dataset schemas vary across agencies; inferred fields can shift over time.",
        ]

        reproducibility = {
            "job_id": spec.job_id,
            "queries": query_log,
            "engine_version": "job-runner-v0.1",
        }

        return JobRunResult(
            job_id=spec.job_id,
            title=spec.title,
            objective=spec.objective,
            datasets=datasets,
            output_rows=output_rows,
            reproducibility=reproducibility,
            caveats=caveats,
        )

    def _resolve_required_datasets(self, spec: JobSpec) -> list[DatasetMatch]:
        matches: list[DatasetMatch] = []

        sql = text(
            """
            SELECT dataset_id, title, source_url
            FROM datasets_metadata
            WHERE to_tsvector('english', title || ' ' || COALESCE(description, '') || ' ' || COALESCE(category, ''))
                @@ websearch_to_tsquery('english', :q)
            ORDER BY updated_on_ts DESC
            LIMIT 1
            """
        )

        with self.engine.begin() as conn:
            for role, terms in spec.required_roles.items():
                q = " OR ".join(terms)
                row = conn.execute(sql, {"q": q}).mappings().first()
                if row is None:
                    raise ValueError(f"No dataset matched role '{role}' for job {spec.job_id}")

                matches.append(
                    DatasetMatch(
                        role=role,
                        dataset_id=str(row["dataset_id"]),
                        title=str(row["title"]),
                        source_url=str(row["source_url"]),
                    )
                )

        return matches

    def _run_dataset_signal(self, dataset_id: str) -> tuple[list[dict[str, Any]], dict[str, str]]:
        schema = self.soql.fetch_schema(dataset_id)

        geo_col = _pick_first(schema.columns, ["borough", "boro", "community", "district", "zip"]) or "borough"
        measure_col = _pick_first(schema.columns, ["count", "score", "violation", "complaint", "total"])

        if measure_col:
            soql = {
                "$select": f"{geo_col} as geography, count(*) as signal",
                "$where": f"{geo_col} IS NOT NULL",
                "$group": geo_col,
                "$order": "signal DESC",
                "$limit": "30",
            }
        else:
            soql = {
                "$select": f"{geo_col} as geography, count(*) as signal",
                "$where": f"{geo_col} IS NOT NULL",
                "$group": geo_col,
                "$order": "signal DESC",
                "$limit": "30",
            }

        rows = self.soql.query(dataset_id=dataset_id, soql_params=soql)
        normalized = [
            {
                "geography": str(row.get("geography", "UNKNOWN") or "UNKNOWN").strip(),
                "signal": float(row.get("signal", 0) or 0),
            }
            for row in rows
        ]

        return normalized, soql


def _pick_first(columns: list[dict[str, str]], keywords: list[str]) -> str | None:
    lowered = [((c.get("name", "") + " " + c.get("display_name", "")).lower(), c.get("name", "")) for c in columns]
    for keyword in keywords:
        for haystack, name in lowered:
            if keyword in haystack and name:
                return name
    return None


def _merge_signals(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_geo: dict[str, dict[str, Any]] = {}

    for row in rows:
        geo = row["geography"]
        existing = by_geo.setdefault(geo, {"geography": geo})
        for key, value in row.items():
            if key.endswith("_signal"):
                existing[key] = float(value)

    return list(by_geo.values())


def _score_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return []

    signal_keys = sorted({k for row in rows for k in row if k.endswith("_signal")})
    for row in rows:
        signals = [float(row.get(k, 0.0) or 0.0) for k in signal_keys]
        row["combined_score"] = round(mean(signals) if signals else 0.0, 4)

    return sorted(rows, key=lambda x: x["combined_score"], reverse=True)
