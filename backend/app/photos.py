"""Decode and re-encode food photos; never trust extensions or client MIME types."""
from io import BytesIO
import warnings
from PIL import Image, ImageOps, UnidentifiedImageError
from fastapi import HTTPException

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 16_000_000


def normalize_photo(raw: bytes) -> bytes:
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Choose a photo under 5 MB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Unsupported image")
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError("Image dimensions too large")
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.thumbnail((1600, 1600))
                # Creating a fresh image removes EXIF, GPS and arbitrary metadata.
                clean = Image.new("RGB", image.size)
                clean.paste(image)
                output = BytesIO()
                clean.save(output, format="JPEG", quality=85, optimize=True)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(status_code=422, detail="Choose a valid JPEG, PNG or WebP photo, up to 16 megapixels") from error
