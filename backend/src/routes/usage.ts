import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { usageEvents } from "../db/schema.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.post("/usage", async (request) => {
    const { meme_id, action, tweet_context } = request.body as {
      meme_id: string;
      action: "suggested" | "used" | "dismissed";
      tweet_context: Record<string, unknown>;
    };

    await db.insert(usageEvents).values({
      userId: DEV_USER_ID,
      globalMemeId: meme_id,
      action,
      tweetContext: tweet_context,
    });

    return { logged: true };
  });
};
