import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { memes } from "../db/schema.js";
import { eq, ilike, sql, and, desc } from "drizzle-orm";

export const memesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/memes/browse", async (request) => {
    const { format, emotion, search } = request.query as {
      format?: string;
      emotion?: string;
      search?: string;
    };

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
