import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { landingApiExample, landingExamples } from "../src/app/landing-examples";
import sitemap from "../src/app/sitemap";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("curated examples have local assets, descriptions, and distinct contexts", async () => {
  assert.equal(landingExamples.length, 3);
  assert.equal(new Set(landingExamples.map((example) => example.id)).size, 3);
  for (const example of landingExamples) {
    assert.match(example.image, /^\/examples\/[a-z-]+\.jpg$/);
    assert.ok(example.alt.length > 20);
    assert.ok(example.caption.length > 10);
    assert.ok(example.context.length > 20);
    assert.ok(example.width > 0 && example.height > 0);
    const asset = await stat(new URL(`../public${example.image}`, import.meta.url));
    assert.ok(asset.size > 0 && asset.size < 500_000);
  }
});

test("landing request example preserves authentication and idempotency", () => {
  assert.match(landingApiExample, /^POST \/api\/v1\/memes\/generate/);
  assert.match(landingApiExample, /Authorization: Bearer <your-api-key>/);
  assert.match(landingApiExample, /Idempotency-Key: <unique-request-id>/);
  const payload = JSON.parse(landingApiExample.slice(landingApiExample.indexOf("{")));
  assert.equal(payload.options.count, 1);
  assert.equal(typeof payload.input, "string");
  assert.equal(typeof payload.options.direction, "string");
});

test("landing copy and schema describe the agent API without inventing prices", async () => {
  const [page, layout, agentText] = await Promise.all([
    read("../src/app/page.tsx"), read("../src/app/layout.tsx"), read("../public/llms.txt"),
  ]);
  assert.match(layout, /The humor layer for AI agents/);
  assert.match(page, /DeveloperApplication/);
  assert.doesNotMatch(layout + page, /priceCurrency|price:\s*["']0|BrowserApplication/);
  assert.match(page, /Paid packs aren&apos;t on sale yet/);
  assert.match(page, /Chrome Web Store release is pending/);
  assert.match(page, /\/landing-video\.webm/);
  assert.doesNotMatch(page, /autoPlay|Open to work/);
  assert.match(page, /<main id="main-content">/);
  for (const text of ["POST /api/v1/memes/generate", "30 days", "paid checkout is not open", "Idempotency-Key"]) {
    assert.ok(agentText.includes(text));
  }
});

test("example controls are bounded, accessible, and never call the generation API", async () => {
  const [component, styles] = await Promise.all([read("../src/app/humor-demo.tsx"), read("../src/app/landing.css")]);
  assert.match(component, /aria-pressed/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /Replay the example animation/);
  assert.match(component, /not a live API call/);
  assert.doesNotMatch(component, /fetch\(|setInterval|setTimeout|localStorage|sessionStorage/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.memeResult \{ animation: none; \}/);
  assert.doesNotMatch(styles, /\binfinite\b/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /\.agentSection, \.reactionSection, \.faqSection \{ grid-template-columns: 1fr/);
});

test("public policies and sitemap agree with current payment availability", async () => {
  const [terms, refunds, privacy, footer] = await Promise.all([
    read("../src/app/terms/page.tsx"), read("../src/app/refund-policy/page.tsx"),
    read("../src/app/privacy-policy/page.tsx"), read("../src/app/site-footer.tsx"),
  ]);
  assert.match(terms, /Paid checkout is not open/);
  assert.match(refunds, /not a monetary refund/);
  assert.match(privacy, /Dodo Payments is the planned payment provider/);
  assert.match(privacy, /does not currently send payment information to it/);
  for (const path of ["/terms/", "/refund-policy/", "/privacy-policy/"]) {
    assert.ok(sitemap().some((entry) => entry.url.endsWith(path)));
    assert.ok(footer.includes(`href="${path}"`));
  }
  assert.match(footer, /mailto:moyezrabbani\.work@gmail\.com/);
});
