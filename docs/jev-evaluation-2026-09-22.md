# Jev evaluation — 2026-09-22

This experiment evaluates TypeSafe Jev 1.13.0 as a re-ranker for MemeDrop's existing deterministic
12-template shortlist. It does not change the production suggestion path. Raw posts, generated
captions, and provider responses remain in ignored `.memedrop/` reports.

## Result

Jev improved template selection substantially on the 104-case suggestion benchmark, but the tested
two-provider hot path is not ready to replace MemeDrop's joint selection-and-caption call.

| Metric | Local shortlist order | Jev re-ranked shortlist |
| --- | ---: | ---: |
| Acceptable family at top 1 | 74.0% | 92.3% |
| Acceptable family in top 3 | 90.4% | 98.1% |
| Acceptable family in top 5 | 99.0% | 98.1% |
| Rejected family in top 5 | 9.6% | 2.9% |
| Ranking p50 | 0.57 ms | 408 ms |
| Ranking p95 | 0.84 ms | 1,243 ms |

The full run used 618,907 Jev input tokens and cost an estimated $0.026 at the published
$0.042/million-token price. Against the local order, Jev improved the first acceptable-family rank
in 25 cases, worsened it in 6, and left it unchanged in 73. It removed 8 existing top-five rejected
families and introduced 1.

A second complete run produced identical aggregate quality. The top-ranked template matched in 103
of 104 cases; the complete 12-item order matched in 23 cases. This supports stable primary choices,
but downstream code should not assume the full probability order is deterministic.

For the fixed 12-case caption sample, Jev selected five templates and the existing caption model
generated their text. The sequential path measured 3,658 ms p50 and 5,873 ms p95; 2 of 12 cases
exceeded the current 4.5-second provider deadline. Only 44 of 60 generated captions passed the
strict region contract (73.3%). Manual inspection found the leading template choices consistently
reasonable, while some captions changed a positive post into an unsupported cynical joke. This was
an engineering review, not a blind human taste study.

The existing joint-model comparison could not be freshly captured: OpenRouter returned HTTP 400
because Gemini 3.7 Flash now requires reasoning for that endpoint while MemeDrop explicitly sends
`reasoning: none`. This is a pre-existing provider compatibility issue and should be repaired and
re-baselined independently.

## Recommendation

Keep Jev out of the user-visible production path for now. Its selection quality is strong enough to
justify retaining the evaluator and considering it for offline catalog review, benchmark triage, or
a future re-ranker trial. A production trial needs a caption architecture that stays within the
latency budget, restores strict caption validity, preserves deterministic fallback, and is compared
against a working joint-model baseline.

Run the selection experiment with:

```sh
npm run eval:jev -- --out .memedrop/jev-evaluation.json
```

Add `--with-captions` only when both provider credentials are loaded. Pin `jev-1.13.0` while
comparing runs so a moving alias cannot silently change the evaluated model.
