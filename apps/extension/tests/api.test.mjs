import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of keys) result[key] = storage.get(key);
        return result;
      },
      async set(values) {
        for (const [key, value] of Object.entries(values)) {
          storage.set(key, value);
        }
      },
    },
  },
};

const {
  ApiError,
  REQUEST_ID_HEADER,
  apiFetch,
  createRequestId,
  withApiRequestHeaders,
} = await import("../src/shared/api.ts");

test.beforeEach(() => {
  storage.clear();
  storage.set("memedrop_install_id", "11111111-1111-4111-8111-111111111111");
});

test("apiFetch sends install id and generated request id headers", async () => {
  let capturedRequest;
  globalThis.fetch = async (url, init) => {
    capturedRequest = { url, init };
    return jsonResponse(200, { ok: true }, { "x-request-id": "server-request-1" });
  };

  const response = await apiFetch("/suggest", {
    method: "POST",
    body: JSON.stringify({ tweet_text: "ship it" }),
  });
  const headers = capturedRequest.init.headers;

  assert.deepEqual(response, { ok: true });
  assert.equal(capturedRequest.url, "http://localhost:3001/api/v1/suggest");
  assert.equal(headers.get("X-MemeDrop-Install-Id"), "11111111-1111-4111-8111-111111111111");
  assert.match(headers.get(REQUEST_ID_HEADER), /^ext-[0-9a-f-]{36}$/i);
});

test("apiFetch preserves caller request id override", async () => {
  let capturedHeaders;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init.headers;
    return jsonResponse(200, { ok: true });
  };

  await apiFetch("/library", {
    headers: {
      [REQUEST_ID_HEADER]: "manual-request-id",
    },
  });

  assert.equal(capturedHeaders.get(REQUEST_ID_HEADER), "manual-request-id");
});

test("apiFetch throws ApiError with backend request id", async () => {
  globalThis.fetch = async () =>
    jsonResponse(
      500,
      {
        error: "Internal Server Error",
        request_id: "body-request-id",
      },
      {
        "x-request-id": "header-request-id",
      },
      "Internal Server Error"
    );

  await assert.rejects(
    apiFetch("/suggest"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 500);
      assert.equal(error.statusText, "Internal Server Error");
      assert.equal(error.requestId, "header-request-id");
      assert.equal(
        error.message,
        "API error: 500 Internal Server Error (request header-request-id)"
      );
      return true;
    }
  );
});

test("apiFetch falls back to body request id when response header is missing", async () => {
  globalThis.fetch = async () =>
    jsonResponse(400, {
      error: "Invalid request",
      request_id: "body-request-id",
    });

  await assert.rejects(
    apiFetch("/suggest"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.requestId, "body-request-id");
      assert.equal(error.message, "API error: 400 Invalid request (request body-request-id)");
      return true;
    }
  );
});

test("withApiRequestHeaders can be reused by direct background fetches", async () => {
  const headers = await withApiRequestHeaders({
    "X-Custom": "value",
  });

  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("X-Custom"), "value");
  assert.equal(headers.get("X-MemeDrop-Install-Id"), "11111111-1111-4111-8111-111111111111");
  assert.match(headers.get(REQUEST_ID_HEADER), /^ext-[0-9a-f-]{36}$/i);
});

test("createRequestId uses extension-scoped prefix", () => {
  assert.match(createRequestId(), /^ext-[0-9a-f-]{36}$/i);
});

function jsonResponse(status, body, headers = {}, statusText = status === 200 ? "OK" : "Error") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}
