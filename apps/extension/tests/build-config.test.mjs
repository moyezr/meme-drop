import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_API_BASE_URL,
  resolveApiBaseUrl,
} from "../build-config.ts";

test("normal extension builds ignore an inherited release API URL", () => {
  assert.equal(
    resolveApiBaseUrl("production", "https://api.memedrop.example"),
    LOCAL_API_BASE_URL
  );
});

test("release builds use the explicitly configured API URL", () => {
  assert.equal(
    resolveApiBaseUrl("release", "https://api.memedrop.example"),
    "https://api.memedrop.example"
  );
});

test("release builds require an explicit API URL", () => {
  assert.throws(
    () => resolveApiBaseUrl("release"),
    /VITE_API_BASE_URL is required in release mode/
  );
});
