import {
  loadSelectorManifest,
  type SelectorCombination,
  type SelectorManifest,
  type SelectorManifestResult,
} from "./forecast/selectorManifest";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:8000";

export type DatasetSearchResult = {
  dataset_id: string;
  title: string;
  description: string;
  agency_name: string;
  category: string;
  rows_count: number;
  source_url: string;
};

export type PublishRunRequest = {
  run_id: string;
  question: string;
  model_name: string;
  embedding_key: string;
  selected_dataset_ids: string[];
  result_payload: Record<string, unknown>;
};

export async function runCatalogIngest(limit: number, topK: number): Promise<{
  ingest_run_id: string;
  datasets_scanned: number;
  datasets_selected: number;
  status: string;
}> {
  const url = new URL(`${API_BASE_URL}/ingest/catalog`);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("top_k", String(topK));

  const response = await fetch(url, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Ingest failed with status ${response.status}`);
  }

  return response.json();
}

export async function searchDatasets(query: string): Promise<DatasetSearchResult[]> {
  const url = new URL(`${API_BASE_URL}/datasets/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "8");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Search failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { results: DatasetSearchResult[] };
  return payload.results;
}

/**
 * @deprecated The forecast workspace no longer loads a "featured dataset" from
 * the backend API. Use SelectorDataset and getSelectorDataset instead.
 */
export type FeaturedDataset = {
  dataset_id: string;
  title: string;
  description: string;
  agency_name: string;
  category: string;
  source_url: string;
  years: number[];
  metrics: string[];
  rows: {
    zipcode: string;
    complaint_type: string;
    year: number;
    complaint_count: number;
  }[];
};

export type SelectorDataset = {
  release_id: string;
  dataset_version: string;
  embedding_version: string;
  feature_schema_version: string;
  source_years: number[];
  target_year: number;
  record_count: number;
  combinations: SelectorCombination[];
  generated_at: string;
  is_mock: boolean;
};

function selectorDatasetFromManifest(
  manifest: SelectorManifest,
  isMock: boolean
): SelectorDataset {
  return {
    release_id: manifest.release_id,
    dataset_version: manifest.dataset_version,
    embedding_version: manifest.embedding_version,
    feature_schema_version: manifest.feature_schema_version,
    source_years: manifest.source_years,
    target_year: manifest.target_year,
    record_count: manifest.record_count,
    combinations: manifest.combinations,
    generated_at: manifest.generated_at,
    is_mock: isMock,
  };
}

export type SelectorDatasetResult =
  | { status: "ready"; dataset: SelectorDataset }
  | { status: "empty" }
  | { status: "unavailable"; reason: string };

/**
 * Load the selector dataset for the active forecast release.
 *
 * This function no longer falls back to the backend API at
 * http://localhost:8000. It reads the selector manifest directly from
 * Firestore (or a bundled dev manifest) so production never silently shows
 * mock data as live data.
 */
export async function getSelectorDataset(): Promise<SelectorDatasetResult> {
  const manifestResult: SelectorManifestResult = await loadSelectorManifest();

  if (manifestResult.status === "live") {
    return {
      status: "ready",
      dataset: selectorDatasetFromManifest(manifestResult.manifest, false),
    };
  }

  if (manifestResult.status === "mock") {
    return {
      status: "ready",
      dataset: selectorDatasetFromManifest(manifestResult.manifest, true),
    };
  }

  if (manifestResult.status === "empty") {
    return { status: "empty" };
  }

  return {
    status: "unavailable",
    reason: manifestResult.reason,
  };
}

/**
 * @deprecated Use getSelectorDataset instead.
 */
export async function getFeaturedDataset(): Promise<FeaturedDataset> {
  throw new Error(
    "getFeaturedDataset is deprecated. Use getSelectorDataset for the forecast workspace."
  );
}

export async function publishRun(
  payload: PublishRunRequest,
  bearerToken: string
): Promise<{ run_id: string; user_id: string; created: boolean; created_on_ts: string | null }> {
  const url = `${API_BASE_URL}/runs/publish`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Publish failed with status ${response.status}`);
  }

  return response.json();
}
