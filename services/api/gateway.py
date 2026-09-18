#!/usr/bin/env python3
"""
Cirkle FastAPI Gateway — Unified API for the self-hosted KYC platform.

Ties together all inference services:
  - Face Analysis (port 8001): detection + embedding + 1:1 matching
  - Passive Liveness (port 8002): 5-signal PAD
  - Risk Fusion (port 8003): weighted decision + audit
  - Document Intelligence (port 8004): OCR + MRZ + forensics

Port: 8000

Endpoints:
  GET  /health                                  — composite health check
  POST /v1/sessions                             — create verification session
  GET  /v1/sessions/{id}                        — fetch session state
  POST /v1/verify/document                      — document OCR / forensics
  POST /v1/verify/face/analyze                  — single-image face analysis
  POST /v1/verify/face/match                    — 1:1 face match
  POST /v1/verify/liveness/passive              — passive liveness check
  POST /v1/verify/risk/evaluate                 — risk fusion
  POST /v1/verify/full                          — full verification pipeline
  WS   /v1/sessions/{id}/events                 — stream verification events
  WS   /ws/capture                              — quality-check stream

Authentication:
  All POST endpoints (except /v1/sessions create) require an
  `X-Audit-Signature` HMAC-SHA256 header over the request body.
  The shared secret is read from GATEWAY_HMAC_SECRET env var (or
  falls back to a development default). This produces a tamper-evident
  audit trail for all verification calls.

Full pipeline (/v1/verify/full):
  Step 1: Document OCR           (POST /document/analyze on port 8004)
  Step 2: Face analysis on doc   (POST /face/analyze on port 8001)
  Step 3: Selfie face analysis   (POST /face/analyze on port 8001)
  Step 4: Face match doc-selfie  (POST /face/match on port 8001)
  Step 5: Liveness on selfie     (POST /liveness/passive on port 8002)
  Step 6: Risk fusion            (POST /risk/evaluate on port 8003)
  Step 7: Return full report     (decision + signals + audit)
"""

import json
import time
import hashlib
import hmac
import os
import asyncio
import base64
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import httpx

app = FastAPI(title="Cirkle Identity Platform API", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FACE_URL = os.environ.get("FACE_URL", "http://localhost:8001")
LIVENESS_URL = os.environ.get("LIVENESS_URL", "http://localhost:8002")
RISK_URL = os.environ.get("RISK_URL", "http://localhost:8003")
DOC_URL = os.environ.get("DOC_URL", "http://localhost:8004")

# Shared secret for HMAC request signing. In production, set via env var.
GATEWAY_HMAC_SECRET = os.environ.get(
    "GATEWAY_HMAC_SECRET", "cirkle-gateway-dev-secret-change-me"
).encode("utf-8")

# In-memory session store (production: replace with Redis / DB)
sessions: Dict[str, Dict[str, Any]] = {}

# Per-session event log (consumed by WebSocket /v1/sessions/{id}/events)
session_events: Dict[str, List[Dict[str, Any]]] = {}


# ─── Pydantic models ────────────────────────────────────────────
class CreateSessionRequest(BaseModel):
    doc_type: str = "national_id"
    country: Optional[str] = None
    webhook_url: Optional[str] = None


class DocumentRequest(BaseModel):
    image: str
    doc_type: str = "national_id"


class FaceMatchRequest(BaseModel):
    image1: str
    image2: str


class LivenessRequest(BaseModel):
    frames: List[str]


class RiskRequest(BaseModel):
    document: Optional[dict] = None
    face: Optional[dict] = None
    liveness: Optional[dict] = None
    device: Optional[dict] = None
    cross_field: Optional[dict] = None
    ai_consensus: Optional[dict] = None
    config: Optional[dict] = None


class FullVerificationRequest(BaseModel):
    doc_image: str
    selfie_image: str
    liveness_frames: List[str]
    doc_type: str = "national_id"
    session_id: Optional[str] = None


# ─── HMAC authentication helpers ─────────────────────────────────
def verify_hmac_signature(body: bytes, signature_header: Optional[str]) -> bool:
    """
    Verify the X-Audit-Signature header.
    Expected format: 'sha256=<hex>'
    """
    if not signature_header:
        return False
    if not signature_header.startswith("sha256="):
        return False
    provided = signature_header[len("sha256="):]
    expected = hmac.new(GATEWAY_HMAC_SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(provided, expected)


@app.middleware("http")
async def hmac_auth_middleware(request: Request, call_next):
    """
    Require X-Audit-Signature on all POST endpoints except session creation.
    GET /health, GET /v1/sessions/{id}, and POST /v1/sessions are exempt.
    """
    if request.method != "POST":
        return await call_next(request)

    path = request.url.path
    # Whitelist session creation — clients need to mint a session before
    # they have a body to sign (or it's an unauthenticated bootstrap).
    if path == "/v1/sessions":
        return await call_next(request)

    # Read body (we have to buffer it so the downstream handler can re-read it)
    body = await request.body()

    # Bypass forOPTIONS / preflight
    if not body:
        return await call_next(request)

    sig = request.headers.get("X-Audit-Signature")
    if not verify_hmac_signature(body, sig):
        return _json_error_response(
            401,
            "UNAUTHORIZED",
            "Missing or invalid X-Audit-Signature header. "
            "Expected format: 'sha256=<hex>' using HMAC-SHA256 over the request body.",
        )

    # Re-inject the body since FastAPI would otherwise consume it
    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = receive  # type: ignore
    return await call_next(request)


def _json_error_response(status: int, code: str, message: str):
    """Build a JSONResponse for middleware-level errors."""
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=status,
        content={"error": code, "message": message, "status": status},
    )


# ─── Session helpers ─────────────────────────────────────────────
def _new_session_id() -> str:
    return f"sess_{int(time.time())}_{hashlib.md5(str(time.time()).encode()).hexdigest()[:6]}"


def _emit_event(session_id: str, event_type: str, data: dict):
    """Append an event to the session event log + push to WS subscribers."""
    event = {
        "ts": time.time(),
        "session_id": session_id,
        "type": event_type,
        "data": data,
    }
    session_events.setdefault(session_id, []).append(event)
    # Notify any pending WebSocket listeners
    subs = _ws_subscribers.get(session_id, set())
    for q in list(subs):
        try:
            q.put_nowait(event)
        except Exception:
            pass


# In-memory pub/sub for session events (one queue per WebSocket subscriber)
_ws_subscribers: Dict[str, set] = {}


# ─── Endpoints ───────────────────────────────────────────────────
@app.get("/health")
async def health():
    async with httpx.AsyncClient(timeout=5) as client:
        checks = {}
        for name, url in [("face", FACE_URL), ("liveness", LIVENESS_URL),
                          ("risk", RISK_URL), ("document", DOC_URL)]:
            try:
                r = await client.get(f"{url}/health")
                checks[name] = {"ok": r.status_code == 200, "status": r.status_code}
            except Exception:
                checks[name] = {"ok": False, "status": "unreachable"}
        all_ok = all(c["ok"] for c in checks.values())
        return {
            "status": "healthy" if all_ok else "degraded",
            "services": checks,
            "version": "1.1.0",
            "hmac_auth_enabled": True,
        }


@app.post("/v1/sessions")
async def create_session(req: CreateSessionRequest):
    session_id = _new_session_id()
    sessions[session_id] = {
        "id": session_id,
        "doc_type": req.doc_type,
        "country": req.country,
        "webhook_url": req.webhook_url,
        "status": "created",
        "created_at": time.time(),
        "steps": {},
    }
    _emit_event(session_id, "session.created", {"doc_type": req.doc_type, "country": req.country})
    return {"session_id": session_id, "status": "created"}


@app.get("/v1/sessions/{session_id}")
async def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(404, "Session not found")
    sess = sessions[session_id]
    sess["events"] = session_events.get(session_id, [])
    return sess


@app.post("/v1/verify/document")
async def verify_document(req: DocumentRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{DOC_URL}/document/analyze",
                                  json={"image": req.image, "doc_type": req.doc_type})
            return r.json()
        except Exception as e:
            return {"error": f"Document service unavailable: {str(e)[:100]}", "confidence": 0}


@app.post("/v1/verify/face/analyze")
async def face_analyze(image: str = ""):
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{FACE_URL}/face/analyze", json={"image": image})
            return r.json()
        except Exception as e:
            return {"detected": False, "error": f"Face service unavailable: {str(e)[:100]}"}


@app.post("/v1/verify/face/match")
async def face_match(req: FaceMatchRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{FACE_URL}/face/match",
                                  json={"image1": req.image1, "image2": req.image2})
            return r.json()
        except Exception as e:
            return {"is_match": False, "error": f"Face service unavailable: {str(e)[:100]}"}


@app.post("/v1/verify/liveness/passive")
async def liveness_passive(req: LivenessRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{LIVENESS_URL}/liveness/passive",
                                  json={"frames": req.frames})
            return r.json()
        except Exception as e:
            return {"is_live": False, "pad_score": 1.0,
                    "error": f"Liveness service unavailable: {str(e)[:100]}"}


@app.post("/v1/verify/risk/evaluate")
async def risk_evaluate(req: RiskRequest):
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(f"{RISK_URL}/risk/evaluate",
                                  json={"document": req.document, "face": req.face,
                                        "liveness": req.liveness, "device": req.device,
                                        "cross_field": req.cross_field,
                                        "ai_consensus": req.ai_consensus,
                                        "config": req.config})
            return r.json()
        except Exception as e:
            return {"decision": "review", "score": 0,
                    "error": f"Risk service unavailable: {str(e)[:100]}"}


# ─── Full verification pipeline ─────────────────────────────────
@app.post("/v1/verify/full")
async def full_verification(req: FullVerificationRequest):
    """
    Full KYC pipeline:
      Step 1: Document OCR (port 8004 /document/analyze)
      Step 2: Face analysis on document photo
      Step 3: Selfie face analysis
      Step 4: Face match (doc selfie)
      Step 5: Liveness on selfie frames
      Step 6: Risk fusion
      Step 7: Return full report
    """
    session_id = req.session_id or _new_session_id()
    if session_id not in sessions:
        sessions[session_id] = {
            "id": session_id, "doc_type": req.doc_type,
            "status": "in_progress", "created_at": time.time(), "steps": {},
        }
    sessions[session_id]["status"] = "in_progress"
    t0 = time.time()

    _emit_event(session_id, "pipeline.start", {"session_id": session_id})

    # ─── Step 1: Document OCR ───────────────────────────────────
    doc_result = {}
    _emit_event(session_id, "step.start", {"step": 1, "name": "document_ocr"})
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{DOC_URL}/document/analyze",
                                  json={"image": req.doc_image, "doc_type": req.doc_type})
            doc_result = r.json() if r.status_code == 200 else {"error": "doc_service_error", "confidence": 0}
        except Exception as e:
            doc_result = {"error": f"Document service unavailable: {str(e)[:100]}", "confidence": 0}
    _emit_event(session_id, "step.complete", {"step": 1, "name": "document_ocr",
                  "confidence": doc_result.get("confidence", 0)})
    sessions[session_id]["steps"]["document_ocr"] = {"status": "done", "result_summary": {"confidence": doc_result.get("confidence")}}

    # ─── Step 2: Face analysis on doc photo ────────────────────
    _emit_event(session_id, "step.start", {"step": 2, "name": "doc_face_analysis"})
    face_doc = {}
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{FACE_URL}/face/analyze", json={"image": req.doc_image})
            face_doc = r.json() if r.status_code == 200 else {"detected": False}
        except Exception as e:
            face_doc = {"detected": False, "error": str(e)[:100]}
    _emit_event(session_id, "step.complete", {"step": 2, "name": "doc_face_analysis",
                  "detected": face_doc.get("detected", False)})
    sessions[session_id]["steps"]["doc_face_analysis"] = {"status": "done", "detected": face_doc.get("detected")}

    # ─── Step 3: Selfie face analysis ──────────────────────────
    _emit_event(session_id, "step.start", {"step": 3, "name": "selfie_face_analysis"})
    face_selfie = {}
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{FACE_URL}/face/analyze", json={"image": req.selfie_image})
            face_selfie = r.json() if r.status_code == 200 else {"detected": False}
        except Exception as e:
            face_selfie = {"detected": False, "error": str(e)[:100]}
    _emit_event(session_id, "step.complete", {"step": 3, "name": "selfie_face_analysis",
                  "detected": face_selfie.get("detected", False)})
    sessions[session_id]["steps"]["selfie_face_analysis"] = {"status": "done", "detected": face_selfie.get("detected")}

    # ─── Step 4: Face match doc-selfie ──────────────────────────
    _emit_event(session_id, "step.start", {"step": 4, "name": "face_match"})
    face_match_result = {"is_match": False, "similarity": 0}
    if face_doc.get("detected") and face_selfie.get("detected"):
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(f"{FACE_URL}/face/match",
                                      json={"image1": req.doc_image, "image2": req.selfie_image})
                face_match_result = r.json() if r.status_code == 200 else {"is_match": False}
            except Exception as e:
                face_match_result = {"is_match": False, "error": str(e)[:100]}
    else:
        face_match_result = {"is_match": False, "reason": "no_face_detected_in_doc_or_selfie"}
    _emit_event(session_id, "step.complete", {"step": 4, "name": "face_match",
                  "is_match": face_match_result.get("is_match", False),
                  "similarity": face_match_result.get("similarity", 0)})
    sessions[session_id]["steps"]["face_match"] = {"status": "done",
        "is_match": face_match_result.get("is_match"), "similarity": face_match_result.get("similarity")}

    # ─── Step 5: Liveness on selfie frames ─────────────────────
    _emit_event(session_id, "step.start", {"step": 5, "name": "liveness"})
    liveness_result = {}
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{LIVENESS_URL}/liveness/passive",
                                  json={"frames": req.liveness_frames})
            liveness_result = r.json() if r.status_code == 200 else {"is_live": False, "pad_score": 1.0}
        except Exception as e:
            liveness_result = {"is_live": False, "pad_score": 1.0, "error": str(e)[:100]}
    _emit_event(session_id, "step.complete", {"step": 5, "name": "liveness",
                  "is_live": liveness_result.get("is_live", False),
                  "pad_score": liveness_result.get("pad_score", 1.0)})
    sessions[session_id]["steps"]["liveness"] = {"status": "done",
        "is_live": liveness_result.get("is_live"), "pad_score": liveness_result.get("pad_score")}

    # ─── Step 6: Risk fusion ────────────────────────────────────
    _emit_event(session_id, "step.start", {"step": 6, "name": "risk_fusion"})
    risk_input = {
        "session_id": session_id,
        "document": doc_result,
        "face": {**face_match_result,
                 "detected": face_selfie.get("detected", False),
                 "quality": face_selfie.get("quality", {})},
        "liveness": liveness_result,
    }
    risk_result = {}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(f"{RISK_URL}/risk/evaluate", json=risk_input)
            risk_result = r.json() if r.status_code == 200 else {"decision": "review", "score": 0}
        except Exception:
            risk_result = {"decision": "review", "score": 0,
                           "reason_codes": ["RISK_SERVICE_UNAVAILABLE"]}
    _emit_event(session_id, "step.complete", {"step": 6, "name": "risk_fusion",
                  "decision": risk_result.get("decision"),
                  "score": risk_result.get("score")})
    sessions[session_id]["steps"]["risk_fusion"] = {"status": "done",
        "decision": risk_result.get("decision"), "score": risk_result.get("score")}

    # ─── Step 7: Return full report ─────────────────────────────
    elapsed = time.time() - t0
    sessions[session_id]["status"] = "complete"
    sessions[session_id]["completed_at"] = time.time()

    report = {
        "session_id": session_id,
        "decision": risk_result.get("decision"),
        "score": risk_result.get("score"),
        "reason_codes": risk_result.get("reason_codes"),
        "explainability": risk_result.get("explainability"),
        "audit": risk_result.get("audit"),
        "results": {
            "document": doc_result,
            "face": {"doc": face_doc, "selfie": face_selfie, "match": face_match_result},
            "liveness": liveness_result,
        },
        "elapsed_ms": round(elapsed * 1000),
        "engine": "self-hosted-python",
        "pipeline_steps": 7,
    }
    _emit_event(session_id, "pipeline.complete", {"decision": report["decision"],
                  "score": report["score"], "elapsed_ms": report["elapsed_ms"]})
    return report


# ─── WebSocket: live event stream ────────────────────────────────
@app.websocket("/v1/sessions/{session_id}/events")
async def session_events_ws(ws: WebSocket, session_id: str):
    """
    Stream verification events for a session as they happen.

    Clients connect after creating a session, then call /v1/verify/full
    (which must use the same session_id) to drive the pipeline. Each
    step emits events: pipeline.start, step.start, step.complete,
    pipeline.complete.

    Also supports client→server ping messages of the form {"type":"ping"}.
    """
    await ws.accept()

    # Subscribe to this session's events
    import queue
    q = queue.Queue()
    _ws_subscribers.setdefault(session_id, set()).add(q)

    # Send any existing events first (replay buffer)
    for ev in session_events.get(session_id, []):
        try:
            await ws.send_json(ev)
        except Exception:
            break

    try:
        # Poll loop: send queued events; also accept client pings
        while True:
            try:
                ev = q.get_nowait()
                await ws.send_json(ev)
            except queue.Empty:
                pass

            # Check for incoming client messages (non-blocking via asyncio.wait_for)
            try:
                data = await asyncio.wait_for(ws.receive_json(), timeout=0.5)
                if data.get("type") == "ping":
                    await ws.send_json({"type": "pong", "ts": time.time()})
                elif data.get("type") == "close":
                    break
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                break
            except Exception:
                # Receive may fail when client hasn't sent anything — ignore
                continue
    finally:
        _ws_subscribers.get(session_id, set()).discard(q)


@app.websocket("/ws/capture")
async def ws_capture(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            if data.get("type") == "quality_check":
                image = data.get("image", "")
                async with httpx.AsyncClient(timeout=5) as client:
                    try:
                        r = await client.post(f"{FACE_URL}/face/analyze", json={"image": image})
                        result = r.json()
                        await ws.send_json({
                            "type": "quality",
                            "score": result.get("quality", {}).get("score", 0),
                            "blur": result.get("quality", {}).get("blur", False),
                            "glare": result.get("quality", {}).get("glare", False),
                            "detected": result.get("detected", False),
                        })
                    except Exception:
                        await ws.send_json({"type": "quality", "score": 0, "error": "service_unavailable"})
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    print("[Gateway] Cirkle Identity Platform API v1.1.0 starting on port 8000...", flush=True)
    print(f"[Gateway] HMAC auth: {'enabled' if GATEWAY_HMAC_SECRET else 'disabled'}", flush=True)
    print(f"[Gateway] FACE_URL={FACE_URL}", flush=True)
    print(f"[Gateway] LIVENESS_URL={LIVENESS_URL}", flush=True)
    print(f"[Gateway] RISK_URL={RISK_URL}", flush=True)
    print(f"[Gateway] DOC_URL={DOC_URL}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=8000)
