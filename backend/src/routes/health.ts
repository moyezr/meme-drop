import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => {
    const result = await db.execute(sql`SELECT 1`);
    return { status: "ok", db: result.rows.length > 0 };
  });
};
