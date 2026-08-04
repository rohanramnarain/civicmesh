import { doc, getDoc } from "firebase/firestore";
import { getForecastDb } from "../firebase";
import {
  getForecastEmbeddingRecord,
  putForecastEmbeddingRecord,
} from "../localStore";
import { verifyRecordChecksum, type EmbeddingRecord } from "./featureBuilder";
import { ForecastFirestoreUnavailableError } from "./forecastErrors";
import { MOCK_EMBEDDING_RECORD } from "./mockEmbeddingRecord";
import { ACTIVE_RELEASE } from "./releaseManifest";

export type AnalysisKey = {
  releaseId: string;
  sourceYear: number;
  zipcode: string;
  complaintType: string;
};

function normalizeComplaintType(complaintType: string): string {
  return complaintType.trim().toLowerCase();
}

async function complaintTypeHash(complaintType: string): Promise<string> {
  const normalized = normalizeComplaintType(complaintType);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export async function buildRecordId(
  sourceYear: number,
  zipcode: string,
  complaintType: string
): Promise<string> {
  const hash = await complaintTypeHash(complaintType);
  return `${sourceYear}_${zipcode}_${hash}`;
}

function isCachedRecordValid(record: EmbeddingRecord): boolean {
  return (
    record.dataset_version === ACTIVE_RELEASE.datasetVersion &&
    record.embedding_version === ACTIVE_RELEASE.embeddingVersion &&
    record.feature_schema_version === ACTIVE_RELEASE.featureSchemaVersion &&
    typeof record.checksum === "string" &&
    record.checksum.length > 0
  );
}

export async function fetchEmbeddingRecord(
  key: AnalysisKey
): Promise<EmbeddingRecord | null> {
  const recordId = await buildRecordId(
    key.sourceYear,
    key.zipcode,
    key.complaintType
  );

  const cached = await getForecastEmbeddingRecord(recordId);
  if (cached && isCachedRecordValid(cached)) {
    try {
      await verifyRecordChecksum(cached);
      return cached;
    } catch (err) {
      console.warn(
        `[forecast] Cached record ${recordId} failed checksum verification. Re-fetching.`
      );
    }
  }

  if (cached && !isCachedRecordValid(cached)) {
    console.warn(
      `[forecast] Cached record ${recordId} failed version/checksum validation. Re-fetching.`
    );
  }

  const db = getForecastDb();
  if (!db) {
    // Development fallback: exercise the local inference path without Firebase.
    // This is gated to dev builds and explicit opt-in so production never
    // returns an unchecked mock record.
    const allowMock =
      import.meta.env.DEV ||
      import.meta.env.VITE_FORECAST_MOCK_FALLBACK === "true";
    if (!allowMock) {
      throw new ForecastFirestoreUnavailableError();
    }
    console.warn(
      "[forecast] Firestore is not configured. Using the development mock embedding record."
    );
    return { ...MOCK_EMBEDDING_RECORD };
  }

  const recordRef = doc(
    db,
    "forecast_releases",
    key.releaseId,
    "embedding_records",
    recordId
  );

  const snapshot = await getDoc(recordRef);
  if (!snapshot.exists()) {
    return null;
  }

  const record = snapshot.data() as EmbeddingRecord;
  await putForecastEmbeddingRecord(recordId, record);
  return record;
}
