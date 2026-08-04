import {
  fetchEmbeddingRecord,
  type AnalysisKey,
} from "./firestoreEmbeddingRepository";
import {
  buildFeatureVector,
  validateRecordShape,
  verifyRecordChecksum,
} from "./featureBuilder";
import { loadModel } from "./modelRegistry";
import { runLocalInference, type ModelName } from "./localInference";
import { buildProvenance } from "./provenance";
import {
  ForecastRecordNotFoundError,
  ForecastVersionMismatchError,
} from "./forecastErrors";
import { putForecastResult } from "../localStore";

export type ForecastServiceResult = {
  id: string;
  zipcode: string;
  complaintType: string;
  sourceYear: number;
  targetYear: number;
  prediction: number;
  modelName: ModelName;
  modelVersion: string;
  mae: number;
  rmse: number;
  provenance: ReturnType<typeof buildProvenance>;
};

export async function runLocalForecast(
  key: AnalysisKey,
  modelName: ModelName
): Promise<ForecastServiceResult> {
  const [record, modelArtifact] = await Promise.all([
    fetchEmbeddingRecord(key),
    loadModel(modelName),
  ]);

  if (!record) {
    throw new ForecastRecordNotFoundError(
      key.zipcode,
      key.complaintType,
      key.sourceYear
    );
  }

  await verifyRecordChecksum(record);
  validateRecordShape(record);

  if (modelArtifact.featureSchemaVersion !== record.feature_schema_version) {
    throw new ForecastVersionMismatchError(
      "feature_schema",
      modelArtifact.featureSchemaVersion,
      record.feature_schema_version
    );
  }
  if (modelArtifact.embeddingVersion !== record.embedding_version) {
    throw new ForecastVersionMismatchError(
      "embedding",
      modelArtifact.embeddingVersion,
      record.embedding_version
    );
  }

  const featureVector = buildFeatureVector(record);
  const inference = await runLocalInference(modelName, featureVector);
  const provenance = buildProvenance(record, inference);

  const result: ForecastServiceResult = {
    id: crypto.randomUUID(),
    zipcode: key.zipcode,
    complaintType: key.complaintType,
    sourceYear: key.sourceYear,
    targetYear: key.sourceYear + 1,
    prediction: inference.prediction,
    modelName: inference.modelName,
    modelVersion: inference.modelVersion,
    mae: inference.mae,
    rmse: inference.rmse,
    provenance,
  };

  await putForecastResult({
    ...result,
    createdAt: new Date().toISOString(),
  });

  return result;
}
