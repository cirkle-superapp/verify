#!/usr/bin/env python3
"""
Cirkle Risk Fusion Engine — Weighted decision fusion with explainability.

Combines results from all modules:
  - Document authenticity (OCR + MRZ + forensics)
  - Face match (1:1 comparison)
  - Liveness (passive + active)
  - Device signals (optional)

Outputs:
  - decision: approve | review | reject
  - score: 0-1 (weighted fusion)
  - reason_codes: list of specific reason codes
  - explainability: chain-of-thought reasoning
  - audit: immutable audit trail entry

Port: 8003
"""

import json
import time
import hashlib
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ─── Default weights ─────────────────────────────────────────────
DEFAULT_WEIGHTS = {
    "document_authenticity": 0.30,
    "face_match": 0.35,
    "liveness": 0.25,
    "device_signals": 0.10,
}

# ─── Reason codes ────────────────────────────────────────────────
REASON_CODES = {
    # Document
    "DOC_PASS": ("Document authenticity verified", "positive"),
    "DOC_FORGERY": ("Document forgery detected", "critical"),
    "DOC_EXPIRED": ("Document expired", "negative"),
    "DOC_TAMPERED": ("Document image tampered", "critical"),
    "DOC_MRZ_INVALID": ("MRZ check digit invalid", "negative"),
    "DOC_LOW_CONFIDENCE": ("Document OCR confidence low", "warning"),
    # Face
    "FACE_MATCH": ("Face matches document photo", "positive"),
    "FACE_MISMATCH": ("Face does not match document", "critical"),
    "FACE_NO_FACE": ("No face detected", "critical"),
    "FACE_LOW_QUALITY": ("Face image quality too low", "warning"),
    # Liveness
    "LIVE_CONFIRMED": ("Liveness confirmed", "positive"),
    "LIVE_FAILED": ("Liveness check failed — possible spoof", "critical"),
    "LIVE_LOW_SCORE": ("Liveness score below threshold", "negative"),
    # Decision
    "APPROVED": ("Verification approved", "positive"),
    "REVIEW_NEEDED": ("Manual review required", "warning"),
    "REJECTED": ("Verification rejected", "negative"),
}

# ─── Audit chain ─────────────────────────────────────────────────
audit_chain = []

def add_audit_entry(session_id: str, decision: str, score: float, reason_codes: list, details: dict):
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
    
    # Compute this entry's hash
    entry_str = json.dumps({k: v for k, v in entry.items()}, sort_keys=True)
    entry["hash"] = hashlib.sha256(entry_str.encode()).hexdigest()[:16]
    
    audit_chain.append(entry)
    return entry


# ─── Risk fusion ─────────────────────────────────────────────────
def evaluate_risk(doc_result: dict, face_result: dict, liveness_result: dict,
                  device_result: dict = None, config: dict = None) -> dict:
    """
    Weighted fusion of all module results.
    
    Returns: {
        decision, score, reason_codes, explainability, audit
    }
    """
    weights = config.get("weights", DEFAULT_WEIGHTS) if config else DEFAULT_WEIGHTS
    thresholds = config.get("thresholds", {
        "approve": 0.80,
        "review": 0.60,
        "reject": 0.0,
    }) if config else {"approve": 0.80, "review": 0.60, "reject": 0.0}
    
    reason_codes = []
    factors = []
    score_sum = 0
    weight_sum = 0
    
    # ─── Document ───────────────────────────────────────────────
    doc_score = 0.5
    if doc_result:
        doc_conf = doc_result.get("confidence", 0)
        tampering = doc_result.get("forensics", {}).get("tampering_score", 0)
        mrz_valid = doc_result.get("mrz", {}).get("check_digits_valid", True)
        
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
        
        factors.append({
            "factor": "Document Authenticity",
            "contribution": round(doc_score * weights["document_authenticity"], 3),
            "detail": f"OCR confidence: {doc_conf:.2f}, tampering: {tampering:.2f}, MRZ valid: {mrz_valid}",
        })
        score_sum += doc_score * weights["document_authenticity"]
        weight_sum += weights["document_authenticity"]
    
    # ─── Face ───────────────────────────────────────────────────
    face_score = 0.5
    if face_result:
        if not face_result.get("detected", True) and "embedding" not in face_result:
            face_score = 0
            reason_codes.append("FACE_NO_FACE")
        else:
            is_match = face_result.get("is_match", False)
            similarity = face_result.get("similarity", 0)
            quality = face_result.get("quality", {}).get("score", 0.5) if isinstance(face_result.get("quality"), dict) else 0.5
            
            if is_match:
                face_score = min(1.0, similarity * 1.2)
                reason_codes.append("FACE_MATCH")
            else:
                face_score = similarity * 0.3
                reason_codes.append("FACE_MISMATCH")
            
            if quality < 0.4:
                reason_codes.append("FACE_LOW_QUALITY")
                face_score *= 0.7
        
        factors.append({
            "factor": "Face Match",
            "contribution": round(face_score * weights["face_match"], 3),
            "detail": f"Similarity: {face_result.get('similarity', 0):.4f}, match: {face_result.get('is_match', False)}, quality: {quality:.2f}",
        })
        score_sum += face_score * weights["face_match"]
        weight_sum += weights["face_match"]
    
    # ─── Liveness ───────────────────────────────────────────────
    live_score = 0.5
    if liveness_result:
        is_live = liveness_result.get("is_live", False)
        pad_score = liveness_result.get("pad_score", 1.0)
        
        live_score = 1.0 - pad_score
        if is_live:
            reason_codes.append("LIVE_CONFIRMED")
        else:
            reason_codes.append("LIVE_FAILED")
            live_score = 0
        
        signals = liveness_result.get("signals", {})
        signal_detail = ", ".join(f"{k}: {v.get('score', 0):.2f}" for k, v in signals.items())
        
        factors.append({
            "factor": "Liveness",
            "contribution": round(live_score * weights["liveness"], 3),
            "detail": f"PAD score: {pad_score:.4f}, live: {is_live}. Signals: {signal_detail}",
        })
        score_sum += live_score * weights["liveness"]
        weight_sum += weights["liveness"]
    
    # ─── Device (optional) ──────────────────────────────────────
    if device_result and weights.get("device_signals", 0) > 0:
        device_score = device_result.get("trust_score", 0.5)
        score_sum += device_score * weights["device_signals"]
        weight_sum += weights["device_signals"]
    
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
    audit_entry = add_audit_entry(
        session_id=f"sess_{int(time.time())}",
        decision=decision,
        score=final_score,
        reason_codes=reason_codes,
        details={"doc": doc_score, "face": face_score, "live": live_score},
    )
    
    return {
        "decision": decision,
        "score": round(final_score, 4),
        "reason_codes": reason_codes,
        "explainability": {
            "factors": factors,
            "reasoning": "\n".join(reasoning_lines),
        },
        "audit": audit_entry,
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

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/health':
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "healthy",
                "service": "risk-fusion",
                "port": 8003,
                "audit_entries": len(audit_chain),
            }).encode())
        elif path == '/audit':
            self.send_response(200)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"entries": audit_chain[-100:], "total": len(audit_chain)}).encode())
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            content_len = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_len)
            data = json.loads(body) if body else {}
            
            if path == '/risk/evaluate':
                t0 = time.time()
                result = evaluate_risk(
                    doc_result=data.get("document", {}),
                    face_result=data.get("face", {}),
                    liveness_result=data.get("liveness", {}),
                    device_result=data.get("device"),
                    config=data.get("config"),
                )
                result["latency_ms"] = round((time.time() - t0) * 1000)
                
                self.send_response(200)
                self._cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(result, default=str).encode())
            else:
                self.send_response(404); self.end_headers()
        except Exception as e:
            self.send_response(500)
            self._cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)[:200]}).encode())


if __name__ == '__main__':
    PORT = 8003
    print(f"[Risk] Fusion engine starting on port {PORT}...", flush=True)
    server = HTTPServer(('0.0.0.0', PORT), RiskHandler)
    print(f"[Risk] Listening on http://0.0.0.0:{PORT}", flush=True)
    print(f"[Risk] Weights: {DEFAULT_WEIGHTS}", flush=True)
    server.serve_forever()
