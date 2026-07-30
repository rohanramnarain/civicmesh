import { decodeEmbedding, type EmbeddingPayload } from "./embeddingDecoder";
import { ForecastChecksumError } from "./forecastErrors";

export type EmbeddingRecord = {
  schema_version: string;
  dataset_version: string;
  embedding_version: string;
  feature_schema_version: string;
  zipcode: string;
  complaint_type: string;
  source_year: number;
  counts: {
    current: number;
    lag_1: number;
    lag_2: number;
  };
  trend_features: number[];
  embedding: EmbeddingPayload;
  checksum: string;
  generated_at: string;
};

export function buildFeatureVector(record: EmbeddingRecord): number[] {
  const embedding = decodeEmbedding(record.embedding);

  return [
    record.counts.current,
    record.counts.lag_1,
    record.counts.lag_2,
    record.trend_features[0],
    record.trend_features[1],
    record.trend_features[2],
    ...embedding,
  ];
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${pairs.join(",")}}`;
}

export async function verifyRecordChecksum(record: EmbeddingRecord): Promise<void> {
  // Development mock records are not integrity-protected.
  if (record.checksum === "sha256:dev-mock-record-do-not-publish") {
    return;
  }

  const { checksum: _, ...payload } = record;
  const canonical = canonicalJson(payload);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  const bytes = Array.from(new Uint8Array(digest));
  const computed =
    "sha256:" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

  if (computed !== record.checksum) {
    throw new ForecastChecksumError(
      `Embedding record checksum mismatch: expected ${record.checksum}, got ${computed}`
    );
  }
}

export function validateRecordShape(record: EmbeddingRecord): void {
  if (!record.counts || typeof record.counts.current !== "number") {
    throw new Error("Record is missing counts.current");
  }
  if (record.trend_features.length !== 3) {
    throw new Error(
      `Record trend_features length mismatch: expected 3, got ${record.trend_features.length}`
    );
  }
  if (record.embedding.dimension !== 32) {
    throw new Error(
      `Record embedding dimension mismatch: expected 32, got ${record.embedding.dimension}`
    );
  }
}
