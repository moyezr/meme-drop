import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemeGenerateRequest,
  MemeGenerateResponse,
  MemeGenerateRouteRequest,
  MemeGenerateRouteResponse,
} from "../src/index.js";
import { isPublicId, PUBLIC_ID_TOKEN_LENGTH } from "../src/index.js";

test("the agent-facing meme contract stays minimal", () => {
  const body = {
    input: "We postponed the launch because of another timezone bug.",
  } satisfies MemeGenerateRequest;
  const route = { Body: body } satisfies MemeGenerateRouteRequest;

  assert.deepEqual(route, { Body: { input: body.input } });
});

test("the agent-facing response contains ready-to-use memes", () => {
  const response = {
    status: "ok",
    memes: [
      {
        id: "a_23456789ABCD",
        image_url: "https://api.memedrop.moyezrabbani.dev/api/v1/memes/assets/a_23456789ABCD",
        expires_at: "2026-09-23T12:00:00Z",
      },
    ],
  } satisfies MemeGenerateResponse;
  const routeResponse: MemeGenerateRouteResponse = response;

  assert.deepEqual(routeResponse, response);
  assert.equal("caption" in response.memes[0], false);
  assert.equal("alt_text" in response.memes[0], false);
});

test("public IDs use typed prefixes and twelve non-ambiguous Base58 characters", () => {
  assert.equal(PUBLIC_ID_TOKEN_LENGTH, 12);
  assert.equal(isPublicId("u_23456789ABCD", "u"), true);
  assert.equal(isPublicId("k_abcdefghijkm", "k"), true);
  assert.equal(isPublicId("g_ABCDEFGHJKLM", "g"), true);
  assert.equal(isPublicId("a_NPQRSTUVWXYZ", "a"), true);

  assert.equal(isPublicId("asset_23456789ABCD"), false);
  assert.equal(isPublicId("a_23456789ABC"), false);
  assert.equal(isPublicId("a_23456789ABCO"), false);
  assert.equal(isPublicId("u_23456789ABCD", "a"), false);
});

test("the agent-facing request supports bounded optional tuning", () => {
  const request = {
    input: "The deployment succeeded on the fifth attempt.",
    options: {
      direction: "dry and self-deprecating",
      count: 3,
    },
  } satisfies MemeGenerateRequest;

  assert.equal(request.options.count, 3);
});
