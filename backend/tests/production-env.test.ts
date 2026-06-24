import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const validEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://memedrop:secret@db.internal:5432/memedrop",
  OPENROUTER_API_KEY: "sk-production-secret-value",
  OPENROUTER_SITE_URL: "https://api.memedrop.com",
  OPENROUTER_APP_NAME: "MemeDrop",
  MEMEDROP_CORS_ORIGINS: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
  MEMEDROP_RATE_LIMIT_STORE: "database",
  MEMEDROP_REQUIRE_INSTALL_ID: "true",
  MEMEDROP_SUGGESTION_LOG_TEXT: "redacted",
  MEMEDROP_USE_DRAFT_TEMPLATES: "false",
  MEMEDROP_RATE_LIMIT_WINDOW_MS: "60000",
  MEMEDROP_RATE_LIMIT_MAX: "600",
  MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS: "60000",
  MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX: "180",
  MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS: "10000",
  MEMEDROP_MAX_IMAGE_BYTES: "8388608",
  MEME_STORAGE_PATH: "/var/lib/memedrop/memes",
};

test("production env validator accepts a hardened production config", () => {
  const result = runValidator(validEnv);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /production env validated/);
});

test("production env validator rejects common launch misconfigurations", () => {
  const result = runValidator({
    ...validEnv,
    NODE_ENV: "development",
    OPENROUTER_SITE_URL: "https://example.com",
    MEMEDROP_CORS_ORIGINS: "http://localhost:5173,*",
    MEMEDROP_RATE_LIMIT_STORE: "memory",
    MEMEDROP_REQUIRE_INSTALL_ID: "false",
    MEMEDROP_SUGGESTION_LOG_TEXT: "full",
    MEMEDROP_USE_DRAFT_TEMPLATES: "true",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /NODE_ENV must be production/);
  assert.match(result.stdout, /MEMEDROP_CORS_ORIGINS must not include \*/);
  assert.match(result.stdout, /MEMEDROP_RATE_LIMIT_STORE must be database/);
  assert.match(result.stdout, /MEMEDROP_REQUIRE_INSTALL_ID must be true/);
  assert.match(result.stdout, /MEMEDROP_SUGGESTION_LOG_TEXT must not be full/);
  assert.match(result.stdout, /MEMEDROP_USE_DRAFT_TEMPLATES must not be true/);
});

test("production env validator rejects placeholder Chrome extension CORS origins", () => {
  const result = runValidator({
    ...validEnv,
    MEMEDROP_CORS_ORIGINS: "chrome-extension://your-published-extension-id",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /final 32-character Web Store extension ID/);
});

test("production env validator requires a Chrome extension CORS origin", () => {
  const result = runValidator({
    ...validEnv,
    MEMEDROP_CORS_ORIGINS: "https://app.memedrop.com",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /must include the final chrome-extension/);
});

function runValidator(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/validate-production-env.ts"], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH || "",
      ...env,
    },
    encoding: "utf8",
  });
}
