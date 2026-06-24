import fs from "node:fs";

const extensionPackage = readJson("../package.json");
const sourceManifest = readJson("../manifest.json");
const distManifestPath = new URL("../dist/manifest.json", import.meta.url);
const hasDistManifest = fs.existsSync(distManifestPath);
const distManifest = hasDistManifest ? readJson("../dist/manifest.json") : null;

if (!isChromeVersion(sourceManifest.version)) {
  fail(`extension/manifest.json version is not a valid Chrome extension version: ${sourceManifest.version}`);
}

if (extensionPackage.version !== sourceManifest.version) {
  fail(
    `extension/package.json version (${extensionPackage.version}) must match extension/manifest.json version (${sourceManifest.version}).`
  );
}

if (distManifest && distManifest.version !== sourceManifest.version) {
  fail(
    `dist/manifest.json version (${distManifest.version}) must match extension/manifest.json version (${sourceManifest.version}).`
  );
}

console.log(
  `[MemeDrop] release metadata validated (version ${sourceManifest.version}${hasDistManifest ? ", dist" : ""})`
);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function isChromeVersion(version) {
  if (typeof version !== "string") return false;
  const parts = version.split(".");
  return (
    parts.length >= 1 &&
    parts.length <= 4 &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 65535)
  );
}

function fail(message) {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
