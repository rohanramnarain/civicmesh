import { describe, expect, it, vi, beforeEach } from "vitest";
import { ACTIVE_RELEASE } from "./releaseManifest";
import type { SelectorManifest } from "./selectorManifest";

const liveManifest: SelectorManifest = {
  release_id: ACTIVE_RELEASE.releaseId,
  dataset_version: ACTIVE_RELEASE.datasetVersion,
  embedding_version: ACTIVE_RELEASE.embeddingVersion,
  feature_schema_version: ACTIVE_RELEASE.featureSchemaVersion,
  source_years: [ACTIVE_RELEASE.sourceYear],
  target_year: ACTIVE_RELEASE.targetYear,
  record_count: 3,
  combinations: [
    { zipcode: "10027", complaint_type: "heat/hot water" },
    { zipcode: "10025", complaint_type: "street condition" },
    { zipcode: "10023", complaint_type: "noise" },
  ],
  generated_at: "2026-07-29T02:27:08Z",
};

const manifestWithoutCombinations = {
  ...liveManifest,
  combinations: undefined,
};

const emptyManifest = {
  ...liveManifest,
  combinations: [],
};

describe("loadSelectorManifest", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns live status when Firestore manifest has combinations", async () => {
    vi.stubEnv("VITE_FORECAST_MOCK_FALLBACK", "false");

    const getDoc = vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => liveManifest,
    });

    vi.doMock("../firebase", () => ({
      isFirebaseConfigured: vi.fn().mockReturnValue(true),
      getForecastDb: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("firebase/firestore", () => ({ doc: vi.fn(), getDoc }));

    const { loadSelectorManifest } = await import("./selectorManifest");
    const result = await loadSelectorManifest();

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.manifest.combinations).toHaveLength(3);
    expect(result.manifest.combinations[0]).toEqual({
      zipcode: "10027",
      complaint_type: "heat/hot water",
    });
  });

  it("derives combinations from embedding_records when manifest lacks them", async () => {
    vi.stubEnv("VITE_FORECAST_MOCK_FALLBACK", "false");

    const getDoc = vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => manifestWithoutCombinations,
    });
    const getDocs = vi.fn().mockResolvedValue({
      forEach: (callback: (doc: { data: () => Record<string, unknown> }) => void) => {
        [
          { data: () => ({ zipcode: "10027", complaint_type: "heat/hot water", source_year: 2025 }) },
          { data: () => ({ zipcode: "10025", complaint_type: "street condition", source_year: 2025 }) },
          { data: () => ({ zipcode: "10027", complaint_type: "heat/hot water", source_year: 2024 }) },
        ].forEach(callback);
      },
    });
    const query = vi.fn();
    const collection = vi.fn();

    vi.doMock("../firebase", () => ({
      isFirebaseConfigured: vi.fn().mockReturnValue(true),
      getForecastDb: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("firebase/firestore", () => ({
      doc: vi.fn(),
      getDoc,
      query,
      collection,
      getDocs,
    }));

    const { loadSelectorManifest } = await import("./selectorManifest");
    const result = await loadSelectorManifest();

    expect(result.status).toBe("live");
    if (result.status !== "live") return;
    expect(result.manifest.combinations).toHaveLength(2);
  });

  it("returns empty status when no combinations are found and mock is disabled", async () => {
    vi.stubEnv("VITE_FORECAST_MOCK_FALLBACK", "false");

    const getDoc = vi.fn().mockResolvedValue({
      exists: () => true,
      data: () => emptyManifest,
    });
    const getDocs = vi.fn().mockResolvedValue({
      forEach: () => undefined,
    });

    vi.doMock("../firebase", () => ({
      isFirebaseConfigured: vi.fn().mockReturnValue(true),
      getForecastDb: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("firebase/firestore", () => ({
      doc: vi.fn(),
      getDoc,
      query: vi.fn(),
      collection: vi.fn(),
      getDocs,
    }));

    const { loadSelectorManifest } = await import("./selectorManifest");
    const result = await loadSelectorManifest();

    expect(result.status).toBe("empty");
  });

  it("returns mock status in dev when Firebase is not configured", async () => {
    vi.stubEnv("DEV", "true");

    vi.doMock("../firebase", () => ({
      isFirebaseConfigured: vi.fn().mockReturnValue(false),
      getForecastDb: vi.fn().mockReturnValue(null),
    }));
    vi.doMock("firebase/firestore", () => ({
      doc: vi.fn(),
      getDoc: vi.fn().mockRejectedValue(new Error("should not be called")),
    }));

    const { loadSelectorManifest, MOCK_SELECTOR_MANIFEST } = await import(
      "./selectorManifest"
    );
    const result = await loadSelectorManifest();

    expect(result.status).toBe("mock");
    if (result.status !== "mock") return;
    expect(result.manifest.combinations).toEqual(
      MOCK_SELECTOR_MANIFEST.combinations
    );
  });

  it("returns unavailable status when Firebase is not configured and mock is disabled", async () => {
    vi.stubEnv("VITE_FORECAST_MOCK_FALLBACK", "false");

    vi.doMock("../firebase", () => ({
      isFirebaseConfigured: vi.fn().mockReturnValue(false),
      getForecastDb: vi.fn().mockReturnValue(null),
    }));
    vi.doMock("firebase/firestore", () => ({
      doc: vi.fn(),
      getDoc: vi.fn().mockRejectedValue(new Error("should not be called")),
    }));

    const { loadSelectorManifest } = await import("./selectorManifest");
    const result = await loadSelectorManifest();

    expect(result.status).toBe("unavailable");
  });

  it("falls back to mock in dev when Firestore read fails", async () => {
    vi.stubEnv("DEV", "true");

    const getDoc = vi.fn().mockRejectedValue(new Error("Firestore offline"));

    vi.doMock("../firebase", () => ({
      isFirebaseConfigured: vi.fn().mockReturnValue(true),
      getForecastDb: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("firebase/firestore", () => ({ doc: vi.fn(), getDoc }));

    const { loadSelectorManifest } = await import("./selectorManifest");
    const result = await loadSelectorManifest();

    expect(result.status).toBe("mock");
  });
});
