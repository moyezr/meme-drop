import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dashboardResponseError,
  mergeDashboardApiKey,
  type DashboardApiKey,
} from "../src/app/dashboard/dashboard-data";

const key: DashboardApiKey = {
  id: "k_23456789ABCD",
  name: "Production",
  created_at: "2026-08-29T12:00:00Z",
  last_used_at: null,
  revoked_at: null,
};

test("dashboard errors remain categorical and user safe", async () => {
  const rateLimited = await dashboardResponseError(
    Response.json({ error: { code: "dashboard_rate_limited" } }, { status: 429 }),
  );
  assert.match(rateLimited.message, /five active API keys/i);

  const unknown = await dashboardResponseError(
    Response.json(
      { error: { code: "unexpected", detail: "sensitive upstream detail" } },
      { status: 502 },
    ),
  );
  assert.equal(unknown.message, "The dashboard request could not be completed.");
  assert.doesNotMatch(unknown.message, /sensitive upstream detail/);
});

test("created and revoked key metadata merge without duplicates", () => {
  const created = mergeDashboardApiKey([], key);
  const revoked = mergeDashboardApiKey(created, {
    ...key,
    revoked_at: "2026-08-29T13:00:00Z",
  });

  assert.equal(created.length, 1);
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0]?.revoked_at, "2026-08-29T13:00:00Z");
});

test("dashboard UI covers loading, errors, empty keys, one-time secrets, and mobile layout", async () => {
  const [page, apiKeysPage, billingPage, billingClient, client, overview, navigation, layout, styles] = await Promise.all([
    readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/api-keys/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/billing/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/billing/billing-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/dashboard-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/dashboard-overview-client.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/dashboard-navigation.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/dashboard/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(page, /Coming next|does not connect/);
  assert.match(page, /DashboardOverviewClient/);
  assert.match(apiKeysPage, /ApiKeysClient/);
  assert.match(billingPage, /BillingClient/);
  assert.match(billingClient, /Self-service packs are not on sale yet/);
  assert.doesNotMatch(billingClient, /pdt_|₹99|checkout\.dodopayments/);
  assert.doesNotMatch(layout, /#api-keys/);
  assert.match(layout, /DashboardNavigation/);
  assert.match(navigation, /usePathname/);
  assert.match(navigation, /href: "\/dashboard\/api-keys"/);
  assert.match(navigation, /href: "\/dashboard\/billing"/);
  assert.match(navigation, /aria-current=\{pathname === link\.href \? "page"/);
  for (const text of [
    "Loading your account",
    "Account data is unavailable",
    "No API keys yet",
    "Copy this credential now",
    "aria-live",
    "role=\"alert\"",
  ]) {
    assert.match(client + overview, new RegExp(text));
  }
  assert.match(client, /pendingIssuance/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /response\.status === 401/);
  assert.match(client, /window\.location\.assign\("\/sign-in"\)/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|console\./);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*\.dashboardSummary/);
  assert.match(styles, /\.dashboardMain button:focus-visible/);
});
