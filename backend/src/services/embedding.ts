import {
  getOpenRouterApiKey,
  openRouterHeaders,
  OPENROUTER_BASE_URL,
  OPENROUTER_EMBEDDING_MODEL,
} from "./llm-provider.js";

export async function generateEmbedding(text: string, signal?: AbortSignal): Promise<number[]> {
  if (!text.trim()) {
    return new Array(1536).fill(0);
  }

  try {
    const apiKey = getOpenRouterApiKey();
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...openRouterHeaders(),
      },
      body: JSON.stringify({
        model: OPENROUTER_EMBEDDING_MODEL,
        input: text,
        dimensions: 1536,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter embedding request failed ${response.status}: ${body.slice(0, 400)}`);
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) {
      throw new Error("OpenRouter embedding response did not include an embedding");
    }

    return embedding;
  } catch (err) {
    console.error("[MemeDrop] Embedding generation failed:", err);
    return new Array(1536).fill(0);
  }
}
