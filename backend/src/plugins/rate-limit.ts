import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { pool } from "../db/index.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  setup?: () => Promise<void>;
  consume: (key: string, windowMs: number, max: number) => Promise<boolean>;
  reset?: () => void;
}

export interface RateLimitQueryClient {
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

const memoryStore = createMemoryRateLimitStore();
const INSTALL_ID_HEADER = "x-memedrop-install-id";
const EXPENSIVE_ROUTES = new Set([
  "POST /api/v1/suggest",
  "POST /api/v1/suggest/caption",
  "POST /api/v1/library/save",
  "GET /api/v1/account/export",
  "DELETE /api/v1/account",
]);

export const rateLimitPlugin: FastifyPluginAsync = async (app) => {
  const store = createConfiguredRateLimitStore();
  await store.setup?.();

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS" || request.url === "/live" || request.url === "/health") {
      return;
    }

    const routeKey = routeKeyForRequest(request);
    const isExpensive = EXPENSIVE_ROUTES.has(routeKey);
    const allowed = await store.consume(
      `${rateLimitClientKey(request)}:${routeKey}`,
      isExpensive ? config.expensiveRateLimitWindowMs : config.apiRateLimitWindowMs,
      isExpensive ? config.expensiveRateLimitMax : config.apiRateLimitMax
    );

    if (!allowed) {
      sendRateLimitResponse(reply);
    }
  });
};

function createConfiguredRateLimitStore(): RateLimitStore {
  if (config.rateLimitStore === "database") return createPostgresRateLimitStore();
  return memoryStore;
}

function routeKeyForRequest(request: FastifyRequest): string {
  const url = request.url.split("?")[0];
  return `${request.method} ${url}`;
}

export function rateLimitClientKey(
  request: Pick<FastifyRequest, "headers" | "ip">
): string {
  const installId = installIdForRequest(request);
  if (installId) return `install:${installId}`;

  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwardedIp =
    typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : undefined;
  return `ip:${firstForwardedIp || request.ip || "unknown"}`;
}

function installIdForRequest(request: Pick<FastifyRequest, "headers">): string | null {
  const raw = request.headers[INSTALL_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !isUuid(value)) return null;
  return value.toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function createMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, Bucket>();

  return {
    async consume(key, windowMs, max) {
      const now = Date.now();
      const current = buckets.get(key);
      if (!current || current.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        pruneExpiredBuckets(buckets, now);
        return true;
      }

      current.count += 1;
      return current.count <= max;
    },
    reset() {
      buckets.clear();
    },
  };
}

export function createPostgresRateLimitStore(client: RateLimitQueryClient = pool): RateLimitStore {
  return {
    async setup() {
      await client.query(`
        CREATE TABLE IF NOT EXISTS api_rate_limits (
          bucket_key text PRIMARY KEY,
          count integer NOT NULL,
          reset_at timestamptz NOT NULL
        )
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS api_rate_limits_reset_at_idx ON api_rate_limits (reset_at)"
      );
    },
    async consume(key, windowMs, max) {
      const result = await client.query<{ count: number }>(
        `
          INSERT INTO api_rate_limits (bucket_key, count, reset_at)
          VALUES ($1, 1, now() + ($2::int * interval '1 millisecond'))
          ON CONFLICT (bucket_key) DO UPDATE SET
            count = CASE
              WHEN api_rate_limits.reset_at <= now() THEN 1
              ELSE api_rate_limits.count + 1
            END,
            reset_at = CASE
              WHEN api_rate_limits.reset_at <= now() THEN now() + ($2::int * interval '1 millisecond')
              ELSE api_rate_limits.reset_at
            END
          RETURNING count
        `,
        [key, windowMs]
      );

      maybePruneExpiredDatabaseBuckets(client);
      return Number(result.rows[0]?.count || 0) <= max;
    },
  };
}

let lastDatabasePruneAt = 0;

function maybePruneExpiredDatabaseBuckets(client: RateLimitQueryClient) {
  const now = Date.now();
  if (now - lastDatabasePruneAt < 60_000) return;
  lastDatabasePruneAt = now;
  client
    .query("DELETE FROM api_rate_limits WHERE reset_at < now() - interval '5 minutes'")
    .catch((err) => {
      console.warn("[MemeDrop] Failed to prune expired rate-limit buckets:", err);
    });
}

function pruneExpiredBuckets(buckets: Map<string, Bucket>, now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function sendRateLimitResponse(reply: FastifyReply) {
  reply.code(429).send({
    error: "Too many requests",
  });
}

export function resetRateLimitBucketsForTest() {
  memoryStore.reset?.();
}
