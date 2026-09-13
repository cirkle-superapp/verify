#!/usr/bin/env python3
"""
Cirkle PaddleOCR Mini-Service (port 3040)
PP-OCRv4 multilingual OCR — Apache-2.0
Zero cost. No billing. No external API.
"""
import json, base64, sys, traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

_ocr = None

def get_ocr():
    global _ocr
    if _ocr is None:
        print("[PaddleOCR] Initializing PP-OCRv4 (en+multilingual)...", flush=True)
        from paddleocr import PaddleOCR
        _ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=True)
        print("[PaddleOCR] Ready!", flush=True)
    return _ocr

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def log_message(self, format, *args): pass

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200); self._cors()
            self.send_header('Content-Type', 'application/json'); self.end_headers()
            status = "ready" if _ocr is not None else "initializing"
            self.wfile.write(json.dumps({"status": status, "engine": "PaddleOCR PP-OCRv4"}).encode())
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != '/ocr':
            self.send_response(404); self.end_headers(); return
        try:
            body = self.rfile.read(int(self.headers['Content-Length'])).decode('utf-8')
            data = json.loads(body)
            image_data = data.get('image', '')
            if not image_data or not image_data.startswith('data:'):
                self.send_response(400); self._cors()
                self.send_header('Content-Type', 'application/json'); self.end_headers()
                self.wfile.write(json.dumps({"error": "image required"}).encode()); return

            b64 = image_data.split(',')[1]
            img_bytes = base64.b64decode(b64)
            import cv2, numpy as np
            nparr = np.frombuffer(img_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            ocr = get_ocr()
            result = ocr.ocr(img, cls=True)

            texts = []; confidences = []; words = []
            if result and result[0]:
                for line in result[0]:
                    bbox = line[0]; text = line[1][0]; conf = line[1][1]
                    texts.append(text); confidences.append(conf)
                    words.append({"text": text, "confidence": round(conf, 3)})

            full_text = "\n".join(texts)
            avg_conf = sum(confidences) / len(confidences) if confidences else 0

            self.send_response(200); self._cors()
            self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps({
                "text": full_text, "confidence": round(avg_conf, 3),
                "words": words, "engine": "PaddleOCR PP-OCRv4", "wordCount": len(words)
            }).encode())
        except Exception as e:
            traceback.print_exc()
            self.send_response(500); self._cors()
            self.send_header('Content-Type', 'application/json'); self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

if __name__ == '__main__':
    PORT = 3040
    print(f"[PaddleOCR] Starting on port {PORT}...", flush=True)
    try: get_ocr()
    except Exception as e: print(f"[PaddleOCR] Pre-warm failed: {e}", flush=True)
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    print(f"[PaddleOCR] Listening on http://localhost:{PORT}", flush=True)
    server.serve_forever()
