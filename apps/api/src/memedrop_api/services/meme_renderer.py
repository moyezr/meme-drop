from __future__ import annotations

import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from typing import Any, Literal, cast

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_DIMENSION = 4_096
MAX_IMAGE_PIXELS = 16_000_000
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
MAX_REGIONS = 8

_SUPPORTED_SOURCE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
_DEFAULT_FILL = "#FFFFFF"
_DEFAULT_STROKE = "#000000"
_DEFAULT_STROKE_RATIO = 0.12
_DEFAULT_LINE_HEIGHT_RATIO = 1.08
_DEFAULT_PADDING_RATIO = 0.055


class MemeRenderError(ValueError):
    """Raised when source media or catalog overlay data cannot be rendered safely."""


@dataclass(frozen=True, slots=True)
class RenderedMeme:
    content: bytes
    content_type: str
    width: int
    height: int


@dataclass(frozen=True, slots=True)
class _FontStyle:
    min_size: int
    max_size: int
    fill: str
    stroke: str
    stroke_ratio: float
    line_height_ratio: float


@dataclass(frozen=True, slots=True)
class _Region:
    text: str
    x: float
    y: float
    width: float
    height: float
    align: Literal["left", "center", "right"]
    valign: Literal["top", "middle", "bottom"]
    padding_ratio: float
    max_lines: int
    font_scale: float
    font: _FontStyle


def render_meme(
    source_image: bytes,
    tailored_overlay: Mapping[str, Any],
    *,
    output_format: Literal["WEBP", "PNG"] = "WEBP",
) -> RenderedMeme:
    """Render catalog-owned caption geometry into a bounded, ready-to-serve image.

    This is deliberately synchronous and side-effect free so callers can move it to a
    worker thread. The repository currently distributes browser fonts only through the
    extension build, not as API package data. Pillow's embedded scalable font is therefore
    the portable fallback for Impact, Anton, and Inter. Layout, transform, color, stroke,
    line-height, alignment, and clipping still follow ``packages/shared/overlay-renderer``.
    Bundling server font files later can improve glyph parity without changing this API.
    """
    if not isinstance(source_image, bytes) or not source_image:
        raise MemeRenderError("source image must be non-empty bytes")
    if len(source_image) > MAX_SOURCE_BYTES:
        raise MemeRenderError("source image exceeds the byte limit")
    if output_format not in {"WEBP", "PNG"}:
        raise MemeRenderError("output format must be WEBP or PNG")

    regions = _parse_overlay(tailored_overlay)
    image = _decode_image(source_image)
    try:
        canvas = image.convert("RGBA")
        for region in regions:
            _draw_region(canvas, region)

        output = BytesIO()
        if output_format == "WEBP":
            # Explicit encoding values make identical inputs deterministic within a
            # supported Pillow/libwebp runtime and avoid carrying source metadata.
            canvas.save(output, format="WEBP", quality=88, method=6, exact=True)
            content_type = "image/webp"
        else:
            canvas.save(output, format="PNG", optimize=False, compress_level=9)
            content_type = "image/png"
        content = output.getvalue()
        if len(content) > MAX_OUTPUT_BYTES:
            raise MemeRenderError("rendered image exceeds the byte limit")
        return RenderedMeme(
            content=content,
            content_type=content_type,
            width=canvas.width,
            height=canvas.height,
        )
    finally:
        image.close()


def _decode_image(source_image: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(source_image)) as opened:
            if opened.format not in _SUPPORTED_SOURCE_FORMATS:
                raise MemeRenderError("source image format is not supported")
            if getattr(opened, "n_frames", 1) != 1:
                raise MemeRenderError("animated images are not supported")
            _check_dimensions(opened.width, opened.height)
            opened.load()
            oriented = ImageOps.exif_transpose(opened)
            _check_dimensions(oriented.width, oriented.height)
            return oriented.copy()
    except MemeRenderError:
        raise
    except (
        Image.DecompressionBombError,
        UnidentifiedImageError,
        OSError,
        SyntaxError,
        ValueError,
    ) as exc:
        raise MemeRenderError("source image is malformed or unsupported") from exc


def _check_dimensions(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise MemeRenderError("source image has invalid dimensions")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise MemeRenderError("source image dimensions exceed the limit")
    if width * height > MAX_IMAGE_PIXELS:
        raise MemeRenderError("source image pixel count exceeds the limit")


def _parse_overlay(overlay: Mapping[str, Any]) -> list[_Region]:
    if not isinstance(overlay, Mapping):
        raise MemeRenderError("tailored overlay must be a mapping")
    raw_regions = overlay.get("regions")
    if (
        not isinstance(raw_regions, Sequence)
        or isinstance(raw_regions, (str, bytes, bytearray))
        or not raw_regions
    ):
        raise MemeRenderError("tailored overlay must contain regions")
    if len(raw_regions) > MAX_REGIONS:
        raise MemeRenderError("tailored overlay contains too many regions")
    return [_parse_region(raw) for raw in raw_regions]


def _parse_region(raw: object) -> _Region:
    if not isinstance(raw, Mapping):
        raise MemeRenderError("overlay region must be a mapping")

    raw_text = raw.get("text")
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise MemeRenderError("overlay region text must be non-empty")
    max_chars = _bounded_int(raw.get("max_chars"), default=120, minimum=1, maximum=500)
    # The shared renderer applies the character limit before transforming or wrapping.
    text = raw_text.strip()[:max_chars]
    transform = raw.get("text_transform", "uppercase")
    if transform == "uppercase":
        text = text.upper()
    elif transform == "mocking":
        text = _mocking_case(text)
    elif transform != "none":
        raise MemeRenderError("overlay region has an invalid text transform")
    if not text:
        raise MemeRenderError("overlay region text must be non-empty")

    x = _normalized_number(raw.get("x"), "x")
    y = _normalized_number(raw.get("y"), "y")
    width = _normalized_number(raw.get("width"), "width", positive=True)
    height = _normalized_number(raw.get("height"), "height", positive=True)
    if x + width > 1 or y + height > 1:
        raise MemeRenderError("overlay region must fit within normalized image bounds")

    align = raw.get("align", "center")
    if align not in {"left", "center", "right"}:
        raise MemeRenderError("overlay region has an invalid horizontal alignment")
    valign = raw.get("valign", "middle")
    if valign not in {"top", "middle", "bottom"}:
        raise MemeRenderError("overlay region has an invalid vertical alignment")

    raw_font = raw.get("font", {})
    if not isinstance(raw_font, Mapping):
        raise MemeRenderError("overlay region font must be a mapping")
    min_size = _bounded_int(raw_font.get("min_size"), default=12, minimum=10, maximum=256)
    max_size = _bounded_int(raw_font.get("max_size"), default=52, minimum=10, maximum=256)
    if min_size > max_size:
        raise MemeRenderError("overlay region font minimum exceeds maximum")

    return _Region(
        text=text,
        x=x,
        y=y,
        width=width,
        height=height,
        align=cast(Literal["left", "center", "right"], align),
        valign=cast(Literal["top", "middle", "bottom"], valign),
        padding_ratio=_bounded_float(
            raw.get("padding_ratio"), default=_DEFAULT_PADDING_RATIO, minimum=0, maximum=0.2
        ),
        max_lines=_bounded_int(raw.get("max_lines"), default=4, minimum=1, maximum=12),
        font_scale=_bounded_float(raw.get("font_scale"), default=1, minimum=0.25, maximum=4),
        font=_FontStyle(
            min_size=min_size,
            max_size=max_size,
            fill=_color(raw_font.get("fill_color"), _DEFAULT_FILL),
            stroke=_color(raw_font.get("stroke_color"), _DEFAULT_STROKE),
            stroke_ratio=_bounded_float(
                raw_font.get("stroke_ratio"),
                default=_DEFAULT_STROKE_RATIO,
                minimum=0,
                maximum=0.25,
            ),
            line_height_ratio=_bounded_float(
                raw_font.get("line_height_ratio"),
                default=_DEFAULT_LINE_HEIGHT_RATIO,
                minimum=0.8,
                maximum=1.5,
            ),
        ),
    )


def _draw_region(canvas: Image.Image, region: _Region) -> None:
    left = round(region.x * canvas.width)
    top = round(region.y * canvas.height)
    right = round((region.x + region.width) * canvas.width)
    bottom = round((region.y + region.height) * canvas.height)
    region_width = max(1, right - left)
    region_height = max(1, bottom - top)
    padding = (
        0
        if region.padding_ratio == 0
        else max(4, round(min(region_width, region_height) * region.padding_ratio))
    )
    safe_width = max(8, region_width - padding * 2)
    safe_height = max(8, region_height - padding * 2)

    font_size, lines = _fit_text(region, safe_width, safe_height)
    font = _portable_font(font_size)
    line_height = font_size * region.font.line_height_ratio
    total_height = min(line_height * len(lines), safe_height)
    if region.valign == "top":
        first_y = line_height / 2
    elif region.valign == "bottom":
        first_y = safe_height - total_height + line_height / 2
    else:
        first_y = safe_height / 2 - total_height / 2 + line_height / 2

    if region.align == "left":
        text_x, anchor = 0.0, "lm"
    elif region.align == "right":
        text_x, anchor = float(safe_width), "rm"
    else:
        text_x, anchor = safe_width / 2, "mm"

    clipped = Image.new("RGBA", (safe_width, safe_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(clipped)
    stroke_width = (
        0
        if region.font.stroke_ratio == 0
        else max(2, round(font_size * region.font.stroke_ratio))
    )
    for index, line in enumerate(lines):
        draw.text(
            (text_x, first_y + index * line_height),
            line,
            font=font,
            fill=region.font.fill,
            stroke_fill=region.font.stroke,
            stroke_width=stroke_width,
            anchor=anchor,
        )
    canvas.alpha_composite(clipped, (left + padding, top + padding))


def _fit_text(region: _Region, width: int, height: int) -> tuple[int, list[str]]:
    words = region.text.split()
    longest = max((len(word) for word in words), default=1)
    target_lines = max(1, min(4, math.ceil(len(region.text) / 18)))
    rough_width = width / max(longest * 0.72, len(region.text) * 0.24)
    rough_height = height / (target_lines * region.font.line_height_ratio)
    initial = min(region.font.max_size, max(region.font.min_size, rough_width, rough_height))
    font_size = round(
        min(region.font.max_size, max(region.font.min_size, initial * region.font_scale))
    )

    while font_size > region.font.min_size:
        lines, _ = _wrap_text(region.text, width, font_size, region.max_lines)
        if (
            len(lines) * font_size * region.font.line_height_ratio <= height
            and all(_text_width(line, font_size) <= width for line in lines)
        ):
            break
        font_size -= 1
    return font_size, _wrap_text(region.text, width, font_size, region.max_lines)[0]


def _wrap_text(text: str, max_width: int, font_size: int, max_lines: int) -> tuple[list[str], bool]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        for piece in _break_word(word, max_width, font_size):
            candidate = f"{current} {piece}" if current else piece
            if _text_width(candidate, font_size) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = piece
    if current:
        lines.append(current)
    if len(lines) <= max_lines:
        return lines, False

    visible = lines[:max_lines]
    last = visible[-1]
    while len(last) > 1 and _text_width(f"{last}...", font_size) > max_width:
        last = last[:-1].strip()
    visible[-1] = f"{last}..." if last else "..."
    return visible, True


def _break_word(word: str, max_width: int, font_size: int) -> list[str]:
    if _text_width(word, font_size) <= max_width:
        return [word]
    pieces: list[str] = []
    current = ""
    for character in word:
        candidate = f"{current}{character}"
        if not current or _text_width(candidate, font_size) <= max_width:
            current = candidate
        else:
            pieces.append(current)
            current = character
    if current:
        pieces.append(current)
    return pieces


def _text_width(text: str, font_size: int) -> float:
    left, _, right, _ = _portable_font(font_size).getbbox(text)
    return float(right - left)


@lru_cache(maxsize=256)
def _portable_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    # load_default(size=...) uses Pillow's embedded Aileron face, so rendering never
    # depends on a host font directory or a request-time font download.
    return ImageFont.load_default(size=font_size)


def _mocking_case(text: str) -> str:
    upper = False
    transformed: list[str] = []
    for character in text.lower():
        if "a" <= character <= "z":
            upper = not upper
            transformed.append(character.upper() if upper else character)
        else:
            transformed.append(character)
    return "".join(transformed)


def _normalized_number(value: object, field: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MemeRenderError(f"overlay region {field} must be a number")
    number = float(value)
    minimum = 0 if not positive else 0.000_001
    if not math.isfinite(number) or number < minimum or number > 1:
        raise MemeRenderError(f"overlay region {field} must be normalized")
    return number


def _bounded_int(value: object, *, default: int, minimum: int, maximum: int) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise MemeRenderError("overlay region integer option is out of bounds")
    return value


def _bounded_float(value: object, *, default: float, minimum: float, maximum: float) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MemeRenderError("overlay region numeric option must be a number")
    number = float(value)
    if not math.isfinite(number) or not minimum <= number <= maximum:
        raise MemeRenderError("overlay region numeric option is out of bounds")
    return number


def _color(value: object, default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise MemeRenderError("overlay region color must be a six-digit hex color")
    return value.upper()
