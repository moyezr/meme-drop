import assert from "node:assert/strict";
import test from "node:test";

const { SuggestionRequestObservers } = await import("../src/shared/suggestion-observers.ts");

test("fans progressive suggestion media updates out to every subscriber", () => {
  const observers = new SuggestionRequestObservers();
  const first = [];
  const second = [];
  observers.subscribe({
    onApiResponse: (duration) => first.push(`api:${duration}`),
    onInitial: (items) => first.push(`initial:${items.length}`),
    onPreview: (item) => first.push(`preview:${item.id}`),
    onOriginal: (item) => first.push(`original:${item.id}`),
  });

  observers.notifyApiResponse(22, "model;dur=12");
  observers.notifyInitial([{ id: "one" }, { id: "two" }], false);
  observers.notifyPreview({ id: "one" });
  observers.subscribe({
    onApiResponse: (duration) => second.push(`api:${duration}`),
    onInitial: (items) => second.push(`initial:${items.length}`),
    onPreview: (item) => second.push(`preview:${item.id}`),
    onOriginal: (item) => second.push(`original:${item.id}`),
  });
  observers.notifyOriginal({ id: "one" });
  observers.notifyPreview({ id: "two" });

  assert.deepEqual(first, ["api:22", "initial:2", "preview:one", "original:one", "preview:two"]);
  assert.deepEqual(second, ["api:22", "initial:2", "preview:one", "original:one", "preview:two"]);
});
