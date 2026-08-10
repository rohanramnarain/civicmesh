import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
} from "firebase/firestore";
import { getForecastDb, isFirebaseConfigured } from "../firebase";
import { ACTIVE_RELEASE } from "./releaseManifest";

export type SelectorCombination = {
  zipcode: string;
  complaint_type: string;
};

export type SelectorManifest = {
  release_id: string;
  dataset_version: string;
  embedding_version: string;
  feature_schema_version: string;
  source_years: number[];
  target_year: number;
  record_count: number;
  combinations: SelectorCombination[];
  generated_at: string;
};

export type SelectorManifestResult =
  | { status: "live"; manifest: SelectorManifest }
  | { status: "mock"; manifest: SelectorManifest }
  | { status: "empty" }
  | { status: "unavailable"; reason: string };

/**
 * Development-only bundled selector manifest.
 * Used when Firebase is not configured so the selector UI can still be
 * exercised locally without exposing production data.
 */
export const MOCK_SELECTOR_MANIFEST: SelectorManifest = {
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
  generated_at: new Date().toISOString(),
};

function normalizeCombination(
  combo: SelectorCombination
): SelectorCombination {
  return {
    zipcode: combo.zipcode.trim(),
    complaint_type: combo.complaint_type.trim().toLowerCase(),
  };
}

function deduplicateCombinations(
  combinations: SelectorCombination[]
): SelectorCombination[] {
  const seen = new Set<string>();
  const result: SelectorCombination[] = [];
  for (const combo of combinations) {
    const normalized = normalizeCombination(combo);
    const key = `${normalized.zipcode}::${normalized.complaint_type}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

function isValidCombination(value: unknown): value is SelectorCombination {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const combo = value as Record<string, unknown>;
  return (
    typeof combo.zipcode === "string" &&
    combo.zipcode.trim().length > 0 &&
    typeof combo.complaint_type === "string" &&
    combo.complaint_type.trim().length > 0
  );
}

function parseManifest(raw: Record<string, unknown>): SelectorManifest | null {
  const combinations = Array.isArray(raw.combinations)
    ? raw.combinations.filter(isValidCombination)
    : [];

  const validCombinations = deduplicateCombinations(combinations);
  if (validCombinations.length === 0) {
    return null;
  }

  return {
    release_id: typeof raw.release_id === "string" ? raw.release_id : "",
    dataset_version:
      typeof raw.dataset_version === "string" ? raw.dataset_version : "",
    embedding_version:
      typeof raw.embedding_version === "string" ? raw.embedding_version : "",
    feature_schema_version:
      typeof raw.feature_schema_version === "string"
        ? raw.feature_schema_version
        : "",
    source_years: Array.isArray(raw.source_years)
      ? raw.source_years.filter((y): y is number => typeof y === "number")
      : [],
    target_year: typeof raw.target_year === "number" ? raw.target_year : 0,
    record_count: typeof raw.record_count === "number" ? raw.record_count : 0,
    combinations: validCombinations,
    generated_at: typeof raw.generated_at === "string" ? raw.generated_at : "",
  };
}

async function fetchManifestFromFirestore(
  releaseId: string
): Promise<SelectorManifest | null> {
  const db = getForecastDb();
  if (!db) {
    return null;
  }

  const snapshot = await getDoc(
    doc(db, "forecast_releases", releaseId, "metadata", "manifest")
  );
  if (!snapshot.exists()) {
    return null;
  }

  return parseManifest(snapshot.data() as Record<string, unknown>);
}

async function deriveCombinationsFromRecords(
  releaseId: string
): Promise<SelectorCombination[]> {
  const db = getForecastDb();
  if (!db) {
    return [];
  }

  const recordsQuery = query(
    collection(db, "forecast_releases", releaseId, "embedding_records")
  );
  const snapshot = await getDocs(recordsQuery);

  const combinations: SelectorCombination[] = [];
  snapshot.forEach((document) => {
    const data = document.data();
    if (
      typeof data.zipcode === "string" &&
      typeof data.complaint_type === "string" &&
      (typeof data.source_year === "number" ||
        typeof data.source_year === "string") &&
      Number(data.source_year) === ACTIVE_RELEASE.sourceYear
    ) {
      combinations.push({
        zipcode: data.zipcode,
        complaint_type: data.complaint_type,
      });
    }
  });

  return deduplicateCombinations(combinations);
}

function isMockFallbackAllowed(): boolean {
  const explicit = import.meta.env.VITE_FORECAST_MOCK_FALLBACK;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return import.meta.env.DEV;
}

/**
 * Load the selector manifest for the active release.
 *
 * Priority:
 * 1. Firestore manifest with a non-empty combinations list.
 * 2. Derive combinations from Firestore embedding_records (backward compat).
 * 3. Bundled mock manifest in dev/test when Firebase is unavailable.
 * 4. Return unavailable status otherwise.
 */
export async function loadSelectorManifest(): Promise<SelectorManifestResult> {
  // Explicit mock-mode opt-in takes precedence so deterministic test and demo
  // environments never accidentally read production Firestore.
  if (import.meta.env.VITE_FORECAST_MOCK_FALLBACK === "true") {
    return { status: "mock", manifest: MOCK_SELECTOR_MANIFEST };
  }

  const allowMock = isMockFallbackAllowed();

  if (!isFirebaseConfigured()) {
    if (!allowMock) {
      return {
        status: "unavailable",
        reason: "Firebase is not configured and mock fallback is disabled.",
      };
    }
    return { status: "mock", manifest: MOCK_SELECTOR_MANIFEST };
  }

  try {
    const manifest = await fetchManifestFromFirestore(ACTIVE_RELEASE.releaseId);

    if (manifest && manifest.combinations.length > 0) {
      return { status: "live", manifest };
    }

    const combinations = await deriveCombinationsFromRecords(
      ACTIVE_RELEASE.releaseId
    );

    if (combinations.length === 0) {
      if (!allowMock) {
        return {
          status: "empty",
        };
      }
      return { status: "mock", manifest: MOCK_SELECTOR_MANIFEST };
    }

    return {
      status: "live",
      manifest: {
        release_id: ACTIVE_RELEASE.releaseId,
        dataset_version: ACTIVE_RELEASE.datasetVersion,
        embedding_version: ACTIVE_RELEASE.embeddingVersion,
        feature_schema_version: ACTIVE_RELEASE.featureSchemaVersion,
        source_years: [ACTIVE_RELEASE.sourceYear],
        target_year: ACTIVE_RELEASE.targetYear,
        record_count: combinations.length,
        combinations,
        generated_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.error("[selector] Failed to load selector manifest:", err);
    if (!allowMock) {
      return {
        status: "unavailable",
        reason:
          err instanceof Error
            ? err.message
            : "Failed to load selector manifest from Firestore.",
      };
    }
    return { status: "mock", manifest: MOCK_SELECTOR_MANIFEST };
  }
}
