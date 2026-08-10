import { describe, expect, it, vi } from "vitest";
import { ACTIVE_RELEASE } from "./forecast/releaseManifest";
import type { SelectorManifest } from "./forecast/selectorManifest";
import { getSelectorDataset } from "./api";

const mockLoadSelectorManifest = vi.fn();

vi.mock("./forecast/selectorManifest", () => ({
  loadSelectorManifest: (...args: unknown[]) => mockLoadSelectorManifest(...args),
}));

const manifest: SelectorManifest = {
  release_id: ACTIVE_RELEASE.releaseId,
  dataset_version: ACTIVE_RELEASE.datasetVersion,
  embedding_version: ACTIVE_RELEASE.embeddingVersion,
  feature_schema_version: ACTIVE_RELEASE.featureSchemaVersion,
  source_years: [ACTIVE_RELEASE.sourceYear],
  target_year: ACTIVE_RELEASE.targetYear,
  record_count: 2,
  combinations: [
    { zipcode: "10027", complaint_type: "heat/hot water" },
    { zipcode: "10025", complaint_type: "street condition" },
  ],
  generated_at: "2026-07-29T02:27:08Z",
};

describe("getSelectorDataset", () => {
  it("maps a live manifest to a ready dataset", async () => {
    mockLoadSelectorManifest.mockResolvedValue({ status: "live", manifest });

    const result = await getSelectorDataset();

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.dataset.is_mock).toBe(false);
    expect(result.dataset.combinations).toHaveLength(2);
    expect(result.dataset.release_id).toBe(ACTIVE_RELEASE.releaseId);
  });

  it("marks a mock manifest as mock", async () => {
    mockLoadSelectorManifest.mockResolvedValue({ status: "mock", manifest });

    const result = await getSelectorDataset();

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.dataset.is_mock).toBe(true);
  });

  it("propagates empty status", async () => {
    mockLoadSelectorManifest.mockResolvedValue({ status: "empty" });

    const result = await getSelectorDataset();

    expect(result.status).toBe("empty");
  });

  it("propagates unavailable status", async () => {
    mockLoadSelectorManifest.mockResolvedValue({
      status: "unavailable",
      reason: "Firebase is not configured",
    });

    const result = await getSelectorDataset();

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.reason).toBe("Firebase is not configured");
  });
});
