import { describe, expect, it } from "vitest";
import * as ort from "onnxruntime-web";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fixtures from "../../../../public/models/forecast311/v1/parity-fixtures.json";

type Fixture = {
  input: number[];
  expected_prediction: number;
  tolerance: number;
};

type Fixtures = {
  random_forest: Fixture;
  xgboost: Fixture;
  lightgbm: Fixture;
};

const typedFixtures = fixtures as Fixtures;

const modelFileByName: Record<keyof Fixtures, string> = {
  random_forest: "random-forest.onnx",
  xgboost: "xgboost.onnx",
  lightgbm: "lightgbm.onnx",
};

async function runOnnxModel(modelName: keyof Fixtures, input: number[]): Promise<number> {
  const modelPath = resolve(
    __dirname,
    "../../../../public/models/forecast311/v1",
    modelFileByName[modelName]
  );
  const buffer = readFileSync(modelPath);
  const session = await ort.InferenceSession.create(buffer, {
    executionProviders: ["wasm"],
  });
  const inputName = session.inputNames[0];
  const tensor = new ort.Tensor("float32", input, [1, input.length]);
  const results = await session.run({ [inputName]: tensor });
  const output = results[session.outputNames[0]] as ort.Tensor;
  return Number(output.data[0]);
}

describe("ONNX parity fixtures", () => {
  it.each(Object.keys(typedFixtures) as (keyof Fixtures)[])(
    "%s prediction matches Python reference within tolerance",
    async (modelName) => {
      const fixture = typedFixtures[modelName];
      const prediction = await runOnnxModel(modelName, fixture.input);
      expect(prediction).toBeCloseTo(
        fixture.expected_prediction,
        -Math.log10(fixture.tolerance)
      );
    }
  );
});
