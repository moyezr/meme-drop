import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text.trim()) {
    return new Array(1536).fill(0);
  }

  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536,
    });

    return response.data[0].embedding;
  } catch (err) {
    console.error("[MemeDrop] Embedding generation failed:", err);
    return new Array(1536).fill(0);
  }
}
