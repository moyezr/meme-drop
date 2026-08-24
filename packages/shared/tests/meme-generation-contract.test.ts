import assert from "node:assert/strict";
import test from "node:test";

import type {
  MemeGenerateRequest,
  MemeGenerateResponse,
  MemeGenerateRouteRequest,
  MemeGenerateRouteResponse,
} from "../src/index.js";

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
        id: "asset_23456789ABCDEFGHJKLMNP",
        image_url: "https://memedropapi.moyezrabbani.dev/api/v1/memes/assets/asset_23456789ABCDEFGHJKLMNP",
        expires_at: "2026-09-23T12:00:00Z",
      },
    ],
  } satisfies MemeGenerateResponse;
  const routeResponse: MemeGenerateRouteResponse = response;

  assert.deepEqual(routeResponse, response);
  assert.equal("caption" in response.memes[0], false);
  assert.equal("alt_text" in response.memes[0], false);
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
