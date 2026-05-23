import { createOpenAI } from "@ai-sdk/openai";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const QWEN_PLUS_MODEL = "qwen/qwen3.6-plus";

export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

export function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3001",
    "X-Title": process.env.OPENROUTER_APP_NAME || "MemeDrop",
  };
}

async function openRouterFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.body && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      body.reasoning = { effort: "none", exclude: true };
      return fetch(input, {
        ...init,
        body: JSON.stringify(body),
      });
    } catch {
      // Fall through to the original request body.
    }
  }

  return fetch(input, init);
}

export const openrouter = createOpenAI({
  name: "openrouter",
  baseURL: OPENROUTER_BASE_URL,
  apiKey: getOpenRouterApiKey(),
  headers: openRouterHeaders(),
  fetch: openRouterFetch,
});
