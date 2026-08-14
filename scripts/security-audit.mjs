import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

  printVulnerabilities(vulnerabilities);
  fail(`npm audit found vulnerabilities: packages=${names.join(",")}`);
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
