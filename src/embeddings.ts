const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = "voyage-4-large";
const VOYAGE_DIMENSIONS = 1024;

function getApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY not set");
  return key;
}

async function callVoyage(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify({
      model: VOYAGE_MODEL,
      input: texts,
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSIONS,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${err}`);
  }

  const json = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return json.data.map((d) => d.embedding);
}

export async function getEmbedding(text: string): Promise<number[]> {
  const [embedding] = await callVoyage([text], "query");
  return embedding;
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  // Voyage supports up to 128 texts per request
  const batchSize = 128;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await callVoyage(batch, "document");
    results.push(...embeddings);
  }
  return results;
}

export function getEmbeddingDimension(): number {
  return VOYAGE_DIMENSIONS;
}
