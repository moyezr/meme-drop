import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATIC_LANDING_EXCEPTION = {
  reviewBy: "2026-09-01",
  packageVersions: {
    "@vercel/analytics": "2.0.1",
    next: "16.2.12",
  },
  vulnerabilityNames: new Set(["@vercel/analytics", "next", "postcss", "sharp"]),
  advisoryUrls: new Set([
    "https://github.com/advisories/GHSA-qx2v-qp2m-jg93",
    "https://github.com/advisories/GHSA-6g55-p6wh-862q",
    "https://github.com/advisories/GHSA-r28c-9q8g-f849",
    "https://github.com/advisories/GHSA-fxqj-rqcc-2cmp",
    "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
  ]),
};
const REVIEWED_EXCEPTIONS = [STATIC_LANDING_EXCEPTION];

auditNpmDependencies();
auditPythonDependencies();
console.log("[MemeDrop] security audit passed");

function auditNpmDependencies() {
  const audit = runJson("npm", ["audit", "--json"]);
  const vulnerabilities = audit.vulnerabilities || {};
  const names = Object.keys(vulnerabilities);
  if (names.length === 0) {
    console.log("[MemeDrop] npm dependency audit clean");
    return;
  }

  const unexpectedNames = names.filter(
    (name) => !REVIEWED_EXCEPTIONS.some((exception) => exception.vulnerabilityNames.has(name))
  );
  const advisoryUrls = Object.values(vulnerabilities).flatMap((vulnerability) =>
    (vulnerability.via || [])
      .filter((item) => typeof item === "object" && item !== null)
      .map((item) => item.url)
      .filter(Boolean)
  );
  const unexpectedAdvisories = advisoryUrls.filter(
    (url) => !REVIEWED_EXCEPTIONS.some((exception) => exception.advisoryUrls.has(url))
  );

  if (unexpectedNames.length > 0 || unexpectedAdvisories.length > 0) {
    printVulnerabilities(vulnerabilities);
    fail(
      `npm audit found unreviewed vulnerabilities: packages=${unexpectedNames.join(",") || "none"}`
    );
  }

  verifyReviewedExceptions();
  console.log(
    "[MemeDrop] npm audit passed with the reviewed static-landing exception"
  );
}

function verifyReviewedExceptions() {
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const installed = {
    "@vercel/analytics":
      lock.packages?.["apps/landing/node_modules/@vercel/analytics"]?.version,
    next: lock.packages?.["node_modules/next"]?.version,
  };
  for (const exception of REVIEWED_EXCEPTIONS) {
    if (new Date() > new Date(`${exception.reviewBy}T23:59:59Z`)) {
      fail(`dependency advisory review expired on ${exception.reviewBy}`);
    }
    for (const [name, expected] of Object.entries(exception.packageVersions)) {
      if (installed[name] !== expected) {
        fail(
          `review dependency advisory exceptions after ${name} changes (${installed[name] || "missing"})`
        );
      }
    }
  }
}

function auditPythonDependencies() {
  const exported = run("uv", [
    "export",
    "--project",
    "apps/api",
    "--frozen",
    "--no-dev",
    "--no-emit-project",
    "--no-hashes",
    "--format",
    "requirements-txt",
  ]);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "memedrop-pip-audit-"));
  const requirementsPath = path.join(temporaryDirectory, "requirements.txt");
  try {
    fs.writeFileSync(requirementsPath, exported.stdout);
    const result = spawnSync(
      "uvx",
      [
        "--from",
        "pip-audit",
        "pip-audit",
        "--disable-pip",
        "--no-deps",
        "--progress-spinner",
        "off",
        "-r",
        requirementsPath,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    if (result.status !== 0) {
      process.stderr.write(result.stdout || result.stderr);
      fail("Python dependency audit failed");
    }
    process.stdout.write(result.stdout || "[MemeDrop] Python dependency audit clean\n");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function runJson(command, args) {
  const result = run(command, args, { allowFailure: true });
  try {
    return JSON.parse(result.stdout || result.stderr);
  } catch {
    process.stderr.write(result.stdout || result.stderr);
    fail(`could not parse ${command} audit output`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!options.allowFailure && result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    fail(`${command} ${args[0]} failed`);
  }
  return result;
}

function printVulnerabilities(vulnerabilities) {
  console.error("\nUnreviewed npm vulnerabilities:");
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    console.error(`- ${name} (${vulnerability.severity})`);
  }
}

function fail(message) {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
