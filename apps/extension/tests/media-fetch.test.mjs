import assert from "node:assert/strict";
import test from "node:test";

const { createSingleFlight } = await import("../src/shared/single-flight.ts");
const { fetchMediaWithTimeout } = await import("../src/shared/media-fetch.ts");

test("aborts a media fetch that never settles", async () => {
  let aborted = false;
  const neverSettles = (_input, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(init.signal.reason);
      });
    });

  await assert.rejects(
    fetchMediaWithTimeout("https://cdn.example/stalled.webp", 5, neverSettles),
    /Media fetch timed out/
  );
  assert.equal(aborted, true);
});

test("a timed-out media flight clears so an on-demand retry can run", async () => {
  const flight = createSingleFlight();
  let attempts = 0;

  await assert.rejects(
    flight.run("https://cdn.example/stalled.webp", () => {
      attempts += 1;
      return fetchMediaWithTimeout(
        "https://cdn.example/stalled.webp",
        5,
        (_input, init) =>
          new Promise((_, reject) =>
            init.signal.addEventListener("abort", () => reject(init.signal.reason))
          )
      );
    }),
    /Media fetch timed out/
  );

  const response = await flight.run("https://cdn.example/stalled.webp", async () => {
    attempts += 1;
    return new Response("ok");
  });

  assert.equal(await response.text(), "ok");
  assert.equal(attempts, 2);
});
