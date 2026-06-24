import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { memes } from "../db/schema.js";
import { eq, ilike, sql, and, desc } from "drizzle-orm";
import { sendValidationError } from "./validation.js";
import { z } from "zod";

const browseMemesQuerySchema = z.object({
  format: z.string().trim().min(1).max(40).optional(),
  emotion: z.string().trim().min(1).max(40).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

export const memesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/memes/browse", async (request, reply) => {
    const parsed = browseMemesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return sendValidationError(reply, parsed.error);
    }
    const { format, emotion, search } = parsed.data;

    const conditions = [];

    if (format) {
      conditions.push(eq(memes.formatType, format));
    }
    if (emotion) {
      conditions.push(
        sql`${memes.systemTags}->>'emotion' = ${emotion}`
      );
    }
    if (search) {
      conditions.push(ilike(memes.name, `%${search}%`));
    }

    const result = await db
      .select()
      .from(memes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(memes.createdAt));

    return { memes: result };
  });
};
