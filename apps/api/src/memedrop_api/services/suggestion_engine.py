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
FEEDBACK_SCORE_CACHE_TTL_SECONDS = 60
FEEDBACK_SCORE_CACHE_MAX = 500
RETRIEVAL_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "being",
    "by",
    "can",
    "could",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "in",
    "into",
    "is",
    "it",
    "its",
    "many",
    "not",
    "of",
    "on",
    "one",
    "person",
    "some",
    "someone",
    "something",
    "than",
    "that",
    "the",
    "then",
    "thing",
    "this",
    "to",
    "was",
    "were",
    "while",
    "will",
    "with",
    "would",
}

# Small domain-neutral vocabulary groups used to recognize a joke's *mechanic*
# before looking at its subject matter.  They deliberately describe everyday
# language (a promise contradicted by a shopping list; a quiet plan interrupted
# by noise) rather than social-network or benchmark vocabulary.  This lets the
# local ranker bridge paraphrases without an embedding call on its hot path.
HUMOR_CONCEPT_WORDS: dict[str, frozenset[str]] = {
    "calm": frozenset({"calm", "quiet", "silent", "peaceful", "relax", "meditation", "serene"}),
    "disruption": frozenset(
        {
            "chaos",
            "construction",
            "drilling",
            "hammer",
            "machinery",
            "noise",
            "loud",
            "alarm",
            "traffic",
        }
    ),
    "ceremony": frozenset(
        {
            "ceremony",
            "ceremonial",
            "launch",
            "presentation",
            "town",
            "hall",
            "music",
            "photographer",
        }
    ),
    "polish": frozenset(
        {"branding", "logo", "font", "color", "uniform", "jacket", "matching", "wrapped", "package"}
    ),
    "display": frozenset(
        {"served", "serving", "menu", "plate", "plated", "display", "exhibit", "gallery"}
    ),
    "trivial": frozenset({"tiny", "minor", "small", "cosmetic", "basic", "ordinary", "rounder"}),
    "excess": frozenset(
        {
            "long",
            "lengthy",
            "elaborate",
            "detailed",
            "many",
            "hours",
            "minute",
            "minutes",
            "slides",
            "biography",
            "steps",
        }
    ),
    "unfinished": frozenset(
        {"before", "yet", "unfinished", "unprepared", "incomplete", "learn", "learned", "starting"}
    ),
    "claim": frozenset(
        {
            "advertised",
            "advertise",
            "claimed",
            "claim",
            "listed",
            "label",
            "labeled",
            "called",
            "says",
            "promised",
            "promise",
            "size",
            "view",
        }
    ),
    "reality": frozenset(
        {
            "actually",
            "apparent",
            "apparently",
            "requires",
            "require",
            "only",
            "just",
            "empty",
            "air",
            "hidden",
            "between",
        }
    ),
    "removal": frozenset(
        {
            "cancel",
            "canceled",
            "cancelled",
            "remove",
            "removed",
            "delete",
            "deleted",
            "discontinue",
            "ended",
        }
    ),
    "repeat": frozenset(
        {"again", "repeat", "repeated", "restart", "return", "begin", "episode", "cycle"}
    ),
    "contribution": frozenset(
        {
            "credit",
            "contribution",
            "contributed",
            "effort",
            "work",
            "equal",
            "share",
            "payment",
            "compensation",
        }
    ),
    "minimal": frozenset({"only", "just", "nothing", "zero", "no", "none", "title"}),
    "exercise": frozenset(
        {"fitness", "workout", "exercise", "activity", "burned", "calories", "intense"}
    ),
    "indulgence": frozenset(
        {"dessert", "cake", "treat", "reward", "eat", "eating", "permission", "slices"}
    ),
    "explanation": frozenset(
        {
            "explained",
            "explanation",
            "details",
            "story",
            "instructions",
            "measurements",
            "answer",
            "directions",
        }
    ),
    "desire": frozenset({"gift", "present", "wishlist", "wish", "shopping", "wrapped", "want"}),
    "simple_fix": frozenset(
        {"simple", "direct", "obvious", "straightforward", "fix", "repair", "replace", "solve"}
    ),
    "workaround": frozenset(
        {"workaround", "routine", "process", "protocol", "training", "teach", "instruct", "ritual"}
    ),
    "group_choice": frozenset(
        {
            "committee",
            "meeting",
            "group",
            "team",
            "staff",
            "management",
            "picked",
            "selected",
            "chose",
            "voted",
        }
    ),
    "responsible": frozenset(
        {"sensible", "responsible", "reasonable", "wise", "proper", "should", "better"}
    ),
    "temptation": frozenset(
        {"impulse", "urge", "temptation", "tempted", "brain", "mind", "thought", "voice", "wants"}
    ),
    "intent": frozenset(
        {
            "goal",
            "plan",
            "planned",
            "started",
            "begin",
            "began",
            "opened",
            "headed",
            "went",
            "trying",
            "tried",
            "wanted",
        }
    ),
    "sudden": frozenset(
        {"instant", "instantly", "immediate", "immediately", "sudden", "suddenly", "moment"}
    ),
    "derailment": frozenset(
        {
            "emergency",
            "interrupted",
            "interruption",
            "erupted",
            "launched",
            "derailed",
            "blocked",
            "burst",
            "broke",
            "breakdown",
            "failed",
            "leak",
            "crashed",
        }
    ),
    "casual_advice": frozenset({"just", "simply", "easy", "easily", "casual", "quickly"}),
    "constraint": frozenset(
        {
            "never",
            "impossible",
            "difficult",
            "hard",
            "requires",
            "required",
            "unavailable",
            "blocked",
        }
    ),
    "request": frozenset(
        {"asked", "requested", "complained", "complaint", "please", "stop", "fix", "issue"}
    ),
    "reply": frozenset({"replied", "responded", "response", "answered", "answer"}),
    "dismissal": frozenset(
        {
            "appreciate",
            "enjoy",
            "relax",
            "ignore",
            "deal",
            "perspective",
            "actually",
            "overreacting",
        }
    ),
    "group_rejection": frozenset(
        {"rejected", "refused", "vetoed", "voted", "dismissed", "declined", "down"}
    ),
    "rationale": frozenset(
        {"because", "rationale", "reason", "supposedly", "apparently", "claims", "makes"}
    ),
    "confidence": frozenset(
        {"announced", "told", "promised", "confident", "knew", "sure", "guaranteed", "shortcut"}
    ),
    "obstacle": frozenset(
        {"locked", "blocked", "closed", "barrier", "obstacle", "failed", "unavailable", "dead-end"}
    ),
    "renaming": frozenset(
        {"renamed", "rebrand", "rebranded", "replaced", "called", "name", "named", "label"}
    ),
    "unchanged": frozenset(
        {"same", "still", "unchanged", "remains", "continued", "continues", "somehow", "old"}
    ),
    "witness": frozenset(
        {"saw", "watched", "noticed", "knew", "witnessed", "only", "secret", "hidden", "truth"}
    ),
    "crowd": frozenset({"everyone", "crowd", "room", "audience", "others", "all"}),
    "celebration": frozenset(
        {"celebrated", "applauded", "praised", "cheered", "congratulated", "impressed", "amazed"}
    ),
    "collective": frozenset({"everyone", "both", "all", "each", "groups", "sides"}),
    "agreement": frozenset(
        {"agree", "agreed", "conclusion", "consensus", "united", "same", "shared"}
    ),
    "hazard": frozenset(
        {
            "danger",
            "hazard",
            "unsafe",
            "risk",
            "failure",
            "failed",
            "breakdown",
            "warning",
            "accident",
            "emergency",
            "crisis",
            "delay",
        }
    ),
    "positive_spin": frozenset(
        {
            "positive",
            "opportunity",
            "experience",
            "growth",
            "exciting",
            "enjoy",
            "benefit",
            "feature",
            "adventure",
        }
    ),
    "accusation": frozenset(
        {"blamed", "blaming", "accused", "suspected", "scapegoat", "fault", "culprit"}
    ),
    "evidence": frozenset(
        {"evidence", "showed", "revealed", "found", "discovered", "footage", "records", "proof"}
    ),
    "efficiency": frozenset(
        {
            "efficient",
            "efficiency",
            "optimize",
            "optimization",
            "faster",
            "speed",
            "save",
            "seconds",
            "streamline",
        }
    ),
    "compensation": frozenset(
        {
            "extra",
            "emergency",
            "injury",
            "damage",
            "recovery",
            "compensate",
            "medical",
            "replacement",
        }
    ),
    "learning_source": frozenset(
        {
            "tutorial",
            "guide",
            "video",
            "online",
            "self-taught",
            "learned",
            "watched",
            "instructions",
        }
    ),
    "physical_failure": frozenset(
        {"collapsed", "fell", "slid", "broke", "cracked", "dropped", "failed", "snapped"}
    ),
    "prerequisite": frozenset(
        {
            "prerequisite",
            "requires",
            "required",
            "need",
            "must",
            "available",
            "depends",
            "access",
            "confirmed",
        }
    ),
    "quantity": frozenset(
        {"amount", "count", "dozen", "hundred", "many", "million", "number", "thousand"}
    ),
    "comparison": frozenset(
        {"compared", "even", "fewer", "less", "more", "than", "versus", "vs"}
    ),
}

USAGE_FEEDBACK_CONTEXT_FIELDS = (
    "sentiment",
    "tone",
    "topic",
    "intent",
    "intensity",
    "reply_style",
    "ideal_meme_vibe",
    "social_dynamic",
    "humor_angle",
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
class SuggestionTiming:
    """Non-sensitive durations for the user-visible suggestion pipeline."""

    candidate_load_ms: float = 0.0
    local_rank_ms: float = 0.0
    joint_model_ms: float = 0.0
    response_assembly_ms: float = 0.0
    joint_outcome: str = "fallback"
    cache_hit: bool = False

    @classmethod
    def cached(cls) -> SuggestionTiming:
        return cls(joint_outcome="cache", cache_hit=True)

    def server_timing_header(self, total_ms: float) -> str:
        """Serialize timings using the standard HTTP Server-Timing header."""

        metrics = (
            ("candidate-load", self.candidate_load_ms, None),
            ("local-rank", self.local_rank_ms, None),
            ("joint-model", self.joint_model_ms, self.joint_outcome),
            ("response-assembly", self.response_assembly_ms, None),
            ("total", total_ms, None),
        )
        values = [
            f"{name};dur={max(0.0, duration):.1f}"
            + (f';desc="{outcome}"' if outcome is not None else "")
            for name, duration, outcome in metrics
        ]
        if self.cache_hit:
            values.append('cache;desc="hit"')
        return ", ".join(values)


@dataclass(frozen=True)
class SuggestionRun:
    """Suggestions plus their per-request, aggregate timing breakdown."""

    suggestions: list[dict[str, Any]]
    timing: SuggestionTiming


@dataclass
class FeedbackCacheGeneration:
    """Per-user invalidation state retained only while detached reads finish."""

    value: int = 0
    stale_reads: int = 0


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
    anti_document_lengths: dict[str, int]
    anti_postings: dict[str, tuple[tuple[str, int], ...]]
    anti_inverse_document_frequency: dict[str, float]
    anti_average_document_length: float

    @classmethod
    def build(cls, candidates: Iterable[Candidate]) -> LexicalCandidateIndex:
        positive_documents: dict[str, Counter[str]] = {}
        anti_documents: dict[str, Counter[str]] = {}
        for candidate in candidates:
            template_id = candidate.template.template_id
            # A duplicate template is never a useful distinct retrieval result.
            positive_documents.setdefault(template_id, Counter(candidate_search_terms(candidate)))
            anti_documents.setdefault(template_id, Counter(candidate_anti_terms(candidate)))

        return cls(*build_bm25_corpus(positive_documents), *build_bm25_corpus(anti_documents))

    def score(self, query: str) -> dict[str, float]:
        """Return positive BM25 scores for catalog retrieval signals."""
        return score_bm25_corpus(
            query,
            self.document_lengths,
            self.postings,
            self.inverse_document_frequency,
            self.average_document_length,
        )

    def anti_score(self, query: str) -> dict[str, float]:
        """Return BM25 evidence that a template is a poor fit for the query."""
        return score_bm25_corpus(
            query,
            self.anti_document_lengths,
            self.anti_postings,
            self.anti_inverse_document_frequency,
            self.anti_average_document_length,
        )


def build_bm25_corpus(
    documents: dict[str, Counter[str]],
) -> tuple[
    dict[str, int],
    dict[str, tuple[tuple[str, int], ...]],
    dict[str, float],
    float,
]:
    document_count = len(documents)
    if not document_count:
        return {}, {}, {}, 0.0
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
    return lengths, postings, idf, sum(lengths.values()) / document_count


def score_bm25_corpus(
    query: str,
    document_lengths: dict[str, int],
    postings: dict[str, tuple[tuple[str, int], ...]],
    inverse_document_frequency: dict[str, float],
    average_document_length: float,
) -> dict[str, float]:
    query_terms = Counter(tokenize_sequence(query))
    if not query_terms or not average_document_length:
        return {}
    scores: dict[str, float] = defaultdict(float)
    # Standard BM25 constants. Keeping this intentionally boring makes tuning
    # reproducible as the catalog moves from dozens to thousands of templates.
    k1 = 1.2
    b = 0.75
    for term, query_frequency in query_terms.items():
        for template_id, term_frequency in postings.get(term, ()):
            document_length = document_lengths[template_id]
            denominator = term_frequency + k1 * (
                1 - b + b * document_length / average_document_length
            )
            scores[template_id] += (
                inverse_document_frequency[term]
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
        self._inflight_suggestions: dict[str, asyncio.Task[SuggestionRun]] = {}
        # Global templates change only through a controlled release. Cache the immutable base
        # candidates for this process, then apply each user's feedback on a fresh copy.
        self._global_candidates: tuple[Candidate, ...] | None = None
        self._global_lexical_index: LexicalCandidateIndex | None = None
        self._global_candidates_lock = asyncio.Lock()
        # Feedback is user-specific but changes much less often than suggestions. Keep
        # it in a small process-local LRU so a warm request does not add a database
        # round trip; the short TTL bounds how long new feedback takes to influence rank.
        self._feedback_scores: OrderedDict[UUID, tuple[float, dict[str, float]]] = OrderedDict()
        self._feedback_score_inflight: dict[UUID, asyncio.Task[dict[str, float]]] = {}
        # Incremented after every usage write. A read that began before the write may
        # still complete for its original caller, but it must never refill this cache.
        self._feedback_cache_generation: dict[UUID, FeedbackCacheGeneration] = {}

    async def get_suggestions(
        self,
        tweet_text: str,
        *,
        user_id: UUID,
        limit: int | None = None,
        refresh: bool = False,
        cache_key: str | None = None,
    ) -> list[dict[str, Any]]:
        run = await self.get_suggestion_run(
            tweet_text,
            user_id=user_id,
            limit=limit,
            refresh=refresh,
            cache_key=cache_key,
        )
        return run.suggestions

    async def get_suggestion_run(
        self,
        tweet_text: str,
        *,
        user_id: UUID,
        limit: int | None = None,
        refresh: bool = False,
        cache_key: str | None = None,
    ) -> SuggestionRun:
        normalized_limit = max(1, min(5, int(limit or 5)))
        key = suggestion_request_key(
            tweet_text,
            user_id=user_id,
            limit=normalized_limit,
            cache_key=cache_key,
        )
        if not refresh and (cached := self._read_cache(key)) is not None:
            return SuggestionRun(cached, SuggestionTiming.cached())
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
                    refresh_feedback=refresh,
                )
            )
            self._inflight_suggestions[flight_key] = task
            task.add_done_callback(
                lambda completed: self._clear_inflight_suggestion(flight_key, completed)
            )
        # Shielding lets a cancelled HTTP request stop waiting without cancelling the
        # shared computation that other callers are relying on.
        return await asyncio.shield(task)

    def _clear_inflight_suggestion(self, key: str, completed: asyncio.Task[SuggestionRun]) -> None:
        if self._inflight_suggestions.get(key) is completed:
            self._inflight_suggestions.pop(key, None)

    async def _generate_suggestions(
        self,
        tweet_text: str,
        *,
        user_id: UUID,
        limit: int,
        key: str,
        refresh_feedback: bool,
    ) -> SuggestionRun:
        started = time.perf_counter()
        context = heuristic_tweet_context(tweet_text)
        candidate_load_started = time.perf_counter()
        candidates = await self._load_candidates(user_id, refresh_feedback=refresh_feedback)
        candidate_load_ms = elapsed_ms(candidate_load_started)
        if not candidates:
            return SuggestionRun(
                [],
                SuggestionTiming(
                    candidate_load_ms=candidate_load_ms,
                    joint_outcome="fallback",
                ),
            )
        # Rank every candidate locally, but bound model input independently from the number
        # returned to the user. This keeps inference cost fixed as the catalog grows.
        local_rank_started = time.perf_counter()
        ranked = fallback_template_selections(
            tweet_text,
            candidates,
            min(12, len(candidates)),
            lexical_index=self._global_lexical_index,
        )
        local_rank_ms = elapsed_ms(local_rank_started)
        fallback = ranked[:limit]
        by_template = {candidate.template.template_id: candidate for candidate in candidates}
        shortlist_templates = [
            by_template[selection.template_id].template
            for selection in ranked
            if selection.template_id in by_template
        ]
        joint_model_started = time.perf_counter()
        joint_outcome = "model"
        model_selections: list[TemplateSelection] = []
        generated: dict[str, dict[str, str]] = {}
        try:
            model = await self.gateway.select_and_caption(
                tweet_text, shortlist_templates, limit, context=context
            )
        except TimeoutError:
            # A bounded provider miss is an expected availability condition, not an
            # application crash. Keep logs actionable without emitting a cancellation stack.
            LOGGER.warning(
                "Joint suggestion generation timed out after %dms; using reviewed local fallback",
                self.settings.joint_suggestion_timeout_ms,
            )
            joint_outcome = "timeout"
        except Exception:
            # Do not retry captioning through the provider: a provider-level failure must
            # immediately take the deterministic local path.
            LOGGER.exception("Joint suggestion generation failed; using local ranking")
            joint_outcome = "fallback"
        else:
            model_selections = model.selections
            generated = model.captions
            if not model_selections:
                joint_outcome = "fallback"
        joint_model_ms = elapsed_ms(joint_model_started)
        selections = fill_selections(model_selections, fallback, limit)
        selected = [
            (by_template[selection.template_id], selection)
            for selection in selections
            if selection.template_id in by_template
        ]
        response_assembly_started = time.perf_counter()
        result = []
        for index, (candidate, selection) in enumerate(selected):
            regions = clean_generated_regions(
                generated.get(candidate.template.template_id, {}),
                candidate.template,
                require_complete=True,
                reject_overlong=True,
            )
            if not regions and self.settings.contextual_caption_fallback:
                regions = build_fallback_caption_set(tweet_text, context, candidate.template) or {}
            if not regions:
                # Returning fewer useful suggestions is better than rendering an
                # uncaptioned template or fabricating a structurally meaningless joke.
                continue
            result.append(
                {
                    "meme_id": candidate.meme_id,
                    "name": candidate.name,
                    "image_url": candidate.image_url,
                    # The original remains the attachment asset. Catalog publishing may
                    # provide a smaller card asset under ``thumbnail_path`` instead.
                    "preview_image_url": candidate.system_tags.get("thumbnail_path")
                    or candidate.image_url,
                    "tailored_overlay": build_overlay(candidate.template, candidate.name, regions),
                    "use_case_label": candidate_use_case_label(candidate),
                    "match_explanation": selection.reason
                    or candidate.template.caption_guidance.pattern,
                    "score": round(
                        selection.score if selection.score is not None else 1 - index * 0.08,
                        3,
                    ),
                    "source": "global",
                    # This is deliberately the only analysis exposed to clients: it is
                    # structured for usage feedback and contains no source post text.
                    "feedback_context": usage_feedback_context(context),
                }
            )
        self._write_cache(key, result)
        timing = SuggestionTiming(
            candidate_load_ms=candidate_load_ms,
            local_rank_ms=local_rank_ms,
            joint_model_ms=joint_model_ms,
            response_assembly_ms=elapsed_ms(response_assembly_started),
            joint_outcome=joint_outcome,
        )
        LOGGER.info(
            "suggestions generated",
            extra={
                "cache_key": safe_log_cache_key(key),
                "templates": len(candidates),
                "returned": len(result),
                "duration_ms": round(elapsed_ms(started)),
                "candidate_load_ms": round(timing.candidate_load_ms),
                "local_rank_ms": round(timing.local_rank_ms),
                "joint_model_ms": round(timing.joint_model_ms),
                "response_assembly_ms": round(timing.response_assembly_ms),
                "joint_outcome": timing.joint_outcome,
            },
        )
        return SuggestionRun(result, timing)

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
            generated = await self.gateway.generate_captions(
                tweet_text, [template], context=context
            )
        except Exception:
            generated = {}
        regions = clean_generated_regions(
            generated.get(template.template_id, {}),
            template,
            require_complete=True,
            reject_overlong=True,
        )
        if not regions and self.settings.contextual_caption_fallback:
            regions = build_fallback_caption_set(tweet_text, context, template) or {}
        return build_overlay(template, str(row["name"]), regions)

    async def _load_candidates(
        self, user_id: UUID, *, refresh_feedback: bool = False
    ) -> list[Candidate]:
        base_candidates, feedback = await asyncio.gather(
            self._load_global_candidates(),
            self._load_feedback_scores(user_id, refresh=refresh_feedback),
        )
        return [
            replace(candidate, feedback_boost=feedback.get(candidate.meme_id, 0.0))
            for candidate in base_candidates
        ]

    async def _load_feedback_scores(self, user_id: UUID, *, refresh: bool) -> dict[str, float]:
        if not refresh and (cached := self._read_feedback_scores(user_id)) is not None:
            return cached
        task = self._feedback_score_inflight.get(user_id)
        if task is None:
            state = self._feedback_cache_generation.get(user_id)
            generation = state.value if state is not None else 0
            task = asyncio.create_task(self._fetch_feedback_scores(user_id, generation))
            self._feedback_score_inflight[user_id] = task
            task.add_done_callback(
                lambda completed: self._clear_feedback_score_inflight(user_id, completed)
            )
        return await asyncio.shield(task)

    async def _fetch_feedback_scores(self, user_id: UUID, generation: int) -> dict[str, float]:
        try:
            scores = await self.store.global_meme_feedback_scores(user_id)
            # Copy at the storage boundary. In particular, fake or adapter stores must
            # not be able to mutate an already-cached user's score map after returning.
            cached_scores = dict(scores)
            state = self._feedback_cache_generation.get(user_id)
            if state is None or state.value == generation:
                self._write_feedback_scores(user_id, cached_scores)
            return cached_scores
        finally:
            self._finish_feedback_score_fetch(user_id, generation)

    def _clear_feedback_score_inflight(
        self, user_id: UUID, completed: asyncio.Task[dict[str, float]]
    ) -> None:
        if self._feedback_score_inflight.get(user_id) is completed:
            self._feedback_score_inflight.pop(user_id, None)
        self._clear_feedback_generation_if_idle(user_id)

    def _finish_feedback_score_fetch(self, user_id: UUID, generation: int) -> None:
        state = self._feedback_cache_generation.get(user_id)
        if state is not None and generation != state.value:
            state.stale_reads -= 1
            if state.stale_reads < 0:
                raise AssertionError("Feedback cache generation lost track of a stale read.")
        self._clear_feedback_generation_if_idle(user_id)

    def _clear_feedback_generation_if_idle(self, user_id: UUID) -> None:
        state = self._feedback_cache_generation.get(user_id)
        if (
            state is not None
            and state.stale_reads == 0
            and user_id not in self._feedback_score_inflight
        ):
            self._feedback_cache_generation.pop(user_id, None)

    def _read_feedback_scores(self, user_id: UUID) -> dict[str, float] | None:
        entry = self._feedback_scores.get(user_id)
        if entry is None:
            return None
        expires_at, scores = entry
        if expires_at <= time.monotonic():
            self._feedback_scores.pop(user_id, None)
            return None
        self._feedback_scores.move_to_end(user_id)
        return scores

    def _write_feedback_scores(self, user_id: UUID, scores: dict[str, float]) -> None:
        self._feedback_scores[user_id] = (
            time.monotonic() + FEEDBACK_SCORE_CACHE_TTL_SECONDS,
            scores,
        )
        self._feedback_scores.move_to_end(user_id)
        while len(self._feedback_scores) > FEEDBACK_SCORE_CACHE_MAX:
            self._feedback_scores.popitem(last=False)

    def invalidate_feedback(self, user_id: UUID) -> None:
        """Forget one user's derived feedback scores after a usage write.

        Suggestion results intentionally retain their short response-cache lifetime;
        this only makes the next cache miss reload the ranking signal without adding a
        write or a read to the hot ``/suggest`` path.
        """
        self._feedback_scores.pop(user_id, None)
        # Detach an older read so the next request does not attach to data that
        # predates the write. It remains alive for any caller already awaiting it.
        detached = self._feedback_score_inflight.pop(user_id, None)
        if detached is None:
            self._clear_feedback_generation_if_idle(user_id)
            return
        state = self._feedback_cache_generation.setdefault(user_id, FeedbackCacheGeneration())
        state.value += 1
        state.stale_reads += 1

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
    inferred_mechanics = infer_humor_mechanics(tweet_text)
    inferred_shape_boosts = inferred_joke_shape_boosts(inferred_mechanics)
    index = lexical_index or LexicalCandidateIndex.build(candidates)
    lexical_scores = index.score(tweet_text)
    anti_scores = index.anti_score(tweet_text)
    max_lexical_score = max(lexical_scores.values(), default=0.0)
    max_anti_score = max(anti_scores.values(), default=0.0)

    def rank(candidate: Candidate) -> tuple[float, Candidate]:
        signal_boost = signals.get(candidate.template.template_id, 0)
        shape_boost = structural_joke_shape_boost(
            tweet_text, candidate
        ) + candidate_joke_shape_boost(inferred_shape_boosts, candidate)
        raw_lexical_score = lexical_scores.get(candidate.template.template_id, 0.0)
        # BM25 is unbounded and its absolute range changes with query length. Map
        # it relative to the strongest matching document for this query instead of
        # letting nearly every candidate with a few generic words hit the cap.
        lexical_boost = (
            0.24 * math.log1p(raw_lexical_score) / math.log1p(max_lexical_score)
            if raw_lexical_score and max_lexical_score
            else 0.0
        )
        raw_anti_score = anti_scores.get(candidate.template.template_id, 0.0)
        anti_penalty = (
            0.1 * math.log1p(raw_anti_score) / math.log1p(max_anti_score)
            if raw_anti_score and max_anti_score
            else 0.0
        )
        score = (
            min(
                1.0,
                0.45
                + lexical_boost
                + signal_boost
                + shape_boost
                + candidate.feedback_boost
                + (0.04 if candidate.is_evergreen else 0),
            )
            - anti_penalty
        )
        return score, candidate

    # Keep a small relevance pool for a soft diversity pass. This is still O(N log k)
    # because both the model shortlist and its expansion factor are bounded.
    pool_limit = min(len(candidates), max(0, limit) * 3)
    relevance_pool = heapq.nsmallest(
        pool_limit,
        (rank(candidate) for candidate in candidates),
        key=lambda item: (-item[0], item[1].template.name),
    )
    top_candidates = diversify_shortlist(relevance_pool, limit)
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


# Catalog-owned joke shapes, rather than template IDs, connect inferred
# mechanics to ranking. New reviewed templates automatically benefit when they
# reuse a shape, and the max-combination keeps this signal bounded per candidate.
MECHANIC_SHAPE_BOOSTS: dict[str, tuple[tuple[str, float], ...]] = {
    "calm_interrupted": (
        ("annoyed observer", 0.46),
        ("calm amid mayhem", 0.36),
        ("forced composure", 0.28),
    ),
    "ceremony_for_trivial_change": (
        ("grandiose art defense", 0.46),
        ("pretentious over-explanation", 0.46),
        ("group bad judgment", 0.38),
        ("overengineering", 0.34),
    ),
    "polish_before_substance": (
        ("luxury makeover", 0.46),
        ("pretentious upgrade", 0.46),
        ("overengineering", 0.38),
        ("flawed plan", 0.34),
    ),
    "claim_reality_gap": (
        ("false label", 0.46),
        ("pretentious relabeling", 0.46),
        ("fake distinction", 0.38),
        ("euphemistic rebrand", 0.38),
        ("pretentious upgrade", 0.34),
    ),
    "bad_value_exchange": (
        ("lowball offer", 0.46),
        ("exploitative bargain", 0.46),
        ("exploitative exchange", 0.42),
        ("lopsided deal", 0.42),
        ("predictable consequence", 0.30),
    ),
    "self_defeating_cycle": (
        ("predictable consequence", 0.46),
        ("obvious outcome", 0.46),
        ("confident bad solution", 0.42),
        ("fake wisdom", 0.42),
        ("flawed plan", 0.38),
    ),
    "unequal_credit": (
        ("exploitative exchange", 0.46),
        ("lopsided deal", 0.46),
        ("lowball offer", 0.42),
        ("dramatic confrontation", 0.30),
    ),
    "self_serving_loophole": (
        ("confident bad solution", 0.46),
        ("fake wisdom", 0.46),
        ("absurd escalation", 0.38),
        ("forced composure", 0.32),
    ),
    "ominous_contradiction": (
        ("ominous promise", 0.46),
        ("hope turning to dread", 0.46),
        ("suspicious ambiguity", 0.38),
        ("forced choice", 0.32),
    ),
    "overexplained_simple_thing": (
        ("grandiose art defense", 0.46),
        ("pretentious over-explanation", 0.46),
        ("luxury makeover", 0.38),
        ("forced composure", 0.30),
    ),
    "nonanswer_with_details": (
        ("elaborate suspicion", 0.46),
        ("overinterpretation", 0.46),
        ("overengineering", 0.40),
        ("guilty reaction", 0.30),
    ),
    "absurd_workaround_chosen": (
        ("preference contrast", 0.46),
        ("reject versus approve", 0.46),
        ("confident bad solution", 0.42),
        ("group bad judgment", 0.38),
    ),
    "responsibility_versus_temptation": (
        ("bad impulse", 0.46),
        ("internal temptation", 0.46),
        ("shiny object temptation", 0.40),
        ("safe versus chaotic path", 0.34),
    ),
    "goal_instantly_derailed": (
        ("goal blocked by chaos", 0.46),
        ("pulled away", 0.46),
        ("panic reversal", 0.40),
        ("calm amid mayhem", 0.34),
    ),
    "casual_advice_hides_constraint": (
        ("hard constraint", 0.48),
        ("not that simple", 0.48),
        ("flawed plan", 0.38),
        ("forced choice", 0.30),
    ),
    "dismissive_rebuttal": (
        ("dramatic confrontation", 0.46),
        ("absurd rebuttal", 0.46),
        ("forced optimism", 0.38),
        ("group bad judgment", 0.34),
    ),
    "group_rejects_improvement": (
        ("group bad judgment", 0.46),
        ("confident bad solution", 0.42),
        ("flawed plan", 0.36),
    ),
    "confidence_meets_obstacle": (
        ("confidence before disaster", 0.46),
        ("sudden realization", 0.42),
        ("flawed plan", 0.38),
    ),
    "fancy_name_same_outcome": (
        ("fake distinction", 0.46),
        ("euphemistic rebrand", 0.46),
        ("false label", 0.42),
        ("luxury makeover", 0.34),
    ),
    "sole_witness_hidden_truth": (
        ("private knowledge", 0.46),
        ("social isolation", 0.46),
        ("awkward observation", 0.40),
        ("guilty reaction", 0.32),
    ),
    "cross_group_agreement": (
        ("unlikely agreement", 0.46),
        ("shared outcome", 0.46),
    ),
    "danger_reframed_positive": (
        ("forced optimism", 0.46),
        ("confident bad solution", 0.42),
        ("group bad judgment", 0.34),
    ),
    "evidence_reveals_culprit": (
        ("hidden cause reveal", 0.46),
        ("fake identity", 0.46),
        ("awkward observation", 0.38),
    ),
    "efficiency_creates_harm": (
        ("confident bad solution", 0.46),
        ("predictable consequence", 0.42),
        ("group bad judgment", 0.34),
    ),
    "self_taught_confidence_fails": (
        ("confidence before disaster", 0.46),
        ("sudden realization", 0.42),
        ("flawed plan", 0.38),
    ),
    "recursive_prerequisite": (
        ("recursive hype", 0.48),
        ("thing inside itself", 0.48),
        ("hard constraint", 0.40),
        ("overengineering", 0.36),
    ),
    "unexpected_scale_comparison": (
        ("unexpected scale comparison", 0.48),
        ("strong versus weak", 0.42),
        ("watching a mistake", 0.30),
        ("awkward observation", 0.26),
    ),
}


def infer_humor_mechanics(text: str) -> set[str]:
    """Infer broad joke grammars from ordinary language, without a model call.

    The output is deliberately small and reusable across subjects.  Each rule
    requires two independent concepts, which prevents a single topical word
    such as ``quiet`` or ``package`` from overwhelming lexical relevance.
    """
    # Keep short structural words here as well as indexed content terms: a
    # negation such as "no" is meaningful for a contradiction even though it is
    # intentionally omitted from BM25 documents.
    tokens = set(tokenize_sequence(text)) | set(re.findall(r"[a-z0-9][a-z0-9_'’-]*", text.lower()))
    repeated_content = Counter(
        token
        for token in re.findall(r"[a-z0-9][a-z0-9_'’-]*", text.lower())
        if len(token) >= 4 and token not in RETRIEVAL_STOP_WORDS
    )

    def has(concept: str) -> bool:
        if tokens & HUMOR_CONCEPT_WORDS[concept]:
            return True
        # Compound nouns such as a road-drill or a jackhammer are still a
        # disruption even when English joins their parts without a hyphen.
        return concept == "disruption" and any(
            token.endswith(("hammer", "drill")) for token in tokens
        )

    mechanics: set[str] = set()
    if has("calm") and has("disruption"):
        mechanics.add("calm_interrupted")
    if has("ceremony") and (has("trivial") or has("polish")):
        mechanics.add("ceremony_for_trivial_change")
    if has("polish") and has("unfinished"):
        mechanics.add("polish_before_substance")
    if has("claim") and has("reality"):
        mechanics.add("claim_reality_gap")
    if has("claim") and ("air" in tokens or "empty" in tokens):
        mechanics.add("bad_value_exchange")
    if has("removal") and has("repeat"):
        mechanics.add("self_defeating_cycle")
    if has("contribution") and has("minimal"):
        mechanics.add("unequal_credit")
    if has("exercise") and has("indulgence"):
        mechanics.add("self_serving_loophole")
    if re.search(r"\b(?:no|without|nothing)\b.{0,90}\b(?:but|then|yet)\b", text) and has("desire"):
        mechanics.add("ominous_contradiction")
    if has("excess") and (has("trivial") or has("polish") or has("display")):
        mechanics.add("overexplained_simple_thing")
    if has("excess") and re.search(r"\b(?:no|without|missing|instead)\b", text):
        mechanics.add("nonanswer_with_details")
    if has("simple_fix") and has("workaround") and has("group_choice"):
        mechanics.add("absurd_workaround_chosen")
    if has("responsible") and has("temptation"):
        mechanics.add("responsibility_versus_temptation")
    if has("intent") and has("sudden") and has("derailment"):
        mechanics.add("goal_instantly_derailed")
    if has("casual_advice") and has("constraint"):
        mechanics.add("casual_advice_hides_constraint")
    if has("request") and has("reply") and has("dismissal"):
        mechanics.add("dismissive_rebuttal")
    if has("group_choice") and has("group_rejection") and has("rationale"):
        mechanics.add("group_rejects_improvement")
    if has("confidence") and has("obstacle"):
        mechanics.add("confidence_meets_obstacle")
    if has("renaming") and has("unchanged"):
        mechanics.add("fancy_name_same_outcome")
    if has("witness") and has("crowd") and has("celebration"):
        mechanics.add("sole_witness_hidden_truth")
    if has("collective") and has("agreement"):
        mechanics.add("cross_group_agreement")
    if has("hazard") and has("positive_spin") and (has("claim") or has("renaming")):
        mechanics.add("danger_reframed_positive")
    if has("accusation") and has("evidence"):
        mechanics.add("evidence_reveals_culprit")
    if has("removal") and has("efficiency") and has("compensation"):
        mechanics.add("efficiency_creates_harm")
    if has("confidence") and has("learning_source") and has("sudden") and has("physical_failure"):
        mechanics.add("self_taught_confidence_fails")
    if has("prerequisite") and any(count >= 2 for count in repeated_content.values()):
        mechanics.add("recursive_prerequisite")
    if (
        (has("quantity") or bool(re.search(r"\b\d[\d,.]*\b", text)))
        and has("comparison")
    ):
        mechanics.add("unexpected_scale_comparison")
    return mechanics


def inferred_joke_shape_boosts(mechanics: set[str]) -> dict[str, float]:
    """Compile inferred mechanics into bounded catalog joke-shape weights."""
    shape_boosts: dict[str, float] = {}
    for mechanic in mechanics:
        for shape, weight in MECHANIC_SHAPE_BOOSTS[mechanic]:
            shape_boosts[shape] = max(weight, shape_boosts.get(shape, 0.0))
    return shape_boosts


def candidate_joke_shape_boost(
    inferred_shape_boosts: dict[str, float], candidate: Candidate
) -> float:
    """Score precompiled mechanics against the candidate's reviewed grammar.

    Taking the strongest shape match avoids double-counting synonymous catalog
    labels and bounds this deterministic signal even when several mechanics are
    inferred from one post.
    """
    return max(
        (
            inferred_shape_boosts.get(shape, 0.0)
            for shape in candidate.template.retrieval.joke_shapes
        ),
        default=0.0,
    )


def fill_selections(
    primary: list[TemplateSelection], fallback: list[TemplateSelection], limit: int
) -> list[TemplateSelection]:
    # The model is explicitly allowed to omit weak options. Do not undo that quality
    # decision merely to fill five slots. Local ranking is used only when the joint
    # model produced no usable selection at all.
    source = primary if primary else fallback
    result = []
    seen = set()
    for item in source:
        if item.template_id in seen:
            continue
        seen.add(item.template_id)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def candidate_search_terms(candidate: Candidate) -> list[str]:
    """Build the stable per-template document indexed by the local retriever."""
    values: list[str] = [
        candidate.template.name,
        *candidate.template.aliases,
        str(candidate.system_tags.get("emotion", "")),
        *string_tag_values(candidate.system_tags.get("use_cases")),
        *string_tag_values(candidate.system_tags.get("vibes")),
        *string_tag_values(candidate.system_tags.get("example_contexts")),
        *candidate.template.retrieval.joke_shapes,
        *candidate.template.retrieval.positive_hints,
    ]
    return [term for value in values for term in tokenize_sequence(value)]


def candidate_anti_terms(candidate: Candidate) -> list[str]:
    return [
        term
        for value in candidate.template.retrieval.anti_hints
        for term in tokenize_sequence(value)
    ]


def candidate_use_case_label(candidate: Candidate) -> str:
    shapes = candidate.template.retrieval.joke_shapes
    return shapes[0].replace("_", " ") if shapes else "meme reply"


def diversify_shortlist(
    relevance_pool: list[tuple[float, Candidate]], limit: int
) -> list[tuple[float, Candidate]]:
    """Softly discourage one joke grammar from monopolizing the shortlist.

    The best relevance result is always preserved. Subsequent choices pay only a
    small penalty for shapes already selected, so a clearly better candidate can
    still win and recall is not constrained by a hard one-per-shape rule.
    """
    remaining = list(relevance_pool)
    selected: list[tuple[float, Candidate]] = []
    shape_counts: Counter[str] = Counter()
    while remaining and len(selected) < max(0, limit):
        best = min(
            remaining,
            key=lambda item: (
                -(
                    item[0]
                    - 0.035
                    * max(
                        (shape_counts[shape] for shape in item[1].template.retrieval.joke_shapes),
                        default=0,
                    )
                ),
                item[1].template.name,
            ),
        )
        selected.append(best)
        remaining.remove(best)
        shape_counts.update(best[1].template.retrieval.joke_shapes)
    return selected


def string_tag_values(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return [item for item in value if isinstance(item, str)]
    return []


def tokenize_sequence(value: str) -> list[str]:
    result: list[str] = []
    for token in re.findall(r"[a-z0-9][a-z0-9_'’-]*", value.lower()):
        if len(token) <= 2 and token not in {"or", "vs"}:
            continue
        if token in RETRIEVAL_STOP_WORDS:
            continue
        result.append(token)
        result.extend(token_stems(token))
        # Hyphenated compounds carry both a phrase-level meaning (which we keep
        # above) and ordinary component concepts.  Indexing the latter makes a
        # query like "premium-label" share useful retrieval evidence with a
        # catalog hint about a "premium label" without requiring a phrase model.
        for component in re.split(r"[-–]", token):
            if component != token and len(component) > 2 and component not in RETRIEVAL_STOP_WORDS:
                result.append(component)
                result.extend(token_stems(component))
    return result


def token_stems(token: str) -> list[str]:
    """Return conservative English suffix variants without a runtime NLP dependency."""
    stems: list[str] = []
    if len(token) > 5 and token.endswith("ing"):
        root = token[:-3]
        stems.extend((root, f"{root}e"))
    elif len(token) > 4 and token.endswith("ied"):
        stems.append(f"{token[:-3]}y")
    elif len(token) > 4 and token.endswith("ed"):
        root = token[:-2]
        stems.extend((root, f"{root}e"))
    elif len(token) > 4 and token.endswith("s") and not token.endswith("ss"):
        stems.append(token[:-1])
    return [stem for stem in stems if len(stem) > 2 and stem != token]


def structural_joke_shape_boost(tweet_text: str, candidate: Candidate) -> float:
    """Map domain-neutral language structure onto catalog-owned joke shapes."""
    raw_tokens = [
        token
        for token in re.findall(r"[a-z0-9][a-z0-9_'’-]*", tweet_text.lower())
        if token not in RETRIEVAL_STOP_WORDS
    ]
    shapes = set(candidate.template.retrieval.joke_shapes)
    boost = 0.0
    if "or" in raw_tokens and shapes & {
        "forced choice",
        "painful dilemma",
        "safe versus chaotic path",
        "self-inflicted consequence",
    }:
        boost += 0.24
    content_counts = Counter(token for token in raw_tokens if len(token) >= 5)
    if any(count >= 2 for count in content_counts.values()):
        if shapes & {"recursive hype", "thing inside itself"}:
            boost += 0.3
        elif shapes & {"everyone gets one", "feature proliferation", "absurd escalation"}:
            boost += 0.18
    return min(boost, 0.3)


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


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000
