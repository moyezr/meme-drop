import assert from "node:assert/strict";
import test from "node:test";
import { validateProductionConfig } from "../scripts/validate-production-config.mjs";

const validProduction = {
  VERCEL_ENV: "production",
  AUTH_SECRET: "auth-secret-0123456789abcdef0123456789abcdef",
  AUTH_GITHUB_ID: "github-client-id",
  AUTH_GITHUB_SECRET: "github-client-secret",
  MEMEDROP_API_BASE_URL: "https://api.memedrop.moyezrabbani.dev",
  MEMEDROP_DASHBOARD_TOKEN_SECRET:
    "bridge-secret-0123456789abcdef0123456789abcdef",
};

test("production web configuration requires the complete bridge contract", () => {
  assert.deepEqual(validateProductionConfig(validProduction), []);

  const errors = validateProductionConfig({
    ...validProduction,
    AUTH_SECRET: "<replace-me>",
    AUTH_GITHUB_SECRET: undefined,
    MEMEDROP_API_BASE_URL: "https://preview-api.example",
    MEMEDROP_DASHBOARD_TOKEN_SECRET: " bridge-secret-with-padding-0123456789 ",
  });
  assert.ok(errors.some((error) => error.startsWith("AUTH_SECRET")));
  assert.ok(errors.some((error) => error.startsWith("GitHub OAuth")));
  assert.ok(errors.some((error) => error.startsWith("MEMEDROP_API_BASE_URL")));
  assert.ok(
    errors.some((error) => error.startsWith("MEMEDROP_DASHBOARD_TOKEN_SECRET")),
  );
  assert.ok(errors.some((error) => error.startsWith("At least one complete")));
  assert.ok(errors.every((error) => !error.includes(validProduction.AUTH_SECRET)));
});

test("local builds do not require deployed secrets", () => {
  assert.deepEqual(validateProductionConfig({ NODE_ENV: "production" }), []);
});
