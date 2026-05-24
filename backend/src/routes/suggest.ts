import type { FastifyPluginAsync } from "fastify";
import {
  getSuggestions,
  getTailoredOverlayForMeme,
} from "../services/suggestion-engine.js";

export const suggestRoutes: FastifyPluginAsync = async (app) => {
  app.post("/suggest", async (request, reply) => {
    const { tweet_text, limit, refresh, cache_key } = request.body as {
      tweet_text: string;
      limit?: number;
      refresh?: boolean;
      cache_key?: string;
    };

    if (!tweet_text?.trim()) {
      return reply.code(400).send({ error: "tweet_text is required" });
    }

    try {
      const suggestions = await getSuggestions(tweet_text, {
        limit,
        refresh,
        cacheKey: cache_key,
      });
      return { suggestions };
    } catch (err) {
      console.error("[MemeDrop] Suggestion error:", err);
      return reply
        .code(500)
        .send({ error: "Failed to generate suggestions", suggestions: [] });
    }
  });

  app.post("/suggest/caption", async (request, reply) => {
    const { tweet_text, meme_id } = request.body as {
      tweet_text: string;
      meme_id: string;
    };

    if (!tweet_text?.trim()) {
      return reply.code(400).send({ error: "tweet_text is required" });
    }
    if (!meme_id?.trim()) {
      return reply.code(400).send({ error: "meme_id is required" });
    }

    try {
      const tailored_overlay = await getTailoredOverlayForMeme(tweet_text, meme_id);
      return { tailored_overlay };
    } catch (err) {
      console.error("[MemeDrop] Caption generation error:", err);
      return reply
        .code(500)
        .send({ error: "Failed to generate caption", tailored_overlay: null });
    }
  });
};
