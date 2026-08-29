import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const PRODUCTION_API_ORIGIN = "https://api.memedrop.moyezrabbani.dev";

export function validateProductionConfig(environment) {
  if (environment.VERCEL_ENV !== "production") {
    return [];
  }

  const errors = [];
  validateSecret(environment.AUTH_SECRET, "AUTH_SECRET", errors);
  validateSecret(
    environment.MEMEDROP_DASHBOARD_TOKEN_SECRET,
    "MEMEDROP_DASHBOARD_TOKEN_SECRET",
    errors,
  );

  if (environment.MEMEDROP_API_BASE_URL !== PRODUCTION_API_ORIGIN) {
    errors.push(`MEMEDROP_API_BASE_URL must equal ${PRODUCTION_API_ORIGIN}.`);
  }

  const githubConfigured = validateProviderPair(
    environment.AUTH_GITHUB_ID,
    environment.AUTH_GITHUB_SECRET,
    "GitHub",
    errors,
  );
  const googleConfigured = validateProviderPair(
    environment.AUTH_GOOGLE_ID,
    environment.AUTH_GOOGLE_SECRET,
    "Google",
    errors,
  );
  if (!githubConfigured && !googleConfigured) {
    errors.push("At least one complete GitHub or Google OAuth provider pair is required.");
  }
  return errors;
}

function validateSecret(value, name, errors) {
  const length = typeof value === "string" ? [...value].length : 0;
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    length < 32 ||
    length > 512 ||
    isPlaceholder(value)
  ) {
    errors.push(`${name} must be a trimmed, non-placeholder value of 32–512 characters.`);
  }
}

function validateProviderPair(clientId, clientSecret, provider, errors) {
  const hasId = validProviderValue(clientId);
  const hasSecret = validProviderValue(clientSecret);
  if (hasId !== hasSecret) {
    errors.push(`${provider} OAuth client ID and client secret must be configured together.`);
  }
  return hasId && hasSecret;
}

function validProviderValue(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    !isPlaceholder(value)
  );
}

function isPlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("<") ||
    normalized === "changeme" ||
    normalized === "change-me" ||
    normalized === "placeholder" ||
    normalized === "replace-me" ||
    normalized.startsWith("your-") ||
    normalized.startsWith("your_")
  );
}

function main() {
  const errors = validateProductionConfig(process.env);
  if (errors.length > 0) {
    console.error("Web production configuration is invalid:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }
  if (process.env.VERCEL_ENV === "production") {
    console.log("Web production configuration is valid.");
  } else {
    console.log("Web production configuration check skipped outside Vercel production.");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
