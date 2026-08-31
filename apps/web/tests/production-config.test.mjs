import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the Turbo web build allows and hashes all production validation inputs", () => {
  const turbo = JSON.parse(readFileSync(new URL("../../../turbo.json", import.meta.url), "utf8"));
  const task = turbo.tasks["@memedrop/web#build"];
  const googleProduction = {
    ...validProduction,
    AUTH_GITHUB_ID: undefined,
    AUTH_GITHUB_SECRET: undefined,
    AUTH_GOOGLE_ID: "google-client-id",
    AUTH_GOOGLE_SECRET: "google-client-secret",
  };
  for (const environment of [validProduction, googleProduction]) {
    for (const name of Object.keys(environment)) {
      assert.ok(task.env.includes(name), `${name} must reach the web build and affect its cache key`);
    }
    const filtered = Object.fromEntries(Object.entries(environment).filter(([name]) => task.env.includes(name)));
    assert.deepEqual(validateProductionConfig(filtered), []);
  }
  assert.deepEqual(task.dependsOn, ["^build"]);
  assert.deepEqual(task.outputs, [".next/**", "!.next/cache/**"]);
  assert.equal(turbo.globalEnv, undefined, "web secrets must stay scoped to the web build");
});
