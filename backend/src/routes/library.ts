import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { userMemes } from "../db/schema.js";
import { eq, and, desc, asc, ilike, sql } from "drizzle-orm";
import { autoTagMeme } from "../services/auto-tagger.js";
import { downloadImage } from "../services/image-downloader.js";
import { sendValidationError, uuidSchema } from "./validation.js";
import { resolveRequestUserId } from "./identity.js";
import { z } from "zod";

const saveMemeRequestSchema = z.object({
  image_url: z.string().trim().url().max(2048),
  source_tweet_id: z.string().trim().min(1).max(128).optional(),
});

const libraryQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  emotion: z.string().trim().min(1).max(40).optional(),
  sort: z.enum(["recent", "most_used", "alphabetical"]).optional(),
});

const libraryParamsSchema = z.object({
  id: uuidSchema,
});

const updateMemeRequestSchema = z.object({
  user_name: z.string().trim().min(1).max(80).optional(),
  user_tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .optional(),
});

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  // Save meme to library
  app.post("/library/save", async (request, reply) => {
    const parsed = saveMemeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }
    const { image_url } = parsed.data;
    const userId = await resolveRequestUserId(request, reply);
    if (!userId) return;

    try {
      // 1. Download image to local filesystem
      const { filePath, fileName } = await downloadImage(image_url);

      // 2. Auto-tag through OpenRouter vision
      const tags = await autoTagMeme(filePath);

      // 3. Insert into user_memes
      const [meme] = await db
        .insert(userMemes)
        .values({
          userId,
          filePath: `/memes/${fileName}`,
          userName: tags.name,
          userTags: [],
          systemTags: {
            emotion: tags.emotion,
            use_cases: tags.use_cases,
            example_contexts: tags.example_contexts,
            vibes: tags.vibes,
          },
          useCount: 0,
        })
        .returning();

      return { meme };
    } catch (err) {
      console.error("[MemeDrop] Library save error:", err);
      return reply.code(400).send({ error: "Failed to save meme" });
    }
  });

  // List user library with search/filter/sort
  app.get("/library", async (request, reply) => {
    const parsed = libraryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }
    const { search, tag, emotion, sort } = parsed.data;
    const userId = await resolveRequestUserId(request, reply);
    if (!userId) return;

    const conditions = [eq(userMemes.userId, userId)];

    if (search) {
      conditions.push(
        sql`(
          ${ilike(userMemes.userName, `%${search}%`)}
          OR EXISTS (
            SELECT 1 FROM unnest(${userMemes.userTags}) t
            WHERE t ILIKE ${'%' + search + '%'}
          )
          OR ${userMemes.systemTags}::text ILIKE ${'%' + search + '%'}
        )`
      );
    }

    if (emotion) {
      conditions.push(
        sql`${userMemes.systemTags}->>'emotion' = ${emotion}`
      );
    }

    if (tag) {
      conditions.push(
        sql`${userMemes.systemTags}->'use_cases' ? ${tag}`
      );
    }

    let orderBy;
    switch (sort) {
      case "most_used":
        orderBy = desc(userMemes.useCount);
        break;
      case "alphabetical":
        orderBy = asc(userMemes.userName);
        break;
      case "recent":
      default:
        orderBy = desc(userMemes.createdAt);
    }

    const result = await db
      .select()
      .from(userMemes)
      .where(and(...conditions))
      .orderBy(orderBy);

    return { memes: result, total: result.length, page: 1 };
  });

  // Update meme
  app.put<{ Params: { id: string } }>(
    "/library/:id",
    async (request, reply) => {
      const params = libraryParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendValidationError(reply, params.error);
      }
      const body = updateMemeRequestSchema.safeParse(request.body);
      if (!body.success) {
        return sendValidationError(reply, body.error);
      }
      const { id } = params.data;
      const { user_name, user_tags } = body.data;
      const userId = await resolveRequestUserId(request, reply);
      if (!userId) return;

      const updates: Partial<typeof userMemes.$inferInsert> = {};
      if (user_name !== undefined) updates.userName = user_name;
      if (user_tags !== undefined) updates.userTags = user_tags;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "No fields to update" });
      }

      const result = await db
        .update(userMemes)
        .set(updates)
        .where(and(eq(userMemes.id, id), eq(userMemes.userId, userId)))
        .returning();

      if (result.length === 0) {
        return reply.code(404).send({ error: "Meme not found" });
      }

      return { meme: result[0] };
    }
  );

  // Delete meme
  app.delete<{ Params: { id: string } }>(
    "/library/:id",
    async (request, reply) => {
      const params = libraryParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendValidationError(reply, params.error);
      }
      const { id } = params.data;
      const userId = await resolveRequestUserId(request, reply);
      if (!userId) return;

      const result = await db
        .delete(userMemes)
        .where(and(eq(userMemes.id, id), eq(userMemes.userId, userId)))
        .returning({ id: userMemes.id });

      if (result.length === 0) {
        return reply.code(404).send({ error: "Meme not found" });
      }

      return { deleted: true };
    }
  );
};
