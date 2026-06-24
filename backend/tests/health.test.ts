import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgresql://test";

const { makeHealthRoutes } = await import("../src/routes/health.js");

test("/live reports process liveness without dependencies", async () => {
  const app = Fastify({ logger: false });
  await app.register(
    makeHealthRoutes({
      checkReadiness: async () => {
        throw new Error("readiness should not run for liveness");
      },
    })
  );
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({ method: "GET", url: "/live" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
});

test("/health returns ok when readiness passes", async () => {
  const app = Fastify({ logger: false });
  await app.register(
    makeHealthRoutes({
      checkReadiness: async () => true,
    })
  );
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok", db: true });
});

test("/health returns 503 when readiness fails", async () => {
  const app = Fastify({ logger: false });
  await app.register(
    makeHealthRoutes({
      checkReadiness: async () => false,
    })
  );
  test.after(async () => {
    await app.close();
  });

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { status: "degraded", db: false });
});
