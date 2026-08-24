import assert from "node:assert/strict";
import test from "node:test";

import {
  repositoryOnlyEnvironment,
  requireDisposableDatabaseUrl,
  requireLocalServiceUrl,
} from "../scripts/deployment-readiness.mjs";

test("deployment readiness accepts only loopback test services", () => {
  assert.equal(
    requireLocalServiceUrl(
      "MEMEDROP_TEST_DATABASE_URL",
      "postgresql://postgres:postgres@127.0.0.1:5432/memedrop_test",
      ["postgresql:"]
    ),
    "postgresql://postgres:postgres@127.0.0.1:5432/memedrop_test"
  );
  assert.throws(
    () =>
      requireLocalServiceUrl(
        "MEMEDROP_TEST_DATABASE_URL",
        "postgresql://db.production.example/memedrop",
        ["postgresql:"]
      ),
    /must point to a loopback/
  );
});

test("deployment readiness refuses a non-disposable local database name", () => {
  assert.equal(
    requireDisposableDatabaseUrl(
      "postgresql://postgres:postgres@127.0.0.1:5432/memedrop_readiness"
    ),
    "postgresql://postgres:postgres@127.0.0.1:5432/memedrop_readiness"
  );
  assert.throws(
    () =>
      requireDisposableDatabaseUrl(
        "postgresql://postgres:postgres@127.0.0.1:5432/memedrop"
      ),
    /database name must include test, integration, or readiness/
  );
});

test("deployment readiness removes product credentials and hosted modes", () => {
  const environment = repositoryOnlyEnvironment({
    OPENROUTER_API_KEY: "provider-secret",
    TAVILY_API_KEY: "provider-secret",
    S3_SECRET_ACCESS_KEY: "storage-secret",
    CRON_SECRET: "cron-secret",
    MEMEDROP_ENV: "production",
    MEMEDROP_STORAGE_BACKEND: "s3",
    MEMEDROP_TRENDS_ENABLED: "true",
  });

  assert.equal(environment.OPENROUTER_API_KEY, "");
  assert.equal(environment.TAVILY_API_KEY, "");
  assert.equal(environment.S3_SECRET_ACCESS_KEY, "");
  assert.equal(environment.CRON_SECRET, "repository-only-local-secret");
  assert.equal(environment.MEMEDROP_TREND_CRON_SECRET, "repository-only-local-secret");
  assert.equal(environment.MEMEDROP_ENV, "development");
  assert.equal(environment.MEMEDROP_STORAGE_BACKEND, "local");
  assert.equal(environment.MEMEDROP_TRENDS_ENABLED, "false");
});
