import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export interface HealthRouteOptions {
  checkReadiness?: () => Promise<boolean>;
}

export function makeHealthRoutes(options: HealthRouteOptions = {}): FastifyPluginAsync {
  const checkReadiness = options.checkReadiness || checkDatabaseReadiness;

  return async (app) => {
    app.get("/live", async () => ({ status: "ok" }));

    app.get("/health", async (_request, reply) => {
      const ready = await checkReadiness();
      if (!ready) {
        reply.code(503);
        return { status: "degraded", db: false };
      }

      return { status: "ok", db: true };
    });
  };
}

async function checkDatabaseReadiness(): Promise<boolean> {
  try {
    const result = await withTimeout(db.execute(sql`SELECT 1`), 1_000);
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Readiness check timed out")), timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const healthRoutes = makeHealthRoutes();
