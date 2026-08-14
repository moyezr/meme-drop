# MemeDrop roadmap

This roadmap grows the existing extension without assuming agency or agent-platform PMF. The order
prioritizes improvements that make current suggestions more useful and produce evidence for later
surfaces.

## Product constraints

- Suggestion quality and ready-to-attach latency are the primary product metrics.
- Automatic suggestions remain the default; user steering is optional.
- Only human-reviewed templates become eligible for normal suggestions.
- New platforms reuse the existing API and catalog instead of creating separate recommendation
  systems.
- Retrieval changes follow measured benchmark or latency regressions, not anticipated scale.

## 1. Catalog annotation workbench — authoring and visual QA complete

Build the smallest internal tool that removes repeated manual work when reviewing a template.

- Ingest a source URL into the configured development object store, or copy an existing template's
  annotations as the starting point for an improvement.
- Store drafts, structured annotations, workflow state, and optimistic revisions in local
  PostgreSQL, separately from runtime memes.
- Draw, move, resize, and inspect normalized caption regions.
- Edit visual description, use cases, anti-use cases, retrieval hints, caption grammar, examples,
  region roles, alignment, limits, and font treatment with a live preview.
- Use a dedicated React workspace with a searchable queue, tabbed inspector, quality score, dirty
  state, keyboard save, and responsive layout rather than an API-served document editor.
- Render every good example through the extension's shared production renderer, surface font size,
  line count, truncation, and overflow, and invalidate human QA whenever render inputs change.
- Use the same bounded typography contract in the workbench, API, and extension: deterministic
  bundled faces, weight, fill/stroke, line height, padding, text transform, and normalized placement.
- Keep the workbench development-only. A local approval never changes runtime suggestion data.
- Next: export a deterministic, checksummed release bundle and apply that bundle to production
  storage and PostgreSQL through a separately authorized script.
- After the manual workflow is stable, add bounded AI assists for descriptions and retrieval-label
  proposals. AI output always lands as an editable suggestion and never changes review state.

Next checkpoint: repair the current verified-catalog annotation warnings and `needs_work` templates
with these controls, lowering the warning ceiling after each reviewed batch. Then build the
checksummed development-to-production promotion bundle and authorized apply script.

Success means a reviewer can add or improve a template without manually calculating coordinates,
while every change is durable, reviewable, and exportable through the existing mechanical,
rendered-QA, benchmark, and promotion gates.

## 2. Quality-led catalog expansion

- Add small, attributable batches of current and evergreen templates.
- Record visual grammar, use cases, anti-use cases, joke shapes, and realistic contrastive examples.
- Track emerging, established, saturated, and retired status once real freshness decisions repeat.
- Expand the golden benchmark before promoting a new meme family.

Gates: no verified-template audit errors, suggestion benchmark pass, no material p95 regression,
and visual approval for every promoted template.

## 3. LinkedIn extension support

- Reuse the existing explicit-trigger, suggestion, steering, rendering, and feedback flows.
- Keep platform-specific DOM extraction and attachment behind a small adapter boundary.
- Validate with founder-led and B2B marketing posts before adding agency workflows.

Proceed when the X experience has repeat usage and the catalog covers common professional contexts.

## 4. Retrieval validation at real catalog scale

- Measure top-12 recall and p95 latency at 100, 250, 500, and 1,000 verified templates.
- Improve annotations and benchmark coverage before adding infrastructure.
- Add hybrid lexical/embedding retrieval only if measured recall degrades and an offline experiment
  improves it without compromising the deterministic fallback or latency budget.

The model continues to see a bounded shortlist rather than the whole catalog.

## 5. Reddit experiment

- Test opt-in meme replies in a small set of suitable communities.
- Respect subreddit norms and avoid assuming that brand participation is welcome everywhere.
- Treat Reddit as a distribution and learning experiment until willingness to pay is demonstrated.

## 6. GIF and post-copy formats

- Add GIF storage, preview, rendering, file-size, and platform-export constraints.
- Support media with no overlay plus separate post copy.
- Add text-only humorous treatments only after the media-led workflow shows repeat value.

Each format requires its own quality benchmark and must not slow static-image suggestions.

## 7. Agency and agent integrations

- Introduce multi-brand profiles, API authentication, usage limits, and outcome ingestion after
  repeated agency demand appears.
- Keep posting, scheduling, account access, and calendars outside MemeDrop.
- Return publish-ready media, post copy, alt text, and safety metadata through a bounded API.

The extension remains the first-party product and proving ground for the shared humor engine.
