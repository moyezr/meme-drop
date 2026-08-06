import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const strict = Boolean(args.strict);
const withSuggestionEval = Boolean(args["with-suggestion-eval"]);
const skipProductionEnv = Boolean(args["skip-production-env"]);
const apiBaseUrl = String(
  args["api-base-url"] ||
    process.env.VITE_API_BASE_URL ||
    (strict ? "" : "https://api.memedrop.example")
);
const storeListingFile = String(args["store-listing"] || "apps/extension/store-listing.json");
const env = {
  ...process.env,
  VITE_API_BASE_URL: apiBaseUrl,
};

let failed = false;
let failureStatus = 0;
let failureMessage = "";

console.log(
  `[MemeDrop] release candidate ${strict ? "strict" : "dry-run"} started`
);

try {
  if (!apiBaseUrl) {
    throwFailure("VITE_API_BASE_URL or --api-base-url is required.", 1);
  }

  run("Static promotion gate", ["npm", "run", "quality:promotion"], env);
  run("Security audit", ["npm", "run", "quality:security"], env);

  if (strict) {
    if (!skipProductionEnv) {
      run("Backend production env preflight", ["npm", "run", "quality:production-env"], env);
    }
    run("Strict store readiness", [
      "node",
      "apps/extension/scripts/validate-store-readiness.mjs",
      "--strict",
      "--file",
      storeListingFile,
    ], env);
  }

  if (withSuggestionEval) {
    run("Suggestion quality gate", ["npm", "run", "quality:suggestions"], env);
  }

  run("Package extension release", ["npm", "run", "package:extension:release"], env);

  if (strict) {
    run("Public launch status", ["npm", "run", "launch:status"], env);
  }
} catch (error) {
  if (!failed) {
    failed = true;
    failureStatus = 1;
    failureMessage = error instanceof Error ? error.message : String(error);
  }
} finally {
  const restore = spawnSync("npm", ["run", "build:extension"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (restore.status !== 0) {
    failed = true;
    console.error("[MemeDrop] Failed to restore local extension build.");
  }
}

if (failed) {
  if (failureMessage) {
    console.error(`[MemeDrop] release candidate failed: ${failureMessage}`);
  }
  process.exit(failureStatus || 1);
}

console.log(`[MemeDrop] release candidate ${strict ? "strict" : "dry-run"} passed`);

function run(label, command, commandEnv) {
  console.log(`\n[MemeDrop] ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: commandEnv,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed = true;
    throwFailure(`${label} failed.`, result.status || 1);
  }
}

function throwFailure(message, status) {
  failed = true;
  failureStatus = status;
  failureMessage = message;
  console.error(`[MemeDrop] ${message}`);
  throw new Error(message);
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
