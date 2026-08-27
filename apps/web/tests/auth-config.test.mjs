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
