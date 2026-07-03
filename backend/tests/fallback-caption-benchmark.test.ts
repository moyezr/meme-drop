import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findMemeTemplate } from "@memedrop/shared";
import { heuristicTweetContext } from "../src/services/context-analyzer.js";
import { buildFallbackCaptionSet } from "../src/services/meme-text.js";

interface BenchmarkCase {
  id: string;
  tweet: string;
  expected_memes?: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const benchmark = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "evals", "suggestion-benchmark.json"),
    "utf8"
  )
) as { cases: BenchmarkCase[] };

test("expected benchmark templates receive distinct contextual fallback captions", () => {
  let checked = 0;

  for (const benchmarkCase of benchmark.cases) {
    const context = heuristicTweetContext(benchmarkCase.tweet);

    for (const memeName of benchmarkCase.expected_memes || []) {
      const template = findMemeTemplate(memeName);
      assert.ok(template, `${benchmarkCase.id}: missing template for ${memeName}`);

      const captions = buildFallbackCaptionSet(
        benchmarkCase.tweet,
        context,
        template
      );
      assert.ok(captions, `${benchmarkCase.id}/${memeName}: missing fallback`);

      const values = Object.values(captions).filter(Boolean);
      assert.ok(values.length > 0, `${benchmarkCase.id}/${memeName}: empty fallback`);

      const normalized = values.map((value) =>
        value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
      );
      if (values.length > 1) {
        assert.equal(
          new Set(normalized).size,
          normalized.length,
          `${benchmarkCase.id}/${memeName}: repeated region text`
        );
      }

      for (const value of values) {
        assert.doesNotMatch(
          value,
          /\b(and|but|or|the|a|an|to|of|for|with)$/i,
          `${benchmarkCase.id}/${memeName}: dangling connector`
        );
      }

      checked += 1;
    }
  }

  assert.equal(checked, 72);
});
