from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

AgentInput = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=12_000),
]
AgentDirection = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=280),
]


class AgentMemeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateMemeOptions(AgentMemeModel):
    direction: AgentDirection | None = None
    count: int = Field(default=1, ge=1, le=5)


class GenerateMemeRequest(AgentMemeModel):
    input: AgentInput
    options: GenerateMemeOptions = Field(default_factory=GenerateMemeOptions)


class GeneratedMeme(AgentMemeModel):
    id: str
    image_url: str
    expires_at: datetime


class GenerateMemeResponse(AgentMemeModel):
    status: Literal["ok", "no_fit"]
    memes: list[GeneratedMeme]
