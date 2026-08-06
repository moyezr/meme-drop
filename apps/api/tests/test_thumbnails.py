from __future__ import annotations

from io import BytesIO

from PIL import Image

from memedrop_api.services.thumbnails import make_thumbnail


def encoded_image(*, size: tuple[int, int], image_format: str = "PNG") -> bytes:
    image = Image.new("RGB", size, color=(40, 120, 220))
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def test_make_thumbnail_limits_the_longest_edge_and_returns_webp() -> None:
    thumbnail = make_thumbnail(encoded_image(size=(1200, 600)))

    with Image.open(BytesIO(thumbnail)) as image:
        assert image.format == "WEBP"
        assert image.size == (480, 240)


def test_make_thumbnail_does_not_upscale_small_images() -> None:
    thumbnail = make_thumbnail(encoded_image(size=(160, 90)))

    with Image.open(BytesIO(thumbnail)) as image:
        assert image.size == (160, 90)


def test_make_thumbnail_applies_exif_orientation_before_sizing() -> None:
    image = Image.new("RGB", (100, 300), color=(40, 120, 220))
    exif = Image.Exif()
    exif[274] = 6
    source = BytesIO()
    image.save(source, format="JPEG", exif=exif)

    thumbnail = make_thumbnail(source.getvalue())

    with Image.open(BytesIO(thumbnail)) as result:
        assert result.size == (300, 100)
