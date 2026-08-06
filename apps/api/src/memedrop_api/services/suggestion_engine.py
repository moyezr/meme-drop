from __future__ import annotations

import asyncio
import hashlib
import heapq
import logging
import math
import re
import time
from collections import Counter, OrderedDict, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, replace
from typing import Any
from uuid import UUID

from memedrop_api.config import Settings
from memedrop_api.repositories import BackendStore
from memedrop_api.schemas import TweetContext
from memedrop_api.services.catalog import MemeCatalog, MemeTemplate
from memedrop_api.services.context_analyzer import heuristic_tweet_context
from memedrop_api.services.meme_text import (
    build_fallback_caption_set,
    build_overlay,
    clean_generated_regions,
)
from memedrop_api.services.openrouter import SuggestionModelGateway, TemplateSelection

LOGGER = logging.getLogger("memedrop.suggestions")
SUGGESTION_CACHE_TTL_SECONDS = 5 * 60
SUGGESTION_CACHE_MAX = 200

USAGE_FEEDBACK_CONTEXT_FIELDS = (
    "sentiment",
    "tone",
    "topic",
    "intent",
    "intensity",
    "reply_style",
    "ideal_meme_vibe",
    "joke_target",
    "social_dynamic",
    "humor_angle",
    "keywords",
)


@dataclass(frozen=True)
class Candidate:
    meme_id: str
    name: str
    image_url: str
    system_tags: dict[str, Any]
    is_evergreen: bool
    template: MemeTemplate
    feedback_boost: float = 0.0


@dataclass(frozen=True)
class LexicalCandidateIndex:
    """An immutable BM25 index over the catalog's caption and tagging metadata.

    It is intentionally local: the model is still responsible for the final joint
    selection and captioning.  This gives the deterministic fallback a retrieval
    signal that does not depend on the arbitrary order in which templates entered
    the catalog, and lets the service build the catalog index once per release.
    """

    document_lengths: dict[str, int]
    postings: dict[str, tuple[tuple[str, int], ...]]
    inverse_document_frequency: dict[str, float]
    average_document_length: float

    @classmethod
    def build(cls, candidates: Iterable[Candidate]) -> LexicalCandidateIndex:
        documents: dict[str, Counter[str]] = {}
        for candidate in candidates:
            template_id = candidate.template.template_id
            # A duplicate template is never a useful distinct retrieval result.
            documents.setdefault(template_id, Counter(candidate_search_terms(candidate)))

        document_count = len(documents)
        if not document_count:
            return cls({}, {}, {}, 0.0)
        raw_postings: dict[str, list[tuple[str, int]]] = defaultdict(list)
        for template_id, terms in documents.items():
            for term, frequency in terms.items():
                raw_postings[term].append((template_id, frequency))
        postings = {term: tuple(entries) for term, entries in raw_postings.items()}
        idf = {
            term: math.log(1 + (document_count - len(entries) + 0.5) / (len(entries) + 0.5))
            for term, entries in postings.items()
        }
        lengths = {template_id: sum(terms.values()) for template_id, terms in documents.items()}
        return cls(lengths, postings, idf, sum(lengths.values()) / document_count)

    def score(self, query: str) -> dict[str, float]:
        """Return BM25 scores only for templates sharing a meaningful query term."""
        query_terms = Counter(tokenize_sequence(query))
        if not query_terms or not self.average_document_length:
            return {}
        scores: dict[str, float] = defaultdict(float)
        # Standard BM25 constants. Keeping this intentionally boring makes tuning
        # reproducible as the catalog moves from dozens to thousands of templates.
        k1 = 1.2
        b = 0.75
        for term, query_frequency in query_terms.items():
            for template_id, term_frequency in self.postings.get(term, ()):
                document_length = self.document_lengths[template_id]
                denominator = term_frequency + k1 * (
                    1 - b + b * document_length / self.average_document_length
                )
                scores[template_id] += (
                    self.inverse_document_frequency[term]
                    * (term_frequency * (k1 + 1) / denominator)
                    * min(query_frequency, 2)
                )
        return dict(scores)


def usage_feedback_context(context: TweetContext) -> dict[str, Any]:
    """Project analysis onto the strictly structured, non-text feedback schema."""
    values = context.model_dump()
    return {field: values[field] for field in USAGE_FEEDBACK_CONTEXT_FIELDS}


class SuggestionService:
    def __init__(
        self,
        store: BackendStore,
        catalog: MemeCatalog,
        gateway: SuggestionModelGateway,
        settings: Settings,
    ) -> None:
        self.store = store
        self.catalog = catalog
        self.gateway = gateway
        self.settings = settings
        self.cache: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()
        # A request can arrive from both the content script and a retry before the first
        # response has populated ``cache``. Keep just one computation in flight per
        # user/request shape so those callers do not duplicate the model request.
        self._inflight_suggestions: dict[str, asyncio.Task[list[dict[str, Any]]]] = {}
        # Global templates change only through a controlled release. Cache the immutable base
        # candidates for this process, then apply each user's feedback on a fresh copy.
        self._global_candidates: tuple[Candidate, ...] | None = None
        self._global_lexical_index: LexicalCandidateIndex | None = None
        self._global_candidates_lock = asyncio.Lock()

    async def get_suggestions(
        self,
        tweet_text: str,
        *,
        user_id: UUID,
        limit: int | None = None,
        refresh: bool = False,
        cache_key: str | None = None,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(5, int(limit or 5)))
        key = suggestion_request_key(
            tweet_text,
            user_id=user_id,
            limit=normalized_limit,
            cache_key=cache_key,
        )
        if not refresh and (cached := self._read_cache(key)) is not None:
            return cached
        # A refresh must never read a completed cache entry. It may, however, share a
        # still-running refresh with an identical request. Keep refresh work separate
        # from ordinary cache-miss work so a refresh always triggers fresh inference.
        flight_key = f"{key}|refresh:{int(refresh)}"
        task = self._inflight_suggestions.get(flight_key)
        if task is None:
            task = asyncio.create_task(
                self._generate_suggestions(
                    tweet_text,
                    user_id=user_id,
                    limit=normalized_limit,
                    key=key,
                )
            )
            self._inflight_suggestions[flight_key] = task
            task.add_done_callback(
                lambda completed: self._clear_inflight_suggestion(flight_key, completed)
            )
        # Shielding lets a cancelled HTTP request stop waiting without cancelling the
        # shared computation that other callers are relying on.
        return await asyncio.shield(task)

    def _clear_inflight_suggestion(
        self, key: str, completed: asyncio.Task[list[dict[str, Any]]]
    ) -> None:
        if self._inflight_suggestions.get(key) is completed:
            self._inflight_suggestions.pop(key, None)

    async def _generate_suggestions(
        self,
        tweet_text: str,
        *,
        user_id: UUID,
        limit: int,
        key: str,
    ) -> list[dict[str, Any]]:
        started = time.perf_counter()
        context = heuristic_tweet_context(tweet_text)
        candidates = await self._load_candidates(user_id)
        if not candidates:
            return []
        # Rank every candidate locally, but bound model input independently from the number
        # returned to the user. This keeps inference cost fixed as the catalog grows.
        ranked = fallback_template_selections(
            tweet_text,
            candidates,
            min(12, len(candidates)),
            lexical_index=self._global_lexical_index,
        )
        fallback = ranked[:limit]
        by_template = {candidate.template.template_id: candidate for candidate in candidates}
        shortlist_templates = [
            by_template[selection.template_id].template
            for selection in ranked
            if selection.template_id in by_template
        ]
        try:
            model = await self.gateway.select_and_caption(tweet_text, shortlist_templates, limit)
        except Exception:
            # Do not retry captioning through the provider: a provider-level failure must
            # immediately take the deterministic local path.
            LOGGER.exception("Joint suggestion generation failed; using local ranking")
            model_selections: list[TemplateSelection] = []
            generated: dict[str, dict[str, str]] = {}
        else:
            model_selections = model.selections
            generated = model.captions
        selections = fill_selections(model_selections, fallback, limit)
        selected = [
            (by_template[selection.template_id], selection)
            for selection in selections
            if selection.template_id in by_template
        ]
        result = []
        for index, (candidate, selection) in enumerate(selected):
            regions = clean_generated_regions(
                generated.get(candidate.template.template_id, {}), candidate.template
            )
            if not regions and self.settings.contextual_caption_fallback:
                regions = build_fallback_caption_set(tweet_text, context, candidate.template) or {}
            result.append(
                {
                    "meme_id": candidate.meme_id,
                    "name": candidate.name,
                    "image_url": candidate.image_url,
                    "tailored_overlay": build_overlay(candidate.template, candidate.name, regions),
                    "use_case_label": "meme reply",
                    "match_explanation": selection.reason
                    or candidate.template.caption_guidance.pattern,
                    "score": round(selection.score or 1 - index * 0.08, 3),
                    "source": "global",
                    # Keep the complete analysis for the current response contract, but give
                    # clients a separate object that is safe to persist as usage feedback.
                    "feedback_context": usage_feedback_context(context),
                    "tweet_context": context.model_dump(),
                }
            )
        self._write_cache(key, result)
        LOGGER.info(
            "suggestions generated",
            extra={
                "cache_key": safe_log_cache_key(key),
                "templates": len(candidates),
                "returned": len(result),
                "duration_ms": round((time.perf_counter() - started) * 1000),
            },
        )
        return result

    async def get_tailored_overlay(self, tweet_text: str, meme_id: UUID) -> dict[str, Any] | None:
        row = await self.store.get_global_meme(meme_id)
        if row is None:
            return None
        template = self.catalog.find_template(
            str(row["name"]),
            meme_id=str(row["id"]),
            include_drafts=self.settings.use_draft_templates,
        )
        if template is None:
            return None
        context = heuristic_tweet_context(tweet_text)
        try:
            generated = await self.gateway.generate_captions(tweet_text, [template])
        except Exception:
            generated = {}
        regions = clean_generated_regions(generated.get(template.template_id, {}), template)
        if not regions and self.settings.contextual_caption_fallback:
            regions = build_fallback_caption_set(tweet_text, context, template) or {}
        return build_overlay(template, str(row["name"]), regions)

    async def _load_candidates(self, user_id: UUID) -> list[Candidate]:
        base_candidates, feedback = await asyncio.gather(
            self._load_global_candidates(), self.store.global_meme_feedback_scores(user_id)
        )
        return [
            replace(candidate, feedback_boost=feedback.get(candidate.meme_id, 0.0))
            for candidate in base_candidates
        ]

    async def _load_global_candidates(self) -> tuple[Candidate, ...]:
        if self._global_candidates is not None:
            return self._global_candidates
        async with self._global_candidates_lock:
            if self._global_candidates is not None:
                return self._global_candidates
            self._global_candidates = self._build_global_candidates(
                await self.store.list_global_memes()
            )
            self._global_lexical_index = LexicalCandidateIndex.build(self._global_candidates)
            return self._global_candidates

    def _build_global_candidates(self, rows: list[dict[str, Any]]) -> tuple[Candidate, ...]:
        result = []
        seen: set[str] = set()
        for row in rows:
            template = self.catalog.find_template(
                str(row["name"]),
                meme_id=str(row["id"]),
                include_drafts=self.settings.use_draft_templates,
            )
            if template is None or template.template_id in seen:
                continue
            seen.add(template.template_id)
            result.append(
                Candidate(
                    meme_id=str(row["id"]),
                    name=str(row["name"]),
                    image_url=str(row["filePath"]),
                    system_tags=dict(row.get("systemTags") or {}),
                    is_evergreen=bool(row.get("isEvergreen", True)),
                    template=template,
                )
            )
        return tuple(sorted(result, key=lambda candidate: candidate.template.name))

    def _read_cache(self, key: str) -> list[dict[str, Any]] | None:
        entry = self.cache.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            self.cache.pop(key, None)
            return None
        self.cache.move_to_end(key)
        return value

    def _write_cache(self, key: str, value: list[dict[str, Any]]) -> None:
        self.cache[key] = (time.monotonic() + SUGGESTION_CACHE_TTL_SECONDS, value)
        self.cache.move_to_end(key)
        while len(self.cache) > SUGGESTION_CACHE_MAX:
            self.cache.popitem(last=False)


def fallback_template_selections(
    tweet_text: str,
    candidates: list[Candidate],
    limit: int,
    *,
    lexical_index: LexicalCandidateIndex | None = None,
) -> list[TemplateSelection]:
    """Rank candidates locally with semantic, feedback, and lexical retrieval signals.

    Callers with a stable catalog should pass a pre-built ``lexical_index``.  The
    optional construction path preserves this function as a useful deterministic
    utility for tests, the offline evaluator, and small one-off catalogs.
    """
    signals = semantic_template_signals(tweet_text)
    index = lexical_index or LexicalCandidateIndex.build(candidates)
    lexical_scores = index.score(tweet_text)
    max_lexical_score = max(lexical_scores.values(), default=0.0)

    def rank(candidate: Candidate) -> tuple[float, Candidate]:
        signal_boost = signals.get(candidate.template.template_id, 0)
        raw_lexical_score = lexical_scores.get(candidate.template.template_id, 0.0)
        # BM25 is unbounded and its absolute range changes with query length. Map
        # it relative to the strongest matching document for this query instead of
        # letting nearly every candidate with a few generic words hit the cap.
        lexical_boost = (
            0.24 * math.log1p(raw_lexical_score) / math.log1p(max_lexical_score)
            if raw_lexical_score and max_lexical_score
            else 0.0
        )
        score = min(
            1.0,
            0.45
            + lexical_boost
            + signal_boost
            + candidate.feedback_boost
            + (0.04 if candidate.is_evergreen else 0),
        )
        return score, candidate

    # Only the shortlist reaches the model. A heap avoids sorting the entire
    # catalog on every request as it grows from dozens to thousands of templates.
    top_candidates = heapq.nsmallest(
        max(0, limit),
        (rank(candidate) for candidate in candidates),
        key=lambda item: (-item[0], item[1].template.name),
    )
    return [
        TemplateSelection(
            template_id=candidate.template.template_id,
            reason=candidate.template.caption_guidance.pattern,
            score=score,
        )
        for score, candidate in top_candidates
    ]


def semantic_template_signals(tweet_text: str) -> dict[str, float]:
    text = tweet_text.lower()
    signals: dict[str, float] = {}

    def boost(value: float, *template_ids: str) -> None:
        for template_id in template_ids:
            signals[template_id] = signals.get(template_id, 0) + value

    if re.search(r"down|fire|broken|outage|dashboard.*red|chaos", text):
        boost(0.35, "this-is-fine", "panik-kalm-panik", "disaster-girl")
    if re.search(r"skipp?ed tests|who could have predicted|somehow.*explod", text):
        boost(0.4, "surprised-pikachu", "roll-safe-think-about-it")
    if re.search(r"can'?t .* if|bad logic|apparently innovation", text):
        boost(0.42, "roll-safe-think-about-it", "expanding-brain")
    if re.search(r"rather .* than|choose|choice|agree on", text):
        boost(0.36, "two-buttons", "uno-draw-25-cards", "two-paths")
    if re.search(r"same|renamed .* to", text):
        boost(0.42, "they-re-the-same-picture")
        boost(0.28, "is-this-a-pigeon")
    if re.search(r"just .* with", text):
        boost(0.4, "they-re-the-same-picture")
        boost(0.1, "is-this-a-pigeon")
    if re.search(r"you get .* you get|every.*button|three .*buttons", text):
        boost(0.45, "oprah-you-get-a", "yo-dawg-heard-you")
    if re.search(r"every time|immediately says|predictable take", text):
        boost(0.4, "say-the-line-bart", "change-my-mind")
    if re.search(r"waiting|still waiting|how long", text):
        boost(0.45, "waiting-skeleton")
    if re.search(r"arguing|both sides|pointing", text):
        boost(0.4, "spider-man-triple", "woman-yelling-at-cat")
    if re.search(r"says|claim|fully autonomous|suspicious", text):
        boost(0.32, "futurama-fry", "is-this-a-pigeon")
    # Joke-shape signals describe reusable social dynamics rather than a topic.
    # They keep the lexical retriever honest when a post has domain-specific words
    # that do not appear in a template's catalog copy.
    if re.search(
        r"(?:stabili[sz]ed|working).*(?:rewrite|new framework|new stack)"
        r"|(?:rewrite|new framework).*(?:yesterday|again)",
        text,
    ):
        boost(0.42, "distracted-boyfriend", "running-away-balloon")
        boost(0.32, "expanding-brain")
    if re.search(
        r"(?:should (?:i|we)|fix .* properly).*(?: or |instead).*(?:feature flag|shortcut|pretend)"
        r"|(?:feature flag|shortcut).*(?:pretend|properly)",
        text,
    ):
        boost(0.46, "two-buttons", "evil-kermit")
        boost(0.38, "gru-s-plan")
    if re.search(
        r"calling .*?(?:spreadsheet|legacy|old).*?(?:modern|platform)|one way to describe", text
    ):
        boost(0.44, "is-this-a-pigeon", "they-re-the-same-picture")
        boost(0.34, "change-my-mind")
    if re.search(
        r"(?:meetings?|calendar).*(?:slack|message)"
        r"|could have been (?:a |an )?(?:slack|message|email)",
        text,
    ):
        boost(0.42, "change-my-mind", "boardroom-meeting-suggestion")
        boost(0.3, "drake-hotline-bling")
    if re.search(r"(?:wait|turns out).*(?:just|actually).*(?:vibes|deck|spreadsheet)", text):
        boost(0.42, "always-has-been", "surprised-pikachu")
        boost(0.3, "change-my-mind")
    if re.search(
        r"(?:budget|paid).*?(?:exposure|shoutout)|(?:exposure|shoutout).*?(?:budget|client)", text
    ):
        boost(0.44, "pawn-stars-best-i-can-do", "trade-offer")
        boost(0.3, "woman-yelling-at-cat")
    if re.search(r"review queue|blocked by silence|aging like milk", text):
        boost(0.46, "waiting-skeleton", "sad-pablo-escobar")
        boost(0.3, "hide-the-pain-harold")
    if re.search(
        r"migration finished|alerts stayed quiet|nobody had to .*rollback|clean ship", text
    ):
        boost(0.44, "leonardo-dicaprio-cheers", "epic-handshake")
        boost(0.32, "laughing-leo")
    if re.search(
        r"quick fix.*?(?:migration|cron|environment)"
        r"|(?:migration|cron).*?(?:quick fix|environment)",
        text,
    ):
        boost(0.42, "monkey-puppet", "hide-the-pain-harold")
        boost(0.32, "expanding-brain")
    if re.search(
        r"(?:trying to|want to).*(?:relax|sleep).*(?:neighbors|noise|bass)"
        r"|neighbors.*?(?:bass|noise)",
        text,
    ):
        boost(0.46, "squidward-window")
        boost(0.28, "hide-the-pain-harold", "monkey-puppet")
    return signals


def fill_selections(
    primary: list[TemplateSelection], fallback: list[TemplateSelection], limit: int
) -> list[TemplateSelection]:
    result = []
    seen = set()
    for item in [*primary, *fallback]:
        if item.template_id in seen:
            continue
        seen.add(item.template_id)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def candidate_search_terms(candidate: Candidate) -> list[str]:
    """Build the stable per-template document indexed by the local retriever."""
    guidance = candidate.template.caption_guidance
    values: list[str] = [
        candidate.template.name,
        *candidate.template.aliases,
        guidance.pattern,
        *(
            value
            for example in guidance.good_examples
            for value in example.values()
            if isinstance(value, str)
        ),
        str(candidate.system_tags.get("emotion", "")),
        *string_tag_values(candidate.system_tags.get("use_cases")),
        *string_tag_values(candidate.system_tags.get("vibes")),
        *string_tag_values(candidate.system_tags.get("example_contexts")),
    ]
    return [term for value in values for term in tokenize_sequence(value)]


def string_tag_values(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [item for item in value if isinstance(item, str)]
    return []


def tokenize_sequence(value: str) -> list[str]:
    return [
        token for token in re.findall(r"[a-z0-9][a-z0-9_'’-]*", value.lower()) if len(token) > 2
    ]


def tokenize(value: str) -> set[str]:
    """Compatibility helper for callers that only need unique normalized tokens."""
    return set(tokenize_sequence(value))


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def suggestion_request_key(
    tweet_text: str,
    *,
    user_id: UUID,
    limit: int,
    cache_key: str | None,
) -> str:
    """Build a complete, per-user key for cached and in-flight suggestions.

    ``cache_key`` is a client optimization hint, not a substitute for the source text:
    the caption and ranking both depend on the text itself. Including both prevents a
    stale or colliding client key from reusing another request's suggestions.
    """
    normalized_cache_key = normalize_text(cache_key) if cache_key else ""
    return (
        f"user:{user_id}|tweet:{normalize_text(tweet_text)}|client:{normalized_cache_key}"
        f"|limit:{limit}|fastapi:v1"
    )


def safe_log_cache_key(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:16]}"


def safe_log_tweet_text(value: str, mode: str) -> str:
    if mode == "full":
        return re.sub(r"\s+", " ", value.strip())
    if mode == "preview":
        normalized = re.sub(r"\s+", " ", value.strip())
        return normalized if len(normalized) <= 180 else f"{normalized[:177]}..."
    return f"[redacted:{hashlib.sha256(value.encode()).hexdigest()[:12]}]"
