# MemeDrop Quality Playbook

This project should optimize for one thing first: a user opens a reply box, sees a meme that feels context-aware and funny, and trusts that clicking it will produce a clean image.

## What Good Looks Like

- The meme family matches the social shape of the post, not just a keyword.
- The caption uses one concrete noun or action from the tweet when it helps the joke.
- Overlay text is short enough to read at thumbnail and full size.
- Text sits in intentional regions and does not cover the face, gesture, or punchline of the source image.
- The result sounds like a human meme reply, not a brand account or explanation.

## Annotation Workflow

Use template annotations as the source of truth for caption quality. For every meme template:

1. Mark only known-good templates as `verified`; keep generated or uncertain templates as `draft`.
2. Define regions over empty visual space or canonical text areas, not over faces or key gestures.
3. Set `max_chars` from visual capacity, not from what would be nice to say.
4. Add good examples that obey the same `max_chars` and region layout constraints users will get at runtime.
5. Add bad examples for generic, wordy, or structurally wrong captions.
6. Run `npm run manifest:audit --workspace=backend` before promoting any draft template.
7. Run `npm run manifest:audit:all --workspace=backend` when working through the full draft/generated backlog.
8. Run `npm run manifest:review-queue --workspace=backend` to prioritize draft templates by benchmark relevance and visual-fit risk.

The verified-template audit must reach zero errors before a template is treated as production-quality. Warnings are review prompts; they are acceptable only when visually checked with the QA contact sheet. The all-template audit is intentionally stricter and may fail while draft templates are still being curated.

The review queue should drive promotion work. Templates with high expected-hit counts affect the benchmark most; templates with visual warnings need region/font/example cleanup before visual QA.

## Evaluation Workflow

Run the benchmark for fast iteration:

```bash
npm run eval:suggestions --workspace=backend -- --mode fast --limit 5
```

Run the quality gate before trusting ranking or caption changes:

```bash
npm run eval:quality --workspace=backend
```

Run the user-facing fast path gate when optimizing interactive latency:

```bash
npm run eval:quality:fast --workspace=backend
```

The quality gate checks:

- `top3`: expected meme family appears near the top.
- `top5`: expected meme family appears somewhere in the strip.
- `caption`: generated captions are specific, short, and non-generic.
- `layout`: generated captions fit their annotated regions.
- `overlay`: suggested memes actually have overlay templates.

Use `--judge` for slower LLM-as-judge checks when comparing larger ranking or captioning changes:

```bash
npm run eval:suggestions --workspace=backend -- --mode smart --limit 5 --judge --min-judge 3.5
```

## Human Data Collection

The best annotation data should be human-curated, not only model-generated.

- Build a golden set of tweets covering common reply intents: dunking, agreement, self-own, disbelief, celebration, suspicion, fake tradeoff, and predictable consequence.
- For each tweet, store 3-5 acceptable meme families and 1-3 rejected families with reasons.
- For each accepted meme, write at least one caption that a human would actually post.
- Review examples against the rendered image, not just JSON.
- Track user actions later: shown, clicked, copied, dismissed, and regenerated. Click-through and repeat use are stronger quality signals than model scores.

## Tech Stack Read

Postgres plus pgvector is the right starting point for this product. The quality problem is not primarily the database.

Keep pgvector while:

- The catalogue is in the hundreds or low thousands.
- You need joins against tags, usage events, and user libraries.
- You want simple local development and one operational database.

Consider a dedicated vector store only if:

- Candidate retrieval becomes a measured bottleneck after indexing and caching.
- The catalogue grows into hundreds of thousands of embeddings.
- You need advanced hybrid retrieval features that are painful in Postgres.

## Speed Priorities

The slow path is LLM work, not vector search.

Recommended order:

1. Use `mode: "fast"` for the interactive extension path; it skips LLM reranking while keeping captions.
2. Cache tweet analysis and embeddings by normalized tweet text.
3. Retrieve more candidates with pgvector, then use cheaper deterministic scoring before optional LLM rerank.
4. Caption only the top few verified templates.
5. Precompute richer meme descriptors, example contexts, and humor tags offline.
6. Stream partial suggestions without captions, then hydrate captioned previews as they finish.
7. Measure stage timings from the existing suggestion pipeline before replacing infrastructure.
