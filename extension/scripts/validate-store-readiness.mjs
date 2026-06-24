import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const strict = Boolean(args.strict);
const rootDir = path.resolve(new URL("../..", import.meta.url).pathname);
const extensionDir = path.join(rootDir, "extension");
const listingPath = path.resolve(
  rootDir,
  String(args.file || "extension/store-listing.json")
);
const manifestPath = path.join(extensionDir, "manifest.json");
const privacyPath = path.join(rootDir, "PRIVACY.md");

const manifest = readJson(manifestPath);
const findings = [];

validateManifest(manifest, findings);
validatePrivacyDraft(findings);
validateListing(findings);

const errors = findings.filter((finding) => finding.severity === "error");
const warnings = findings.filter((finding) => finding.severity === "warn");

for (const finding of findings) {
  console.log(`${finding.severity.toUpperCase()} ${finding.message}`);
}

if (errors.length > 0) {
  console.error(
    `[MemeDrop] store readiness failed: errors=${errors.length} warnings=${warnings.length}`
  );
  process.exit(1);
}

console.log(`[MemeDrop] store readiness validated (errors=0 warnings=${warnings.length})`);

function validateManifest(sourceManifest, output) {
  if (sourceManifest.manifest_version !== 3) {
    output.push({ severity: "error", message: "manifest_version must be 3" });
  }

  if (!sourceManifest.name || sourceManifest.name.length > 45) {
    output.push({ severity: "error", message: "manifest name is required and must be <=45 chars" });
  }

  if (!sourceManifest.description || sourceManifest.description.length > 132) {
    output.push({
      severity: "error",
      message: "manifest description is required and must be <=132 chars",
    });
  }

  const permissions = sourceManifest.permissions || [];
  const hostPermissions = sourceManifest.host_permissions || [];
  const allowedPermissions = new Set(["storage"]);
  const forbiddenPermissions = permissions.filter((permission) => !allowedPermissions.has(permission));
  if (forbiddenPermissions.length > 0) {
    output.push({
      severity: "error",
      message: `unexpected extension permissions: ${forbiddenPermissions.join(", ")}`,
    });
  }

  const requiredHosts = ["https://x.com/*", "https://twitter.com/*"];
  for (const host of requiredHosts) {
    if (!hostPermissions.includes(host)) {
      output.push({ severity: "error", message: `missing host permission: ${host}` });
    }
  }

  const sourceHosts = hostPermissions.filter((host) => !requiredHosts.includes(host));
  if (sourceHosts.length > 0) {
    output.push({
      severity: "error",
      message: `source manifest should not include backend host permissions: ${sourceHosts.join(", ")}`,
    });
  }

  for (const [size, relativePath] of Object.entries(sourceManifest.icons || {})) {
    const iconPath = path.join(extensionDir, relativePath);
    if (!fs.existsSync(iconPath)) {
      output.push({ severity: "error", message: `missing icon ${size}: ${relativePath}` });
      continue;
    }
    const dimensions = readPngDimensions(iconPath);
    if (!dimensions || dimensions.width !== Number(size) || dimensions.height !== Number(size)) {
      output.push({
        severity: "error",
        message: `icon ${relativePath} must be ${size}x${size}`,
      });
    }
  }
}

function validatePrivacyDraft(output) {
  if (!fs.existsSync(privacyPath)) {
    output.push({ severity: "error", message: "PRIVACY.md is required before store submission" });
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
    output.push({
      severity: strict ? "error" : "warn",
      message: `privacy policy still contains launch placeholders: ${placeholders.join(", ")}`,
    });
  }

  validateUsageEventDisclosure(output, privacy, "privacy policy");
}

function validateListing(output) {
  if (!fs.existsSync(listingPath)) {
    output.push({
      severity: strict ? "error" : "warn",
      message: `store listing metadata not found: ${path.relative(rootDir, listingPath)}`,
    });
    return;
  }

  const listing = readJson(listingPath);
  validateTextField(output, listing, "single_purpose", 30, 240);
  validateTextField(output, listing, "short_description", 20, 132);
  validateTextField(output, listing, "detailed_description", 80, 8000);

  if (!isHttpsUrl(listing.privacy_policy_url)) {
    output.push({ severity: "error", message: "privacy_policy_url must be an https URL" });
  }
  if (strict && isPlaceholderUrl(listing.privacy_policy_url)) {
    output.push({ severity: "error", message: "privacy_policy_url must not be an example URL" });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(listing.support_email || ""))) {
    output.push({ severity: "error", message: "support_email must be a valid email address" });
  }
  if (strict && /example\.com$/i.test(String(listing.support_email || ""))) {
    output.push({ severity: "error", message: "support_email must not be an example address" });
  }

  const justifications = listing.permission_justifications || {};
  for (const key of ["storage", "https://x.com/*", "https://twitter.com/*", "api_host"]) {
    if (!justifications[key] || String(justifications[key]).length < 20) {
      output.push({ severity: "error", message: `missing permission justification: ${key}` });
    }
  }

  const disclosures = listing.data_disclosures || {};
  for (const key of [
    "tweet_text_or_compose_context",
    "anonymous_install_id",
    "usage_events",
    "saved_meme_images",
  ]) {
    if (!disclosures[key] || String(disclosures[key]).length < 20) {
      output.push({ severity: "error", message: `missing data disclosure: ${key}` });
    }
  }

  validateUsageEventDisclosure(output, String(disclosures.usage_events || ""), "usage_events disclosure");

  if (!Array.isArray(listing.screenshots) || listing.screenshots.length < 2) {
    output.push({ severity: "error", message: "at least two store screenshots must be listed" });
  } else {
    let checkedScreenshotCount = 0;
    let hasPreferredScreenshot = false;
    for (const screenshot of listing.screenshots) {
      if (!screenshot.path || !screenshot.description) {
        output.push({ severity: "error", message: "each screenshot needs path and description" });
      }
      const screenshotPath = path.join(extensionDir, screenshot.path || "");
      if (strict && !fs.existsSync(screenshotPath)) {
        output.push({
          severity: "error",
          message: `strict store readiness requires screenshot file: ${screenshot.path}`,
        });
        continue;
      }
      if (fs.existsSync(screenshotPath)) {
        const dimensions = validateScreenshotFile(output, screenshotPath, screenshot.path);
        if (dimensions) {
          checkedScreenshotCount += 1;
          if (dimensions.width === 1280 && dimensions.height === 800) {
            hasPreferredScreenshot = true;
          }
        }
      }
    }
    if (checkedScreenshotCount > 0 && !hasPreferredScreenshot) {
      output.push({
        severity: "error",
        message: "store screenshots must include at least one 1280x800 image",
      });
    }
  }
}

function validateScreenshotFile(output, screenshotPath, label) {
  const dimensions = readImageDimensions(screenshotPath);
  if (!dimensions) {
    output.push({
      severity: "error",
      message: `store screenshot must be a PNG or JPEG image: ${label}`,
    });
    return null;
  }

  const accepted =
    (dimensions.width === 1280 && dimensions.height === 800) ||
    (dimensions.width === 640 && dimensions.height === 400);
  if (!accepted) {
    output.push({
      severity: "error",
      message: `store screenshot ${label} must be 1280x800 or 640x400; found ${dimensions.width}x${dimensions.height}`,
    });
  }
  return dimensions;
}

function validateUsageEventDisclosure(output, text, label) {
  const normalized = text.toLowerCase();
  for (const term of ["shown", "clicked", "saved", "dismissed"]) {
    if (!normalized.includes(term)) {
      output.push({
        severity: "error",
        message: `${label} must disclose ${term} meme feedback events`,
      });
    }
  }
  if (!normalized.includes("used") && !normalized.includes("inserted")) {
    output.push({
      severity: "error",
      message: `${label} must disclose inserted or used meme feedback events`,
    });
  }
}

function validateTextField(output, object, field, minLength, maxLength) {
  const value = String(object[field] || "").trim();
  if (value.length < minLength || value.length > maxLength) {
    output.push({
      severity: "error",
      message: `${field} must be between ${minLength} and ${maxLength} chars`,
    });
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readPngDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  const png = readPngDimensionsFromBuffer(buffer);
  if (png) return png;
  return readJpegDimensionsFromBuffer(buffer);
}

function readPngDimensionsFromBuffer(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensionsFromBuffer(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (
      marker >= 0xc0 &&
      marker <= 0xc3
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholderUrl(value) {
  try {
    return new URL(String(value)).hostname === "example.com";
  } catch {
    return true;
  }
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
