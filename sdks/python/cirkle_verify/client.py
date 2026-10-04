"""CirkleVerify client — sync + async, retry-aware, rate-limit-aware.

The client is the only object most users will need to interact with. It
implements every public API method (``verify_document``,
``check_liveness``, ``face_match``, ``validate_id``, ``parse_mrz``,
``register_webhook``, ``get_certificate``, ``export_data``) with both a
synchronous entry point and an async twin (``verify_document_async``,
``check_liveness_async``, ...) so callers can pick whichever fits their
runtime.

Design notes
------------
* **HTTP layer** — uses :mod:`urllib` from the standard library for the
  sync path and :mod:`httpx` (when installed) for the async path. The
  SDK degrades gracefully: if ``httpx`` is missing, the async methods
  raise a clear :class:`RuntimeError` instead of crashing on import.
* **Retries** — 5xx responses are retried up to 3 times with exponential
  backoff (250ms → 500ms → 1000ms). 4xx responses are never retried.
* **Rate limits** — HTTP 429 with a ``Retry-After`` header is honoured
  by sleeping for the requested duration and retrying the request once.
* **Auth** — the API key is sent as ``Authorization: Bearer <key>`` and
  also mirrored as ``X-API-Key: <key>`` so the server can pick whichever
  extractor it prefers.
* **Webhooks** — the client does **not** deliver webhooks (the server
  does that). It only *registers* them and verifies incoming signatures
  via :func:`cirkle_verify.utils.verify_signature`.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Sequence, Union

from .exceptions import (
    ApiError,
    AuthenticationError,
    AuthorizationError,
    CirkleError,
    NetworkError,
    NotFoundError,
    RateLimitError,
    ServerError,
    ValidationError,
)
from .models import (
    Certificate,
    FaceMatchResult,
    GdprExport,
    IdValidationResult,
    LivenessResult,
    MrzParseResult,
    VerificationResult,
    WebhookEndpoint,
)
from .utils import (
    compute_signature,
    format_signature_header,
    normalize_base_url,
    normalize_image_input,
    to_query_string,
    verify_signature,
)

__all__ = ["CirkleVerify", "AsyncCirkleVerify"]

DEFAULT_BASE_URL = "https://cirkle-verify.vercel.app"
DEFAULT_TIMEOUT = 60.0
MAX_RETRIES = 3
BACKOFF_BASE_MS = 250

# Methods that are *expected* to take a long time (OCR / liveness). The
# SDK bumps the default timeout for these so callers don't have to.
_LONG_METHOD_PATHS = {
    "/api/verify/document",
    "/api/verify/liveness",
    "/api/verify/face-match",
    "/api/v1/verify/document",
    "/api/v1/verify/liveness",
    "/api/v1/verify/face-match",
}


class CirkleVerify:
    """Synchronous Cirkle Verify API client.

    Parameters
    ----------
    api_key:
        The Cirkle API key (``cvk_...``). Required.
    base_url:
        Override the API root. Defaults to the public production endpoint.
        Use ``http://localhost:3000`` for local development.
    timeout:
        Per-request timeout in seconds (default 60s, raised automatically
        to 120s for long-running endpoints).
    max_retries:
        Maximum number of 5xx retries (default 3).
    user_agent:
        Override the ``User-Agent`` header.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = MAX_RETRIES,
        user_agent: str = "cirkle-verify-python/1.0.0",
    ) -> None:
        if not api_key or not isinstance(api_key, str):
            raise AuthenticationError("api_key is required (e.g. 'cvk_...')")
        self.api_key = api_key
        self.base_url = normalize_base_url(base_url)
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self.user_agent = user_agent

    # ─── Public API methods ───────────────────────────────────────

    def verify_document(
        self,
        image_path: Optional[str] = None,
        *,
        image: Optional[Union[str, bytes]] = None,
        doc_type: str = "national_id",
        country: Optional[str] = None,
        back_image: Optional[Union[str, bytes]] = None,
        back_image_path: Optional[str] = None,
    ) -> VerificationResult:
        """Submit a document image for OCR + field extraction.

        Either ``image_path`` (a filesystem path) or ``image`` (a data URL
        or raw bytes) must be provided. ``back_image``/``back_image_path``
        is optional and used for two-sided documents (e.g. national ID).

        Returns a :class:`VerificationResult` with the extracted fields,
        confidence scores, and consensus metadata.
        """
        image_data = self._resolve_image(image_path, image, "image_path or image")
        back_data: Optional[str] = None
        if back_image_path or back_image is not None:
            back_data = self._resolve_image(back_image_path, back_image, "back image")
        body: Dict[str, Any] = {
            "frontImage": image_data,
            "docType": doc_type,
        }
        if back_data:
            body["backImage"] = back_data
        if country:
            body["country"] = country
        resp = self._request("POST", "/api/verify/document", json=body)
        return VerificationResult.model_validate(resp) if hasattr(VerificationResult, "model_validate") else VerificationResult(**resp)

    def check_liveness(
        self,
        frames: Sequence[Union[str, bytes]],
        *,
        challenge_type: Optional[str] = None,
        actions: Optional[Sequence[str]] = None,
    ) -> LivenessResult:
        """Submit a sequence of webcam frames for a liveness verdict.

        ``frames`` are data-URL strings or raw bytes (the SDK will encode
        raw bytes for you). ``challenge_type`` (or the more explicit
        ``actions`` list) drives the challenge-response check; pass
        ``"turn_left"``, ``"turn_right"``, ``"smile"``, etc.
        """
        encoded_frames = [normalize_image_input(f) for f in frames]
        if not encoded_frames:
            raise ValidationError("at least one frame is required")
        body: Dict[str, Any] = {"frames": encoded_frames}
        if actions:
            body["actions"] = list(actions)
        elif challenge_type:
            body["actions"] = [challenge_type]
        resp = self._request("POST", "/api/verify/liveness", json=body)
        return LivenessResult.model_validate(resp) if hasattr(LivenessResult, "model_validate") else LivenessResult(**resp)

    def face_match(
        self,
        document_image: Union[str, bytes],
        selfie_image: Union[str, bytes],
    ) -> FaceMatchResult:
        """Compare a selfie to a document photo.

        Both inputs may be file paths, ``data:`` URLs, or raw bytes.
        Returns a :class:`FaceMatchResult` with ``matched``, ``score``,
        and ``confidence``.
        """
        doc_data = self._resolve_image(None, document_image, "document_image")
        self_data = self._resolve_image(None, selfie_image, "selfie_image")
        body = {"docImage": doc_data, "selfie": self_data}
        resp = self._request("POST", "/api/verify/face-match", json=body)
        return FaceMatchResult.model_validate(resp) if hasattr(FaceMatchResult, "model_validate") else FaceMatchResult(**resp)

    def validate_id(
        self,
        *,
        country: str,
        id_number: str,
    ) -> IdValidationResult:
        """Validate a national ID against the country checksum algorithm.

        ``country`` is an ISO 3166-1 alpha-2 code (e.g. ``"EG"``).
        Returns :class:`IdValidationResult` with ``is_valid``,
        ``checksum_valid``, and extracted birth date / gender.
        """
        body = {"country": country.upper(), "id": id_number}
        resp = self._request("POST", "/api/verify/validate-id", json=body)
        return IdValidationResult.model_validate(resp) if hasattr(IdValidationResult, "model_validate") else IdValidationResult(**resp)

    def parse_mrz(self, mrz_text: str) -> MrzParseResult:
        """Parse an ICAO 9303 MRZ text block (TD1/TD2/TD3)."""
        if not mrz_text or not mrz_text.strip():
            raise ValidationError("mrz_text is required (min 20 chars)")
        body = {"text": mrz_text}
        resp = self._request("POST", "/api/verify/parse-mrz", json=body)
        return MrzParseResult.model_validate(resp) if hasattr(MrzParseResult, "model_validate") else MrzParseResult(**resp)

    def register_webhook(
        self,
        *,
        url: str,
        events: Sequence[str],
        secret: str,
    ) -> WebhookEndpoint:
        """Register a webhook endpoint with the Cirkle platform.

        The endpoint will receive HMAC-SHA256-signed HTTP POSTs whenever
        the listed events fire. Returns the created :class:`WebhookEndpoint`.

        ``secret`` must be at least 16 characters.
        """
        if not url or not url.startswith("https://"):
            raise ValidationError("url must be an https:// URL")
        if not secret or len(secret) < 16:
            raise ValidationError("secret must be at least 16 characters")
        if not events:
            raise ValidationError("events list cannot be empty")
        body = {
            "url": url,
            "events": list(events),
            "secret": secret,
        }
        resp = self._request("POST", "/api/v1/verify/webhook-system", json={**body, "action": "register"})
        if "endpoint" in resp:
            return WebhookEndpoint.model_validate(resp["endpoint"]) if hasattr(WebhookEndpoint, "model_validate") else WebhookEndpoint(**resp["endpoint"])
        # Fallback: legacy /api/v1/verify/webhook shape
        return WebhookEndpoint.model_validate(resp) if hasattr(WebhookEndpoint, "model_validate") else WebhookEndpoint(**resp)

    def get_certificate(
        self,
        *,
        verification_id: str,
        subject: Optional[Dict[str, Any]] = None,
        result: Optional[Dict[str, Any]] = None,
        layers: Optional[Dict[str, Any]] = None,
    ) -> Certificate:
        """Issue (or retrieve) a signed verification certificate.

        If ``subject``/``result``/``layers`` are supplied, the SDK issues
        a new certificate. Otherwise it issues a minimal one keyed on the
        ``verification_id`` (the server fills in placeholders).
        """
        if not verification_id:
            raise ValidationError("verification_id is required")
        body: Dict[str, Any] = {
            "verificationId": verification_id,
            "subject": subject or {"verificationId": verification_id, "docType": "national_id"},
            "result": result or {"status": "verified", "overallScore": 0},
            "layers": layers or {},
        }
        resp = self._request("POST", "/api/v1/verify/certificate", json=body)
        cert_block = resp.get("certificate", resp)
        return Certificate.model_validate(cert_block) if hasattr(Certificate, "model_validate") else Certificate(**cert_block)

    def export_data(self, *, user_id: str) -> GdprExport:
        """Download a GDPR Article 20 data-portability export for ``user_id``."""
        if not user_id:
            raise ValidationError("user_id is required")
        resp = self._request("GET", "/api/v1/verify/gdpr/export", params={"user_id": user_id})
        return GdprExport.model_validate(resp) if hasattr(GdprExport, "model_validate") else GdprExport(**resp)

    # ─── Webhook signature helpers (static-ish methods) ───────────

    @staticmethod
    def compute_webhook_signature(payload: Union[bytes, str, dict], secret: str) -> str:
        """Compute the HMAC-SHA256 signature for an outgoing webhook payload."""
        return compute_signature(payload, secret)

    @staticmethod
    def format_signature(hex_digest: str) -> str:
        """Wrap a hex digest as the ``sha256=<hex>`` header value."""
        return format_signature_header(hex_digest)

    @staticmethod
    def verify_webhook_signature(
        payload: Union[bytes, str, dict],
        secret: str,
        header_value: str,
    ) -> bool:
        """Verify an incoming ``X-Cirkle-Signature`` header."""
        return verify_signature(payload, secret, header_value)

    # ─── HTTP plumbing ────────────────────────────────────────────

    def _resolve_image(
        self,
        path: Optional[str],
        image: Optional[Union[str, bytes]],
        param_name: str,
    ) -> str:
        """Pick whichever of (path, image) was provided and normalise it."""
        if path:
            return normalize_image_input(path)
        if image is not None:
            return normalize_image_input(image)
        raise ValidationError(f"{param_name} is required")

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Issue an HTTP request with retries + rate-limit handling."""
        url = self._build_url(path, params)
        body = self._serialize_json(json)
        hdrs = self._default_headers(headers)
        timeout = self.timeout
        if path in _LONG_METHOD_PATHS:
            timeout = max(timeout, 120.0)
        last_exc: Optional[CirkleError] = None
        for attempt in range(self.max_retries + 1):
            try:
                return self._do_request(method, url, body, hdrs, timeout)
            except RateLimitError as e:
                last_exc = e
                if attempt >= self.max_retries:
                    raise
                wait = e.retry_after or 2.0
                time.sleep(min(wait, 60.0))
                continue
            except ServerError as e:
                last_exc = e
                if attempt >= self.max_retries:
                    raise
                # exponential backoff: 250ms, 500ms, 1000ms
                wait_ms = BACKOFF_BASE_MS * (2 ** attempt)
                time.sleep(wait_ms / 1000.0)
                continue
        # Should be unreachable, but satisfy the type-checker.
        if last_exc:
            raise last_exc
        raise ServerError("request failed without a captured exception", status=0)

    def _do_request(
        self,
        method: str,
        url: str,
        body: Optional[bytes],
        headers: Dict[str, str],
        timeout: float,
    ) -> Dict[str, Any]:
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - trusted internal URL
                status = resp.status
                raw = resp.read()
        except urllib.error.HTTPError as e:
            status = e.code
            raw = e.read() if hasattr(e, "read") else b""
            return self._handle_error_response(status, raw, e.headers)
        except urllib.error.URLError as e:
            raise NetworkError(f"network error: {e.reason}") from e
        except TimeoutError as e:
            raise NetworkError("request timed out") from e
        return self._parse_json(status, raw)

    def _handle_error_response(self, status: int, raw: bytes, headers: Any) -> Dict[str, Any]:
        """Map an HTTP error response to the right SDK exception."""
        text = raw.decode("utf-8", errors="replace") if raw else ""
        try:
            payload = json.loads(text) if text else {}
        except (ValueError, json.JSONDecodeError):
            payload = {"error": text or "no response body"}
        message = str(payload.get("error") or payload.get("message") or f"HTTP {status}")
        code = payload.get("code")
        details = {k: v for k, v in payload.items() if k not in ("error", "message", "code")}
        if status == 400:
            raise ValidationError(message, code=code, details=details)
        if status == 401:
            raise AuthenticationError(message, code=code, details=details)
        if status == 403:
            raise AuthorizationError(message, code=code, details=details)
        if status == 404:
            raise NotFoundError(message, code=code, details=details)
        if status == 429:
            retry_after = self._parse_retry_after(headers)
            raise RateLimitError(message, retry_after=retry_after, code=code, details=details)
        if 500 <= status < 600:
            raise ServerError(message, status=status, code=code, details=details)
        raise ApiError(message, status=status, code=code, details=details)

    @staticmethod
    def _parse_retry_after(headers: Any) -> Optional[float]:
        if not headers:
            return None
        val = None
        try:
            val = headers.get("Retry-After") if hasattr(headers, "get") else None
        except Exception:
            val = None
        if not val:
            return None
        try:
            return float(val)
        except (TypeError, ValueError):
            return None

    def _build_url(self, path: str, params: Optional[Dict[str, Any]]) -> str:
        url = f"{self.base_url}{path}"
        qs = to_query_string(params)
        if qs:
            url = f"{url}?{qs}"
        return url

    def _serialize_json(self, body: Optional[Dict[str, Any]]) -> Optional[bytes]:
        if body is None:
            return None
        return json.dumps(body).encode("utf-8")

    def _default_headers(self, extra: Optional[Dict[str, str]]) -> Dict[str, str]:
        h: Dict[str, str] = {
            "Authorization": f"Bearer {self.api_key}",
            "X-API-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": self.user_agent,
        }
        if extra:
            h.update(extra)
        return h

    @staticmethod
    def _parse_json(status: int, raw: bytes) -> Dict[str, Any]:
        if not raw:
            return {}
        try:
            parsed = json.loads(raw.decode("utf-8"))
            return parsed if isinstance(parsed, dict) else {"_value": parsed}
        except (ValueError, json.JSONDecodeError):
            return {"_raw": raw.decode("utf-8", errors="replace"), "_status": status}


# ─── Async wrapper (httpx) ─────────────────────────────────────────


class AsyncCirkleVerify:
    """Asynchronous Cirkle Verify API client backed by :mod:`httpx`.

    Mirrors :class:`CirkleVerify` method-for-method with ``_async``
    suffixes. Requires ``httpx`` (``pip install httpx``); raises a clear
    error on first use if the package isn't installed so the import-time
    surface stays tiny.
    """

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = MAX_RETRIES,
        user_agent: str = "cirkle-verify-python/1.0.0",
    ) -> None:
        self._sync = CirkleVerify(
            api_key,
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            user_agent=user_agent,
        )

    def _ensure_httpx(self):  # type: ignore[no-untyped-def]
        try:
            import httpx  # type: ignore[import-untyped]
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "AsyncCirkleVerify requires httpx. Install with `pip install httpx`."
            ) from e
        return httpx

    async def _request_async(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        httpx = self._ensure_httpx()
        url = self._sync._build_url(path, params)
        headers = self._sync._default_headers(None)
        body = self._sync._serialize_json(json_body)
        timeout = self._sync.timeout
        if path in _LONG_METHOD_PATHS:
            timeout = max(timeout, 120.0)
        for attempt in range(self._sync.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.request(method, url, content=body, headers=headers)
                    return self._sync._parse_json(resp.status_code, resp.content)
            except httpx.TimeoutException as e:
                raise NetworkError(f"request timed out: {e}") from e
            except httpx.HTTPStatusError as e:
                return self._sync._handle_error_response(e.response.status_code, e.response.content, e.response.headers)
            except Exception as e:
                if attempt >= self._sync.max_retries:
                    raise NetworkError(f"async request failed: {e}") from e
                # backoff
                await _async_sleep(BACKOFF_BASE_MS * (2 ** attempt) / 1000.0)
        return {}

    async def verify_document_async(
        self,
        image_path: Optional[str] = None,
        *,
        image: Optional[Union[str, bytes]] = None,
        doc_type: str = "national_id",
        country: Optional[str] = None,
        back_image: Optional[Union[str, bytes]] = None,
        back_image_path: Optional[str] = None,
    ) -> VerificationResult:
        """Async twin of :meth:`CirkleVerify.verify_document`."""
        image_data = self._sync._resolve_image(image_path, image, "image_path or image")
        back_data = None
        if back_image_path or back_image is not None:
            back_data = self._sync._resolve_image(back_image_path, back_image, "back image")
        body: Dict[str, Any] = {"frontImage": image_data, "docType": doc_type}
        if back_data:
            body["backImage"] = back_data
        if country:
            body["country"] = country
        resp = await self._request_async("POST", "/api/verify/document", json_body=body)
        return VerificationResult.model_validate(resp) if hasattr(VerificationResult, "model_validate") else VerificationResult(**resp)

    async def check_liveness_async(
        self,
        frames: Sequence[Union[str, bytes]],
        *,
        challenge_type: Optional[str] = None,
        actions: Optional[Sequence[str]] = None,
    ) -> LivenessResult:
        """Async twin of :meth:`CirkleVerify.check_liveness`."""
        encoded = [normalize_image_input(f) for f in frames]
        if not encoded:
            raise ValidationError("at least one frame is required")
        body: Dict[str, Any] = {"frames": encoded}
        if actions:
            body["actions"] = list(actions)
        elif challenge_type:
            body["actions"] = [challenge_type]
        resp = await self._request_async("POST", "/api/verify/liveness", json_body=body)
        return LivenessResult.model_validate(resp) if hasattr(LivenessResult, "model_validate") else LivenessResult(**resp)

    async def face_match_async(
        self,
        document_image: Union[str, bytes],
        selfie_image: Union[str, bytes],
    ) -> FaceMatchResult:
        """Async twin of :meth:`CirkleVerify.face_match`."""
        doc = self._sync._resolve_image(None, document_image, "document_image")
        self_ = self._sync._resolve_image(None, selfie_image, "selfie_image")
        body = {"docImage": doc, "selfie": self_}
        resp = await self._request_async("POST", "/api/verify/face-match", json_body=body)
        return FaceMatchResult.model_validate(resp) if hasattr(FaceMatchResult, "model_validate") else FaceMatchResult(**resp)

    async def validate_id_async(self, *, country: str, id_number: str) -> IdValidationResult:
        """Async twin of :meth:`CirkleVerify.validate_id`."""
        body = {"country": country.upper(), "id": id_number}
        resp = await self._request_async("POST", "/api/verify/validate-id", json_body=body)
        return IdValidationResult.model_validate(resp) if hasattr(IdValidationResult, "model_validate") else IdValidationResult(**resp)

    async def parse_mrz_async(self, mrz_text: str) -> MrzParseResult:
        """Async twin of :meth:`CirkleVerify.parse_mrz`."""
        if not mrz_text or not mrz_text.strip():
            raise ValidationError("mrz_text is required (min 20 chars)")
        body = {"text": mrz_text}
        resp = await self._request_async("POST", "/api/verify/parse-mrz", json_body=body)
        return MrzParseResult.model_validate(resp) if hasattr(MrzParseResult, "model_validate") else MrzParseResult(**resp)

    async def register_webhook_async(
        self,
        *,
        url: str,
        events: Sequence[str],
        secret: str,
    ) -> WebhookEndpoint:
        """Async twin of :meth:`CirkleVerify.register_webhook`."""
        if not url or not url.startswith("https://"):
            raise ValidationError("url must be an https:// URL")
        if not secret or len(secret) < 16:
            raise ValidationError("secret must be at least 16 characters")
        if not events:
            raise ValidationError("events list cannot be empty")
        body = {"url": url, "events": list(events), "secret": secret, "action": "register"}
        resp = await self._request_async("POST", "/api/v1/verify/webhook-system", json_body=body)
        if "endpoint" in resp:
            block = resp["endpoint"]
            return WebhookEndpoint.model_validate(block) if hasattr(WebhookEndpoint, "model_validate") else WebhookEndpoint(**block)
        return WebhookEndpoint.model_validate(resp) if hasattr(WebhookEndpoint, "model_validate") else WebhookEndpoint(**resp)

    async def get_certificate_async(
        self,
        *,
        verification_id: str,
        subject: Optional[Dict[str, Any]] = None,
        result: Optional[Dict[str, Any]] = None,
        layers: Optional[Dict[str, Any]] = None,
    ) -> Certificate:
        """Async twin of :meth:`CirkleVerify.get_certificate`."""
        if not verification_id:
            raise ValidationError("verification_id is required")
        body = {
            "verificationId": verification_id,
            "subject": subject or {"verificationId": verification_id, "docType": "national_id"},
            "result": result or {"status": "verified", "overallScore": 0},
            "layers": layers or {},
        }
        resp = await self._request_async("POST", "/api/v1/verify/certificate", json_body=body)
        block = resp.get("certificate", resp)
        return Certificate.model_validate(block) if hasattr(Certificate, "model_validate") else Certificate(**block)

    async def export_data_async(self, *, user_id: str) -> GdprExport:
        """Async twin of :meth:`CirkleVerify.export_data`."""
        if not user_id:
            raise ValidationError("user_id is required")
        resp = await self._request_async("GET", "/api/v1/verify/gdpr/export", params={"user_id": user_id})
        return GdprExport.model_validate(resp) if hasattr(GdprExport, "model_validate") else GdprExport(**resp)


async def _async_sleep(seconds: float) -> None:
    """Tiny indirection so async tests can patch the sleep without dragging in asyncio."""
    import asyncio  # local import keeps the module-import surface tiny

    await asyncio.sleep(seconds)
