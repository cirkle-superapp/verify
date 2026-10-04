"""Helper utilities for the Cirkle Verify Python SDK.

This module is intentionally framework-free — it only depends on the
Python standard library so callers can install :mod:`cirkle_verify`
without dragging in Pillow/numpy/httpx just to encode an image.

The functions here are split into three groups:

1. **Image helpers** — :func:`encode_image_path`, :func:`encode_image_bytes`.
2. **HMAC webhook helpers** — :func:`compute_signature`,
   :func:`verify_signature`.
3. **HTTP helpers** — :func:`normalize_base_url`, :func:`to_query_string`.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
import time
from typing import Optional, Union
from urllib.parse import urlencode

from .exceptions import InvalidImageError, SignatureVerificationError

# ─── Image helpers ──────────────────────────────────────────────────


_MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".heic": "image/heic",
    ".heif": "image/heif",
}


def _guess_mime(path: str) -> str:
    """Best-effort MIME detection from the file extension."""
    _, ext = os.path.splitext(path)
    return _MIME_BY_EXT.get(ext.lower(), "application/octet-stream")


def encode_image_bytes(data: bytes, mime: Optional[str] = None) -> str:
    """Encode raw image bytes to a ``data:`` URL ready for the Cirkle API.

    Parameters
    ----------
    data:
        Raw bytes of an image file (JPEG, PNG, WEBP, ...).
    mime:
        Optional explicit MIME type. If omitted, defaults to ``image/jpeg``.
    """
    if not isinstance(data, (bytes, bytearray)):
        raise InvalidImageError("encode_image_bytes expects bytes/bytearray input")
    if not data:
        raise InvalidImageError("image bytes are empty")
    mime = mime or "image/jpeg"
    b64 = base64.b64encode(bytes(data)).decode("ascii")
    return f"data:{mime};base64,{b64}"


def encode_image_path(path: str, mime: Optional[str] = None) -> str:
    """Load an image from disk and encode it to a ``data:`` URL.

    Parameters
    ----------
    path:
        Filesystem path to the image (e.g. ``"id_card.jpg"``).
    mime:
        Optional explicit MIME type. If omitted, the MIME is guessed from
        the file extension and falls back to ``image/jpeg``.

    Raises
    ------
    InvalidImageError:
        The file does not exist, is empty, or cannot be read.
    """
    if not path or not isinstance(path, str):
        raise InvalidImageError("image path must be a non-empty string")
    if not os.path.isfile(path):
        raise InvalidImageError(f"image file not found: {path}")
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        raise InvalidImageError(f"failed to read image {path}: {e}") from e
    if not data:
        raise InvalidImageError(f"image file is empty: {path}")
    return encode_image_bytes(data, mime or _guess_mime(path))


def normalize_image_input(image: Union[str, bytes], *, allow_data_url: bool = True) -> str:
    """Coerce a path/bytes/data-URL input to a ``data:`` URL.

    - ``str`` starting with ``data:`` → returned as-is (when allowed).
    - ``str`` not starting with ``data:`` → treated as a file path and
      encoded with :func:`encode_image_path`.
    - ``bytes`` → encoded with :func:`encode_image_bytes`.
    """
    if isinstance(image, (bytes, bytearray)):
        return encode_image_bytes(bytes(image))
    if isinstance(image, str):
        if image.startswith("data:") and allow_data_url:
            return image
        if image.startswith("data:"):
            raise InvalidImageError("data: URLs are not allowed in this context")
        return encode_image_path(image)
    raise InvalidImageError(f"unsupported image input type: {type(image).__name__}")


# ─── HMAC-SHA256 webhook helpers ───────────────────────────────────


def compute_signature(payload: Union[bytes, str, dict], secret: str) -> str:
    """Compute the HMAC-SHA256 hex signature for a webhook payload.

    The payload is JSON-serialised when given as a dict. ``bytes`` are
    signed as-is (UTF-8 for ``str``). The return value is the **raw hex**
    digest — wrap it with :func:`format_signature_header` to produce the
    ``sha256=<hex>`` form the Cirkle API sends.
    """
    if not secret:
        raise SignatureVerificationError("secret is required to compute a signature")
    if isinstance(payload, dict):
        body = _canonical_json(payload).encode("utf-8")
    elif isinstance(payload, str):
        body = payload.encode("utf-8")
    elif isinstance(payload, (bytes, bytearray)):
        body = bytes(payload)
    else:
        raise SignatureVerificationError(
            f"unsupported payload type for signature: {type(payload).__name__}"
        )
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def format_signature_header(hex_digest: str) -> str:
    """Wrap a hex digest as the ``sha256=<hex>`` header value."""
    return f"sha256={hex_digest}"


def verify_signature(
    payload: Union[bytes, str, dict],
    secret: str,
    header_value: str,
    *,
    tolerance_seconds: Optional[float] = None,
) -> bool:
    """Verify an incoming webhook signature in constant time.

    Parameters
    ----------
    payload:
        The raw request body. Pass a ``str``/``bytes`` for exact-byte
        verification (recommended), or a ``dict`` to canonicalise the JSON
        yourself. Mixing dict + the server's signed-raw-body risks a
        mismatch — prefer raw.
    secret:
        The shared secret registered with the endpoint.
    header_value:
        The value of the ``X-Cirkle-Signature`` header (``sha256=<hex>``).
    tolerance_seconds:
        Optional replay-window — currently advisory; reserved for future
        timestamp-based anti-replay.

    Raises
    ------
    SignatureVerificationError:
        If the header is malformed. Returns ``False`` for a mismatch
        (caller decides whether to raise).
    """
    if not secret:
        raise SignatureVerificationError("secret is required to verify a signature")
    if not header_value:
        raise SignatureVerificationError("signature header is empty")
    if not header_value.startswith("sha256="):
        raise SignatureVerificationError(
            "signature header must be of the form 'sha256=<hex>'"
        )
    expected_hex = header_value[len("sha256="):].strip()
    if not expected_hex:
        raise SignatureVerificationError("signature header has no hex digest")
    try:
        expected = binascii.unhexlify(expected_hex)
    except (binascii.Error, ValueError) as e:
        raise SignatureVerificationError(f"signature hex decode failed: {e}") from e
    actual = compute_signature(payload, secret)
    actual_bytes = binascii.unhexlify(actual)
    if len(expected) != len(actual_bytes):
        return False
    # constant-time compare
    if not hmac.compare_digest(expected, actual_bytes):
        return False
    _ = tolerance_seconds  # reserved for future timestamp check
    return True


def _canonical_json(obj: dict) -> str:
    """Deterministic JSON serialisation — sorted keys, no whitespace.

    Mirrors the canonicaliser used by the Cirkle server when signing
    webhook payloads so a dict-input verify round-trips the same bytes.
    """
    return _canonical(obj)


def _canonical(value):  # type: ignore[no-untyped-def]
    if isinstance(value, dict):
        return "{" + ",".join(
            f'"{k}":{_canonical(value[k])}' for k in sorted(value.keys())
        ) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_canonical(v) for v in value) + "]"
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    # string — escape per JSON
    s = str(value).replace("\\", "\\\\").replace('"', '\\"')
    s = s.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return f'"{s}"'


# ─── HTTP helpers ──────────────────────────────────────────────────


def normalize_base_url(url: str) -> str:
    """Strip trailing slashes from the base URL.

    A trailing slash would otherwise produce double-slash paths
    (``https://x//api/v1/verify/document``) which Next.js rejects.
    """
    if not url:
        return "https://cirkle-verify.vercel.app"
    return url.rstrip("/")


def to_query_string(params: Optional[dict]) -> str:
    """Render a dict as a URL query string (without the leading ``?``)."""
    if not params:
        return ""
    return urlencode({k: v for k, v in params.items() if v is not None})


def now_ms() -> int:
    """Current epoch time in milliseconds (used for retry backoff)."""
    return int(time.time() * 1000)


__all__ = [
    "encode_image_bytes",
    "encode_image_path",
    "normalize_image_input",
    "compute_signature",
    "format_signature_header",
    "verify_signature",
    "normalize_base_url",
    "to_query_string",
    "now_ms",
]
