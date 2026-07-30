import type { EmbeddingRecord } from "./featureBuilder";

/**
 * Development-only mock embedding record.
 * Used when Firestore is not configured so the local inference path can still
 * be exercised without Firebase credentials.
 */
export const MOCK_EMBEDDING_RECORD: EmbeddingRecord = {
  schema_version: "forecast-embedding-record-v1",
  dataset_version: "nyc311-2025-v1",
  embedding_version: "311-embed-v1",
  feature_schema_version: "forecast-features-v1",
  zipcode: "10027",
  complaint_type: "heat/hot water",
  source_year: 2025,
  counts: {
    current: 142,
    lag_1: 134,
    lag_2: 119,
  },
  trend_features: [8, 15, 131.67],
  embedding: {
    encoding: "int8-scale",
    dimension: 32,
    scale: 0.0078125,
    values_base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  },
  checksum: "sha256:dev-mock-record-do-not-publish",
  generated_at: "2026-07-25T00:00:00Z",
};
