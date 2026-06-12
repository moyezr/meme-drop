import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { userMemes } from "../db/schema.js";
import { eq, and, desc, asc, ilike, sql } from "drizzle-orm";
import { autoTagMeme } from "../services/auto-tagger.js";
import { downloadImage } from "../services/image-downloader.js";

const DEV_USER_ID = "00000000-0000-0000-0000-000000000001";

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  // Save meme to library
  app.post("/library/save", async (request, reply) => {
    const { image_url, source_tweet_id } = request.body as {
      image_url: string;
      source_tweet_id?: string;
    };

    // 1. Download image to local filesystem
    const { filePath, fileName } = await downloadImage(image_url);

    // 2. Auto-tag through OpenRouter vision
    const tags = await autoTagMeme(filePath);

    // 3. Insert into user_memes
    const [meme] = await db
      .insert(userMemes)
      .values({
        userId: DEV_USER_ID,
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
  });

  // List user library with search/filter/sort
  app.get("/library", async (request) => {
    const { search, tag, emotion, sort } = request.query as {
      search?: string;
      tag?: string;
      emotion?: string;
      sort?: "recent" | "most_used" | "alphabetical";
    };

    const conditions = [eq(userMemes.userId, DEV_USER_ID)];

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
      const { id } = request.params;
      const { user_name, user_tags } = request.body as {
        user_name?: string;
        user_tags?: string[];
      };

      const updates: Partial<typeof userMemes.$inferInsert> = {};
      if (user_name !== undefined) updates.userName = user_name;
      if (user_tags !== undefined) updates.userTags = user_tags;

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "No fields to update" });
      }

      const result = await db
        .update(userMemes)
        .set(updates)
        .where(and(eq(userMemes.id, id), eq(userMemes.userId, DEV_USER_ID)))
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
      const { id } = request.params;

      const result = await db
        .delete(userMemes)
        .where(and(eq(userMemes.id, id), eq(userMemes.userId, DEV_USER_ID)))
        .returning({ id: userMemes.id });

      if (result.length === 0) {
        return reply.code(404).send({ error: "Meme not found" });
      }

      return { deleted: true };
    }
  );
};
