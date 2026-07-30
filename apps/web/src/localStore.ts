import type { EmbeddingRecord } from "./forecast/featureBuilder";
import type { Provenance } from "./forecast/provenance";

type LegacyEmbeddingRecord = {
  key: string;
  model: string;
  text: string;
  vector: number[];
  createdAt: string;
};

export type RunRecord = {
  id: string;
  question: string;
  model: string;
  queryEmbeddingKey: string;
  selectedDatasetIds: string[];
  createdAt: string;
};

export type ForecastResultRecord = {
  id: string;
  zipcode: string;
  complaintType: string;
  sourceYear: number;
  targetYear: number;
  prediction: number;
  modelName: string;
  modelVersion: string;
  provenance: Provenance;
  createdAt: string;
};

const DB_NAME = "civicgrid-local";
const DB_VERSION = 3;
const EMBEDDINGS_STORE = "embeddings";
const RUNS_STORE = "runs";
const FORECAST_EMBEDDINGS_STORE = "forecastEmbeddings";
const FORECAST_RESULTS_STORE = "forecastResults";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) {
        db.createObjectStore(EMBEDDINGS_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        db.createObjectStore(RUNS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(FORECAST_EMBEDDINGS_STORE)) {
        db.createObjectStore(FORECAST_EMBEDDINGS_STORE, { keyPath: "recordId" });
      }
      if (!db.objectStoreNames.contains(FORECAST_RESULTS_STORE)) {
        db.createObjectStore(FORECAST_RESULTS_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export async function getEmbedding(key: string): Promise<LegacyEmbeddingRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDINGS_STORE, "readonly");
    const store = tx.objectStore(EMBEDDINGS_STORE);
    const req = store.get(key);

    req.onsuccess = () => resolve((req.result as LegacyEmbeddingRecord | undefined) ?? null);
    req.onerror = () => reject(req.error || new Error("Read embedding failed"));
  });
}

export async function putEmbedding(record: LegacyEmbeddingRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EMBEDDINGS_STORE, "readwrite");
    const store = tx.objectStore(EMBEDDINGS_STORE);
    const req = store.put(record);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Write embedding failed"));
  });
}

export async function getForecastEmbeddingRecord(
  recordId: string
): Promise<EmbeddingRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FORECAST_EMBEDDINGS_STORE, "readonly");
    const store = tx.objectStore(FORECAST_EMBEDDINGS_STORE);
    const req = store.get(recordId);

    req.onsuccess = () => resolve((req.result as EmbeddingRecord | undefined) ?? null);
    req.onerror = () => reject(req.error || new Error("Read forecast embedding record failed"));
  });
}

export async function putForecastEmbeddingRecord(
  recordId: string,
  record: EmbeddingRecord
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FORECAST_EMBEDDINGS_STORE, "readwrite");
    const store = tx.objectStore(FORECAST_EMBEDDINGS_STORE);
    const req = store.put({ ...record, recordId });

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Write forecast embedding record failed"));
  });
}

export async function putRun(record: RunRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RUNS_STORE, "readwrite");
    const store = tx.objectStore(RUNS_STORE);
    const req = store.put(record);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Write run record failed"));
  });
}

export async function listRuns(limit = 10): Promise<RunRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RUNS_STORE, "readonly");
    const store = tx.objectStore(RUNS_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const all = (req.result as RunRecord[]).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
      resolve(all.slice(0, limit));
    };
    req.onerror = () => reject(req.error || new Error("List run records failed"));
  });
}

export async function putForecastResult(record: ForecastResultRecord): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FORECAST_RESULTS_STORE, "readwrite");
    const store = tx.objectStore(FORECAST_RESULTS_STORE);
    const req = store.put(record);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error("Write forecast result failed"));
  });
}

export async function listForecastResults(limit = 10): Promise<ForecastResultRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FORECAST_RESULTS_STORE, "readonly");
    const store = tx.objectStore(FORECAST_RESULTS_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const all = (req.result as ForecastResultRecord[]).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1
      );
      resolve(all.slice(0, limit));
    };
    req.onerror = () => reject(req.error || new Error("List forecast results failed"));
  });
}
