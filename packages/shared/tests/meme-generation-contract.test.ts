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
        id: "suggestion-123",
        image_url: "https://cdn.example.test/finished-meme.jpg",
        alt_text: "A finished meme about postponing a launch.",
        caption: "ONE LAST TIMEZONE FIX",
      },
    ],
  } satisfies MemeGenerateResponse;
  const routeResponse: MemeGenerateRouteResponse = response;

  assert.deepEqual(routeResponse, response);
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
