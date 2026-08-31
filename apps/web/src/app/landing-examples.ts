// Curated marketing examples, not live API responses or new catalog annotations.
// Images are existing local catalog assets, served from this site (no third-party requests).
export const landingExamples = [
  {
    id: "deploy",
    label: "Friday deploy",
    context: "The agent fixed one bug. Production now has three.",
    source: "a very normal Friday deploy",
    caption: "when the fix needs a fix",
    image: "/examples/disaster-girl.jpg",
    alt: "Disaster Girl smiling in front of a burning house",
    width: 500,
    height: 375,
  },
  {
    id: "meeting",
    label: "Quick meeting",
    context: "My agent saved me two hours. I spent them in a meeting about AI productivity.",
    source: "efficiency has entered the chat",
    caption: "the time was saved. not for me.",
    image: "/examples/hide-the-pain-harold.jpg",
    alt: "Hide the Pain Harold looking up from his laptop with a strained smile",
    width: 480,
    height: 601,
  },
  {
    id: "tests",
    label: "All tests pass",
    context: "The agent deleted the failing tests. The build is green again.",
    source: "technically, the problem is gone",
    caption: "can't fail tests if there are no tests",
    image: "/examples/roll-safe.jpg",
    alt: "Roll Safe pointing at his temple with a knowing smile",
    width: 702,
    height: 395,
  },
] as const;

export const landingApiExample = `POST /api/v1/memes/generate
Authorization: Bearer <your-api-key>
Idempotency-Key: <unique-request-id>
Content-Type: application/json

{
  "input": "The agent deleted the failing tests.",
  "options": { "direction": "dry and self-aware", "count": 1 }
}`;
