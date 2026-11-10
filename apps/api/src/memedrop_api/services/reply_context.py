"""Bounded reply context stays transient and separate from operational feedback."""

from __future__ import annotations

import json

from memedrop_api.schemas import ReplyContext


def reply_source_text(target: str, context: ReplyContext | None) -> str:
    if context is None:
        return target
    # Labels are serialized, so source text cannot masquerade as another field.
    return json.dumps(
        {
            "reply_target": target,
            "original_post": context.model_dump(),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
