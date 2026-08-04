export type EmbeddingPayload = {
  encoding: string;
  dimension: number;
  scale: number;
  values_base64: string;
};

export function decodeEmbedding(payload: EmbeddingPayload): number[] {
  if (payload.encoding !== "int8-scale") {
    throw new Error(`Unsupported embedding encoding: ${payload.encoding}`);
  }

  const raw = atob(payload.values_base64);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }

  const int8Array = new Int8Array(bytes.buffer);
  const floats: number[] = [];

  for (let i = 0; i < int8Array.length; i += 1) {
    floats.push(int8Array[i] * payload.scale);
  }

  if (floats.length !== payload.dimension) {
    throw new Error(
      `Decoded embedding dimension mismatch: expected ${payload.dimension}, got ${floats.length}`
    );
  }

  return floats;
}
