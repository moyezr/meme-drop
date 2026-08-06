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
      feedback_context: { topic: "deploy" },
    });
  }

  await queue.flush();

  assert.deepEqual(
    batches.map((batch) => batch.length),
    [50, 1]
  );
  assert.equal(batches[0][0].tweet_context.topic, "deploy");
});

test("usage telemetry retries a failed batch once and reports both failures", async () => {
  let attempts = 0;
  const failures = [];
  const queue = new UsageTelemetryQueue({
    flushDelayMs: 60_000,
    sendBatch: async () => {
      attempts += 1;
      throw new Error(`request ${attempts} failed`);
    },
    onError: (error, attempt) => failures.push({ error, attempt }),
  });

  queue.enqueue({ meme_id: "broken-meme", action: "clicked" });
  await queue.flush();

  assert.equal(attempts, 2);
  assert.deepEqual(
    failures.map(({ attempt }) => attempt),
    [1, 2]
  );
  assert.match(failures[1].error.message, /request 2 failed/);
});

test("usage telemetry projects only feedback context into the API context field", () => {
  const projected = projectUsageEvent({
    meme_id: "safe-meme",
    action: "used",
    source: "global",
    feedback_context: {
      topic: "work",
      humor_angle: "deadline pressure",
      core_claim: "do not transmit this either",
    },
    // Runtime messages are untyped; prove an accidental raw field is ignored.
    tweet_context: { raw_post_text: "do not transmit this" },
  });

  assert.deepEqual(projected, {
    meme_id: "safe-meme",
    action: "used",
    source: "global",
    tweet_context: {
      topic: "work",
      humor_angle: "deadline pressure",
    },
  });
  assert.deepEqual(
    projectUsageEvent({ meme_id: "saved-meme", action: "saved", source: "user" }),
    {
      meme_id: "saved-meme",
      action: "saved",
      source: "user",
      tweet_context: {},
    }
  );
});
