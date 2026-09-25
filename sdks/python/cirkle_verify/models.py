"""Pydantic models for Cirkle Verify SDK request/response payloads.

These models are intentionally permissive (most fields are ``Optional``)
because the Cirkle API can return a wide range of optional metadata
(consensus info, image-quality assessment, raw OCR text, etc.). Each
model is round-trippable: ``Model(**api_response_json).model_dump(
exclude_none=True)`` re-creates a valid payload.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

try:
    # Pydantic v2 (preferred when available, Python 3.8+ compatible)
    from pydantic import BaseModel, ConfigDict, Field

    _PYDANTIC_V2 = True
except ImportError:  # pragma: no cover - exercised only on missing dep
    # Fallback to a tiny shim so the SDK still imports without pydantic
    # installed. The shape mirrors v2's BaseModel enough for ``Model(**d)``
    # construction + ``.model_dump()`` to work. Lint/type-checkers still
    # prefer the real pydantic — this is purely a graceful degradation.
    _PYDANTIC_V2 = False

    class BaseModel:  # type: ignore[no-redef]
        def __init__(self, **data: Any) -> None:
            for k, v in data.items():
                setattr(self, k, v)

        def model_dump(self, exclude_none: bool = False) -> Dict[str, Any]:
            out: Dict[str, Any] = {}
            for k, v in self.__dict__.items():
                if exclude_none and v is None:
                    continue
                out[k] = v
            return out

        @classmethod
        def model_validate(cls, obj: Any) -> "BaseModel":
            if isinstance(obj, dict):
                return cls(**obj)
            return cls(**obj.__dict__)

    def ConfigDict(**kwargs: Any) -> Dict[str, Any]:  # type: ignore[no-redef]
        return kwargs

    def Field(default: Any = None, **kwargs: Any) -> Any:  # type: ignore[no-redef]
        return default


# ─── Shared sub-shapes ──────────────────────────────────────────────


class ConsensusInfo(BaseModel):
    """Metadata describing how multiple AI providers cross-checked a result."""

    total: Optional[int] = None
    successful: Optional[int] = None
    provider_names: Optional[List[str]] = None
    agreement: Optional[float] = None
    field_agreement: Optional[Dict[str, float]] = None
    outcomes: Optional[List[Dict[str, Any]]] = None
    verdict: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class ImageQualityAssessment(BaseModel):
    """Per-image quality breakdown returned by the document endpoint."""

    overall_quality: Optional[float] = None
    is_document: Optional[bool] = None
    is_blurry: Optional[bool] = None
    has_glare: Optional[bool] = None
    is_framed_well: Optional[bool] = None
    rotation: Optional[str] = None
    lighting: Optional[str] = None
    is_full_frame: Optional[bool] = None
    issues: Optional[List[str]] = None
    suggestions: Optional[List[str]] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class FieldConfidence(BaseModel):
    """Per-field confidence in [0, 1]."""

    full_name_ar: Optional[float] = None
    full_name_en: Optional[float] = None
    national_id: Optional[float] = None
    birth_date: Optional[float] = None
    address: Optional[float] = None
    gender: Optional[float] = None
    document_no: Optional[float] = None
    expiry_date: Optional[float] = None
    nationality: Optional[float] = None
    job: Optional[float] = None
    religion: Optional[float] = None
    marital_status: Optional[float] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class ExtractedFields(BaseModel):
    """Fields extracted from a document — mirrors the API's ``data`` object."""

    full_name_ar: Optional[str] = None
    full_name_en: Optional[str] = None
    national_id: Optional[str] = None
    birth_date: Optional[str] = None
    address: Optional[str] = None
    gender: Optional[str] = None
    document_no: Optional[str] = None
    expiry_date: Optional[str] = None
    nationality: Optional[str] = None
    job: Optional[str] = None
    religion: Optional[str] = None
    marital_status: Optional[str] = None
    extra_fields: Optional[Dict[str, str]] = None
    raw_text: Optional[str] = None
    arabic_text: Optional[str] = None
    has_photo: Optional[bool] = None
    confidence: Optional[float] = None
    field_confidence: Optional[FieldConfidence] = None
    image_quality: Optional[ImageQualityAssessment] = None
    mrz_parsed: Optional[bool] = None
    validation_flags: Optional[Dict[str, Any]] = None
    passes: Optional[int] = None
    consensus: Optional[ConsensusInfo] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


# ─── Top-level result models ────────────────────────────────────────


class VerificationResult(BaseModel):
    """Top-level response from ``client.verify_document()``."""

    id: Optional[str] = None
    status: Optional[str] = None
    score: Optional[float] = None
    extracted_fields: Optional[ExtractedFields] = None
    elapsed_ms: Optional[int] = None
    engine: Optional[str] = None
    consensus: Optional[ConsensusInfo] = None
    providers: Optional[List[str]] = None
    debug: Optional[Dict[str, Any]] = None
    data: Optional[ExtractedFields] = None  # raw alias

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class LivenessSignals(BaseModel):
    """Liveness breakdown returned by ``client.check_liveness()``."""

    motion_score: Optional[float] = None
    challenge_score: Optional[float] = None
    print_attack_score: Optional[float] = None
    screen_artifact_score: Optional[float] = None
    depth_score: Optional[float] = None
    motion_smoothness_score: Optional[float] = None
    velocity_profile_score: Optional[float] = None
    total_score: Optional[float] = None
    is_live: Optional[bool] = None
    issues: Optional[List[str]] = None
    suggestions: Optional[List[str]] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class LivenessResult(BaseModel):
    """Response from ``client.check_liveness()``."""

    passed: Optional[bool] = None
    score: Optional[float] = None
    is_live: Optional[bool] = None
    detected_actions: Optional[List[str]] = None
    reasoning: Optional[str] = None
    signals: Optional[LivenessSignals] = None
    consensus: Optional[ConsensusInfo] = None
    engine: Optional[str] = None
    result: Optional[Dict[str, Any]] = None  # raw inner result block

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class FaceMatchResult(BaseModel):
    """Response from ``client.face_match()``."""

    matched: Optional[bool] = None
    is_match: Optional[bool] = None
    same_person: Optional[bool] = None
    score: Optional[float] = None
    similarity: Optional[float] = None
    confidence: Optional[float] = None
    reasoning: Optional[str] = None
    consensus: Optional[ConsensusInfo] = None
    engine: Optional[str] = None
    result: Optional[Dict[str, Any]] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class IdValidationResult(BaseModel):
    """Response from ``client.validate_id()``."""

    is_valid: Optional[bool] = None
    valid: Optional[bool] = None
    checksum_valid: Optional[bool] = None
    country: Optional[str] = None
    id_number: Optional[str] = None
    extracted_fields: Optional[Dict[str, Any]] = None
    extracted: Optional[Dict[str, Any]] = None
    birth_date: Optional[str] = None
    gender: Optional[str] = None
    error: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class MrzCheckDigits(BaseModel):
    """Per-field check-digit results returned by the MRZ parser."""

    document_number: Optional[bool] = None
    birth_date: Optional[bool] = None
    expiry_date: Optional[bool] = None
    composite: Optional[bool] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class MrzParseResult(BaseModel):
    """Response from ``client.parse_mrz()``."""

    valid: Optional[bool] = None
    format: Optional[str] = None
    document_code: Optional[str] = None
    issuing_country: Optional[str] = None
    document_number: Optional[str] = None
    name: Optional[str] = None
    sex: Optional[str] = None
    birth_date: Optional[str] = None
    expiry_date: Optional[str] = None
    nationality: Optional[str] = None
    fields: Optional[Dict[str, Any]] = None
    check_digits: Optional[MrzCheckDigits] = None
    errors: Optional[List[str]] = None
    raw: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class WebhookEndpoint(BaseModel):
    """A registered webhook endpoint — created by ``client.register_webhook()``."""

    id: Optional[str] = None
    url: Optional[str] = None
    events: Optional[List[str]] = None
    secret: Optional[str] = None
    active: Optional[bool] = None
    created_at: Optional[str] = None
    last_triggered_at: Optional[str] = None
    failure_count: Optional[int] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class CertificateSubject(BaseModel):
    """The verified identity inside a :class:`Certificate`."""

    full_name_ar: Optional[str] = None
    full_name_en: Optional[str] = None
    national_id: Optional[str] = None
    document_no: Optional[str] = None
    doc_type: Optional[str] = None
    nationality: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class CertificateResult(BaseModel):
    """The verification outcome embedded in a :class:`Certificate`."""

    status: Optional[str] = None
    overall_score: Optional[float] = None
    doc_confidence: Optional[float] = None
    face_match_score: Optional[float] = None
    liveness_score: Optional[float] = None
    consistency_score: Optional[float] = None
    fraud_probability: Optional[float] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class CertificateSignature(BaseModel):
    """The cryptographic signature block of a :class:`Certificate`."""

    algorithm: Optional[str] = None
    key_id: Optional[str] = None
    value: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class Certificate(BaseModel):
    """A signed verification certificate issued by ``client.get_certificate()``."""

    id: Optional[str] = None
    certificate_id: Optional[str] = None
    version: Optional[str] = None
    verification_id: Optional[str] = None
    subject: Optional[CertificateSubject] = None
    result: Optional[CertificateResult] = None
    layers: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    signature: Optional[CertificateSignature] = None
    issued_at: Optional[str] = None
    expires_at: Optional[str] = None
    raw: Optional[str] = None
    verify_url: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


class GdprExport(BaseModel):
    """GDPR Article 20 data-portability export returned by ``client.export_data()``."""

    user_id: Optional[str] = None
    exported_at: Optional[str] = None
    data: Optional[Dict[str, Any]] = None
    hash: Optional[str] = None
    download_url: Optional[str] = None
    regulation: Optional[str] = None
    raw_biometrics_policy: Optional[str] = None

    if _PYDANTIC_V2:
        model_config = ConfigDict(extra="allow")


__all__ = [
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
]
