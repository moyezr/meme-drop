import assert from "node:assert/strict";
import test from "node:test";

const {
  UsageTelemetryQueue,
  projectUsageEvent,
} = await import("../src/background/usage-telemetry.ts");

test("usage telemetry batches events into requests of at most 50", async () => {
  const batches = [];
  const queue = new UsageTelemetryQueue({
    flushDelayMs: 60_000,
    sendBatch: async (events) => batches.push(events),
  });

  for (let index = 0; index < 51; index += 1) {
    queue.enqueue({
      meme_id: `meme-${index}`,
      action: "shown",
      feedback_context: { topic: "tech" },
    });
  }

  await queue.flush();

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [50, 1]
  );
  assert.equal(batches[0][0].tweet_context.topic, "tech");
});

test("usage telemetry retries a failed batch once and reports both failures", async () => {
  let attempts = 0;
  const failures = [];
  const batches = [];
  const queue = new UsageTelemetryQueue({
    flushDelayMs: 60_000,
    sendBatch: async (events) => {
      batches.push(structuredClone(events));
      attempts += 1;
      throw new Error(`request ${attempts} failed`);
    },
    onError: (error, attempt) => failures.push({ error, attempt }),
  });

  queue.enqueue({ meme_id: "broken-meme", action: "clicked" });
  await queue.flush();

  assert.equal(attempts, 2);
  assert.deepEqual(batches[0], batches[1]);
  assert.match(batches[0][0].event_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    failures.map(({ attempt }) => attempt),
    [1, 2]
  );
  assert.match(failures[1].error.message, /request 2 failed/);
});

test("usage telemetry projects only feedback context into the API context field", () => {
  const projected = projectUsageEvent({
    meme_id: "safe-meme",
    action: "inserted",
    source: "global",
    feedback_context: {
      suggestion_mode: "steered",
      topic: "tech",
      humor_angle: "deadline pressure",
      joke_target: "do not transmit source-derived targets",
      keywords: ["do", "not", "transmit"],
      core_claim: "do not transmit this either",
      steering_instruction: "do not transmit raw user guidance",
    },
    // Runtime messages are untyped; prove an accidental raw field is ignored.
    tweet_context: { raw_post_text: "do not transmit this" },
  });

  assert.match(projected.event_id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(projected, {
    event_id: projected.event_id,
    telemetry_version: 2,
    meme_id: "safe-meme",
    action: "inserted",
    source: "global",
    tweet_context: {
      suggestion_mode: "steered",
      topic: "tech",
    },
  });
  const saved = projectUsageEvent({ meme_id: "saved-meme", action: "saved", source: "user" });
  assert.deepEqual(saved, {
    event_id: saved.event_id,
    telemetry_version: 2,
    meme_id: "saved-meme",
    action: "saved",
    source: "user",
    tweet_context: {},
  });
});


test("telemetry drops arbitrary values under recognized categorical keys and invalid metadata", () => {
  const result = projectUsageEvent({
    meme_id: "safe-meme", action: "shown",
    impression_id: "source-derived-id", position: 500,
    feedback_context: {
      toString: "must not be forwarded", topic: "verbatim source text", tone: { raw: "post" }, intensity: Infinity,
      reply_style: "verbatim model output", ideal_meme_vibe: "source", social_dynamic: "source",
    },
  });
  assert.deepEqual(result.tweet_context, {});
  assert.equal(result.impression_id, undefined);
  assert.equal(result.position, undefined);
  const impression_id = crypto.randomUUID();
  const valid = projectUsageEvent({ meme_id: "m", action: "shown", impression_id, position: 5 });
  assert.equal(valid.impression_id, impression_id);
  assert.equal(valid.position, 5);
});
