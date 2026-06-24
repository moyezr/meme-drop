import { spawnSync } from "node:child_process";

const allowedDevToolAdvisories = new Set([
  "@esbuild-kit/core-utils",
  "@esbuild-kit/esm-loader",
  "drizzle-kit",
  "esbuild",
  "vite",
]);

const allowedRationale =
  "allowed only in the development install; production deploys must use npm ci --omit=dev after build/migration steps";

const prodAudit = runAudit(["audit", "--omit=dev", "--json"]);
const fullAudit = runAudit(["audit", "--json"]);
const prodVulnerabilities = Object.keys(prodAudit.vulnerabilities || {});
const fullVulnerabilities = Object.keys(fullAudit.vulnerabilities || {});
const unexpectedDevVulnerabilities = fullVulnerabilities.filter(
  (name) => !allowedDevToolAdvisories.has(name)
);

if (prodVulnerabilities.length > 0) {
  printVulnerabilities("Production dependency vulnerabilities", prodAudit);
  console.error(
    `[MemeDrop] security audit failed: ${prodVulnerabilities.length} production vulnerabilities`
  );
  process.exit(1);
}

if (unexpectedDevVulnerabilities.length > 0) {
  printVulnerabilities("Unexpected development dependency vulnerabilities", {
    vulnerabilities: Object.fromEntries(
      unexpectedDevVulnerabilities.map((name) => [
        name,
        fullAudit.vulnerabilities[name],
      ])
    ),
  });
  console.error(
    `[MemeDrop] security audit failed: ${unexpectedDevVulnerabilities.length} unapproved development vulnerabilities`
  );
  process.exit(1);
}

console.log("[MemeDrop] production dependency audit clean");

if (fullVulnerabilities.length > 0) {
  console.log("[MemeDrop] development install advisories allowed with rationale:");
  for (const name of fullVulnerabilities.sort()) {
    const vulnerability = fullAudit.vulnerabilities[name];
    console.log(`- ${name} (${vulnerability.severity}): ${allowedRationale}`);
  }
}

console.log("[MemeDrop] security audit passed");

function runAudit(args) {
  const result = spawnSync("npm", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const output = result.stdout || result.stderr;
  try {
    return JSON.parse(output);
  } catch {
    console.error(output);
    console.error("[MemeDrop] Could not parse npm audit output.");
    process.exit(1);
  }
}

function printVulnerabilities(title, audit) {
  console.error(`\n${title}:`);
  for (const [name, vulnerability] of Object.entries(audit.vulnerabilities || {})) {
    console.error(`- ${name} (${vulnerability.severity})`);
  }
}
