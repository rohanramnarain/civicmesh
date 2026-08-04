import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchEmbeddingRecord } from "./firestoreEmbeddingRepository";
import { ACTIVE_RELEASE } from "./releaseManifest";
import type { EmbeddingRecord } from "./featureBuilder";

const mockRecord: EmbeddingRecord = {
  schema_version: "forecast-embedding-record-v1",
  dataset_version: ACTIVE_RELEASE.datasetVersion,
  embedding_version: ACTIVE_RELEASE.embeddingVersion,
  feature_schema_version: ACTIVE_RELEASE.featureSchemaVersion,
  zipcode: "10027",
  complaint_type: "heat/hot water",
  source_year: 2025,
  counts: { current: 142, lag_1: 134, lag_2: 119 },
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

const staleRecord: EmbeddingRecord = {
  ...mockRecord,
  dataset_version: "old-dataset-version",
  checksum: "sha256:stale",
};

describe("fetchEmbeddingRecord caching", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns a valid cached record without reading Firestore", async () => {
    const getForecastEmbeddingRecord = vi.fn().mockResolvedValue(mockRecord);
    const putForecastEmbeddingRecord = vi.fn().mockResolvedValue(undefined);
    const getDoc = vi.fn().mockRejectedValue(new Error("Firestore should not be called"));
    const getDb = vi.fn().mockReturnValue({});

    vi.doMock("../firebase", () => ({ getForecastDb: getDb }));
    vi.doMock("../localStore", () => ({
      getForecastEmbeddingRecord,
      putForecastEmbeddingRecord,
    }));
    vi.doMock("firebase/firestore", () => ({ doc: vi.fn(), getDoc }));

    const { fetchEmbeddingRecord: fetch } = await import(
      "./firestoreEmbeddingRepository"
    );
    const result = await fetch({
      releaseId: ACTIVE_RELEASE.releaseId,
      sourceYear: 2025,
      zipcode: "10027",
      complaintType: "Heat/Hot Water",
    });

    expect(result).toEqual(mockRecord);
    expect(getForecastEmbeddingRecord).toHaveBeenCalledTimes(1);
    expect(getDoc).not.toHaveBeenCalled();
    expect(putForecastEmbeddingRecord).not.toHaveBeenCalled();
  });

  it("refetches from Firestore when the cached record has the wrong version", async () => {
    const getForecastEmbeddingRecord = vi.fn().mockResolvedValue(staleRecord);
    const putForecastEmbeddingRecord = vi.fn().mockResolvedValue(undefined);
    const firestoreRecord = { ...mockRecord, checksum: "sha256:fresh" };
    const getDoc = vi.fn().mockResolvedValue({ exists: () => true, data: () => firestoreRecord });
    const getDb = vi.fn().mockReturnValue({});

    vi.doMock("../firebase", () => ({ getForecastDb: getDb }));
    vi.doMock("../localStore", () => ({
      getForecastEmbeddingRecord,
      putForecastEmbeddingRecord,
    }));
    vi.doMock("firebase/firestore", () => ({ doc: vi.fn(), getDoc }));

    const { fetchEmbeddingRecord: fetch } = await import(
      "./firestoreEmbeddingRepository"
    );
    const result = await fetch({
      releaseId: ACTIVE_RELEASE.releaseId,
      sourceYear: 2025,
      zipcode: "10027",
      complaintType: "Heat/Hot Water",
    });

    expect(result).toEqual(firestoreRecord);
    expect(getForecastEmbeddingRecord).toHaveBeenCalledTimes(1);
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(putForecastEmbeddingRecord).toHaveBeenCalledTimes(1);
  });
});
