import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { usageEvents, userMemes } from "../db/schema.js";
import { and, eq, sql } from "drizzle-orm";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.post("/usage", async (request) => {
    const { meme_id, action, tweet_context, source } = request.body as {
      meme_id: string;
      action: "suggested" | "used" | "dismissed";
      tweet_context: Record<string, unknown>;
      source?: "user" | "global";
    };

    const resolvedSource = source || (await inferMemeSource(meme_id));

    await db.insert(usageEvents).values({
      userId: DEV_USER_ID,
      userMemeId: resolvedSource === "user" ? meme_id : null,
      globalMemeId: resolvedSource === "user" ? null : meme_id,
      action,
      tweetContext: tweet_context,
    });

    if (action === "used" && resolvedSource === "user") {
      await db
        .update(userMemes)
        .set({
          useCount: sql`${userMemes.useCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(eq(userMemes.id, meme_id));
    }

    return { logged: true };
  });
};

async function inferMemeSource(memeId: string): Promise<"user" | "global"> {
  const [userMeme] = await db
    .select({ id: userMemes.id })
    .from(userMemes)
    .where(and(eq(userMemes.id, memeId), eq(userMemes.userId, DEV_USER_ID)))
    .limit(1);

  return userMeme ? "user" : "global";
}
