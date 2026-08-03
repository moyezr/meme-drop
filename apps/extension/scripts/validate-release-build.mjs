import fs from "node:fs";

const mode = process.argv.includes("--post") ? "post" : "pre";
const apiBaseUrl = process.env.VITE_API_BASE_URL || "";

if (!apiBaseUrl) {
  fail("VITE_API_BASE_URL is required for release builds.");
}

let apiUrl;
try {
  apiUrl = new URL(apiBaseUrl);
} catch {
  fail(`VITE_API_BASE_URL is not a valid URL: ${apiBaseUrl}`);
}

if (apiUrl.protocol !== "https:") {
  fail("VITE_API_BASE_URL must use https:// for release builds.");
}

if (isLocalhost(apiUrl.hostname)) {
  fail("VITE_API_BASE_URL must not point at localhost for release builds.");
}

if (mode === "post") {
  const manifestPath = new URL("../dist/manifest.json", import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const hostPermissions = manifest.host_permissions || [];
  const permissions = manifest.permissions || [];
  const forbidden = hostPermissions.filter((permission) =>
    /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(permission)
  );

  if (forbidden.length > 0) {
    fail(`Release manifest contains local host permissions: ${forbidden.join(", ")}`);
  }

  const expectedApiPermission = `${apiUrl.origin}/*`;
  if (!hostPermissions.includes(expectedApiPermission)) {
    fail(`Release manifest is missing API host permission: ${expectedApiPermission}`);
  }

  if (!permissions.includes("storage")) {
    fail("Release manifest is missing required storage permission.");
  }
}

console.log(`[MemeDrop] release build config validated (${mode})`);

function isLocalhost(hostname) {
  return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
}

function fail(message) {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
