import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import test from "node:test";

import { runSmokeAgent, SmokeAgentError } from "../src/smoke-agent.js";

const API_KEY = "key_23456789ABCDEFGHJKLMNP.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ASSET_ID = "asset_23456789ABCDEFGHJKLMNP";
const NOW = new Date("2026-08-27T00:00:00.000Z");
const EXPIRES_AT = "2026-09-26T00:00:00.000Z";

test("acts as a black-box agent and verifies replay plus private media", async () => {
  const requests: Array<{
    method: string;
    path: string;
    authorization: string | undefined;
    idempotencyKey: string | undefined;
    body: string;
  }> = [];
  let baseUrl = "";
  const server = await startServer(async (request, response) => {
    const body = await requestBody(request);
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization,
      idempotencyKey: header(request, "idempotency-key"),
      body,
    });
    if (request.url === "/live") return json(response, 200, { status: "ok" });
    if (request.url === "/health") {
      return json(response, 200, { status: "ok", db: true, trends: { state: "fresh" } });
    }
    if (request.url === "/api/v1/memes/generate") {
      response.setHeader("x-request-id", `request-${requests.length}`);
      return json(response, 200, {
        status: "ok",
        memes: [
          {
            id: ASSET_ID,
            image_url: `${baseUrl}/api/v1/memes/assets/${ASSET_ID}`,
            expires_at: EXPIRES_AT,
          },
        ],
      });
    }
    if (request.url === `/api/v1/memes/assets/${ASSET_ID}`) {
      response.writeHead(200, { "content-type": "image/webp", "content-length": "4" });
      response.end(Buffer.from([0x52, 0x49, 0x46, 0x46]));
      return;
    }
    response.writeHead(404).end();
  });
  baseUrl = server.baseUrl;

  try {
    const report = await runSmokeAgent({
      apiBaseUrl: baseUrl,
      apiKey: API_KEY,
      input: "A synthetic private input that must not be logged",
      idempotencyKey: "smoke-case-1",
      now: () => NOW,
    });

    assert.equal(report.status, "passed");
    assert.equal(report.target_origin, baseUrl);
    assert.equal(report.generation_status, "ok");
    assert.deepEqual(report.asset_ids, [ASSET_ID]);
    assert.deepEqual(report.media, [{ id: ASSET_ID, content_type: "image/webp", bytes: 4 }]);
    assert.equal(report.replay_verified, true);

    const generations = requests.filter((request) => request.path.endsWith("/generate"));
    assert.equal(generations.length, 2);
    assert.deepEqual(generations.map((request) => request.authorization), [
      `Bearer ${API_KEY}`,
      `Bearer ${API_KEY}`,
    ]);
    assert.deepEqual(generations.map((request) => request.idempotencyKey), [
      "smoke-case-1",
      "smoke-case-1",
    ]);
    assert.deepEqual(generations.map((request) => JSON.parse(request.body)), [
      { input: "A synthetic private input that must not be logged" },
      { input: "A synthetic private input that must not be logged" },
    ]);
    const media = requests.find((request) => request.path.includes("/assets/"));
    assert.equal(media?.authorization, `Bearer ${API_KEY}`);
    assert.ok(!JSON.stringify(report).includes(API_KEY));
    assert.ok(!JSON.stringify(report).includes("synthetic private input"));
  } finally {
    await server.close();
  }
});

test("accepts a replayed no-fit response without fetching media", async () => {
  let mediaRequests = 0;
  const server = await startServer(async (request, response) => {
    await requestBody(request);
    if (request.url === "/live" || request.url === "/health") {
      return json(response, 200, { status: "ok" });
    }
    if (request.url === "/api/v1/memes/generate") {
      return json(response, 200, { status: "no_fit", memes: [] });
    }
    mediaRequests += 1;
    response.writeHead(404).end();
  });

  try {
    const report = await runSmokeAgent({
      apiBaseUrl: server.baseUrl,
      apiKey: API_KEY,
      input: "No suitable joke",
      idempotencyKey: "smoke-no-fit",
      now: () => NOW,
    });
    assert.equal(report.generation_status, "no_fit");
    assert.equal(report.meme_count, 0);
    assert.deepEqual(report.media, []);
    assert.equal(mediaRequests, 0);
  } finally {
    await server.close();
  }
});

test("never forwards a credential to a cross-origin asset URL", async () => {
  let requestCount = 0;
  const server = await startServer(async (request, response) => {
    requestCount += 1;
    await requestBody(request);
    if (request.url === "/live" || request.url === "/health") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 200, {
      status: "ok",
      memes: [
        {
          id: ASSET_ID,
          image_url: `https://untrusted.example/api/v1/memes/assets/${ASSET_ID}`,
          expires_at: EXPIRES_AT,
        },
      ],
    });
  });

  try {
    await assert.rejects(
      runSmokeAgent({
        apiBaseUrl: server.baseUrl,
        apiKey: API_KEY,
        input: "Do not leak credentials",
        idempotencyKey: "smoke-untrusted-url",
        now: () => NOW,
      }),
      (error: unknown) =>
        error instanceof SmokeAgentError &&
        error.step === "response_validation" &&
        error.code === "untrusted_asset_url",
    );
    assert.equal(requestCount, 3);
  } finally {
    await server.close();
  }
});

test("surfaces stable API errors without returning the response body", async () => {
  const server = await startServer(async (request, response) => {
    await requestBody(request);
    if (request.url === "/live" || request.url === "/health") {
      return json(response, 200, { status: "ok" });
    }
    return json(response, 402, {
      error: { code: "insufficient_credits" },
      private_detail: "must never be exposed",
    });
  });

  try {
    await assert.rejects(
      runSmokeAgent({
        apiBaseUrl: server.baseUrl,
        apiKey: API_KEY,
        input: "Credit boundary",
        idempotencyKey: "smoke-no-credits",
        now: () => NOW,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SmokeAgentError);
        assert.equal(error.code, "insufficient_credits");
        assert.equal(error.httpStatus, 402);
        assert.ok(!error.message.includes("private_detail"));
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("stops before generation when readiness is degraded", async () => {
  let generationRequests = 0;
  const server = await startServer(async (request, response) => {
    await requestBody(request);
    if (request.url === "/live") return json(response, 200, { status: "ok" });
    if (request.url === "/health") {
      return json(response, 503, { status: "degraded", db: false });
    }
    generationRequests += 1;
    return json(response, 500, { error: { code: "should_not_run" } });
  });

  try {
    await assert.rejects(
      runSmokeAgent({
        apiBaseUrl: server.baseUrl,
        apiKey: API_KEY,
        input: "Do not spend while unhealthy",
        idempotencyKey: "smoke-degraded",
      }),
      (error: unknown) =>
        error instanceof SmokeAgentError &&
        error.step === "readiness" &&
        error.code === "service_unavailable" &&
        error.httpStatus === 503,
    );
    assert.equal(generationRequests, 0);
  } finally {
    await server.close();
  }
});

test("requires HTTPS except for local development origins", async () => {
  await assert.rejects(
    runSmokeAgent({
      apiBaseUrl: "http://api.example.com",
      apiKey: API_KEY,
      input: "Unsafe target",
    }),
    (error: unknown) => error instanceof SmokeAgentError && error.code === "insecure_api_base_url",
  );
  await assert.rejects(
    runSmokeAgent({
      apiBaseUrl: "https://api.example.com/v1",
      apiKey: API_KEY,
      input: "Wrong target shape",
    }),
    (error: unknown) =>
      error instanceof SmokeAgentError && error.code === "api_base_url_must_be_origin",
  );
  await assert.rejects(
    runSmokeAgent({
      apiBaseUrl: "https://api.example.com",
      apiKey: API_KEY,
      input: "Invalid retry identity",
      idempotencyKey: "contains whitespace",
    }),
    (error: unknown) => error instanceof SmokeAgentError && error.code === "invalid_idempotency_key",
  );
});

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handler(request, response).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("test server unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(payload)),
  });
  response.end(payload);
}
