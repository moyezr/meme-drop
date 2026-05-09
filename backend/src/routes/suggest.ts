import type { FastifyPluginAsync } from "fastify";
import { getSuggestions } from "../services/suggestion-engine.js";

export const suggestRoutes: FastifyPluginAsync = async (app) => {
  app.post("/suggest", async (request, reply) => {
    const { tweet_text, limit, source, refresh, mode } = request.body as {
      tweet_text: string;
      limit?: number;
      source?: "all" | "user" | "global";
      refresh?: boolean;
      mode?: "fast" | "smart";
    };

    if (!tweet_text?.trim()) {
      return reply.code(400).send({ error: "tweet_text is required" });
    }
    if (source && !["all", "user", "global"].includes(source)) {
      return reply.code(400).send({ error: "source must be all, user, or global" });
    }
    if (mode && !["fast", "smart"].includes(mode)) {
      return reply.code(400).send({ error: "mode must be fast or smart" });
    }

    try {
      const suggestions = await getSuggestions(tweet_text, {
        limit,
        source,
        refresh,
        mode,
      });
      return { suggestions };
    } catch (err) {
      console.error("[MemeDrop] Suggestion error:", err);
      return reply
        .code(500)
        .send({ error: "Failed to generate suggestions", suggestions: [] });
    }
  });
};
