import { createOpenAI } from "@ai-sdk/openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const QWEN_PLUS_MODEL = "qwen/qwen3.6-plus";
export const MEME_QUALITY_MODEL =
  process.env.OPENROUTER_MEME_MODEL || "z-ai/glm-5.2";
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

export function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3001",
    "X-Title": process.env.OPENROUTER_APP_NAME || "MemeDrop",
  };
}

export const openrouter = createOpenAI({
  name: "openrouter",
  baseURL: OPENROUTER_BASE_URL,
  apiKey: getOpenRouterApiKey(),
  headers: openRouterHeaders(),
});
