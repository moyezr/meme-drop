import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { usageEvents, userMemes } from "../db/schema.js";
import { and, eq, sql } from "drizzle-orm";
import { sendValidationError, uuidSchema } from "./validation.js";
import { resolveRequestUserId } from "./identity.js";
import { USAGE_FEEDBACK_ACTIONS } from "../db/usage-actions.js";
import { z } from "zod";

const usageTweetContextSchema = z
  .object({
    sentiment: z.enum(["positive", "negative", "neutral"]).optional(),
    tone: z
      .enum([
        "sarcastic",
        "earnest",
        "rant",
        "celebratory",
        "hot-take",
        "question",
        "absurdist",
        "wholesome",
        "self-deprecating",
      ])
      .optional(),
    topic: z
      .enum([
        "tech",
        "finance",
        "politics",
        "sports",
        "entertainment",
        "personal",
        "culture",
        "relationships",
        "other",
      ])
      .optional(),
    intent: z
      .enum([
        "counter-argument",
        "agreement",
        "sharing-opinion",
        "venting",
        "asking",
        "celebrating",
        "dunking",
        "self-deprecating",
      ])
      .optional(),
    intensity: z.number().min(0).max(1).optional(),
    reply_style: z.string().trim().max(80).optional(),
    ideal_meme_vibe: z.string().trim().max(180).optional(),
    joke_target: z.string().trim().max(120).optional(),
    social_dynamic: z.string().trim().max(160).optional(),
    humor_angle: z.string().trim().max(180).optional(),
    keywords: z.array(z.string().trim().min(1).max(40)).max(6).optional(),
  })
  .strict();

const usageRequestSchema = z.object({
  meme_id: uuidSchema,
  action: z.enum(USAGE_FEEDBACK_ACTIONS),
  tweet_context: usageTweetContextSchema.default({}),
  source: z.enum(["user", "global"]).optional(),
});

export const usageRoutes: FastifyPluginAsync = async (app) => {
  app.post("/usage", async (request, reply) => {
    const parsed = usageRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }
    const { meme_id, action, tweet_context, source } = parsed.data;
    const userId = await resolveRequestUserId(request, reply);
    if (!userId) return;

    const resolvedSource = source || (await inferMemeSource(meme_id, userId));

    await db.insert(usageEvents).values({
      userId,
      userMemeId: resolvedSource === "user" ? meme_id : null,
      globalMemeId: resolvedSource === "user" ? null : meme_id,
      action,
      tweetContext: tweet_context,
    });

    if ((action === "used" || action === "inserted") && resolvedSource === "user") {
      await db
        .update(userMemes)
        .set({
          useCount: sql`${userMemes.useCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(and(eq(userMemes.id, meme_id), eq(userMemes.userId, userId)));
    }

    return { logged: true };
  });
};

async function inferMemeSource(
  memeId: string,
  userId: string
): Promise<"user" | "global"> {
  const [userMeme] = await db
    .select({ id: userMemes.id })
    .from(userMemes)
    .where(and(eq(userMemes.id, memeId), eq(userMemes.userId, userId)))
    .limit(1);

  return userMeme ? "user" : "global";
}
