import assert from "node:assert/strict";
import test from "node:test";
import { filterAnalyticsEvent } from "../src/lib/analytics";

const origin = "https://memedrop.moyezrabbani.dev";

test("public page views strip query parameters, fragments, and URL credentials", () => {
  for (const path of ["/", "/docs/", "/privacy-policy/", "/terms/", "/refund-policy/"]) {
    const event = {
      type: "pageview" as const,
      url: `https://user:password@memedrop.moyezrabbani.dev${path}?input=example&token=secret#caption`,
    };
    assert.deepEqual(filterAnalyticsEvent(event), {
      type: "pageview",
      url: `${origin}${path.replace(/\/$/, "") || "/"}`,
    });
    assert.ok(event.url.includes("?input="), "the original event is not mutated");
  }
});

test("private and unknown routes never produce analytics events", () => {
  for (const path of [
    "/sign-in", "/dashboard", "/dashboard/", "/dashboard/api-keys", "/dashboard/billing",
    "/api/auth/callback/google", "/api/dashboard/overview", "/docs/private-input", "/unknown",
  ]) {
    assert.equal(filterAnalyticsEvent({ type: "pageview", url: `${origin}${path}?token=secret` }), null);
  }
});

test("custom events and invalid URLs are dropped", () => {
  assert.equal(filterAnalyticsEvent({ type: "event", url: origin }), null);
  for (const url of ["invalid", "/docs", "javascript:alert(1)", "file:///docs"]) {
    assert.equal(filterAnalyticsEvent({ type: "pageview", url }), null);
  }
});
