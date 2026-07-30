import { describe, expect, it } from "vitest";
import { decodeEmbedding } from "./embeddingDecoder";
import { buildFeatureVector, type EmbeddingRecord } from "./featureBuilder";
import { buildRecordId } from "./firestoreEmbeddingRepository";

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
