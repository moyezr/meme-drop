import "dotenv/config";

interface Finding {
  severity: "error" | "warn";
  message: string;
}

const findings: Finding[] = [];

requireExact("NODE_ENV", "production");
requireUrl("DATABASE_URL", ["postgres:", "postgresql:"], { allowPlaceholder: false });
requireSecret("OPENROUTER_API_KEY");
requireUrl("OPENROUTER_SITE_URL", ["https:"], { allowPlaceholder: false });
requirePresent("OPENROUTER_APP_NAME");
requireCorsOrigins();
requireExact("MEMEDROP_RATE_LIMIT_STORE", "database");
requireBoolean("MEMEDROP_REQUIRE_INSTALL_ID", true);
requireNotValue("MEMEDROP_SUGGESTION_LOG_TEXT", "full");
requireNotValue("MEMEDROP_USE_DRAFT_TEMPLATES", "true");
requirePositiveInt("MEMEDROP_RATE_LIMIT_WINDOW_MS");
requirePositiveInt("MEMEDROP_RATE_LIMIT_MAX");
requirePositiveInt("MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS");
requirePositiveInt("MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX");
requirePositiveInt("MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS");
requirePositiveInt("MEMEDROP_MAX_IMAGE_BYTES");
requireAbsolutePath("MEME_STORAGE_PATH");

const errors = findings.filter((finding) => finding.severity === "error");
const warnings = findings.filter((finding) => finding.severity === "warn");

for (const finding of findings) {
  console.log(`${finding.severity.toUpperCase()} ${finding.message}`);
}

if (errors.length > 0) {
  console.error(
    `[MemeDrop] production env validation failed: errors=${errors.length} warnings=${warnings.length}`
  );
  process.exit(1);
}

console.log(`[MemeDrop] production env validated (warnings=${warnings.length})`);

function requirePresent(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    findings.push({ severity: "error", message: `${name} is required.` });
    return "";
  }
  return value;
}

function requireExact(name: string, expected: string) {
  const value = requirePresent(name);
  if (value && value !== expected) {
    findings.push({ severity: "error", message: `${name} must be ${expected}.` });
  }
}

function requireSecret(name: string) {
  const value = requirePresent(name);
  if (!value) return;
  if (/example|placeholder|change-me|dummy|test-key/i.test(value)) {
    findings.push({ severity: "error", message: `${name} must not use a placeholder value.` });
  }
  if (value.length < 16) {
    findings.push({ severity: "warn", message: `${name} looks unusually short.` });
  }
}

function requireUrl(
  name: string,
  protocols: string[],
  options: { allowPlaceholder: boolean }
) {
  const value = requirePresent(name);
  if (!value) return;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    findings.push({ severity: "error", message: `${name} must be a valid URL.` });
    return;
  }

  if (!protocols.includes(url.protocol)) {
    findings.push({
      severity: "error",
      message: `${name} must use one of these protocols: ${protocols.join(", ")}.`,
    });
  }

  if (!options.allowPlaceholder && isLocalOrPlaceholderHost(url.hostname)) {
    findings.push({
      severity: "error",
      message: `${name} must not use a local or placeholder host: ${url.hostname}.`,
    });
  }
}

function requireCorsOrigins() {
  const value = requirePresent("MEMEDROP_CORS_ORIGINS");
  if (!value) return;

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    findings.push({ severity: "error", message: "MEMEDROP_CORS_ORIGINS must include at least one origin." });
  }

  let hasChromeExtensionOrigin = false;

  for (const origin of origins) {
    if (origin === "*") {
      findings.push({ severity: "error", message: "MEMEDROP_CORS_ORIGINS must not include *." });
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      findings.push({ severity: "error", message: `MEMEDROP_CORS_ORIGINS has an invalid origin: ${origin}.` });
      continue;
    }

    if (!["chrome-extension:", "https:"].includes(parsed.protocol)) {
      findings.push({
        severity: "error",
        message: `MEMEDROP_CORS_ORIGINS must only include chrome-extension:// or https:// origins: ${origin}.`,
      });
    }

    if (isLocalOrPlaceholderHost(parsed.hostname)) {
      findings.push({
        severity: "error",
        message: `MEMEDROP_CORS_ORIGINS must not include local or placeholder origins: ${origin}.`,
      });
    }

    if (parsed.protocol === "chrome-extension:") {
      hasChromeExtensionOrigin = true;
      if (!isChromeExtensionId(parsed.hostname)) {
        findings.push({
          severity: "error",
          message: `MEMEDROP_CORS_ORIGINS chrome-extension origin must use the final 32-character Web Store extension ID: ${origin}.`,
        });
      }
    }
  }

  if (!hasChromeExtensionOrigin) {
    findings.push({
      severity: "error",
      message: "MEMEDROP_CORS_ORIGINS must include the final chrome-extension://<web-store-extension-id> origin.",
    });
  }
}

function requireBoolean(name: string, expected: boolean) {
  const value = requirePresent(name);
  if (!value) return;
  const normalized = value.toLowerCase();
  const parsed =
    ["1", "true", "yes", "on"].includes(normalized)
      ? true
      : ["0", "false", "no", "off"].includes(normalized)
        ? false
        : null;

  if (parsed === null) {
    findings.push({ severity: "error", message: `${name} must be a boolean.` });
    return;
  }

  if (parsed !== expected) {
    findings.push({ severity: "error", message: `${name} must be ${String(expected)}.` });
  }
}

function requireNotValue(name: string, forbidden: string) {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === forbidden.toLowerCase()) {
    findings.push({ severity: "error", message: `${name} must not be ${forbidden} in production.` });
  }
}

function requirePositiveInt(name: string) {
  const value = requirePresent(name);
  if (!value) return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    findings.push({ severity: "error", message: `${name} must be a positive integer.` });
  }
}

function requireAbsolutePath(name: string) {
  const value = requirePresent(name);
  if (!value) return;
  if (!value.startsWith("/")) {
    findings.push({ severity: "error", message: `${name} must be an absolute path.` });
  }
}

function isLocalOrPlaceholderHost(hostname: string) {
  return [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "example.com",
    "memedrop.example",
    "api.memedrop.example",
  ].includes(hostname.toLowerCase());
}

function isChromeExtensionId(value: string) {
  return /^[a-p]{32}$/.test(value);
}
