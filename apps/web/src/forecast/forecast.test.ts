import { describe, expect, it } from "vitest";
import { decodeEmbedding } from "./embeddingDecoder";
import {
  buildFeatureVector,
  validateRecordShape,
  verifyRecordChecksum,
  type EmbeddingRecord,
} from "./featureBuilder";
import { buildRecordId } from "./firestoreEmbeddingRepository";
import { buildProvenance } from "./provenance";
import type { LocalInferenceResult } from "./localInference";
import {
  ForecastChecksumError,
  ForecastFirestoreUnavailableError,
  ForecastInferenceError,
  ForecastModelLoadError,
  ForecastRecordNotFoundError,
  ForecastVersionMismatchError,
  getForecastUserMessage,
} from "./forecastErrors";
import { ACTIVE_RELEASE } from "./releaseManifest";

describe("embeddingDecoder", () => {
  it("decodes an int8-scale base64 vector", () => {
    const bytes = new Int8Array([0, 64, -64, 127, -128]);
    const valuesBase64 = btoa(String.fromCharCode(...new Uint8Array(bytes.buffer)));

    const result = decodeEmbedding({
      encoding: "int8-scale",
      dimension: 5,
      scale: 0.0078125,
      values_base64: valuesBase64,
    });

    expect(result).toHaveLength(5);
    expect(result[0]).toBeCloseTo(0, 6);
    expect(result[1]).toBeCloseTo(64 * 0.0078125, 6);
    expect(result[2]).toBeCloseTo(-64 * 0.0078125, 6);
    expect(result[3]).toBeCloseTo(127 * 0.0078125, 6);
    expect(result[4]).toBeCloseTo(-128 * 0.0078125, 6);
  });

  it("throws on unsupported encoding", () => {
    expect(() =>
      decodeEmbedding({
        encoding: "float32",
        dimension: 1,
        scale: 1,
        values_base64: "AAAAAA==",
      })
    ).toThrow("Unsupported embedding encoding");
  });

  it("throws on dimension mismatch", () => {
    expect(() =>
      decodeEmbedding({
        encoding: "int8-scale",
        dimension: 10,
        scale: 0.0078125,
        values_base64: "AAAAAA==",
      })
    ).toThrow("Decoded embedding dimension mismatch");
  });
});

describe("featureBuilder", () => {
  it("builds a feature vector in the expected order", () => {
    const record: EmbeddingRecord = {
      schema_version: "forecast-embedding-record-v1",
      dataset_version: "nyc311-2025-v1",
      embedding_version: "311-embed-v1",
      feature_schema_version: "forecast-features-v1",
      zipcode: "10027",
      complaint_type: "heat/hot water",
      source_year: 2025,
      counts: { current: 142, lag_1: 134, lag_2: 119 },
      trend_features: [8, 15, 131.67],
      embedding: {
        encoding: "int8-scale",
        dimension: 3,
        scale: 1,
        values_base64: btoa(String.fromCharCode(0, 1, 255)),
      },
      checksum: "sha256:test",
      generated_at: "2026-07-25T00:00:00Z",
    };

    const vector = buildFeatureVector(record);

    expect(vector).toHaveLength(9); // 3 counts + 3 trends + 3 embedding
    expect(vector.slice(0, 6)).toEqual([142, 134, 119, 8, 15, 131.67]);
    expect(vector.slice(6)).toEqual([0, 1, -1]);
  });
});

describe("firestoreEmbeddingRepository", () => {
  it("builds deterministic record IDs", async () => {
    const id1 = await buildRecordId(2025, "10027", "Heat/Hot Water");
    const id2 = await buildRecordId(2025, "10027", "heat/hot water");
    const id3 = await buildRecordId(2025, "10027", "street condition");

    expect(id1).toBe(id2); // normalization should make these equal
    expect(id1).toMatch(/^2025_10027_[a-f0-9]{16}$/);
    expect(id3).not.toBe(id1);
  });
});

describe("featureBuilder validateRecordShape", () => {
  it("accepts a valid record", () => {
    expect(() => validateRecordShape(baseRecord())).not.toThrow();
  });

  it("throws when counts.current is missing", () => {
    const record = baseRecord();
    record.counts = { current: undefined as unknown as number, lag_1: 1, lag_2: 2 };
    expect(() => validateRecordShape(record)).toThrow("Record is missing counts.current");
  });

  it("throws when trend_features length is not 3", () => {
    const record = baseRecord();
    record.trend_features = [1, 2];
    expect(() => validateRecordShape(record)).toThrow(
      "Record trend_features length mismatch: expected 3, got 2"
    );
  });

  it("throws when embedding dimension is not 32", () => {
    const record = baseRecord();
    record.embedding.dimension = 16;
    expect(() => validateRecordShape(record)).toThrow(
      "Record embedding dimension mismatch: expected 32, got 16"
    );
  });
});

describe("featureBuilder verifyRecordChecksum", () => {
  it("bypasses verification for the dev mock checksum", async () => {
    const record = baseRecord();
    record.checksum = "sha256:dev-mock-record-do-not-publish";
    await expect(verifyRecordChecksum(record)).resolves.toBeUndefined();
  });

  it("verifies a record with a matching checksum", async () => {
    const record = baseRecord();
    record.checksum = await computeSha256Checksum(record);
    await expect(verifyRecordChecksum(record)).resolves.toBeUndefined();
  });

  it("throws when the checksum does not match", async () => {
    const record = baseRecord();
    record.checksum = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    await expect(verifyRecordChecksum(record)).rejects.toBeInstanceOf(ForecastChecksumError);
  });
});

describe("provenance", () => {
  it("builds provenance from a record and inference result", () => {
    const record = baseRecord();
    const inference: LocalInferenceResult = {
      prediction: 150,
      modelName: "xgboost",
      modelVersion: "v1",
      modelChecksum: "sha256:model-checksum",
      executionProvider: "wasm",
      mae: 12.3,
      rmse: 18.4,
    };

    const provenance = buildProvenance(record, inference);

    expect(provenance.dataset_version).toBe(record.dataset_version);
    expect(provenance.embedding_version).toBe(record.embedding_version);
    expect(provenance.embedding_checksum).toBe(record.checksum);
    expect(provenance.feature_schema_version).toBe(record.feature_schema_version);
    expect(provenance.model_name).toBe(inference.modelName);
    expect(provenance.model_version).toBe(inference.modelVersion);
    expect(provenance.model_checksum).toBe(inference.modelChecksum);
    expect(provenance.source_year).toBe(ACTIVE_RELEASE.sourceYear);
    expect(provenance.target_year).toBe(ACTIVE_RELEASE.targetYear);
    expect(provenance.firestore_release_id).toBe(ACTIVE_RELEASE.releaseId);
    expect(provenance.generated_at).toBe(record.generated_at);
    expect(provenance.local_runtime).toBe("onnxruntime-web");
    expect(provenance.execution_provider).toBe(inference.executionProvider);
  });
});

describe("forecastErrors getForecastUserMessage", () => {
  it("returns a message for ForecastRecordNotFoundError", () => {
    const error = new ForecastRecordNotFoundError("10027", "heat/hot water", 2025);
    expect(getForecastUserMessage(error)).toContain("No precomputed embedding found");
  });

  it("returns a message for ForecastVersionMismatchError", () => {
    const error = new ForecastVersionMismatchError("feature_schema", "v1", "v2");
    expect(getForecastUserMessage(error)).toContain("incompatible");
  });

  it("returns a message for ForecastChecksumError", () => {
    const error = new ForecastChecksumError("checksum mismatch");
    expect(getForecastUserMessage(error)).toContain("integrity verification");
  });

  it("returns a message for ForecastModelLoadError", () => {
    const error = new ForecastModelLoadError("xgboost", "network error");
    expect(getForecastUserMessage(error)).toContain("could not be loaded");
  });

  it("returns a message for ForecastInferenceError", () => {
    const error = new ForecastInferenceError("xgboost", new Error("session failed"));
    expect(getForecastUserMessage(error)).toContain("local prediction failed");
  });

  it("returns a message for ForecastFirestoreUnavailableError", () => {
    const error = new ForecastFirestoreUnavailableError();
    expect(getForecastUserMessage(error)).toContain("Firestore is not configured");
  });

  it("returns a fallback message for unknown errors", () => {
    expect(getForecastUserMessage("something broke")).toBe("Forecast failed. Please try again.");
  });
});

describe("Phase 2 forecast isolation", () => {
  it("does not import the browser embedding runtime in any forecast module", async () => {
    const modules = [
      await import("./embeddingDecoder"),
      await import("./featureBuilder"),
      await import("./firestoreEmbeddingRepository"),
      await import("./forecastErrors"),
      await import("./forecastService"),
      await import("./localInference"),
      await import("./modelRegistry"),
      await import("./provenance"),
      await import("./releaseManifest"),
    ];
    for (const mod of modules) {
      expect(mod).not.toHaveProperty("embedText");
    }
  });
});

function baseRecord(): EmbeddingRecord {
  return {
    schema_version: "forecast-embedding-record-v1",
    dataset_version: "nyc311-2025-v1",
    embedding_version: "311-embed-v1",
    feature_schema_version: "forecast-features-v1",
    zipcode: "10027",
    complaint_type: "heat/hot water",
    source_year: 2025,
    counts: { current: 142, lag_1: 134, lag_2: 119 },
    trend_features: [8, 15, 131.67],
    embedding: {
      encoding: "int8-scale",
      dimension: 32,
      scale: 1,
      values_base64: btoa(String.fromCharCode(...new Array(32).fill(0))),
    },
    checksum: "sha256:test",
    generated_at: "2026-07-25T00:00:00Z",
  };
}

async function computeSha256Checksum(record: EmbeddingRecord): Promise<string> {
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

  const { checksum: _, ...payload } = record;
  const canonical = canonicalJson(payload);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const bytes = Array.from(new Uint8Array(digest));
  return "sha256:" + bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}
