from memedrop_api.services.context_analyzer import heuristic_tweet_context


def test_rhetorical_failure_question_is_sarcastic_dunk() -> None:
    context = heuristic_tweet_context(
        "We skipped tests, deployed Friday night, and the payment flow exploded. "
        "Who could have predicted this?"
    )

    assert context.tone == "sarcastic"
    assert context.intent == "dunking"
    assert any("payment flow" in anchor for anchor in context.caption_anchors)
    assert any("skipped tests" in anchor for anchor in context.caption_anchors)


def test_context_classifies_topic_and_positive_tone() -> None:
    context = heuristic_tweet_context(
        "The software migration finished, the launch shipped, and everything is great."
    )

    assert context.topic == "tech"
    assert context.sentiment == "positive"
    assert context.tone == "celebratory"
    assert context.intent == "agreement"


def test_context_has_safe_fallback_keywords_for_empty_semantics() -> None:
    context = heuristic_tweet_context("ok")

    assert context.keywords == ["tweet", "reaction"]
    assert context.joke_target == "the situation"


def test_quantity_comparison_extracts_the_actual_target_and_caption_anchors() -> None:
    context = heuristic_tweet_context(
        "Google hired 33 students from IIT Patna 💀 Bro even TCS does not hire that many."
    )

    assert context.tone == "sarcastic"
    assert context.intent == "dunking"
    assert context.joke_target == "TCS"
    assert context.comedic_tension == (
        "an unexpectedly large result vs the supposedly stronger benchmark"
    )
    assert "hired 33 students" in context.caption_anchors
