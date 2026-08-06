import assert from "node:assert/strict";
import test from "node:test";

const { getSuggestionMediaUrls } = await import("../src/shared/suggestion-media.ts");

test("uses the original asset as the preview fallback without a duplicate download", () => {
  assert.deepEqual(getSuggestionMediaUrls("https://cdn.example/original.jpg"), {
    previewUrl: "https://cdn.example/original.jpg",
    originalUrl: "https://cdn.example/original.jpg",
    sharesAsset: true,
  });
});

test("keeps preview and attachment assets distinct when a thumbnail is supplied", () => {
  assert.deepEqual(
    getSuggestionMediaUrls("https://cdn.example/original.jpg", "https://cdn.example/preview.webp"),
    {
      previewUrl: "https://cdn.example/preview.webp",
      originalUrl: "https://cdn.example/original.jpg",
      sharesAsset: false,
    }
  );
});
