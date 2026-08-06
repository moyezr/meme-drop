from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, StringConstraints, model_validator

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SaveMemeRequest(StrictModel):
    image_url: AnyHttpUrl = Field(max_length=2048)
    source_tweet_id: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=128),
        ]
        | None
    ) = None


class UpdateMemeRequest(StrictModel):
    user_name: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
        ]
        | None
    ) = None
    user_tags: (
        list[
            Annotated[
                str,
                StringConstraints(strip_whitespace=True, min_length=1, max_length=40),
            ]
        ]
        | None
    ) = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def require_update(self) -> UpdateMemeRequest:
        if self.user_name is None and self.user_tags is None:
            raise ValueError("No fields to update")
        return self


class TweetContextInput(StrictModel):
    sentiment: Literal["positive", "negative", "neutral"] | None = None
    tone: (
        Literal[
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
        | None
    ) = None
    topic: (
        Literal[
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
        | None
    ) = None
    intent: (
        Literal[
            "counter-argument",
            "agreement",
            "sharing-opinion",
            "venting",
            "asking",
            "celebrating",
            "dunking",
            "self-deprecating",
        ]
        | None
    ) = None
    intensity: float | None = Field(default=None, ge=0, le=1)
    reply_style: str | None = Field(default=None, max_length=80)
    ideal_meme_vibe: str | None = Field(default=None, max_length=180)
    joke_target: str | None = Field(default=None, max_length=120)
    social_dynamic: str | None = Field(default=None, max_length=160)
    humor_angle: str | None = Field(default=None, max_length=180)
    keywords: (
        list[
            Annotated[
                str,
                StringConstraints(strip_whitespace=True, min_length=1, max_length=40),
            ]
        ]
        | None
    ) = Field(default=None, max_length=6)


USAGE_FEEDBACK_ACTIONS = (
    "suggested",
    "shown",
    "clicked",
    "used",
    "inserted",
    "saved",
    "dismissed",
)
UsageFeedbackAction = Literal[
    "suggested", "shown", "clicked", "used", "inserted", "saved", "dismissed"
]


class UsageRequest(StrictModel):
    meme_id: UUID
    action: UsageFeedbackAction
    tweet_context: TweetContextInput = Field(default_factory=TweetContextInput)
    source: Literal["user", "global"] | None = None


class UsageBatchRequest(StrictModel):
    events: list[UsageRequest] = Field(min_length=1, max_length=50)


class AutoTagResult(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    emotion: Literal["sarcastic", "absurdist", "wholesome", "savage", "confused", "celebratory"]
    format_type: Literal["reaction_image", "text_overlay"]
    use_cases: list[str] = Field(min_length=2, max_length=4)
    example_contexts: list[str] = Field(min_length=2, max_length=4)
    vibes: list[str] = Field(min_length=1, max_length=4)
    is_evergreen: bool


class TweetContext(StrictModel):
    sentiment: Literal["positive", "negative", "neutral"]
    tone: Literal[
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
    topic: Literal[
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
    intent: Literal[
        "counter-argument",
        "agreement",
        "sharing-opinion",
        "venting",
        "asking",
        "celebrating",
        "dunking",
        "self-deprecating",
    ]
    intensity: float = Field(ge=0, le=1)
    reply_style: str
    ideal_meme_vibe: str
    joke_target: str
    social_dynamic: str
    humor_angle: str
    core_claim: str
    implied_context: str
    comedic_tension: str
    caption_anchors: list[str]
    keywords: list[str]


TweetText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=280,
    ),
]


class SuggestRequest(StrictModel):
    tweet_text: TweetText
    limit: int | None = Field(default=None, ge=1, le=10)
    refresh: bool = False
    cache_key: str | None = Field(default=None, min_length=1, max_length=240)


class CaptionRequest(StrictModel):
    tweet_text: TweetText
    meme_id: UUID
