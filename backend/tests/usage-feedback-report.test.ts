import assert from "node:assert/strict";
import test from "node:test";
import type { UsageFeedbackRow } from "../src/services/usage-feedback-report.js";

process.env.DATABASE_URL ||= "postgresql://test";

const { summarizeUsageFeedback } = await import("../src/services/usage-feedback-report.js");

test("usage feedback report classifies promote and review candidates", () => {
  const rows: UsageFeedbackRow[] = [
    { meme_id: "global-1", meme_name: "Strong Template", meme_source: "global", action: "shown", events: 100 },
    { meme_id: "global-1", meme_name: "Strong Template", meme_source: "global", action: "clicked", events: 42 },
    { meme_id: "global-1", meme_name: "Strong Template", meme_source: "global", action: "used", events: 20 },
    { meme_id: "global-2", meme_name: "Weak Template", meme_source: "global", action: "shown", events: 100 },
    { meme_id: "global-2", meme_name: "Weak Template", meme_source: "global", action: "clicked", events: 4 },
    { meme_id: "global-2", meme_name: "Weak Template", meme_source: "global", action: "dismissed", events: 85 },
    { meme_id: "global-3", meme_name: "New Template", meme_source: "global", action: "shown", events: 4 },
    { meme_id: "global-3", meme_name: "New Template", meme_source: "global", action: "saved", events: 2 },
  ];

  const report = summarizeUsageFeedback(rows, {
    lookbackDays: 30,
    minimumShown: 20,
  });

  assert.equal(report.summary.memes, 3);
  assert.equal(report.summary.shown, 204);
  assert.equal(report.summary.clicked, 46);
  assert.equal(report.summary.used, 20);
  assert.equal(report.summary.saved, 2);
  assert.equal(report.summary.dismissed, 85);
  assert.equal(report.summary.promote_candidates, 1);
  assert.equal(report.summary.review_candidates, 1);

  const strong = report.items.find((item) => item.meme_id === "global-1");
  assert.equal(strong?.quality_signal, "promote");
  assert.equal(strong?.click_through_rate, 0.42);
  assert.equal(strong?.use_rate, 0.2);

  const weak = report.items.find((item) => item.meme_id === "global-2");
  assert.equal(weak?.quality_signal, "review");
  assert.equal(weak?.dismissal_rate, 0.85);

  const fresh = report.items.find((item) => item.meme_id === "global-3");
  assert.equal(fresh?.quality_signal, "insufficient_data");
});

test("usage feedback report treats legacy suggested and inserted events as shown and used", () => {
  const report = summarizeUsageFeedback(
    [
      { meme_id: "legacy", meme_name: "Legacy Events", meme_source: "user", action: "suggested", events: 30 },
      { meme_id: "legacy", meme_name: "Legacy Events", meme_source: "user", action: "inserted", events: 6 },
    ],
    { lookbackDays: 30, minimumShown: 20 }
  );

  assert.equal(report.summary.shown, 30);
  assert.equal(report.summary.used, 6);
  assert.equal(report.items[0]?.quality_signal, "promote");
  assert.equal(report.items[0]?.use_rate, 0.2);
});
