import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://test";
process.env.MEMEDROP_REQUIRE_INSTALL_ID = "true";

const { buildApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const {
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  rateLimitClientKey,
  resetRateLimitBucketsForTest,
} = await import("../src/plugins/rate-limit.js");

test.beforeEach(() => {
  resetRateLimitBucketsForTest();
});

test("suggest route rejects missing tweet_text before identity or model work", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/suggest",
    payload: {},
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "Invalid request");
});

test("account deletion requires install identity", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "DELETE",
    url: "/api/v1/account",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, "x-memedrop-install-id is required");
});

test("usage route accepts expanded feedback actions before identity check", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  for (const action of ["shown", "clicked", "inserted", "saved"] as const) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/usage",
      payload: {
        meme_id: "11111111-1111-4111-8111-111111111111",
        action,
        tweet_context: {},
        source: "global",
      },
    });

    assert.equal(response.statusCode, 401, `${action} should pass body validation and require identity`);
    assert.equal(response.json().error, "x-memedrop-install-id is required");
  }
});

test("usage route rejects unknown feedback actions", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/usage",
    payload: {
      meme_id: "11111111-1111-4111-8111-111111111111",
      action: "hovered",
      tweet_context: {},
      source: "global",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "Invalid request");
});

test("usage route rejects unknown tweet context keys", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/usage",
    payload: {
      meme_id: "11111111-1111-4111-8111-111111111111",
      action: "shown",
      tweet_context: {
        raw_tweet_text: "This should never be accepted as usage telemetry context.",
      },
      source: "global",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "Invalid request");
  assert.match(JSON.stringify(response.json().details), /Unrecognized key/);
});

test("usage route rejects oversized tweet context fields", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/v1/usage",
    payload: {
      meme_id: "11111111-1111-4111-8111-111111111111",
      action: "shown",
      tweet_context: {
        humor_angle: "x".repeat(181),
      },
      source: "global",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "Invalid request");
  assert.match(JSON.stringify(response.json().details), /Too big|at most 180/);
});

test("cors preflight allows extension request id and install id headers", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/usage",
    headers: {
      origin: "http://localhost:5173",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-request-id,x-memedrop-install-id",
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.match(
    String(response.headers["access-control-allow-headers"]).toLowerCase(),
    /x-request-id/
  );
  assert.match(
    String(response.headers["access-control-allow-headers"]).toLowerCase(),
    /x-memedrop-install-id/
  );
});

test("responses include a stable caller-provided request id when it is safe", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/live",
    headers: {
      "x-request-id": "release-check-123",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-request-id"], "release-check-123");
});

test("unsafe request ids are replaced before being echoed", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/live",
    headers: {
      "x-request-id": "short",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["x-request-id"]), /^[A-Za-z0-9-]{36}$/);
  assert.notEqual(response.headers["x-request-id"], "short");
});

test("unexpected errors return a safe body with request id", async () => {
  const app = await buildApp({ logger: false });
  app.get("/test/boom", async () => {
    throw new Error("database password leaked in stack");
  });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/test/boom",
    headers: {
      "x-request-id": "boom-check-123",
    },
  });
  const body = response.json();

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["x-request-id"], "boom-check-123");
  assert.equal(body.error, "Internal Server Error");
  assert.equal(body.request_id, "boom-check-123");
  assert.equal(JSON.stringify(body).includes("database password"), false);
});

test("not found responses include request id", async () => {
  const app = await buildApp({ logger: false });
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/missing",
    headers: {
      "x-request-id": "missing-check-123",
    },
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), {
    error: "Not Found",
    request_id: "missing-check-123",
  });
});

test("static meme serving uses configured meme storage path", async () => {
  const app = await buildApp({ logger: false });
  const fileName = `test-${crypto.randomUUID()}.txt`;
  const filePath = path.join(config.memeStoragePath, fileName);
  fs.mkdirSync(config.memeStoragePath, { recursive: true });
  fs.writeFileSync(filePath, "meme-bytes");
  test.after(async () => {
    await app.close();
    fs.rmSync(filePath, { force: true });
  });

  const response = await app.inject({
    method: "GET",
    url: `/memes/${fileName}`,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "meme-bytes");
});

test("rate limit client key prefers valid install id before falling back to IP", () => {
  assert.equal(
    rateLimitClientKey({
      headers: { "x-memedrop-install-id": "11111111-1111-4111-8111-111111111111" },
      ip: "203.0.113.9",
    }),
    "install:11111111-1111-4111-8111-111111111111"
  );

  assert.equal(
    rateLimitClientKey({
      headers: {
        "x-memedrop-install-id": "not-a-uuid",
        "x-forwarded-for": "198.51.100.10, 10.0.0.1",
      },
      ip: "203.0.113.9",
    }),
    "ip:198.51.100.10"
  );
});

test("memory rate-limit store enforces limits and resets after window expiry", async () => {
  const store = createMemoryRateLimitStore();

  assert.equal(await store.consume("test-key", 10, 2), true);
  assert.equal(await store.consume("test-key", 10, 2), true);
  assert.equal(await store.consume("test-key", 10, 2), false);

  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.equal(await store.consume("test-key", 10, 2), true);
});

test("postgres rate-limit store creates schema and enforces returned count", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const store = createPostgresRateLimitStore({
    async query<T>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("RETURNING count")) {
        return { rows: [{ count: 3 } as T] };
      }
      return { rows: [] };
    },
  });

  await store.setup?.();
  const allowed = await store.consume("install:abc:POST /api/v1/suggest", 60_000, 2);
  const consumeCall = calls.find((call) => call.sql.includes("RETURNING count"));

  assert.equal(allowed, false);
  assert.ok(calls.length >= 3);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS api_rate_limits/);
  assert.match(calls[1].sql, /CREATE INDEX IF NOT EXISTS api_rate_limits_reset_at_idx/);
  assert.ok(consumeCall);
  assert.match(consumeCall.sql, /ON CONFLICT \(bucket_key\) DO UPDATE/);
  assert.deepEqual(consumeCall.params, ["install:abc:POST /api/v1/suggest", 60_000]);
});
