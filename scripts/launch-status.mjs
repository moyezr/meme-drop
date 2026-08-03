import fs from "node:fs";
import path from "node:path";
import extensionPackage from "../apps/extension/package.json" with { type: "json" };

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionDir = path.join(repoRoot, "apps/extension");
const apiBaseUrl = String(args["api-base-url"] || process.env.VITE_API_BASE_URL || "");
const listingPath = path.resolve(
  repoRoot,
  String(args.file || "apps/extension/store-listing.json")
);
const zipPath = path.resolve(
  repoRoot,
  String(args.zip || `.memedrop/memedrop-extension-v${extensionPackage.version}.zip`)
);

const blockers = [];
const warnings = [];
const ready = [];

checkApiOrigin();
checkExtensionCorsOrigin();
checkPrivacyPolicy();
checkStoreListing();
checkReleasePackage();
checkDatasetExpansion();
checkIdentityModel();

printSection("Ready", ready);
printSection("Warnings", warnings);
printSection("Blockers", blockers);

if (blockers.length > 0) {
  console.error(`[MemeDrop] launch status: blocked (${blockers.length} blockers, ${warnings.length} warnings)`);
  process.exit(1);
}

console.log(`[MemeDrop] launch status: ready (${warnings.length} warnings)`);

function checkApiOrigin() {
  if (!apiBaseUrl) {
    blockers.push("Set VITE_API_BASE_URL or pass --api-base-url with the real production HTTPS API origin.");
    return;
  }

  let apiUrl;
  try {
    apiUrl = new URL(apiBaseUrl);
  } catch {
    blockers.push(`Production API origin is not a valid URL: ${apiBaseUrl}`);
    return;
  }

  if (apiUrl.protocol !== "https:") {
    blockers.push("Production API origin must use https://.");
  }

  if (isLocalOrPlaceholderHost(apiUrl.hostname)) {
    blockers.push(`Production API origin must not use a local or placeholder host: ${apiUrl.hostname}`);
  }

  if (apiUrl.pathname !== "/" || apiUrl.search || apiUrl.hash) {
    warnings.push("Use only the API origin for VITE_API_BASE_URL, without path, query, or hash.");
  }

  if (!isLocalOrPlaceholderHost(apiUrl.hostname) && apiUrl.protocol === "https:") {
    ready.push(`Production API origin set to ${apiUrl.origin}.`);
  }
}

function checkExtensionCorsOrigin() {
  const rawOrigins = String(process.env.MEMEDROP_CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (rawOrigins.length === 0) {
    blockers.push("Set MEMEDROP_CORS_ORIGINS to the final chrome-extension://<web-store-extension-id> origin before public launch.");
    return;
  }

  const chromeExtensionOrigins = rawOrigins.filter((origin) => origin.startsWith("chrome-extension://"));
  if (chromeExtensionOrigins.length === 0) {
    blockers.push("MEMEDROP_CORS_ORIGINS must include the final chrome-extension://<web-store-extension-id> origin.");
    return;
  }

  for (const origin of chromeExtensionOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      blockers.push(`MEMEDROP_CORS_ORIGINS contains an invalid Chrome extension origin: ${origin}.`);
      continue;
    }

    if (!isChromeExtensionId(parsed.hostname)) {
      blockers.push(`MEMEDROP_CORS_ORIGINS Chrome extension origin must use the final 32-character Web Store extension ID: ${origin}.`);
    }
  }

  if (chromeExtensionOrigins.some((origin) => {
    try {
      return isChromeExtensionId(new URL(origin).hostname);
    } catch {
      return false;
    }
  })) {
    ready.push("Backend CORS includes a final Chrome extension origin.");
  }
}

function checkPrivacyPolicy() {
  const privacyPath = path.join(repoRoot, "PRIVACY.md");
  if (!fs.existsSync(privacyPath)) {
    blockers.push("Create PRIVACY.md or replace it with a hosted lawyer-reviewed privacy policy.");
    return;
  }

  const privacy = fs.readFileSync(privacyPath, "utf8");
  const placeholders = [
    "<privacy-contact@example.com>",
    "Before launch",
    "verify the current",
    "define exact retention",
  ].filter((placeholder) => privacy.includes(placeholder));

  if (placeholders.length > 0) {
    blockers.push(`Privacy policy still has launch placeholders: ${placeholders.join(", ")}.`);
    return;
  }

  ready.push("Privacy policy has no known launch placeholders.");
}

function checkStoreListing() {
  const blockerCountBefore = blockers.length;

  if (!fs.existsSync(listingPath)) {
    blockers.push(
      `Create ${path.relative(repoRoot, listingPath)} from apps/extension/store-listing.example.json with real URL, email, and screenshots.`
    );
    return;
  }

  let listing;
  try {
    listing = JSON.parse(fs.readFileSync(listingPath, "utf8"));
  } catch (error) {
    blockers.push(`Store listing JSON is invalid: ${error.message}`);
    return;
  }

  if (!isHttpsUrl(listing.privacy_policy_url)) {
    blockers.push("Store listing privacy_policy_url must be an HTTPS URL.");
  } else {
    const privacyUrl = new URL(String(listing.privacy_policy_url));
    if (isLocalOrPlaceholderHost(privacyUrl.hostname)) {
      blockers.push(`Store listing privacy_policy_url must not use a placeholder host: ${privacyUrl.hostname}.`);
    }
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(listing.support_email || ""))) {
    blockers.push("Store listing support_email must be a valid email address.");
  } else if (/example\.(com|org|net)$/i.test(String(listing.support_email))) {
    blockers.push("Store listing support_email must not use an example domain.");
  }

  const screenshots = Array.isArray(listing.screenshots) ? listing.screenshots : [];
  if (screenshots.length < 2) {
    blockers.push("Store listing must include at least two screenshots.");
  }

  for (const screenshot of screenshots) {
    const screenshotPath = path.join(extensionDir, String(screenshot.path || ""));
    if (!screenshot.path || !fs.existsSync(screenshotPath)) {
      blockers.push(`Store screenshot file is missing: ${screenshot.path || "(empty path)"}.`);
    }
  }

  if (blockers.length === blockerCountBefore) {
    ready.push(`Store listing metadata found at ${path.relative(repoRoot, listingPath)}.`);
  }
}

function checkReleasePackage() {
  if (!fs.existsSync(zipPath)) {
    warnings.push(`Validated release package not found at ${path.relative(repoRoot, zipPath)}.`);
    return;
  }

  ready.push(`Release package exists at ${path.relative(repoRoot, zipPath)}.`);
}

function checkDatasetExpansion() {
  const planPath = path.join(repoRoot, ".memedrop/template-promotion-plan.json");
  const plan = readOptionalJson(planPath);
  if (plan?.summary) {
    const approvedBlocked = Number(plan.summary.approved_blocked || 0);
    const approvedReady = Number(plan.summary.approved_ready || 0);
    const readyForReview = Number(plan.summary.ready_for_review || 0);
    const selectedForNextBatch = Number(plan.summary.selected_for_next_batch || 0);

    if (approvedBlocked > 0) {
      blockers.push(
        `Dataset promotion plan has ${approvedBlocked} approved templates blocked by missing benchmark coverage or stale QA warnings.`
      );
    }
    if (approvedReady > 0) {
      warnings.push(
        `Dataset promotion plan has ${approvedReady} approved templates ready; selected next batch size is ${selectedForNextBatch}.`
      );
    }
    if (readyForReview > 0) {
      warnings.push(
        `Dataset promotion plan has ${readyForReview} mechanically ready draft templates still awaiting human visual QA.`
      );
    }
  } else {
    warnings.push("Dataset promotion plan is missing; run npm run dataset:promotion-plan before launch review.");
  }

  const promotedPath = path.join(
    repoRoot,
    "packages/shared/src/data/meme-template-manifest.promoted.json"
  );
  if (fs.existsSync(promotedPath)) {
    const promoted = JSON.parse(fs.readFileSync(promotedPath, "utf8"));
    const promotedCount = Array.isArray(promoted.templates) ? promoted.templates.length : 0;
    if (promotedCount > 0) {
      ready.push(`Promoted runtime template manifest contains ${promotedCount} reviewed templates.`);
      return;
    }
  }

  const decisionsPath = path.join(repoRoot, ".memedrop/template-review-decisions.json");
  if (!fs.existsSync(decisionsPath)) {
    warnings.push(
      "No generated draft templates are promoted yet; create .memedrop/template-review-decisions.json after human review, then run npm run dataset:promote-reviewed."
    );
    return;
  }

  warnings.push(
    "Template review decisions exist but promoted runtime manifest is empty; run npm run dataset:promote-reviewed after strict validation."
  );
}

function checkIdentityModel() {
  warnings.push(
    "Anonymous install IDs isolate data but are not strong authentication; use private/unlisted distribution until real account/session identity and abuse controls are in place."
  );
}

function printSection(title, items) {
  if (items.length === 0) return;
  console.log(`\n${title}:`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    blockers.push(`JSON file is invalid: ${path.relative(repoRoot, filePath)} (${error.message}).`);
    return null;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalOrPlaceholderHost(hostname) {
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

function isChromeExtensionId(value) {
  return /^[a-p]{32}$/.test(String(value));
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
