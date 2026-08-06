from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageOps

THUMBNAIL_MAX_DIMENSION = 480
THUMBNAIL_CONTENT_TYPE = "image/webp"


def make_thumbnail(image_bytes: bytes, *, max_dimension: int = THUMBNAIL_MAX_DIMENSION) -> bytes:
    """Return an oriented WebP thumbnail without upscaling the original image."""
    if max_dimension <= 0:
        raise ValueError("max_dimension must be positive")

    with Image.open(BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source)
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        output = BytesIO()
        image.save(output, format="WEBP", quality=82, method=6)
    return output.getvalue()
