import * as ort from "onnxruntime-web";
import { ForecastModelLoadError } from "./forecastErrors";

// Serve WASM binaries from the public directory root in both dev and production.
ort.env.wasm.wasmPaths = "/";

export type ModelName = "random_forest" | "xgboost" | "lightgbm";

export type ModelArtifact = {
  name: ModelName;
  version: string;
  featureSchemaVersion: string;
  embeddingVersion: string;
  onnxPath: string;
  checksum: string;
  mae: number;
  rmse: number;
  executionProvider: string;
  session: ort.InferenceSession;
};

const MODEL_BASE_PATH = "/models/forecast311/v1";

const modelFileByName: Record<ModelName, string> = {
  random_forest: "random-forest.onnx",
  xgboost: "xgboost.onnx",
  lightgbm: "lightgbm.onnx",
};

const cache = new Map<ModelName, Promise<ModelArtifact>>();

/**
 * Creates an ONNX inference session, preferring WebGPU when available and
 * falling back to WASM if WebGPU fails. The returned executionProvider string
 * reflects the provider that actually initialized the session.
 */
async function createSessionWithPreferredProvider(
  onnxPath: string
): Promise<{ session: ort.InferenceSession; executionProvider: string }> {
  if (navigator.gpu) {
    try {
      const session = await ort.InferenceSession.create(onnxPath, {
        executionProviders: ["webgpu"],
      });
      return { session, executionProvider: "webgpu" };
    } catch (err) {
      console.warn(
        "[modelRegistry] WebGPU inference session failed, falling back to WASM:",
        err
      );
    }
  }

  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ["wasm"],
  });
  return { session, executionProvider: "wasm" };
}

async function fetchChecksums(): Promise<Record<string, string>> {
  const response = await fetch(`${MODEL_BASE_PATH}/checksums.json`);
  if (!response.ok) {
    throw new ForecastModelLoadError(
      "all",
      `Failed to load model checksums: ${response.status}`
    );
  }
  return response.json();
}

async function fetchModelCard(): Promise<{
  models: Array<{
    model_name: string;
    model_version: string;
    feature_schema_version: string;
    embedding_version: string;
    onnx_file: string;
    checksum: string;
    mae: number;
    rmse: number;
  }>;
}> {
  const response = await fetch(`${MODEL_BASE_PATH}/model-card.json`);
  if (!response.ok) {
    throw new ForecastModelLoadError(
      "all",
      `Failed to load model card: ${response.status}`
    );
  }
  return response.json();
}

export async function loadModel(name: ModelName): Promise<ModelArtifact> {
  if (cache.has(name)) {
    return cache.get(name)!;
  }

  const loadPromise = (async (): Promise<ModelArtifact> => {
    const [checksums, modelCard] = await Promise.all([
      fetchChecksums(),
      fetchModelCard(),
    ]);

    const fileName = modelFileByName[name];
    const onnxPath = `${MODEL_BASE_PATH}/${fileName}`;

    const card = modelCard.models.find((m) => m.onnx_file === fileName);
    if (!card) {
      throw new ForecastModelLoadError(name, `Model not found in model-card.json`);
    }

    const expectedChecksum = checksums[fileName];
    if (!expectedChecksum) {
      throw new ForecastModelLoadError(name, `Checksum not found for ${fileName}`);
    }

    if (card.checksum !== expectedChecksum) {
      throw new ForecastModelLoadError(name, `Checksum mismatch for ${fileName}`);
    }

    try {
      const { session, executionProvider } =
        await createSessionWithPreferredProvider(onnxPath);

      return {
        name,
        version: card.model_version,
        featureSchemaVersion: card.feature_schema_version,
        embeddingVersion: card.embedding_version,
        onnxPath,
        checksum: card.checksum,
        mae: card.mae,
        rmse: card.rmse,
        executionProvider,
        session,
      };
    } catch (err) {
      throw new ForecastModelLoadError(
        name,
        err instanceof Error ? err.message : String(err)
      );
    }
  })();

  cache.set(name, loadPromise);
  return loadPromise;
}

export function clearModelCache(): void {
  cache.clear();
}
