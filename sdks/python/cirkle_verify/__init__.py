"""Cirkle Verify Python SDK.

Public API
----------

>>> from cirkle_verify import CirkleVerify
>>> client = CirkleVerify(api_key="cvk_live_xxx")
>>> result = client.verify_document(image_path="id_card.jpg", doc_type="national_id")

The package exports:

* :class:`CirkleVerify` — synchronous client (urllib under the hood).
* :class:`AsyncCirkleVerify` — async twin backed by ``httpx`` (optional
  install: ``pip install httpx``).
* All Pydantic models (``VerificationResult``, ``LivenessResult``, ...).
* The full exception hierarchy (``CirkleError``, ``RateLimitError``, ...).
* Image + HMAC helpers (``encode_image_path``, ``verify_signature``, ...).
"""

from __future__ import annotations

from .client import AsyncCirkleVerify, CirkleVerify
from .exceptions import (
    ApiError,
    AuthenticationError,
    AuthorizationError,
    CirkleError,
    InvalidImageError,
    NetworkError,
    NotFoundError,
    RateLimitError,
    ServerError,
    SignatureVerificationError,
    ValidationError,
)
from .models import (
    Certificate,
    CertificateResult,
    CertificateSignature,
    CertificateSubject,
    ConsensusInfo,
    ExtractedFields,
    FaceMatchResult,
    FieldConfidence,
    GdprExport,
    IdValidationResult,
    ImageQualityAssessment,
    LivenessResult,
    LivenessSignals,
    MrzCheckDigits,
    MrzParseResult,
    VerificationResult,
    WebhookEndpoint,
)
from .utils import (
    compute_signature,
    encode_image_bytes,
    encode_image_path,
    format_signature_header,
    normalize_base_url,
    normalize_image_input,
    to_query_string,
    verify_signature,
)

__version__ = "1.0.0"

__all__ = [
    # client
    "CirkleVerify",
    "AsyncCirkleVerify",
    # exceptions
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
    # models
    "ConsensusInfo",
    "ImageQualityAssessment",
    "FieldConfidence",
    "ExtractedFields",
    "VerificationResult",
    "LivenessSignals",
    "LivenessResult",
    "FaceMatchResult",
    "IdValidationResult",
    "MrzCheckDigits",
    "MrzParseResult",
    "WebhookEndpoint",
    "CertificateSubject",
    "CertificateResult",
    "CertificateSignature",
    "Certificate",
    "GdprExport",
    # utils
    "encode_image_bytes",
    "encode_image_path",
    "normalize_image_input",
    "compute_signature",
    "format_signature_header",
    "verify_signature",
    "normalize_base_url",
    "to_query_string",
    # version
    "__version__",
]
