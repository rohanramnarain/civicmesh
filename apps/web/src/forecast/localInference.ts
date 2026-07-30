import * as ort from "onnxruntime-web";
import { loadModel, type ModelName } from "./modelRegistry";
import { ForecastInferenceError } from "./forecastErrors";

export type LocalInferenceResult = {
  prediction: number;
  modelName: ModelName;
  modelVersion: string;
  modelChecksum: string;
  executionProvider: string;
};

export async function runLocalInference(
  modelName: ModelName,
  featureVector: number[]
): Promise<LocalInferenceResult> {
  const artifact = await loadModel(modelName);

  const inputTensor = new ort.Tensor("float32", featureVector, [
    1,
    featureVector.length,
  ]);

  const feeds: Record<string, ort.Tensor> = {};
  const inputName = artifact.session.inputNames[0];
  feeds[inputName] = inputTensor;

  try {
    const results = await artifact.session.run(feeds);
    const outputName = artifact.session.outputNames[0];
    const output = results[outputName] as ort.Tensor;
    const prediction = Math.max(0, Number(output.data[0]));

    return {
      prediction,
      modelName,
      modelVersion: artifact.version,
      modelChecksum: artifact.checksum,
      executionProvider: artifact.executionProvider,
    };
  } catch (err) {
    throw new ForecastInferenceError(modelName, err);
  }
}
