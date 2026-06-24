import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(new URL("../..", import.meta.url).pathname);
const extensionDir = path.join(rootDir, "extension");
const templatePath = path.join(extensionDir, "store-listing.example.json");
const outPath = path.resolve(
  rootDir,
  String(args.out || "extension/store-listing.json")
);
const allowPlaceholders = Boolean(args["allow-placeholders"]);

if (fs.existsSync(outPath) && !args.force) {
  fail(`${path.relative(rootDir, outPath)} already exists; pass --force to overwrite.`);
}

const listing = readJson(templatePath);
const privacyPolicyUrl = String(args["privacy-policy-url"] || "").trim();
const supportEmail = String(args["support-email"] || "").trim();

if (privacyPolicyUrl) {
  validatePrivacyPolicyUrl(privacyPolicyUrl);
  listing.privacy_policy_url = privacyPolicyUrl;
} else if (!allowPlaceholders) {
  fail("--privacy-policy-url is required unless --allow-placeholders is passed.");
}

if (supportEmail) {
  validateSupportEmail(supportEmail);
  listing.support_email = supportEmail;
} else if (!allowPlaceholders) {
  fail("--support-email is required unless --allow-placeholders is passed.");
}

if (!allowPlaceholders) {
  validatePrivacyPolicyUrl(listing.privacy_policy_url);
  validateSupportEmail(listing.support_email);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(listing, null, 2)}\n`);
fs.mkdirSync(path.join(extensionDir, "store-assets"), { recursive: true });

console.log(`[MemeDrop] wrote ${path.relative(rootDir, outPath)}`);
console.log("[MemeDrop] capture store screenshots into extension/store-assets/ using the listed paths.");

function validatePrivacyPolicyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("privacy policy URL must be a valid URL.");
  }

  if (url.protocol !== "https:") {
    fail("privacy policy URL must use https://.");
  }
  if (isPlaceholderHost(url.hostname)) {
    fail(`privacy policy URL must not use a placeholder or local host: ${url.hostname}.`);
  }
}

function validateSupportEmail(value) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    fail("support email must be a valid email address.");
  }
  const domain = value.split("@").pop() || "";
  if (/^(example|test)\.(com|org|net)$/i.test(domain)) {
    fail("support email must not use an example domain.");
  }
}

function isPlaceholderHost(hostname) {
  return [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "example.com",
    "memedrop.example",
    "api.memedrop.example",
  ].includes(String(hostname).toLowerCase());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function fail(message) {
  console.error(`[MemeDrop] ${message}`);
  process.exit(1);
}
