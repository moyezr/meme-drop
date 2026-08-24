import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCT_SECRET_NAMES = [
  "OPENROUTER_API_KEY",
  "TAVILY_API_KEY",
  "GEMINI_API_KEY",
  "DEEPSEEK_API_KEY",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "CRON_SECRET",
  "MEMEDROP_TREND_CRON_SECRET",
];

export function requireLocalServiceUrl(name, value, protocols) {
  if (!value) {
    throw new Error(`${name} is required and must point to a local test service.`);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol) || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`${name} must point to a loopback ${protocols.join(" or ")} service.`);
  }
  return parsed.toString();
}

export function requireDisposableDatabaseUrl(value) {
  const validated = requireLocalServiceUrl(
    "MEMEDROP_TEST_DATABASE_URL",
    value,
    ["postgresql:", "postgres:"]
  );
  const databaseName = decodeURIComponent(new URL(validated).pathname.slice(1)).toLowerCase();
  if (
    !databaseName ||
    !["test", "integration", "readiness"].some((marker) => databaseName.includes(marker))
  ) {
    throw new Error(
      "MEMEDROP_TEST_DATABASE_URL database name must include test, integration, or readiness."
    );
  }
  return validated;
}

export function repositoryOnlyEnvironment(source = process.env) {
  const environment = {
    ...source,
    MEMEDROP_ENV: "development",
    MEMEDROP_STORAGE_BACKEND: "local",
    MEMEDROP_TRENDS_ENABLED: "false",
    REDIS_URL: "",
  };
  for (const name of PRODUCT_SECRET_NAMES) environment[name] = "";
  environment.CRON_SECRET = "repository-only-local-secret";
  environment.MEMEDROP_TREND_CRON_SECRET = "repository-only-local-secret";
  return environment;
}

function run(label, command, environment) {
  console.log(`\n[MemeDrop] ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed.`);
  }
}

function main() {
  const testDatabaseUrl = requireDisposableDatabaseUrl(process.env.MEMEDROP_TEST_DATABASE_URL);
  const testRedisUrl = requireLocalServiceUrl(
    "MEMEDROP_TEST_REDIS_URL",
    process.env.MEMEDROP_TEST_REDIS_URL,
    ["redis:", "rediss:"]
  );
  const baseEnvironment = repositoryOnlyEnvironment();
  const staticEnvironment = {
    ...baseEnvironment,
    DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/test",
    MEMEDROP_TEST_DATABASE_URL: "",
    MEMEDROP_TEST_REDIS_URL: "",
  };
  const integrationEnvironment = {
    ...baseEnvironment,
    DATABASE_URL: testDatabaseUrl,
    MEMEDROP_TEST_DATABASE_URL: testDatabaseUrl,
    MEMEDROP_TEST_REDIS_URL: testRedisUrl,
  };

  console.log("[MemeDrop] repository deployment-readiness gate started");
  run(
    "Static, test, and workspace build gates",
    ["npm", "run", "quality:static"],
    staticEnvironment
  );
  run(
    "Built API process smoke",
    ["npm", "run", "quality:api-process:smoke"],
    staticEnvironment
  );
  run(
    "Deterministic recommendation tuning gates",
    ["npm", "run", "quality:tuning"],
    staticEnvironment
  );
  run(
    "Local PostgreSQL and Redis integration gate",
    ["npm", "run", "quality:api-integration"],
    integrationEnvironment
  );
  run(
    "Backend image build and smoke",
    ["npm", "run", "quality:backend-image"],
    staticEnvironment
  );
  run(
    "Locked dependency security audit",
    ["npm", "run", "quality:security"],
    staticEnvironment
  );
  console.log("\n[MemeDrop] repository deployment-readiness gate passed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`[MemeDrop] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
