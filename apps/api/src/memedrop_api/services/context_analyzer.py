from __future__ import annotations

import re
from typing import Literal

from memedrop_api.schemas import TweetContext

Tone = Literal[
    "sarcastic",
    "earnest",
    "rant",
    "celebratory",
    "hot-take",
    "question",
    "absurdist",
    "wholesome",
    "self-deprecating",
]
Topic = Literal[
    "tech",
    "finance",
    "politics",
    "sports",
    "entertainment",
    "personal",
    "culture",
    "relationships",
    "other",
]
Intent = Literal[
    "counter-argument",
    "agreement",
    "sharing-opinion",
    "venting",
    "asking",
    "celebrating",
    "dunking",
    "self-deprecating",
]

COMMON_WORDS = {
    "about",
    "after",
    "again",
    "always",
    "because",
    "before",
    "could",
    "every",
    "from",
    "have",
    "into",
    "just",
    "more",
    "only",
    "really",
    "should",
    "somehow",
    "still",
    "than",
    "that",
    "their",
    "there",
    "these",
    "they",
    "thing",
    "things",
    "this",
    "what",
    "when",
    "where",
    "which",
    "while",
    "would",
    "your",
}
OUTCOME_WORDS = re.compile(
    r"\b(explode|exploded|broken|broke|failed|failing|down|outage|crash|crashed|red|blocked|delayed)\b",
    re.I,
)
ACTION_WORDS = re.compile(
    r"\b(skip|skipped|ignore|ignored|deploy|deployed|rename|renamed|call|calling|choose|chose|rewrite|rewriting|add|added|remove|removed)\b",
    re.I,
)


def heuristic_tweet_context(tweet_text: str) -> TweetContext:
    text = tweet_text.lower()
    words = re.findall(r"[a-z0-9][a-z0-9_'’-]*", tweet_text, re.I)
    keywords = list(
        dict.fromkeys(
            word.lower() for word in words if len(word) > 3 and word.lower() not in COMMON_WORDS
        )
    )[:6]
    negative = bool(
        re.search(r"\b(bad|broken|hate|awful|terrible|worst|angry|fail|failed|annoying)\b", text)
    )
    positive = bool(
        re.search(
            r"\b(good|great|love|best|win|won|happy|amazing|finished|shipped|launched)\b", text
        )
    )
    sarcastic = bool(re.search(r"\b(sure|totally|obviously|of course|yeah right|lol|lmao)\b", text))
    question = "?" in tweet_text
    rhetorical = question and bool(
        re.search(
            r"\b(who could have predicted|what could (?:possibly )?go wrong|"
            r"who saw that coming|somehow)\b",
            text,
        )
    )
    rant = bool(re.search(r"!{2,}|\b(always|never|again|ridiculous|insane)\b", text))
    tone: Tone = (
        "sarcastic"
        if rhetorical
        else "question"
        if question
        else "sarcastic"
        if sarcastic
        else "rant"
        if rant
        else "celebratory"
        if positive
        else "hot-take"
    )
    intent: Intent = (
        "dunking"
        if rhetorical or (negative and (sarcastic or rant))
        else "asking"
        if question
        else "venting"
        if negative
        else "agreement"
        if positive
        else "sharing-opinion"
    )
    anchors = build_caption_anchors(text, keywords)
    target = next((keyword for keyword in keywords if len(keyword) >= 4), "the situation")
    return TweetContext(
        sentiment="negative" if negative else "positive" if positive else "neutral",
        tone=tone,
        topic=infer_topic(text),
        intent=intent,
        intensity=0.75 if rant or sarcastic or rhetorical else 0.45 if question else 0.55,
        reply_style="sharp dunk"
        if intent == "dunking"
        else "exhausted agreement"
        if intent == "venting"
        else "wry reaction",
        ideal_meme_vibe="mocking disbelief"
        if intent == "dunking"
        else "tired acceptance"
        if intent == "venting"
        else "clear reaction image energy",
        joke_target=target,
        social_dynamic="mocking a predictable self-own"
        if intent == "dunking"
        else "joining the complaint"
        if intent == "venting"
        else "reacting to the absurdity",
        humor_angle="the predictable consequence is the joke"
        if intent == "dunking"
        else "everyone is pretending this is normal"
        if intent == "venting"
        else "the unstated contrast is the joke",
        core_claim=re.sub(r"\s+", " ", tweet_text.strip()),
        implied_context="the audience recognizes the unstated consequence",
        comedic_tension="what they expected vs the predictable consequence"
        if intent == "dunking"
        else "what should be normal vs what happened",
        caption_anchors=anchors,
        keywords=keywords if len(keywords) >= 2 else ["tweet", "reaction"],
    )


def build_caption_anchors(text: str, keywords: list[str]) -> list[str]:
    words = re.findall(r"[a-z0-9][a-z0-9_'’-]*", text)
    candidates: list[tuple[str, int]] = []
    for size in (3, 2, 1):
        for index in range(len(words) - size + 1):
            phrase_words = words[index : index + size]
            if any(len(word) < 3 or word in COMMON_WORDS for word in phrase_words):
                continue
            phrase = " ".join(phrase_words)
            score = sum(term_specificity(word) for word in phrase_words)
            if ACTION_WORDS.search(phrase):
                score += 3
            if OUTCOME_WORDS.search(phrase):
                score += 5
            candidates.append((phrase, score))
    candidates.extend((keyword, term_specificity(keyword) + 1) for keyword in keywords)
    ordered = sorted(candidates, key=lambda item: -item[1])
    return list(dict.fromkeys(phrase for phrase, _ in ordered))[:6] or ["tweet", "reaction"]


def term_specificity(term: str) -> int:
    score = 2 if len(term) >= 7 else 1
    if re.search(
        r"prod|dashboard|launch|test|deploy|payment|rewrite|framework|bug|spreadsheet|macro|platform|meeting|calendar|slack|roadmap|deck|migration|agent",
        term,
    ):
        score += 4
    return score


def infer_topic(text: str) -> Topic:
    topics: list[tuple[str, Topic]] = [
        (r"\b(ai|software|app|code|developer|iphone|startup|tech)\b", "tech"),
        (r"\b(stock|market|money|bank|crypto|price|fed)\b", "finance"),
        (r"\b(election|policy|senate|president|government|vote)\b", "politics"),
        (r"\b(game|team|score|nba|nfl|soccer|cricket|sports)\b", "sports"),
        (r"\b(movie|show|music|album|celebrity|streaming)\b", "entertainment"),
        (r"\b(date|friend|family|relationship|partner)\b", "relationships"),
        (r"\b(internet|trend|meme|culture|timeline)\b", "culture"),
    ]
    return next((topic for pattern, topic in topics if re.search(pattern, text)), "other")
