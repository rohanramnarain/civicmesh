export class ForecastRecordNotFoundError extends Error {
  constructor(
    public readonly zipcode: string,
    public readonly complaintType: string,
    public readonly sourceYear: number
  ) {
    super(
      `No embedding record found for ${zipcode} / ${complaintType} / ${sourceYear}`
    );
    this.name = "ForecastRecordNotFoundError";
  }
}

export class ForecastVersionMismatchError extends Error {
  constructor(
    public readonly kind: "feature_schema" | "embedding",
    public readonly modelVersion: string,
    public readonly recordVersion: string
  ) {
    super(
      `${kind === "feature_schema" ? "Feature schema" : "Embedding version"} mismatch: model expects ${modelVersion}, record has ${recordVersion}`
    );
    this.name = "ForecastVersionMismatchError";
  }
}

export class ForecastChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastChecksumError";
  }
}

export class ForecastModelLoadError extends Error {
  constructor(public readonly modelName: string, message: string) {
    super(`Failed to load model "${modelName}": ${message}`);
    this.name = "ForecastModelLoadError";
  }
}

export class ForecastInferenceError extends Error {
  constructor(public readonly modelName: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Inference failed for model "${modelName}": ${message}`);
    this.name = "ForecastInferenceError";
  }
}

export class ForecastFirestoreUnavailableError extends Error {
  constructor() {
    super(
      "Firestore is not configured. Forecasting requires a configured Firebase project and a published embedding release."
    );
    this.name = "ForecastFirestoreUnavailableError";
  }
}

export function getForecastUserMessage(error: unknown): string {
  if (error instanceof ForecastRecordNotFoundError) {
    return `No precomputed embedding found for ${error.zipcode} / ${error.complaintType} / ${error.sourceYear}. It may not be included in this release.`;
  }
  if (error instanceof ForecastVersionMismatchError) {
    return `The selected model is incompatible with the embedding record (${error.kind}). Try a different model or refresh the release data.`;
  }
  if (error instanceof ForecastChecksumError) {
    return `The embedding record failed integrity verification. Try refreshing or contact support.`;
  }
  if (error instanceof ForecastModelLoadError) {
    return `The forecast model could not be loaded. Check your network and try again.`;
  }
  if (error instanceof ForecastInferenceError) {
    return `The local prediction failed. Your browser may not support the required runtime.`;
  }
  if (error instanceof ForecastFirestoreUnavailableError) {
    return `Forecasting is unavailable because Firestore is not configured. Please contact support.`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Forecast failed. Please try again.";
}
