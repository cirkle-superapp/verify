#!/usr/bin/env python3
"""
Cirkle FastAPI Gateway — Unified API for the self-hosted KYC platform.

Ties together all inference services:
  - Face Analysis (port 8001): detection + embedding + 1:1 matching
  - Passive Liveness (port 8002): 5-signal PAD
  - Risk Fusion (port 8003): weighted decision + audit
  - Document Intelligence (port 8004): OCR + MRZ + forensics

Port: 8000
"""

import json
import time
import hashlib
import asyncio
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import httpx

app = FastAPI(title="Cirkle Identity Platform API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

FACE_URL = "http://localhost:8001"
LIVENESS_URL = "http://localhost:8002"
RISK_URL = "http://localhost:8003"
DOC_URL = "http://localhost:8004"
sessions = {}

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
    config: Optional[dict] = None

class FullVerificationRequest(BaseModel):
    doc_image: str
    selfie_image: str
    liveness_frames: List[str]
    doc_type: str = "national_id"

@app.get("/health")
async def health():
    async with httpx.AsyncClient(timeout=5) as client:
        checks = {}
        for name, url in [("face", FACE_URL), ("liveness", LIVENESS_URL), ("risk", RISK_URL), ("document", DOC_URL)]:
            try:
                r = await client.get(f"{url}/health")
                checks[name] = {"ok": r.status_code == 200}
            except:
                checks[name] = {"ok": False}
        all_ok = all(c["ok"] for c in checks.values())
        return {"status": "healthy" if all_ok else "degraded", "services": checks}

@app.post("/v1/sessions")
async def create_session(req: CreateSessionRequest):
    session_id = f"sess_{int(time.time())}_{hashlib.md5(str(time.time()).encode()).hexdigest()[:6]}"
    sessions[session_id] = {"id": session_id, "doc_type": req.doc_type, "country": req.country, "webhook_url": req.webhook_url, "status": "created", "created_at": time.time(), "steps": {}}
    return {"session_id": session_id, "status": "created"}

@app.get("/v1/sessions/{session_id}")
async def get_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(404, "Session not found")
    return sessions[session_id]

@app.post("/v1/verify/document")
async def verify_document(req: DocumentRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{DOC_URL}/document/analyze", json={"image": req.image, "doc_type": req.doc_type})
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
            r = await client.post(f"{FACE_URL}/face/match", json={"image1": req.image1, "image2": req.image2})
            return r.json()
        except Exception as e:
            return {"is_match": False, "error": f"Face service unavailable: {str(e)[:100]}"}

@app.post("/v1/verify/liveness/passive")
async def liveness_passive(req: LivenessRequest):
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(f"{LIVENESS_URL}/liveness/passive", json={"frames": req.frames})
            return r.json()
        except Exception as e:
            return {"is_live": False, "pad_score": 1.0, "error": f"Liveness service unavailable: {str(e)[:100]}"}

@app.post("/v1/verify/risk/evaluate")
async def risk_evaluate(req: RiskRequest):
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(f"{RISK_URL}/risk/evaluate", json={"document": req.document, "face": req.face, "liveness": req.liveness, "device": req.device, "config": req.config})
            return r.json()
        except Exception as e:
            return {"decision": "review", "score": 0, "error": f"Risk service unavailable: {str(e)[:100]}"}

@app.post("/v1/verify/full")
async def full_verification(req: FullVerificationRequest):
    session_id = f"sess_{int(time.time())}"
    t0 = time.time()
    async with httpx.AsyncClient(timeout=60) as client:
        tasks = [
            client.post(f"{DOC_URL}/document/analyze", json={"image": req.doc_image, "doc_type": req.doc_type}),
            client.post(f"{FACE_URL}/face/analyze", json={"image": req.selfie_image}),
            client.post(f"{LIVENESS_URL}/liveness/passive", json={"frames": req.liveness_frames}),
        ]
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        doc_result = responses[0].json() if not isinstance(responses[0], Exception) and responses[0].status_code == 200 else {}
        face_selfie = responses[1].json() if not isinstance(responses[1], Exception) and responses[1].status_code == 200 else {}
        liveness_result = responses[2].json() if not isinstance(responses[2], Exception) and responses[2].status_code == 200 else {}

    face_match_result = {"is_match": False, "similarity": 0}
    if face_selfie.get("detected"):
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                r = await client.post(f"{FACE_URL}/face/match", json={"image1": req.selfie_image, "image2": req.doc_image})
                face_match_result = r.json()
            except: pass

    risk_input = {"document": doc_result, "face": {**face_match_result, "quality": face_selfie.get("quality", {})}, "liveness": liveness_result}
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.post(f"{RISK_URL}/risk/evaluate", json=risk_input)
            risk_result = r.json()
        except:
            risk_result = {"decision": "review", "score": 0, "reason_codes": ["RISK_SERVICE_UNAVAILABLE"]}

    elapsed = time.time() - t0
    return {
        "session_id": session_id, "decision": risk_result.get("decision"), "score": risk_result.get("score"),
        "reason_codes": risk_result.get("reason_codes"), "explainability": risk_result.get("explainability"),
        "audit": risk_result.get("audit"),
        "results": {"document": doc_result, "face": {"selfie": face_selfie, "match": face_match_result}, "liveness": liveness_result},
        "elapsed_ms": round(elapsed * 1000), "engine": "self-hosted-python",
    }

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
                        await ws.send_json({"type": "quality", "score": result.get("quality", {}).get("score", 0), "blur": result.get("quality", {}).get("blur", False), "glare": result.get("quality", {}).get("glare", False), "detected": result.get("detected", False)})
                    except:
                        await ws.send_json({"type": "quality", "score": 0, "error": "service_unavailable"})
    except WebSocketDisconnect: pass

if __name__ == "__main__":
    import uvicorn
    print("[Gateway] Cirkle Identity Platform API starting on port 8000...", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=8000)
