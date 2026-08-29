import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardNoStoreHeaders,
  readIdempotencyKey,
  normalizedUpstreamError,
  requireSameOriginMutation,
  validatedRequestId,
  validateDashboardApiOrigin,
} from "../src/lib/dashboard-proxy-core";

test("dashboard mutations require an exact same-origin Origin header", async () => {
  const sameOrigin = new Request("https://memedrop.example/api/dashboard/api-keys", {
    method: "POST",
    headers: { Origin: "https://memedrop.example" },
  });
  assert.equal(requireSameOriginMutation(sameOrigin), null);

  for (const origin of [undefined, "https://attacker.example", "null"]) {
    const request = new Request("https://memedrop.example/api/dashboard/api-keys", {
      method: "POST",
      headers: origin ? { Origin: origin } : undefined,
    });
    const response = requireSameOriginMutation(request);
    assert.equal(response?.status, 403);
    assert.equal(response?.headers.get("cache-control"), "no-store, max-age=0");
    assert.deepEqual(await response?.json(), {
      error: { code: "invalid_request_origin" },
    });
  }
});

test("upstream errors are normalized without forwarding their body", async () => {
  const invalid = normalizedUpstreamError(422, "request_12345678");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("x-request-id"), "request_12345678");
  assert.deepEqual(await invalid.json(), {
    error: { code: "dashboard_request_invalid" },
  });

  const internalAuthenticationFailure = normalizedUpstreamError(401);
  assert.equal(internalAuthenticationFailure.status, 502);
  assert.deepEqual(await internalAuthenticationFailure.json(), {
    error: { code: "dashboard_api_auth_failed" },
  });

  const unexpected = normalizedUpstreamError(599);
  assert.equal(unexpected.status, 502);
  assert.deepEqual(await unexpected.json(), {
    error: { code: "dashboard_api_unavailable" },
  });
});

test("request IDs are forwarded only when they match the API-safe format", () => {
  assert.equal(validatedRequestId("request_12345678"), "request_12345678");
  for (const value of [null, "short", "request.with.dot", "request id 123"]) {
    assert.equal(validatedRequestId(value), undefined);
    assert.equal(dashboardNoStoreHeaders(undefined, value ?? undefined).has("x-request-id"), false);
  }
});

test("API-key creation requires a bounded visible idempotency key", async () => {
  const valid = new Request("https://memedrop.example/api/dashboard/api-keys", {
    method: "POST",
    headers: { "Idempotency-Key": "create_key_12345678" },
  });
  assert.equal(readIdempotencyKey(valid), "create_key_12345678");

  for (const value of [undefined, "contains spaces", "x".repeat(201)]) {
    const request = new Request("https://memedrop.example/api/dashboard/api-keys", {
      method: "POST",
      headers: value ? { "Idempotency-Key": value } : undefined,
    });
    const response = readIdempotencyKey(request);
    assert.ok(response instanceof Response);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: "invalid_idempotency_key" },
    });
  }
});

test("dashboard API origins are exact in production and loopback-only for development HTTP", () => {
  assert.equal(
    validateDashboardApiOrigin("https://api.memedrop.moyezrabbani.dev", {
      vercelEnv: "production",
      nodeEnv: "production",
    }),
    "https://api.memedrop.moyezrabbani.dev",
  );
  assert.throws(() =>
    validateDashboardApiOrigin("https://preview-api.example", {
      vercelEnv: "production",
      nodeEnv: "production",
    }),
  );
  assert.equal(
    validateDashboardApiOrigin("http://localhost:3001", {
      nodeEnv: "development",
    }),
    "http://localhost:3001",
  );
  assert.throws(() =>
    validateDashboardApiOrigin("http://localhost:3001", {
      nodeEnv: "production",
    }),
  );
  assert.throws(() =>
    validateDashboardApiOrigin("http://private-api.example", {
      nodeEnv: "development",
    }),
  );
});
