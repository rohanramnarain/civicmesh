import type { EmbeddingRecord } from "./featureBuilder";
import type { LocalInferenceResult } from "./localInference";
import { ACTIVE_RELEASE } from "./releaseManifest";

export type Provenance = {
  dataset_version: string;
  embedding_version: string;
  embedding_checksum: string;
  feature_schema_version: string;
  model_name: string;
  model_version: string;
  model_checksum: string;
  source_year: number;
  target_year: number;
  firestore_release_id: string;
  generated_at: string;
  local_runtime: string;
  execution_provider: string;
};

export function buildProvenance(
  record: EmbeddingRecord,
  inference: LocalInferenceResult
): Provenance {
  return {
    dataset_version: record.dataset_version,
    embedding_version: record.embedding_version,
    embedding_checksum: record.checksum,
    feature_schema_version: record.feature_schema_version,
    model_name: inference.modelName,
    model_version: inference.modelVersion,
    model_checksum: inference.modelChecksum,
    source_year: ACTIVE_RELEASE.sourceYear,
    target_year: ACTIVE_RELEASE.targetYear,
    firestore_release_id: ACTIVE_RELEASE.releaseId,
    generated_at: record.generated_at,
    local_runtime: "onnxruntime-web",
    execution_provider: inference.executionProvider,
  };
}
