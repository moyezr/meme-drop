import assert from "node:assert/strict";
import test from "node:test";
import { jwtVerify } from "jose";
import {
  DASHBOARD_ASSERTION_AUDIENCE,
  DASHBOARD_ASSERTION_ISSUER,
  DASHBOARD_ASSERTION_TTL_SECONDS,
  signDashboardAssertion,
} from "../src/lib/dashboard-assertion-core";

const secret = new TextEncoder().encode("a-secure-test-secret-with-32-bytes-minimum");
const issuedAt = 1_800_000_000;

test("dashboard assertions carry bounded, stable identity claims", async () => {
  const assertion = await signDashboardAssertion(
    {
      provider: "github",
      providerAccountId: "github-account-123",
      email: "developer@example.com",
    },
    secret,
    issuedAt,
  );
  const { payload, protectedHeader } = await jwtVerify(assertion, secret, {
    algorithms: ["HS256"],
    issuer: DASHBOARD_ASSERTION_ISSUER,
    audience: DASHBOARD_ASSERTION_AUDIENCE,
    currentDate: new Date((issuedAt + 1) * 1_000),
  });

  assert.equal(protectedHeader.alg, "HS256");
  assert.equal(payload.sub, "github:github-account-123");
  assert.equal(payload.provider, "github");
  assert.equal(payload.provider_account_id, "github-account-123");
  assert.equal(payload.email, "developer@example.com");
  assert.equal(payload.iat, issuedAt);
  assert.equal(payload.exp, issuedAt + DASHBOARD_ASSERTION_TTL_SECONDS);
});

test("dashboard assertions reject the wrong audience", async () => {
  const assertion = await signDashboardAssertion(
    { provider: "google", providerAccountId: "google-account-456" },
    secret,
    issuedAt,
  );

  await assert.rejects(
    jwtVerify(assertion, secret, {
      algorithms: ["HS256"],
      issuer: DASHBOARD_ASSERTION_ISSUER,
      audience: "another-service",
      currentDate: new Date((issuedAt + 1) * 1_000),
    }),
  );
});

test("dashboard assertions reject identities outside the bridge contract", async () => {
  await assert.rejects(
    signDashboardAssertion(
      { provider: "unknown", providerAccountId: "account-123" },
      secret,
      issuedAt,
    ),
  );
  await assert.rejects(
    signDashboardAssertion(
      { provider: "github", providerAccountId: " account-123" },
      secret,
      issuedAt,
    ),
  );
});
