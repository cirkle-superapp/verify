"""Custom exception hierarchy for the Cirkle Verify Python SDK.

All SDK errors derive from :class:`CirkleError` so callers can catch the
whole family with a single ``except CirkleError`` clause while still being
able to react to specific failure modes (auth, rate limit, server, etc.).
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class CirkleError(Exception):
    """Base class for every error raised by the Cirkle Verify SDK."""

    def __init__(self, message: str, *, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details or {}

    def __str__(self) -> str:  # pragma: no cover - trivial
        if self.code:
            return f"[{self.code}] {self.message}"
        return self.message


class AuthenticationError(CirkleError):
    """API key is missing, malformed, or revoked (HTTP 401)."""


class AuthorizationError(CirkleError):
    """API key is valid but lacks permission for the resource (HTTP 403)."""


class ValidationError(CirkleError):
    """Request body failed server-side validation (HTTP 400)."""


class NotFoundError(CirkleError):
    """The requested resource (verification, certificate, webhook...) does not exist (HTTP 404)."""


class RateLimitError(CirkleError):
    """The API key has exceeded its per-minute request budget (HTTP 429).

    Attributes
    ----------
    retry_after:
        Seconds the client should wait before retrying, parsed from the
        ``Retry-After`` response header. ``None`` when the server did not
        send one.
    """

    def __init__(self, message: str, *, retry_after: Optional[float] = None, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message, code=code or "rate_limited", details=details)
        self.retry_after = retry_after


class ServerError(CirkleError):
    """The Cirkle API returned a 5xx response.

    SDK retries 5xx up to 3 times with exponential backoff before raising
    this. ``status`` is the final HTTP status code observed.
    """

    def __init__(self, message: str, *, status: int, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message, code=code or "server_error", details=details)
        self.status = status


class ApiError(CirkleError):
    """A non-2xx response that does not map to one of the specific subclasses.

    This is the fallback for HTTP statuses outside 400/401/403/404/429/5xx.
    ``status`` is the HTTP status code.
    """

    def __init__(self, message: str, *, status: int, code: Optional[str] = None, details: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(message, code=code, details=details)
        self.status = status


class NetworkError(CirkleError):
    """Transport-level failure — DNS, TCP reset, TLS handshake, timeout, etc."""


class InvalidImageError(CirkleError):
    """An image passed to the SDK could not be loaded or base64-encoded."""


class SignatureVerificationError(CirkleError):
    """An incoming webhook signature did not match the shared secret."""


__all__ = [
    "CirkleError",
    "AuthenticationError",
    "AuthorizationError",
    "ValidationError",
    "NotFoundError",
    "RateLimitError",
    "ServerError",
    "ApiError",
    "NetworkError",
    "InvalidImageError",
    "SignatureVerificationError",
]
