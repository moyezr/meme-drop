import assert from "node:assert/strict";
import test from "node:test";

const { createSingleFlight } = await import("../src/shared/single-flight.ts");

test("single-flight coalesces simultaneous work for the same media URL", async () => {
  const singleFlight = createSingleFlight();
  let calls = 0;
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });

  const first = singleFlight.run("https://cdn.example/original.jpg", async () => {
    calls += 1;
    await pending;
    return "data:image/jpeg;base64,one";
  });
  const second = singleFlight.run("https://cdn.example/original.jpg", async () => {
    calls += 1;
    return "data:image/jpeg;base64,two";
  });

  resolve();
  assert.deepEqual(await Promise.all([first, second]), [
    "data:image/jpeg;base64,one",
    "data:image/jpeg;base64,one",
  ]);
  assert.equal(calls, 1);
});

test("single-flight clears failed work so a later media request can retry", async () => {
  const singleFlight = createSingleFlight();
  await assert.rejects(singleFlight.run("image", async () => Promise.reject(new Error("offline"))));
  assert.equal(await singleFlight.run("image", async () => "retried"), "retried");
});
