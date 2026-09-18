#!/usr/bin/env python3
"""
Cirkle Risk Fusion Engine — Weighted decision fusion with explainability.

Combines results from all modules:
  - Document authenticity (OCR + MRZ + forensics)
  - Face match (1:1 comparison)
  - Liveness (passive + active)
  - Device signals (optional)
  - Cross-field consistency
  - Document authenticity (security features)
  - AI consensus confidence (multi-provider agreement)
  - OCR confidence

Outputs:
  - decision: approve | review | reject
  - score: 0-1 (weighted fusion)
  - reason_codes: list of specific reason codes (50+ catalog)
  - explainability: chain-of-thought reasoning (DeepSeek-style)
  - audit: immutable audit trail entry (HMAC chained)

Port: 8003
Endpoints:
  POST /risk/evaluate       — weighted fusion + audit
  POST /risk/explain        — human-readable chain-of-thought explanation
  GET  /risk/reason-codes   — full catalog of 50+ reason codes
  GET  /health              — service health
  GET  /audit                — recent audit-chain entries
"""

import json
import time
import hashlib
import hmac
import os
import traceback
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ─── Configuration ───────────────────────────────────────────────
RISK_HMAC_SECRET = os.environ.get(
    "RISK_HMAC_SECRET", "cirkle-risk-dev-secret-change-me"
).encode("utf-8")

# ─── Default weights ─────────────────────────────────────────────
# Updated weights — new signals added, weights normalized to sum to 1.0.
# The legacy DEFAULT_WEIGHTS is kept as DEFAULT_WEIGHTS_LEGACY for
# backward compatibility when callers omit a 'weights' config.
DEFAULT_WEIGHTS = {
    "document_authenticity": 0.18,
    "face_match": 0.20,
    "liveness": 0.15,
    "device_signals": 0.05,
    "cross_field_consistency": 0.10,
    "document_authenticity_features": 0.08,  # security-feature based
    "face_match_confidence": 0.10,
    "liveness_confidence": 0.08,
    "ai_consensus_confidence": 0.04,
    "ocr_confidence": 0.02,
}

DEFAULT_WEIGHTS_LEGACY = {
    "document_authenticity": 0.30,
    "face_match": 0.35,
    "liveness": 0.25,
    "device_signals": 0.10,
}

# ─── Reason codes (50+) ─────────────────────────────────────────
# Each entry: (description, severity)
# Severities: positive | info | warning | negative | critical
REASON_CODES = {
    # ─── Document (15) ───────────────────────────────────────────
    "DOC_PASS": ("Document authenticity verified", "positive"),
    "DOC_FORGERY": ("Document forgery detected", "critical"),
    "DOC_EXPIRED": ("Document expired", "negative"),
    "DOC_TAMPERED": ("Document image tampered", "critical"),
    "DOC_MRZ_INVALID": ("MRZ check digit invalid", "negative"),
    "DOC_LOW_CONFIDENCE": ("Document OCR confidence low", "warning"),
    "DOC_MRZ_MISSING": ("MRZ field missing", "warning"),
    "DOC_MRZ_CHECKSUM_FAIL": ("MRZ checksum failed", "critical"),
    "DOC_SECURITY_FEATURE_MISSING": ("Required security feature missing", "negative"),
    "DOC_HOLOGRAM_MISSING": ("Hologram not detected", "warning"),
    "DOC_WATERMARK_MISSING": ("Watermark not detected", "warning"),
    "DOC_MICROPRINT_MISSING": ("Microprint not detected", "warning"),
    "DOC_UV_FEATURE_MISSING": ("UV security feature missing", "negative"),
    "DOC_GENUINE_SECURITY": ("Security features match expected pattern", "positive"),
    "DOC_TYPE_UNSUPPORTED": ("Document type not supported", "warning"),
    # ─── Face (10) ───────────────────────────────────────────────
    "FACE_MATCH": ("Face matches document photo", "positive"),
    "FACE_MISMATCH": ("Face does not match document", "critical"),
    "FACE_NO_FACE": ("No face detected", "critical"),
    "FACE_LOW_QUALITY": ("Face image quality too low", "warning"),
    "FACE_MULTIPLE_FACES": ("Multiple faces detected", "negative"),
    "FACE_POSE_EXTREME": ("Face pose extreme (yaw/pitch/roll)", "warning"),
    "FACE_EYE_CLOSED": ("Eye closed — biometric quality insufficient", "warning"),
    "FACE_OCCLUDED": ("Face occluded (mask, hair, hand)", "negative"),
    "FACE_TOO_SMALL": ("Face too small in image", "warning"),
    "FACE_HIGH_QUALITY": ("Face image quality is high", "positive"),
    # ─── Liveness (10) ───────────────────────────────────────────
    "LIVE_CONFIRMED": ("Liveness confirmed", "positive"),
    "LIVE_FAILED": ("Liveness check failed — possible spoof", "critical"),
    "LIVE_LOW_SCORE": ("Liveness score below threshold", "negative"),
    "LIVE_NO_FRAMES": ("No liveness frames provided", "critical"),
    "LIVE_SINGLE_FRAME": ("Only one frame provided — passive motion unavailable", "warning"),
    "LIVE_PAD_SCORE_HIGH": ("PAD score above 0.5 — likely attack", "critical"),
    "LIVE_TEXTURE_ANOMALY": ("Texture anomaly detected", "negative"),
    "LIVE_MOIRE_DETECTED": ("Screen moiré pattern detected", "critical"),
    "LIVE_DEPTH_FLAT": ("Depth map appears flat (likely print attack)", "negative"),
    "LIVE_CHALLENGE_FAILED": ("Liveness challenge failed", "critical"),
    # ─── OCR (5) ─────────────────────────────────────────────────
    "OCR_SUCCESS": ("OCR extraction successful", "positive"),
    "OCR_LOW_CONFIDENCE": ("OCR confidence below 0.7", "warning"),
    "OCR_FIELD_MISSING": ("Required field missing from OCR", "negative"),
    "OCR_GARBLED": ("OCR output garbled — unreadable", "critical"),
    "OCR_PARTIAL": ("OCR partial — some fields missing", "warning"),
    # ─── Cross-field (5) ─────────────────────────────────────────
    "CROSS_FIELD_PASS": ("All cross-field checks passed", "positive"),
    "CROSS_FIELD_NAME_MISMATCH": ("Cross-field name mismatch", "negative"),
    "CROSS_FIELD_DOB_MISMATCH": ("Date of birth mismatch", "critical"),
    "CROSS_FIELD_GENDER_MISMATCH": ("Gender mismatch", "warning"),
    "CROSS_FIELD_NATIONALITY_MISMATCH": ("Nationality mismatch", "warning"),
    # ─── AI consensus (5) ────────────────────────────────────────
    "AI_CONSENSUS_AGREE": ("All AI providers agree", "positive"),
    "AI_CONSENSUS_DISAGREE": ("AI providers disagree", "negative"),
    "AI_CONSENSUS_SPLIT": ("AI provider consensus split", "warning"),
    "AI_CONSENSUS_INSUFFICIENT": ("Insufficient AI providers (need ≥2)", "warning"),
    "AI_PROVIDER_ERROR": ("AI provider returned error", "warning"),
    # ─── Device signals (5) ─────────────────────────────────────
    "DEVICE_TRUSTED": ("Device signals trusted", "positive"),
    "DEVICE_EMULATOR": ("Emulator detected", "critical"),
    "DEVICE_ROOTED": ("Rooted/jailbroken device", "negative"),
    "DEVICE_VPN": ("VPN/proxy detected", "warning"),
    "DEVICE_LOW_TRUST": ("Device trust score below 0.5", "warning"),
    # ─── Final decision (3) ──────────────────────────────────────
    "APPROVED": ("Verification approved", "positive"),
    "REVIEW_NEEDED": ("Manual review required", "warning"),
    "REJECTED": ("Verification rejected", "negative"),
    # ─── Operational (5) ────────────────────────────────────────
    "SERVICE_HEALTHY": ("All upstream services healthy", "positive"),
    "SERVICE_DEGRADED": ("Upstream service degraded", "warning"),
    "SERVICE_TIMEOUT": ("Upstream service timed out", "negative"),
    "RATE_LIMITED": ("Client rate-limited", "warning"),
    "INTERNAL_ERROR": ("Internal server error", "critical"),
}


# ─── Audit chain ─────────────────────────────────────────────────
audit_chain = []

def _hmac_digest(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str)
    return hmac.new(RISK_HMAC_SECRET, canonical.encode("utf-8"),
                    hashlib.sha256).hexdigest()

def add_audit_entry(session_id: str, decision: str, score: float,
                    reason_codes: list, details: dict):
    """Add immutable audit entry with HMAC chain."""
    entry = {
        "timestamp": time.time(),
        "session_id": session_id,
        "decision": decision,
        "score": score,
        "reason_codes": reason_codes,
        "details_hash": hashlib.sha256(json.dumps(details, sort_keys=True).encode()).hexdigest()[:16],
    }

    # Chain to previous entry
    if audit_chain:
        prev_hash = audit_chain[-1]["hash"]
        entry["prev_hash"] = prev_hash
    else:
        entry["prev_hash"] = "genesis"

    # Compute this entry's hash (and HMAC for tamper-evidence)
    entry_str = json.dumps({k: v for k, v in entry.items()}, sort_keys=True, default=str)
    entry["hash"] = hashlib.sha256(entry_str.encode()).hexdigest()[:16]
    entry["hmac"] = _hmac_digest(entry)[:16]

    audit_chain.append(entry)
    return entry


# ─── Signal extraction helpers ──────────────────────────────────
def _extract_signal(signals: dict, key: str, default: float = 0.5) -> float:
    """Safely pull a 0..1 signal value out of a dict."""
    val = signals.get(key, default)
    try:
        return float(np.clip(val, 0.0, 1.0))
    except (TypeError, ValueError):
        return default


def _summarize_signals(payload: dict) -> dict:
    """
    Extract a flat dict of 0..1 signal values from the risk input.
    Supports both the legacy nested input shape and the new flat
    'signals' top-level field.
    """
    out = {}
    # ─── Document ───────────────────────────────────────────────
    doc = payload.get("document", {}) or {}
    out["document_authenticity"] = _extract_signal(
        doc, "confidence", default=0.5)
    # Security-feature based authenticity
    sec_features = doc.get("forensics", {}).get("security_features", {})
    if isinstance(sec_features, dict):
        # Fraction of detected security features
        detected = sum(1 for v in sec_features.values() if v)
        total = max(1, len(sec_features))
        out["document_authenticity_features"] = detected / total
    else:
        out["document_authenticity_features"] = 0.5
    out["ocr_confidence"] = _extract_signal(doc, "ocr_confidence", default=0.5)
    out["cross_field_consistency"] = _extract_signal(
        payload.get("cross_field", {}) or doc, "consistency_score", default=0.5)

    # ─── Face ────────────────────────────────────────────────────
    face = payload.get("face", {}) or {}
    face_match_conf = 0.0
    if face.get("is_match"):
        sim = face.get("similarity", 0.0)
        try:
            face_match_conf = float(np.clip(sim, 0.0, 1.0))
        except (TypeError, ValueError):
            face_match_conf = 0.5
    else:
        face_match_conf = 0.0
    out["face_match_confidence"] = face_match_conf
    # Backward-compatible "face_match" score for legacy DEFAULT_WEIGHTS_LEGACY
    out["face_match"] = face_match_conf

    # ─── Liveness ───────────────────────────────────────────────
    live = payload.get("liveness", {}) or {}
    pad = _extract_signal(live, "pad_score", default=1.0)
    # liveness_confidence = 1 - pad_score (high pad → low confidence in live)
    out["liveness_confidence"] = float(np.clip(1.0 - pad, 0.0, 1.0))
    # Legacy "liveness" score for backward-compat
    out["liveness"] = out["liveness_confidence"]

    # ─── Device ─────────────────────────────────────────────────
    dev = payload.get("device", {}) or {}
    out["device_signals"] = _extract_signal(dev, "trust_score", default=0.5)

    # ─── AI consensus ────────────────────────────────────────────
    ai = payload.get("ai_consensus", {}) or {}
    if "confidence" in ai:
        out["ai_consensus_confidence"] = _extract_signal(ai, "confidence")
    else:
        providers = ai.get("providers", [])
        if providers:
            # Fraction of providers that "agree" (decision == majority)
            decisions = [p.get("decision") for p in providers if isinstance(p, dict)]
            if decisions:
                from collections import Counter
                majority = Counter(decisions).most_common(1)[0][0]
                agree = sum(1 for d in decisions if d == majority)
                out["ai_consensus_confidence"] = agree / len(decisions)
            else:
                out["ai_consensus_confidence"] = 0.5
        else:
            out["ai_consensus_confidence"] = 0.5

    return out


# ─── Risk fusion ─────────────────────────────────────────────────
def evaluate_risk(doc_result: dict, face_result: dict, liveness_result: dict,
                  device_result: dict = None, config: dict = None,
                  cross_field_result: dict = None,
                  ai_consensus_result: dict = None,
                  ocr_confidence: float = None,
                  raw_payload: dict = None) -> dict:
    """
    Weighted fusion of all module results.

    Returns: { decision, score, reason_codes, explainability, audit }
    """
    config = config or {}
    weights = config.get("weights", DEFAULT_WEIGHTS)
    thresholds = config.get("thresholds", {
        "approve": 0.80,
        "review": 0.60,
        "reject": 0.0,
    })

    # Build a flat signal dict — prefer the raw_payload if provided (it
    # may include the new top-level fields), else reconstruct from the
    # legacy nested arguments.
    if raw_payload is not None:
        payload = dict(raw_payload)
        payload.setdefault("document", doc_result or {})
        payload.setdefault("face", face_result or {})
        payload.setdefault("liveness", liveness_result or {})
        payload.setdefault("device", device_result or {})
        if cross_field_result is not None:
            payload.setdefault("cross_field", cross_field_result)
        if ai_consensus_result is not None:
            payload.setdefault("ai_consensus", ai_consensus_result)
    else:
        payload = {
            "document": doc_result or {},
            "face": face_result or {},
            "liveness": liveness_result or {},
            "device": device_result or {},
            "cross_field": cross_field_result or {},
            "ai_consensus": ai_consensus_result or {},
        }
        if ocr_confidence is not None:
            payload["document"] = {**payload["document"], "ocr_confidence": ocr_confidence}

    signals = _summarize_signals(payload)

    reason_codes = []
    factors = []
    score_sum = 0.0
    weight_sum = 0.0

    # ─── Document authenticity (legacy) ─────────────────────────
    doc = payload.get("document", {}) or {}
    doc_conf = signals["document_authenticity"]
    tampering = doc.get("forensics", {}).get("tampering_score", 0) if isinstance(doc.get("forensics"), dict) else 0
    mrz_valid = doc.get("mrz", {}).get("check_digits_valid", True) if isinstance(doc.get("mrz"), dict) else True

    doc_score = doc_conf * (1 - tampering)
    if not mrz_valid:
        doc_score *= 0.5
        reason_codes.append("DOC_MRZ_INVALID")

    if tampering > 0.3:
        reason_codes.append("DOC_TAMPERED")
        doc_score = 0
    elif doc_conf > 0.7:
        reason_codes.append("DOC_PASS")
    elif doc_conf < 0.5:
        reason_codes.append("DOC_LOW_CONFIDENCE")

    if "document_authenticity" in weights:
        factors.append({
            "factor": "Document Authenticity (OCR)",
            "weight": weights["document_authenticity"],
            "value": round(doc_score, 4),
            "contribution": round(doc_score * weights["document_authenticity"], 4),
            "detail": f"OCR conf: {doc_conf:.2f}, tampering: {tampering:.2f}, MRZ valid: {mrz_valid}",
        })
        score_sum += doc_score * weights["document_authenticity"]
        weight_sum += weights["document_authenticity"]

    # ─── Document authenticity (security features) ─────────────
    sec_score = signals["document_authenticity_features"]
    sec_features = doc.get("forensics", {}).get("security_features", {}) if isinstance(doc.get("forensics"), dict) else {}
    if isinstance(sec_features, dict) and sec_features:
        if sec_score >= 0.7:
            reason_codes.append("DOC_GENUINE_SECURITY")
        missing = [k for k, v in sec_features.items() if not v]
        if "hologram" in missing:
            reason_codes.append("DOC_HOLOGRAM_MISSING")
        if "watermark" in missing:
            reason_codes.append("DOC_WATERMARK_MISSING")
        if "microprint" in missing:
            reason_codes.append("DOC_MICROPRINT_MISSING")
        if "uv" in missing:
            reason_codes.append("DOC_UV_FEATURE_MISSING")
        if missing and len(missing) >= 3:
            reason_codes.append("DOC_SECURITY_FEATURE_MISSING")
    if "document_authenticity_features" in weights:
        factors.append({
            "factor": "Document Authenticity (Security Features)",
            "weight": weights["document_authenticity_features"],
            "value": round(sec_score, 4),
            "contribution": round(sec_score * weights["document_authenticity_features"], 4),
            "detail": f"Security feature detection ratio: {sec_score:.2f}",
        })
        score_sum += sec_score * weights["document_authenticity_features"]
        weight_sum += weights["document_authenticity_features"]

    # ─── Face match (legacy + new confidence) ──────────────────
    face = payload.get("face", {}) or {}
    face_score = 0.0
    if face:
        detected = face.get("detected", True)
        is_match = face.get("is_match", False)
        similarity = face.get("similarity", 0)
        quality = face.get("quality", {})
        if isinstance(quality, dict):
            q_score = quality.get("score", 0.5)
        else:
            q_score = 0.5

        if not detected and "embedding" not in face:
            reason_codes.append("FACE_NO_FACE")
        elif is_match:
            face_score = min(1.0, float(similarity) * 1.2)
            reason_codes.append("FACE_MATCH")
        else:
            face_score = float(similarity) * 0.3
            reason_codes.append("FACE_MISMATCH")

        if q_score < 0.4:
            reason_codes.append("FACE_LOW_QUALITY")
            face_score *= 0.7
        if q_score >= 0.8:
            reason_codes.append("FACE_HIGH_QUALITY")

    face_match_conf = signals["face_match_confidence"]
    if "face_match" in weights:
        factors.append({
            "factor": "Face Match",
            "weight": weights["face_match"],
            "value": round(face_score, 4),
            "contribution": round(face_score * weights["face_match"], 4),
            "detail": f"Similarity: {face.get('similarity', 0):.4f}, match: {face.get('is_match', False)}, quality: {face.get('quality', {}).get('score', 0.5) if isinstance(face.get('quality'), dict) else 0.5:.2f}",
        })
        score_sum += face_score * weights["face_match"]
        weight_sum += weights["face_match"]

    if "face_match_confidence" in weights:
        fmc = face_match_conf
        factors.append({
            "factor": "Face Match Confidence",
            "weight": weights["face_match_confidence"],
            "value": round(fmc, 4),
            "contribution": round(fmc * weights["face_match_confidence"], 4),
            "detail": f"Match confidence: {fmc:.4f}",
        })
        score_sum += fmc * weights["face_match_confidence"]
        weight_sum += weights["face_match_confidence"]

    # ─── Liveness ───────────────────────────────────────────────
    live = payload.get("liveness", {}) or {}
    live_score = 0.0
    if live:
        is_live = live.get("is_live", False)
        pad_score_val = live.get("pad_score", 1.0)
        live_score = 1.0 - pad_score_val
        if is_live:
            reason_codes.append("LIVE_CONFIRMED")
        else:
            reason_codes.append("LIVE_FAILED")
            live_score = 0
        if pad_score_val > 0.5 and not is_live:
            reason_codes.append("LIVE_PAD_SCORE_HIGH")
        signals_dict = live.get("signals", {}) if isinstance(live.get("signals"), dict) else {}
        if signals_dict.get("texture", {}).get("score", 1.0) < 0.3:
            reason_codes.append("LIVE_TEXTURE_ANOMALY")
        if signals_dict.get("frequency", {}).get("score", 1.0) < 0.3:
            reason_codes.append("LIVE_MOIRE_DETECTED")
        if signals_dict.get("depth", {}).get("score", 1.0) < 0.3:
            reason_codes.append("LIVE_DEPTH_FLAT")

    liveness_conf = signals["liveness_confidence"]
    if "liveness" in weights:
        factors.append({
            "factor": "Liveness",
            "weight": weights["liveness"],
            "value": round(live_score, 4),
            "contribution": round(live_score * weights["liveness"], 4),
            "detail": f"PAD score: {live.get('pad_score', 1.0):.4f}, live: {live.get('is_live', False)}",
        })
        score_sum += live_score * weights["liveness"]
        weight_sum += weights["liveness"]

    if "liveness_confidence" in weights:
        factors.append({
            "factor": "Liveness Confidence",
            "weight": weights["liveness_confidence"],
            "value": round(liveness_conf, 4),
            "contribution": round(liveness_conf * weights["liveness_confidence"], 4),
            "detail": f"Live confidence: {liveness_conf:.4f}",
        })
        score_sum += liveness_conf * weights["liveness_confidence"]
        weight_sum += weights["liveness_confidence"]

    # ─── Device (optional) ──────────────────────────────────────
    dev = payload.get("device", {}) or {}
    if dev and weights.get("device_signals", 0) > 0:
        device_score = signals["device_signals"]
        score_sum += device_score * weights["device_signals"]
        weight_sum += weights["device_signals"]
        factors.append({
            "factor": "Device Signals",
            "weight": weights["device_signals"],
            "value": round(device_score, 4),
            "contribution": round(device_score * weights["device_signals"], 4),
            "detail": f"Trust score: {device_score:.2f}",
        })
        if device_score >= 0.7:
            reason_codes.append("DEVICE_TRUSTED")
        elif device_score < 0.5:
            reason_codes.append("DEVICE_LOW_TRUST")

    # ─── Cross-field consistency ───────────────────────────────
    cf = payload.get("cross_field", {}) or {}
    cf_score = signals["cross_field_consistency"]
    if "cross_field_consistency" in weights:
        factors.append({
            "factor": "Cross-Field Consistency",
            "weight": weights["cross_field_consistency"],
            "value": round(cf_score, 4),
            "contribution": round(cf_score * weights["cross_field_consistency"], 4),
            "detail": f"Consistency score: {cf_score:.2f}, checks passed: {cf.get('checks_passed', 'n/a')}/{cf.get('checks_total', 'n/a')}",
        })
        score_sum += cf_score * weights["cross_field_consistency"]
        weight_sum += weights["cross_field_consistency"]

    if cf_score >= 0.9 and cf:
        reason_codes.append("CROSS_FIELD_PASS")
    flags = cf.get("flags", []) if isinstance(cf, dict) else []
    if "CROSS_FIELD_NAME_MISMATCH" in flags or cf.get("name_mismatch"):
        reason_codes.append("CROSS_FIELD_NAME_MISMATCH")
    if "CROSS_FIELD_DOB_MISMATCH" in flags or cf.get("dob_mismatch"):
        reason_codes.append("CROSS_FIELD_DOB_MISMATCH")
    if "CROSS_FIELD_GENDER_MISMATCH" in flags or cf.get("gender_mismatch"):
        reason_codes.append("CROSS_FIELD_GENDER_MISMATCH")
    if "CROSS_FIELD_NATIONALITY_MISMATCH" in flags or cf.get("nationality_mismatch"):
        reason_codes.append("CROSS_FIELD_NATIONALITY_MISMATCH")

    # ─── AI consensus ────────────────────────────────────────────
    ai = payload.get("ai_consensus", {}) or {}
    ai_score = signals["ai_consensus_confidence"]
    if "ai_consensus_confidence" in weights:
        factors.append({
            "factor": "AI Consensus Confidence",
            "weight": weights["ai_consensus_confidence"],
            "value": round(ai_score, 4),
            "contribution": round(ai_score * weights["ai_consensus_confidence"], 4),
            "detail": f"Provider agreement: {ai_score:.2f}",
        })
        score_sum += ai_score * weights["ai_consensus_confidence"]
        weight_sum += weights["ai_consensus_confidence"]

    providers = ai.get("providers", []) if isinstance(ai.get("providers"), list) else []
    if providers:
        if ai_score >= 0.9:
            reason_codes.append("AI_CONSENSUS_AGREE")
        elif ai_score >= 0.6:
            reason_codes.append("AI_CONSENSUS_SPLIT")
        else:
            reason_codes.append("AI_CONSENSUS_DISAGREE")
    elif "ai_consensus" in payload:
        reason_codes.append("AI_CONSENSUS_INSUFFICIENT")

    # ─── OCR confidence ─────────────────────────────────────────
    ocr_score = signals["ocr_confidence"]
    if "ocr_confidence" in weights:
        factors.append({
            "factor": "OCR Confidence",
            "weight": weights["ocr_confidence"],
            "value": round(ocr_score, 4),
            "contribution": round(ocr_score * weights["ocr_confidence"], 4),
            "detail": f"OCR confidence: {ocr_score:.2f}",
        })
        score_sum += ocr_score * weights["ocr_confidence"]
        weight_sum += weights["ocr_confidence"]

    if ocr_score >= 0.85:
        reason_codes.append("OCR_SUCCESS")
    elif ocr_score < 0.5:
        reason_codes.append("OCR_GARBLED")
    elif ocr_score < 0.7:
        reason_codes.append("OCR_LOW_CONFIDENCE")

    # ─── Final score ─────────────────────────────────────────────
    final_score = score_sum / weight_sum if weight_sum > 0 else 0

    # ─── Decision ────────────────────────────────────────────────
    has_critical = any(REASON_CODES.get(rc, ("", ""))[1] == "critical" for rc in reason_codes)

    if has_critical:
        decision = "reject"
        reason_codes.append("REJECTED")
    elif final_score >= thresholds["approve"]:
        decision = "approve"
        reason_codes.append("APPROVED")
    elif final_score >= thresholds["review"]:
        decision = "review"
        reason_codes.append("REVIEW_NEEDED")
    else:
        decision = "reject"
        reason_codes.append("REJECTED")

    # Dedupe reason codes while preserving order
    seen = set()
    deduped = []
    for rc in reason_codes:
        if rc not in seen:
            seen.add(rc)
            deduped.append(rc)
    reason_codes = deduped

    # ─── Explainability ──────────────────────────────────────────
    reasoning_lines = [
        f"Overall score: {final_score:.4f}",
        f"Decision: {decision} (threshold: approve={thresholds['approve']}, review={thresholds['review']})",
    ]
    for f in factors:
        sign = "+" if f["contribution"] > 0.1 else ("-" if f["contribution"] < 0 else "=")
        reasoning_lines.append(f"  {sign} {f['factor']}: {f['detail']}")

    reasoning_lines.append(f"Reason codes: {', '.join(reason_codes)}")

    # ─── Audit ──────────────────────────────────────────────────
    session_id = (payload.get("session_id") if isinstance(payload, dict) else None) \
                  or f"sess_{int(time.time())}"
    audit_entry = add_audit_entry(
        session_id=session_id,
        decision=decision,
        score=final_score,
        reason_codes=reason_codes,
        details={"doc": doc_score, "face": face_score, "live": live_score,
                 "sec": sec_score, "cf": cf_score, "ai": ai_score, "ocr": ocr_score},
    )

    return {
        "decision": decision,
        "score": round(final_score, 4),
        "reason_codes": reason_codes,
        "explainability": {
            "factors": factors,
            "reasoning": "\n".join(reasoning_lines),
            "signals": signals,
        },
        "audit": audit_entry,
    }


# ─── Chain-of-thought explanation ────────────────────────────────
def explain_decision(payload: dict) -> dict:
    """
    Produce a human-readable, chain-of-thought explanation of the risk
    decision. Format inspired by DeepSeek's reasoning trace:
      Step 1: Gathered signals X, Y, Z
      Step 2: Weighted them by W1, W2, W3
      Step 3: Computed weighted_sum = X*W1 + Y*W2 + Z*W3
      Step 4: Compared to threshold T (T=0.65 for approve, 0.60 for review)
      Step 5: Final decision: APPROVE/REVIEW/REJECT with reason codes
    """
    config = payload.get("config", {}) or {}
    weights = config.get("weights", DEFAULT_WEIGHTS)
    thresholds = config.get("thresholds", {"approve": 0.80, "review": 0.60, "reject": 0.0})

    # Run the full evaluation to get score, decision, factors
    result = evaluate_risk(
        doc_result=payload.get("document", {}),
        face_result=payload.get("face", {}),
        liveness_result=payload.get("liveness", {}),
        device_result=payload.get("device"),
        config=config,
        cross_field_result=payload.get("cross_field", {}),
        ai_consensus_result=payload.get("ai_consensus", {}),
        ocr_confidence=(payload.get("document", {}) or {}).get("ocr_confidence"),
        raw_payload=payload,
    )

    signals = result["explainability"]["signals"]
    factors = result["explainability"]["factors"]
    decision = result["decision"]
    score = result["score"]
    reason_codes = result["reason_codes"]

    # ─── Step 1: Gathered signals ───────────────────────────────
    step1_lines = ["Step 1 — Gathered signals:"]
    for k, v in signals.items():
        step1_lines.append(f"  - {k} = {v:.4f}")

    # ─── Step 2: Weights ────────────────────────────────────────
    step2_lines = ["Step 2 — Applied fusion weights:"]
    for k, w in weights.items():
        if k in signals:
            step2_lines.append(f"  - {k}: weight = {w:.2f}")

    # ─── Step 3: Weighted sum ───────────────────────────────────
    step3_lines = ["Step 3 — Computed weighted contribution per factor:"]
    for f in factors:
        step3_lines.append(
            f"  - {f['factor']}: {f['value']:.4f} × {f['weight']:.2f} = {f['contribution']:.4f}"
        )
    weighted_sum_str = " + ".join(f"{f['contribution']:.4f}" for f in factors)
    step3_lines.append(f"  weighted_sum = {weighted_sum_str} = {score:.4f}")

    # ─── Step 4: Threshold comparison ────────────────────────────
    step4_lines = [
        "Step 4 — Compared to decision thresholds:",
        f"  - approve threshold: {thresholds.get('approve', 0.80)}",
        f"  - review threshold: {thresholds.get('review', 0.60)}",
        f"  - score {score:.4f} {'≥' if score >= thresholds.get('approve', 0.80) else '<'} approve_threshold",
    ]
    if score >= thresholds.get("approve", 0.80):
        step4_lines.append(f"  → score meets or exceeds the APPROVE threshold.")
    elif score >= thresholds.get("review", 0.60):
        step4_lines.append(f"  → score falls in REVIEW range (between review and approve).")
    else:
        step4_lines.append(f"  → score below REVIEW threshold → REJECT path.")

    # ─── Step 5: Final decision ─────────────────────────────────
    step5_lines = [
        f"Step 5 — Final decision: {decision.upper()}",
        f"  Reason codes: {', '.join(reason_codes) if reason_codes else '(none)'}",
    ]
    # Add human-readable descriptions for each reason code
    for rc in reason_codes:
        desc, sev = REASON_CODES.get(rc, ("Unknown code", "info"))
        step5_lines.append(f"    • [{sev.upper():<8}] {rc}: {desc}")

    full_chain = "\n".join(step1_lines + [""] + step2_lines + [""] +
                           step3_lines + [""] + step4_lines + [""] + step5_lines)

    return {
        "decision": decision,
        "score": score,
        "reason_codes": reason_codes,
        "chain_of_thought": full_chain,
        "steps": {
            "step1_signals": signals,
            "step2_weights": weights,
            "step3_factors": factors,
            "step4_thresholds": thresholds,
            "step5_decision": decision,
        },
        "audit": result.get("audit"),
    }


# ─── HTTP Server ──────────────────────────────────────────────────
class RiskHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def log_message(self, *a): pass
    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def _send_json(self, status: int, payload: dict):
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(payload, default=str).encode())

    def _read_body(self):
        try:
            content_len = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            return None, {"error": "BAD_HEADER", "message": "Invalid Content-Length", "status": 400}
        if content_len > 10 * 1024 * 1024:
            return None, {"error": "PAYLOAD_TOO_LARGE", "message": "Request too large (>10MB)", "status": 413}
        if content_len <= 0:
            return b"", None
        try:
            return self.rfile.read(content_len), None
        except Exception as e:
            return None, {"error": "READ_FAILED", "message": f"Could not read body: {str(e)[:80]}", "status": 400}

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health':
            self._send_json(200, {
                "status": "healthy",
                "service": "risk-fusion",
                "port": 8003,
                "audit_entries": len(audit_chain),
                "endpoints": [
                    "/risk/evaluate", "/risk/explain",
                    "/risk/reason-codes", "/health", "/audit",
                ],
                "reason_code_count": len(REASON_CODES),
                "weights": DEFAULT_WEIGHTS,
            })
        elif path == '/risk/reason-codes':
            catalog = []
            for code, (desc, sev) in sorted(REASON_CODES.items()):
                catalog.append({
                    "code": code,
                    "description": desc,
                    "severity": sev,
                })
            self._send_json(200, {
                "total": len(REASON_CODES),
                "catalog": catalog,
                "severities": ["positive", "info", "warning", "negative", "critical"],
            })
        elif path == '/audit':
            self._send_json(200, {
                "entries": audit_chain[-100:],
                "total": len(audit_chain),
            })
        else:
            self._send_json(404, {"error": "NOT_FOUND", "message": f"Unknown path: {path}", "status": 404})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body, berr = self._read_body()
            if berr is not None:
                self._send_json(berr.get("status", 400), berr)
                return
            try:
                data = json.loads(body) if body else {}
            except json.JSONDecodeError as e:
                self._send_json(400, {"error": "BAD_JSON", "message": f"Invalid JSON: {str(e)[:80]}"})
                return

            if path == '/risk/evaluate':
                t0 = time.time()
                result = evaluate_risk(
                    doc_result=data.get("document", {}),
                    face_result=data.get("face", {}),
                    liveness_result=data.get("liveness", {}),
                    device_result=data.get("device"),
                    config=data.get("config"),
                    cross_field_result=data.get("cross_field", {}),
                    ai_consensus_result=data.get("ai_consensus", {}),
                    ocr_confidence=(data.get("document", {}) or {}).get("ocr_confidence"),
                    raw_payload=data,
                )
                result["latency_ms"] = round((time.time() - t0) * 1000)
                self._send_json(200, result)

            elif path == '/risk/explain':
                t0 = time.time()
                result = explain_decision(data)
                result["latency_ms"] = round((time.time() - t0) * 1000)
                self._send_json(200, result)

            else:
                self._send_json(404, {"error": "NOT_FOUND", "message": f"Unknown path: {path}", "status": 404})

        except Exception as e:
            tb = traceback.format_exc(limit=3)
            self._send_json(500, {
                "error": "INTERNAL_ERROR",
                "message": f"Internal server error: {str(e)[:120]}",
                "status": 500,
                "traceback": tb[:500],
            })


if __name__ == '__main__':
    PORT = 8003
    print(f"[Risk] Fusion engine starting on port {PORT}...", flush=True)
    print(f"[Risk] Reason code catalog: {len(REASON_CODES)} entries", flush=True)
    server = HTTPServer(('0.0.0.0', PORT), RiskHandler)
    print(f"[Risk] Listening on http://0.0.0.0:{PORT}", flush=True)
    print(f"[Risk] Weights: {DEFAULT_WEIGHTS}", flush=True)
    print(f"[Risk] Endpoints: /risk/evaluate, /risk/explain, /risk/reason-codes, /health, /audit", flush=True)
    server.serve_forever()
