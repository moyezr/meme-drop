import type { FastifyPluginAsync } from "fastify";
import { getSuggestions } from "../services/suggestion-engine.js";

export const suggestRoutes: FastifyPluginAsync = async (app) => {
  app.post("/suggest", async (request, reply) => {
    const { tweet_text } = request.body as { tweet_text: string };

    if (!tweet_text?.trim()) {
      return reply.code(400).send({ error: "tweet_text is required" });
    }

    try {
      const suggestions = await getSuggestions(tweet_text);
      return { suggestions };
    } catch (err) {
      console.error("[MemeDrop] Suggestion error:", err);
      return reply
        .code(500)
        .send({ error: "Failed to generate suggestions", suggestions: [] });
    }
  });
};
