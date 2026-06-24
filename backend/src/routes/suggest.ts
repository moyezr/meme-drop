import type { FastifyPluginAsync } from "fastify";
import {
  getSuggestions,
  getTailoredOverlayForMeme,
} from "../services/suggestion-engine.js";
import {
  sendValidationError,
  tweetTextSchema,
  uuidSchema,
} from "./validation.js";
import { resolveRequestUserId } from "./identity.js";
import { z } from "zod";

const suggestRequestSchema = z.object({
  tweet_text: tweetTextSchema,
  limit: z.number().int().min(1).max(10).optional(),
  refresh: z.boolean().optional(),
  cache_key: z.string().trim().min(1).max(240).optional(),
  mode: z.enum(["fast", "smart"]).optional(),
});

const captionRequestSchema = z.object({
  tweet_text: tweetTextSchema,
  meme_id: uuidSchema,
});

export const suggestRoutes: FastifyPluginAsync = async (app) => {
  app.post("/suggest", async (request, reply) => {
    const parsed = suggestRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }
    const { tweet_text, limit, refresh, cache_key, mode } = parsed.data;
    const userId = await resolveRequestUserId(request, reply);
    if (!userId) return;

    try {
      const suggestions = await getSuggestions(tweet_text, {
        limit,
        refresh,
        cacheKey: cache_key,
        mode,
        userId,
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
    const parsed = captionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }
    const { tweet_text, meme_id } = parsed.data;

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
