import { getFeaturedDatasetFromFirestore } from "./firebase";

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

export async function getFeaturedDataset(): Promise<FeaturedDataset> {
  const fromFirestore = await getFeaturedDatasetFromFirestore();
  if (fromFirestore) {
    return fromFirestore;
  }

  const url = `${API_BASE_URL}/datasets/featured`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Featured dataset failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { featured: FeaturedDataset };
  return payload.featured;
}

export type ForecastPrediction = {
  zipcode: string;
  complaint_type: string;
  source_year: number;
  target_year: number;
  source_count: number;
  predicted_count: number;
};

export type ForecastResult = {
  source_year: number;
  target_year: number;
  model_comparison: {
    model_name: string;
    mae: number;
    rmse: number;
    trained_on_rows: number;
    validation_rows: number;
  }[];
  predictions: Record<string, ForecastPrediction[]>;
};

export async function runForecast311(rows: FeaturedDataset["rows"]): Promise<ForecastResult> {
  const url = `${API_BASE_URL}/forecast311/train-and-predict`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rows,
      source_year: 2025,
      target_year: 2026,
    }),
  });
  if (!response.ok) {
    throw new Error(`Forecast failed with status ${response.status}`);
  }
  return response.json() as Promise<ForecastResult>;
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
