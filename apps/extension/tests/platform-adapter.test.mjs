import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  getPlatformAdapter,
  isInlineComposeSessionActive,
  linkedinPostIdFromHref,
  selectLinkedInPostText,
} from "../src/content/platform-adapter.ts";

test("resolves X and LinkedIn hosts without accepting lookalike domains", () => {
  assert.equal(getPlatformAdapter("x.com")?.id, "x");
  assert.equal(getPlatformAdapter("mobile.twitter.com")?.id, "x");
  assert.equal(getPlatformAdapter("www.linkedin.com")?.id, "linkedin");
  assert.equal(getPlatformAdapter("linkedin.com.attacker.example"), null);
  assert.equal(getPlatformAdapter("example.com"), null);
});

test("selects substantial LinkedIn post copy and normalizes whitespace", () => {
  assert.equal(
    selectLinkedInPostText([
      "Founder at Example",
      "  A useful post\nabout launching products with customers. … more  ",
      "2h",
    ]),
    "A useful post about launching products with customers."
  );
  assert.equal(selectLinkedInPostText(["", "   "]), null);
});

test("extracts stable LinkedIn activity IDs when a canonical post link exists", () => {
  assert.equal(
    linkedinPostIdFromHref(
      "https://www.linkedin.com/feed/update/urn:li:ugcPost:7491205106810400768/"
    ),
    "7491205106810400768"
  );
  assert.equal(
    linkedinPostIdFromHref(
      "https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A1234567890/"
    ),
    "1234567890"
  );
  assert.equal(linkedinPostIdFromHref("https://www.linkedin.com/feed/"), null);
});

test("keeps an explicit LinkedIn reply alive while the editor mounts", () => {
  assert.equal(
    isInlineComposeSessionActive({
      hasSource: true,
      elapsedMs: 200,
      composerPresent: false,
    }),
    true
  );
  assert.equal(
    isInlineComposeSessionActive({
      hasSource: true,
      elapsedMs: 4_000,
      composerPresent: true,
    }),
    true
  );
  assert.equal(
    isInlineComposeSessionActive({
      hasSource: true,
      elapsedMs: 4_000,
      composerPresent: false,
    }),
    false
  );
  assert.equal(
    isInlineComposeSessionActive({
      hasSource: false,
      elapsedMs: 0,
      composerPresent: true,
    }),
    false
  );
});

test("extension manifest runs the shared content workflow on LinkedIn", async () => {
  const manifest = JSON.parse(
    await fs.readFile(new URL("../manifest.json", import.meta.url), "utf8")
  );
  assert.ok(manifest.host_permissions.includes("https://www.linkedin.com/*"));
  assert.ok(
    manifest.content_scripts.some((script) =>
      script.matches.includes("https://www.linkedin.com/*")
    )
  );
});
