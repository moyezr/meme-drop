import { readFileSync } from "node:fs";

const read = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
const docs = read("../src/app/docs/page.tsx");
const privacy = read("../src/app/privacy-policy/page.tsx");
const route = read("../../api/src/memedrop_api/api/agent_memes.py");
const models = read("../../api/src/memedrop_api/agent_meme_models.py");
const credits = read("../../api/src/memedrop_api/agent_generation_credits.py");

function requireText(source, text, label) {
  if (!source.includes(text)) {
    throw new Error(`${label} is missing required contract text: ${text}`);
  }
}

function rejectText(source, text, label) {
  if (source.includes(text)) {
    throw new Error(`${label} contains stale contract text: ${text}`);
  }
}

for (const text of [
  "https://api.memedrop.moyezrabbani.dev",
  "Authorization",
  "Bearer",
  "Idempotency-Key",
  "a_23456789ABCD",
  "followed by 12 Base58 characters",
  "image_url",
  "expires_at",
  "no_fit",
  "30 days",
  "one credit",
  "per durable returned meme",
  "full reservation is refunded",
]) {
  requireText(docs, text, "agent docs");
}

for (const text of ["one-charge idempotency", "The credit is released"]) {
  rejectText(docs, text, "agent docs");
}

const stableErrorCodes = [
  "invalid_input",
  "authentication_failed",
  "install_auth_not_supported",
  "insufficient_credits",
  "idempotency_conflict",
  "idempotency_in_progress",
  "rate_limited",
  "render_failure",
  "storage_failure",
  "asset_persistence_failure",
  "internal_failure",
  "provider_timeout",
  "asset_not_found",
  "asset_expired",
];
for (const code of stableErrorCodes) {
  requireText(route, `"${code}"`, "agent API route");
  requireText(docs, code, "agent docs");
}

for (const field of ["id", "image_url", "expires_at"]) {
  requireText(models, field, "agent response model");
}
requireText(credits, "timedelta(days=30)", "generated-asset retention");

for (const text of [
  "does not require an API key",
  "currently relative",
  "still being implemented",
  "not been implemented yet",
]) {
  rejectText(docs, text, "agent docs");
  rejectText(privacy, text, "privacy policy");
}

for (const text of [
  "one-way SHA-256 hashes",
  "expires 30 days",
  "protected daily cleanup job",
  "implementation excludes raw submitted text",
  "provider-side input retention",
  "Payments, recharging, and self-service billing are not implemented",
]) {
  requireText(privacy, text, "privacy policy");
}

console.log("Web agent contract assertions passed.");
