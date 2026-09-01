import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Auth.js uses JWT sessions without a database adapter", async () => {
  const source = await read("../src/auth.ts");

  assert.match(source, /session:\s*\{\s*strategy:\s*"jwt"\s*\}/);
  assert.doesNotMatch(source, /\badapter\s*:/i);
  assert.match(source, /AUTH_GITHUB_ID/);
  assert.match(source, /AUTH_GOOGLE_ID/);
  assert.match(source, /token\.authProvider = account\.provider/);
  assert.match(source, /token\.providerAccountId = account\.providerAccountId/);
});

test("development loads the repository OAuth environment with an app-local override", async () => {
  const manifest = JSON.parse(await read("../package.json"));
  const launcher = await read("../scripts/dev.mjs");
  assert.equal(manifest.scripts.dev, "node scripts/dev.mjs");
  assert.match(launcher, /\.env"\), resolve\(appDirectory, "\.env\.local"\)/);
  assert.match(launcher, /Object\.assign\(environment, parseEnv/);
  assert.match(launcher, /env: environment/);
  assert.doesNotMatch(launcher, /console\.(?:log|info).*environment|AUTH_SECRET/);
});

test("the web app is server-renderable and protects dashboard routes", async () => {
  const [nextConfig, dashboardLayout, authRoute] = await Promise.all([
    read("../next.config.ts"),
    read("../src/app/dashboard/layout.tsx"),
    read("../src/app/api/auth/[...nextauth]/route.ts"),
  ]);

  assert.doesNotMatch(nextConfig, /output:\s*["']export["']/);
  assert.match(dashboardLayout, /await auth\(\)/);
  assert.match(dashboardLayout, /redirect\("\/sign-in"\)/);
  assert.match(authRoute, /export const \{ GET, POST \} = handlers/);
});

test("dashboard route handlers use the centralized no-store bridge", async () => {
  const [proxy, proxyCore, overviewRoute, createRoute, revokeRoute] = await Promise.all([
    read("../src/lib/dashboard-proxy.ts"),
    read("../src/lib/dashboard-proxy-core.ts"),
    read("../src/app/api/dashboard/overview/route.ts"),
    read("../src/app/api/dashboard/api-keys/route.ts"),
    read("../src/app/api/dashboard/api-keys/[keyId]/revoke/route.ts"),
  ]);

  assert.match(proxy, /cache: "no-store"/);
  assert.match(proxy, /Authorization: `Bearer \$\{assertion\}`/);
  assert.match(proxy, /"Idempotency-Key": init\.idempotencyKey/);
  assert.match(proxy, /"x-request-id": requestId/);
  assert.match(proxyCore, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(proxy, /if \(!upstream\.ok\)/);
  assert.match(
    proxy,
    /normalizedUpstreamError\(upstream\.status, responseRequestId\)/,
  );
  assert.doesNotMatch(proxy, /console\./);
  assert.match(createRoute, /requireSameOriginMutation\(request\)/);
  assert.match(createRoute, /readIdempotencyKey\(request\)/);
  assert.match(createRoute, /idempotencyKey,/);
  assert.match(revokeRoute, /requireSameOriginMutation\(request\)/);
  assert.match(overviewRoute, /\/api\/v1\/dashboard\/overview/);
  assert.match(createRoute, /\/api\/v1\/dashboard\/api-keys/);
  assert.match(revokeRoute, /\/api\/v1\/dashboard\/api-keys\/\$\{keyId\}\/revoke/);
});
