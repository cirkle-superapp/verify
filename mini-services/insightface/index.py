#!/usr/bin/env python3
"""
Cirkle InsightFace Mini-Service (port 3041)
ArcFace face recognition — 99.8% LFW accuracy (MIT)
Zero cost. No billing. No external API.
"""
import json, base64, sys, traceback, os
from http.server import HTTPServer, BaseHTTPRequestHandler

_app = None

def get_app():
    global _app
    if _app is None:
        print("[InsightFace] Loading ArcFace models (buffalo_l)...", flush=True)
        from insightface.app import FaceAnalysis
        _app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
        _app.prepare(ctx_id=-1, det_size=(640, 640))
        print("[InsightFace] Ready!", flush=True)
    return _app

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def log_message(self, f, *a): pass
    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200); self._cors()
            self.send_header('Content-Type', 'application/json'); self.end_headers()
            status = "ready" if _app is not None else "initializing"
            self.wfile.write(json.dumps({"status": status, "engine": "InsightFace ArcFace", "accuracy": "99.8% LFW"}).encode())
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != '/match':
            self.send_response(404); self.end_headers(); return
        try:
            body = self.rfile.read(int(self.headers['Content-Length'])).decode('utf-8')
            data = json.loads(body)
            selfie_data = data.get('selfie', '')
            doc_data = data.get('document', '')
            if not selfie_data or not doc_data:
                self.send_response(400); self._cors()
                self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps({"error": "selfie and document required"}).encode()); return

            import cv2, numpy as np
            def decode(data_url):
                b64 = data_url.split(',')[1]
                img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), np.uint8), cv2.IMREAD_COLOR)
                return img

            selfie_img = decode(selfie_data)
            doc_img = decode(doc_data)

            app = get_app()
            faces1 = app.get(selfie_img)
            faces2 = app.get(doc_img)

            if not faces1:
                result = {"isMatch": False, "samePerson": False, "similarity": 0,
                          "reasoning": "No face detected in selfie."}
            elif not faces2:
                result = {"isMatch": False, "samePerson": False, "similarity": 0,
                          "reasoning": "No face detected in document image."}
            else:
                # Get embeddings (512-d vectors)
                emb1 = faces1[0].embedding
                emb2 = faces2[0].embedding
                # Cosine similarity
                import numpy as np
                cos_sim = np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))
                similarity = max(0, min(100, cos_sim * 100))
                det_score1 = float(faces1[0].det_score)
                det_score2 = float(faces2[0].det_score)
                is_match = similarity >= 50
                result = {
                    "isMatch": bool(is_match),
                    "samePerson": bool(is_match),
                    "similarity": round(similarity, 1),
                    "reasoning": f"Cosine similarity: {cos_sim:.4f}, score: {similarity:.1f}%, "
                                 f"selfie det: {det_score1:.2f}, doc det: {det_score2:.2f}",
                }

            self.send_response(200); self._cors()
            self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            traceback.print_exc()
            self.send_response(500); self._cors()
            self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

if __name__ == '__main__':
    PORT = 3041
    print(f"[InsightFace] Starting on port {PORT}...", flush=True)
    try: get_app()
    except Exception as e: print(f"[InsightFace] Pre-warm failed: {e}", flush=True)
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    print(f"[InsightFace] Listening on http://localhost:{PORT}", flush=True)
    server.serve_forever()
