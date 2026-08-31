from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from memedrop_api.services.meme_renderer import (
    MAX_IMAGE_DIMENSION,
    MAX_SOURCE_BYTES,
    MemeRenderError,
    render_meme,
)


def source_image(*, width: int = 320, height: int = 240, format: str = "PNG") -> bytes:
    output = BytesIO()
    Image.new("RGB", (width, height), "#1463A5").save(output, format=format)
    return output.getvalue()


def test_renders_deterministic_multi_region_png_with_catalog_rules() -> None:
    overlay = {
        "regions": [
            {
                "id": "setup",
                "text": "release day",
                "text_transform": "uppercase",
                "x": 0.05,
                "y": 0.04,
                "width": 0.9,
                "height": 0.3,
                "align": "left",
                "valign": "top",
                "padding_ratio": 0.02,
                "max_lines": 2,
                "max_chars": 40,
                "font": {
                    "min_size": 12,
                    "max_size": 34,
                    "fill_color": "#ffffff",
                    "stroke_color": "#000000",
                    "stroke_ratio": 0.1,
                    "line_height_ratio": 1.1,
                },
            },
            {
                "id": "punchline",
                "text": "nothing can go wrong",
                "text_transform": "mocking",
                "x": 0.1,
                "y": 0.68,
                "width": 0.8,
                "height": 0.28,
                "align": "right",
                "valign": "bottom",
                "max_lines": 2,
                "max_chars": 80,
                "font": {"min_size": 10, "max_size": 30, "stroke_ratio": 0},
            },
        ]
    }

    first = render_meme(source_image(), overlay, output_format="PNG")
    second = render_meme(source_image(), overlay, output_format="PNG")

    assert first == second
    assert first.content_type == "image/png"
    assert (first.width, first.height) == (320, 240)
    with Image.open(BytesIO(first.content)) as rendered:
        assert rendered.format == "PNG"
        background = (20, 99, 165, 255)
        top_region = rendered.crop((16, 9, 304, 82))
        bottom_region = rendered.crop((32, 163, 288, 231))
        assert any(pixel != background for pixel in top_region.get_flattened_data())
        assert any(pixel != background for pixel in bottom_region.get_flattened_data())


def test_returns_ready_to_serve_webp_by_default() -> None:
    rendered = render_meme(
        source_image(format="JPEG"),
        {
            "regions": [
                {
                    "text": "ship it",
                    "x": 0,
                    "y": 0,
                    "width": 1,
                    "height": 0.3,
                    "max_lines": 1,
                    "max_chars": 20,
                }
            ]
        },
    )

    assert rendered.content_type == "image/webp"
    with Image.open(BytesIO(rendered.content)) as image:
        assert image.format == "WEBP"
        assert image.size == (320, 240)


@pytest.mark.parametrize(
    ("source_text", "transform", "max_chars", "equivalent_text"),
    [
        ("ship it beyond", "uppercase", 7, "SHIP IT"),
        ("nothing", "mocking", 20, "NoThInG"),
    ],
)
def test_applies_text_transform_after_character_limit(
    source_text: str, transform: str, max_chars: int, equivalent_text: str
) -> None:
    def overlay(text: str, text_transform: str, character_limit: int) -> dict[str, object]:
        return {
            "regions": [
                {
                    "text": text,
                    "text_transform": text_transform,
                    "x": 0,
                    "y": 0,
                    "width": 1,
                    "height": 0.5,
                    "max_chars": character_limit,
                }
            ]
        }

    transformed = render_meme(
        source_image(), overlay(source_text, transform, max_chars), output_format="PNG"
    )
    equivalent = render_meme(
        source_image(), overlay(equivalent_text, "none", 20), output_format="PNG"
    )

    assert transformed.content == equivalent.content


@pytest.mark.parametrize(
    "overlay",
    [
        {},
        {"regions": []},
        {"regions": [{"text": "", "x": 0, "y": 0, "width": 1, "height": 1}]},
        {"regions": [{"text": "caption", "x": 0.8, "y": 0, "width": 0.3, "height": 1}]},
        {
            "regions": [
                {
                    "text": "caption",
                    "x": 0,
                    "y": 0,
                    "width": 1,
                    "height": 1,
                    "align": "sideways",
                }
            ]
        },
    ],
)
def test_rejects_missing_empty_or_malformed_regions(overlay: dict[str, object]) -> None:
    with pytest.raises(MemeRenderError):
        render_meme(source_image(), overlay)


def test_rejects_malformed_or_unsupported_images() -> None:
    overlay = {"regions": [{"text": "caption", "x": 0, "y": 0, "width": 1, "height": 1}]}

    with pytest.raises(MemeRenderError, match="malformed or unsupported"):
        render_meme(b"not an image", overlay)
    with pytest.raises(MemeRenderError, match="format is not supported"):
        render_meme(source_image(format="BMP"), overlay)


def test_rejects_oversized_source_bytes_and_dimensions() -> None:
    overlay = {"regions": [{"text": "caption", "x": 0, "y": 0, "width": 1, "height": 1}]}

    with pytest.raises(MemeRenderError, match="byte limit"):
        render_meme(b"x" * (MAX_SOURCE_BYTES + 1), overlay)
    with pytest.raises(MemeRenderError, match="dimensions exceed"):
        render_meme(source_image(width=MAX_IMAGE_DIMENSION + 1, height=1), overlay)
