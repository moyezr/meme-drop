import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import extensionPackage from "../package.json" with { type: "json" };

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const zipPath = path.resolve(
  repoRoot,
  String(args.zip || `.memedrop/memedrop-extension-v${extensionPackage.version}.zip`)
);
const apiBaseUrl = process.env.VITE_API_BASE_URL || "";

if (!fs.existsSync(zipPath)) {
  fail(`Release package not found: ${path.relative(repoRoot, zipPath)}`);
}

let apiUrl;
try {
  apiUrl = new URL(apiBaseUrl);
} catch {
  fail("VITE_API_BASE_URL must be set to the production HTTPS API origin when validating release packages.");
}

if (apiUrl.protocol !== "https:") {
  fail("VITE_API_BASE_URL must use https:// when validating release packages.");
}

const entries = unzipList(zipPath);
const entrySet = new Set(entries);

if (!entrySet.has("manifest.json")) {
  fail("Release package must contain manifest.json at the zip root.");
}

const badEntries = entries.filter((entry) => {
  return (
    entry.startsWith("/") ||
    entry.includes("../") ||
    entry.startsWith("__MACOSX/") ||
    entry.endsWith(".DS_Store") ||
    entry.endsWith(".map") ||
    /\.(ts|tsx)$/.test(entry)
  );
});
if (badEntries.length > 0) {
  fail(`Release package contains forbidden entries: ${badEntries.join(", ")}`);
}

const manifest = JSON.parse(unzipRead(zipPath, "manifest.json"));
const hostPermissions = manifest.host_permissions || [];
const permissions = manifest.permissions || [];
const expectedApiPermission = `${apiUrl.origin}/*`;

for (const iconPath of ["icons/icon16.png", "icons/icon48.png", "icons/icon128.png"]) {
  if (!entrySet.has(iconPath)) {
    fail(`Release package is missing required icon: ${iconPath}`);
  }
}

for (const host of [
  "https://x.com/*",
  "https://twitter.com/*",
  "https://www.linkedin.com/*",
  expectedApiPermission,
]) {
  if (!hostPermissions.includes(host)) {
    fail(`Release package manifest is missing host permission: ${host}`);
  }
}

const localHosts = hostPermissions.filter((permission) =>
  /localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?/i.test(permission)
);
if (localHosts.length > 0) {
  fail(`Release package manifest contains local host permissions: ${localHosts.join(", ")}`);
}

const unexpectedPermissions = permissions.filter((permission) => permission !== "storage");
if (unexpectedPermissions.length > 0) {
  fail(`Release package manifest contains unexpected permissions: ${unexpectedPermissions.join(", ")}`);
}

if (!permissions.includes("storage")) {
  fail("Release package manifest is missing storage permission.");
}

if (manifest.version !== extensionPackage.version) {
  fail(
    `Release package manifest version (${manifest.version}) does not match package version (${extensionPackage.version}).`
  );
}

console.log(
  `[MemeDrop] release package validated (${path.relative(repoRoot, zipPath)}, entries=${entries.length})`
);

function unzipList(filePath) {
  const result = spawnSync("unzip", ["-Z1", filePath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`Could not inspect release package: ${result.stderr || result.stdout}`);
  }
  return result.stdout
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function unzipRead(filePath, entry) {
  const result = spawnSync("unzip", ["-p", filePath, entry], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`Could not read ${entry} from release package: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function fail(message) {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
