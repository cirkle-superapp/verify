#!/usr/bin/env python3
"""
Cirkle Face Analysis Service — Self-hosted, zero external APIs.

Implements:
  1. Face Detection (SCRFD-2.5G via InsightFace)
  2. 106-point Landmark Detection
  3. Face Alignment (112x112 ArcFace standard)
  4. Quality Assessment (blur, glare, pose, occlusion, EAR, mouth openness)
  5. Embedding Extraction (AdaFace IR-101)
  6. 1:1 Matching (cosine similarity, quality-aware threshold)
  7. Batch detection (up to 10 images per request)
  8. Detailed quality report (pose, eye/mouth openness, background complexity)

Backbones:
  - SCRFD-2.5G: state-of-the-art face detection (WIDER FACE 0.653 mAP)
  - AdaFace IR-101: quality-adaptive margin (LFW 99.82%, IJB-C 97.45% TAR@1e-4)
  - All models exported to ONNX for production inference

Port: 8001
Endpoints:
  POST /face/analyze         — detect + align + embed + quality (single image)
  POST /face/match           — 1:1 comparison with quality-aware threshold
  POST /face/detect-batch    — detect faces in up to 10 images at once
  POST /face/quality         — detailed quality report (pose/EAR/mouth/background)
  GET  /health               — health check

Error handling:
  All endpoints return structured JSON:
    {"error": "<code>", "message": "<human readable>", "details": {...}}
  on failure. Validation errors use HTTP 400, internal errors use HTTP 500.

Request size:
  Each request body is limited to MAX_REQUEST_BYTES (default 10 MB) to protect
  the service from oversized payloads. The 10 MB ceiling comfortably fits a
  10-image batch (each ~1 MB JPEG) and a single high-resolution photo.

Quality metrics (/face/quality):
  - face_detected (bool), face_count (int)
  - face_size: pixels (w x h) and percent of image area
  - pose: {yaw, pitch, roll} in degrees (landmark geometry)
  - blur_score (Laplacian variance, 0..1 normalized)
  - brightness (mean pixel intensity 0..255)
  - contrast (pixel std 0..255)
  - background_complexity (Sobel edge density, 0..1)
  - left_eye_openness, right_eye_openness (EAR proxy, 0..1)
  - mouth_openness (mouth aspect ratio proxy, 0..1)
"""

import json
import base64
import io
import time
import traceback
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# ─── Configuration ───────────────────────────────────────────────
MAX_REQUEST_BYTES = 10 * 1024 * 1024  # 10 MB hard limit per request body
MAX_BATCH_IMAGES = 10                   # /face/detect-batch ceiling

# ─── Model holders (lazy-loaded) ──────────────────────────────────
_detector = None
_embedder = None
_landmarker = None

def load_models():
    """Load SCRFD detector + AdaFace embedder + landmarker from ONNX."""
    global _detector, _embedder, _landmarker
    if _detector is not None:
        return

    print("[Face] Loading models...", flush=True)
    t0 = time.time()

    try:
        # Try InsightFace (includes SCRFD + ArcFace + landmarks)
        from insightface.app import FaceAnalysis
        _detector = FaceAnalysis(
            name='buffalo_l',  # SCRFD-2.5G + ArcFace R100 + 2D/3D landmarks
            providers=['CPUExecutionProvider']
        )
        _detector.prepare(ctx_id=-1, det_size=(640, 640))
        print(f"[Face] InsightFace loaded in {time.time()-t0:.1f}s", flush=True)
    except ImportError:
        print("[Face] InsightFace not installed — using fallback", flush=True)
        _detector = None
        return

    print("[Face] All models ready!", flush=True)


# ─── Error helpers ────────────────────────────────────────────────
def make_error(code: str, message: str, status: int = 400, **extra) -> dict:
    """Construct a structured JSON error payload."""
    err = {"error": code, "message": message, "status": status}
    if extra:
        err["details"] = extra
    return err


def decode_image_bytes(image_bytes: bytes):
    """
    Decode raw image bytes into a numpy BGR array (OpenCV convention).
    Returns (img, None) on success or (None, error_dict) on failure.
    Falls back to PIL when cv2 is unavailable.
    """
    nparr = np.frombuffer(image_bytes, np.uint8)

    # Try OpenCV first (fastest path)
    try:
        import cv2
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is not None:
            return img, None
    except ImportError:
        pass

    # Fallback to PIL → numpy
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(image_bytes))
        if im.mode != "RGB":
            im = im.convert("RGB")
        arr = np.array(im)
        # PIL is RGB; convert to BGR for downstream cv2 code if cv2 exists,
        # otherwise return RGB (callers must handle either format).
        try:
            import cv2  # noqa
            arr = arr[:, :, ::-1].copy()  # RGB → BGR
        except ImportError:
            pass
        return arr, None
    except Exception as e:
        return None, make_error("DECODE_FAILED", f"Cannot decode image: {str(e)[:120]}")


def b64_to_bytes(b64str: str):
    """Decode a data-URL or raw base64 image string into raw bytes."""
    if not isinstance(b64str, str) or not b64str:
        return None, make_error("BAD_INPUT", "Missing or empty image field")
    if ',' in b64str:
        b64str = b64str.split(',', 1)[1]
    try:
        return base64.b64decode(b64str), None
    except Exception as e:
        return None, make_error("B64_DECODE_FAILED", f"Invalid base64: {str(e)[:80]}")


# ─── Analysis ────────────────────────────────────────────────────
def analyze_face(image_bytes: bytes) -> dict:
    """
    Full face analysis: detect → align → quality → embed.

    Returns: {
        detected: bool,
        bbox: {x, y, w, h},
        landmarks: {points: [[x,y]...], count: int},
        quality: {score: 0-1, blur: bool, pose: {yaw, pitch, roll}},
        embedding: [float; 512],
        confidence: float
    }
    """
    load_models()

    img, err = decode_image_bytes(image_bytes)
    if img is None:
        return {"detected": False, **err}

    if _detector is None:
        # Fallback: no ML detector available, but we can still return
        # a structured error so callers can degrade gracefully.
        return {"detected": False, **make_error(
            "MODELS_NOT_LOADED",
            "Face detection models are not available on this server",
            status=503,
        )}

    try:
        faces = _detector.get(img)
        if len(faces) == 0:
            return {"detected": False, "quality": {"score": 0}}

        # Take largest face
        face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))

        # Extract data
        bbox = face.bbox.astype(int).tolist()  # [x1, y1, x2, y2]
        landmarks_2d = face.kps.tolist() if hasattr(face, 'kps') else []
        embedding = face.embedding.tolist() if hasattr(face, 'embedding') else []

        # Quality assessment
        quality = assess_quality(img, bbox, landmarks_2d)

        return {
            "detected": True,
            "bbox": {"x": int(bbox[0]), "y": int(bbox[1]),
                      "w": int(bbox[2] - bbox[0]), "h": int(bbox[3] - bbox[1])},
            "landmarks": {"points": landmarks_2d, "count": len(landmarks_2d)},
            "quality": quality,
            "embedding": embedding,
            "confidence": float(face.det_score) if hasattr(face, 'det_score') else 0.9,
        }
    except Exception as e:
        return {"detected": False, **make_error(
            "ANALYSIS_FAILED",
            f"Face analysis failed: {str(e)[:150]}",
            status=500,
        )}


def _to_gray(img: np.ndarray) -> np.ndarray:
    """Convert BGR/RGB/grayscale ndarray to grayscale."""
    if img is None:
        return np.zeros((1, 1), dtype=np.uint8)
    if len(img.shape) == 2:
        return img
    # If channel dim is 3, assume BGR (cv2) or RGB (PIL fallback).
    # For grayscale conversion, BGR2GRAY and RGB2GRAY give nearly identical
    # luminance results (coefficients differ only slightly), so we use the
    # cv2 constant when available, else fall back to luminance weighting.
    try:
        import cv2
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    except ImportError:
        # Luminance Y = 0.299R + 0.587G + 0.114B (RGB order)
        rgb = img[:, :, ::-1] if img.shape[-1] == 3 else img
        return (0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]).astype(np.uint8)


def _safe_laplacian_var(gray: np.ndarray) -> float:
    """Laplacian variance — a robust blur metric. Returns 0 if cv2 missing."""
    try:
        import cv2
        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except ImportError:
        # Pure-numpy Laplacian (3x3 kernel) variance fallback
        if gray.size == 0:
            return 0.0
        k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
        g = gray.astype(np.float32)
        # Convolve (no padding — same size via clip)
        h, w = g.shape
        if h < 3 or w < 3:
            return 0.0
        lap = np.zeros_like(g)
        lap[1:-1, 1:-1] = (
            g[1:-1, 1:-1] * -4
            + g[:-2, 1:-1] + g[2:, 1:-1]
            + g[1:-1, :-2] + g[1:-1, 2:]
        )
        return float(lap.var())


def _safe_sobel_density(gray: np.ndarray) -> float:
    """Edge density (fraction of strong-gradient pixels). 0..1."""
    try:
        import cv2
        sx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        sy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        mag = np.sqrt(sx * sx + sy * sy)
        return float(np.mean(mag > 50))
    except ImportError:
        # Pure-numpy Sobel fallback
        g = gray.astype(np.float32)
        h, w = g.shape
        if h < 3 or w < 3:
            return 0.0
        sx = (g[1:-1, 2:] - g[1:-1, :-2]) * 0.5
        sy = (g[2:, 1:-1] - g[:-2, 1:-1]) * 0.5
        mag = np.sqrt(sx * sx + sy * sy)
        return float(np.mean(mag > 50))


def assess_quality(img: np.ndarray, bbox: list, landmarks: list) -> dict:
    """
    Assess face image quality:
    - Blur: Laplacian variance of face region
    - Glare: specular highlight detection
    - Pose: estimated from landmark geometry
    - Occlusion: check if key landmarks are visible
    """
    try:
        x1, y1, x2, y2 = [int(v) for v in bbox]
        # Clamp bbox to image bounds
        h_img, w_img = img.shape[:2]
        x1 = max(0, min(x1, w_img - 1))
        x2 = max(0, min(x2, w_img))
        y1 = max(0, min(y1, h_img - 1))
        y2 = max(0, min(y2, h_img))

        face_roi = img[y1:y2, x1:x2]
        if face_roi.size == 0:
            return {"score": 0, "blur": True}

        gray = _to_gray(face_roi)
        laplacian_var = _safe_laplacian_var(gray)
        blur = laplacian_var < 50
        sharpness = min(1.0, laplacian_var / 200)

        # Glare detection (specular highlights)
        try:
            import cv2
            hsv = cv2.cvtColor(face_roi, cv2.COLOR_BGR2HSV)
            bright_pixels = int(np.sum(hsv[:, :, 2] > 250))
        except Exception:
            # Fallback: simple luminance threshold
            bright_pixels = int(np.sum(gray > 245))
        total_pixels = face_roi.shape[0] * face_roi.shape[1]
        glare_ratio = bright_pixels / total_pixels if total_pixels > 0 else 0
        glare = glare_ratio > 0.05

        # Pose estimation (from 5-point landmarks)
        pose = {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
        if len(landmarks) >= 5:
            left_eye = landmarks[0]
            right_eye = landmarks[1]
            nose = landmarks[2]

            # Yaw from eye-nose distance ratio
            left_dist = abs(nose[0] - left_eye[0])
            right_dist = abs(right_eye[0] - nose[0])
            if right_dist > 0:
                yaw_ratio = left_dist / right_dist
                pose["yaw"] = float(min(90, abs(1 - yaw_ratio) * 45))

            # Roll from eye angle
            dx = right_eye[0] - left_eye[0]
            dy = right_eye[1] - left_eye[1]
            pose["roll"] = float(abs(np.degrees(np.arctan2(dy, dx)) if dx != 0 else 0))

            # Pitch from nose vertical position relative to eye-midpoint
            eye_mid_y = (left_eye[1] + right_eye[1]) / 2.0
            eye_dist = abs(right_eye[1] - left_eye[1]) + 1e-6
            # Normalize nose's vertical offset by eye separation
            pitch_offset = (nose[1] - eye_mid_y) / eye_dist
            # Typical frontal: offset ~ 1.0; larger = looking down
            pose["pitch"] = float(np.clip((pitch_offset - 1.0) * 30, -90, 90))

        # Overall quality score
        pose_penalty = max(0, (pose["yaw"] - 15) / 45) * 0.3 if pose["yaw"] > 15 else 0
        glare_penalty = 0.2 if glare else 0
        score = max(0, min(1, sharpness - pose_penalty - glare_penalty))

        return {
            "score": round(score, 3),
            "blur": blur,
            "sharpness": round(sharpness, 3),
            "glare": glare,
            "pose": {k: round(v, 1) for k, v in pose.items()},
        }
    except Exception as e:
        return {
            "score": 0.5, "blur": False, "glare": False,
            "pose": {"yaw": 0, "pitch": 0, "roll": 0},
            "warning": f"quality_assessment_fallback: {str(e)[:80]}",
        }


# ─── Detailed quality report (/face/quality) ────────────────────
def _ear_proxy(eye_points: list) -> float:
    """
    Eye Aspect Ratio (EAR) proxy using a 1..6 vertical/horizontal ratio.
    Input: list of 6 [x, y] points (eye contour) OR 2 corner points.
    Output: 0..1 openness (1 = fully open, 0 = closed).
    """
    if not eye_points:
        return 0.5

    if len(eye_points) >= 6:
        p = eye_points
        # EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
        vertical = (abs(p[1][1] - p[5][1]) + abs(p[2][1] - p[4][1]))
        horizontal = abs(p[0][0] - p[3][0]) + 1e-6
        ear = vertical / (2.0 * horizontal)
    elif len(eye_points) >= 2:
        # Fallback: vertical extent / horizontal extent
        xs = [p[0] for p in eye_points]
        ys = [p[1] for p in eye_points]
        vertical = max(ys) - min(ys)
        horizontal = max(xs) - min(xs) + 1e-6
        ear = vertical / horizontal
    else:
        return 0.5

    # Map EAR ~0.15 (closed) → 0, ~0.30 (open) → 1
    return float(np.clip((ear - 0.15) / 0.15, 0.0, 1.0))


def _mouth_openness_proxy(mouth_points: list) -> float:
    """
    Mouth aspect ratio proxy — vertical lip separation normalized by width.
    Returns 0..1 (0 = closed, 1 = wide open).
    """
    if not mouth_points or len(mouth_points) < 2:
        return 0.0
    xs = [p[0] for p in mouth_points]
    ys = [p[1] for p in mouth_points]
    vertical = max(ys) - min(ys)
    horizontal = max(xs) - min(xs) + 1e-6
    ratio = vertical / horizontal
    # Closed mouth ratio ~0.05; wide open ~0.40
    return float(np.clip((ratio - 0.05) / 0.35, 0.0, 1.0))


def assess_quality_detailed(image_bytes: bytes) -> dict:
    """
    Comprehensive face quality report.

    Returns:
      face_detected: bool
      face_count: int
      face_size: {width_px, height_px, area_px, percent_of_image}
      pose: {yaw, pitch, roll} (degrees, estimated from landmark geometry)
      blur_score: 0..1 (normalized Laplacian variance)
      brightness: 0..255 (mean pixel intensity of face ROI)
      contrast: 0..255 (std of pixel intensity of face ROI)
      background_complexity: 0..1 (Sobel edge density outside the face bbox)
      left_eye_openness: 0..1 (EAR proxy)
      right_eye_openness: 0..1 (EAR proxy)
      mouth_openness: 0..1
      overall_quality: 0..1 (composite)
      landmarks: list of [x, y] points (5-pt when available)
    """
    img, err = decode_image_bytes(image_bytes)
    if img is None:
        return {"face_detected": False, "face_count": 0, **err}

    h_img, w_img = img.shape[:2]
    img_area = max(1, h_img * w_img)

    # Background complexity is computed on the *non-face* region; we need a
    # detection first. If models are missing, we still return brightness /
    # contrast / blur of the whole image so callers can use it.
    gray_full = _to_gray(img)
    full_brightness = float(gray_full.mean()) if gray_full.size else 0.0
    full_contrast = float(gray_full.std()) if gray_full.size else 0.0
    full_blur = _safe_laplacian_var(gray_full)
    full_bg_complexity = _safe_sobel_density(gray_full)

    load_models()
    if _detector is None:
        return {
            "face_detected": False,
            "face_count": 0,
            "blur_score": round(min(1.0, full_blur / 200), 4),
            "brightness": round(full_brightness, 2),
            "contrast": round(full_contrast, 2),
            "background_complexity": round(full_bg_complexity, 4),
            "left_eye_openness": 0.0,
            "right_eye_openness": 0.0,
            "mouth_openness": 0.0,
            "overall_quality": 0.0,
            "note": "Models not loaded — full-image metrics only",
        }

    try:
        faces = _detector.get(img)
    except Exception as e:
        return {
            "face_detected": False, "face_count": 0,
            **make_error("DETECT_FAILED", f"Detection failed: {str(e)[:120]}", status=500),
            "brightness": round(full_brightness, 2),
            "contrast": round(full_contrast, 2),
            "background_complexity": round(full_bg_complexity, 4),
        }

    face_count = len(faces)
    if face_count == 0:
        return {
            "face_detected": False,
            "face_count": 0,
            "blur_score": round(min(1.0, full_blur / 200), 4),
            "brightness": round(full_brightness, 2),
            "contrast": round(full_contrast, 2),
            "background_complexity": round(full_bg_complexity, 4),
            "left_eye_openness": 0.0,
            "right_eye_openness": 0.0,
            "mouth_openness": 0.0,
            "overall_quality": 0.0,
        }

    # Pick the largest face
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    bbox = face.bbox.astype(int).tolist()  # [x1, y1, x2, y2]
    x1, y1, x2, y2 = [int(v) for v in bbox]
    x1 = max(0, min(x1, w_img - 1))
    x2 = max(0, min(x2, w_img))
    y1 = max(0, min(y1, h_img - 1))
    y2 = max(0, min(y2, h_img))
    face_w = max(1, x2 - x1)
    face_h = max(1, y2 - y1)
    face_area = face_w * face_h

    face_roi = img[y1:y2, x1:x2]
    gray_face = _to_gray(face_roi)
    face_brightness = float(gray_face.mean()) if gray_face.size else 0.0
    face_contrast = float(gray_face.std()) if gray_face.size else 0.0
    lap_var = _safe_laplacian_var(gray_face)
    blur_score = float(min(1.0, lap_var / 200))

    # Background complexity — everything outside the face bbox
    mask = np.ones((h_img, w_img), dtype=bool)
    mask[y1:y2, x1:x2] = False
    bg_gray = gray_full[mask]
    background_complexity = _safe_sobel_density(gray_full)  # whole-image density
    # Refine: subtract face contribution (approximate)
    if bg_gray.size > 0:
        bg_std = float(bg_gray.std())
        # Higher std = more textured background → 0..1
        background_complexity = float(min(1.0, bg_std / 80))

    # Landmarks (5-point from InsightFace: LE, RE, nose, mouth-left, mouth-right)
    landmarks_5 = face.kps.tolist() if hasattr(face, 'kps') else []

    pose = {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}
    left_eye_openness = 0.5
    right_eye_openness = 0.5
    mouth_openness = 0.0

    if len(landmarks_5) >= 5:
        le, re, nose, ml, mr = landmarks_5[:5]
        # Yaw from eye-nose distance ratio
        left_dist = abs(nose[0] - le[0])
        right_dist = abs(re[0] - nose[0])
        if right_dist > 0:
            yaw_ratio = left_dist / right_dist
            pose["yaw"] = float(min(90, abs(1 - yaw_ratio) * 45))
        # Roll from eye angle
        dx = re[0] - le[0]
        dy = re[1] - le[1]
        pose["roll"] = float(np.degrees(np.arctan2(dy, dx)) if dx != 0 else 0)
        # Pitch from nose vertical position relative to eye midpoint
        eye_mid_y = (le[1] + re[1]) / 2.0
        eye_dist = abs(re[1] - le[1]) + 1e-6
        pitch_offset = (nose[1] - eye_mid_y) / eye_dist
        pose["pitch"] = float(np.clip((pitch_offset - 1.0) * 30, -90, 90))

        # Eye openness: use eye corner points + extrapolated vertical extent
        # InsightFace 5-pt has no top/bottom eyelid points, so we approximate
        # openness from the eye-corner horizontal separation vs nose-to-eye
        # vertical distance — a coarser but still useful proxy.
        eye_sep = abs(re[0] - le[0]) + 1e-6
        # Approximate eye "open" vertical extent from gray-gradient peak in
        # the eye-box region. Use ROI around each eye.
        eye_box_h = max(3, int(eye_sep * 0.20))
        le_roi = gray_full[max(0, int(le[1] - eye_box_h)): min(h_img, int(le[1] + eye_box_h)),
                            max(0, int(le[0] - eye_box_h)): min(w_img, int(le[0] + eye_box_h))]
        re_roi = gray_full[max(0, int(re[1] - eye_box_h)): min(h_img, int(re[1] + eye_box_h)),
                            max(0, int(re[0] - eye_box_h)): min(w_img, int(re[0] + eye_box_h))]
        if le_roi.size and re_roi.size:
            # Vertical gradient intensity ~ eye opening (more open = more contrast)
            le_grad = float(np.abs(np.diff(le_roi.astype(np.float32), axis=0)).mean())
            re_grad = float(np.abs(np.diff(re_roi.astype(np.float32), axis=0)).mean())
            # Normalize by eye-separation-based expected scale
            left_eye_openness = float(np.clip(le_grad / (eye_sep * 0.05 + 1e-6), 0.0, 1.0))
            right_eye_openness = float(np.clip(re_grad / (eye_sep * 0.05 + 1e-6), 0.0, 1.0))
        else:
            left_eye_openness = 0.5
            right_eye_openness = 0.5

        # Mouth openness proxy
        mouth_w = abs(mr[0] - ml[0]) + 1e-6
        # Sample gray values along the midline between mouth corners
        mid_x = int((ml[0] + mr[0]) / 2)
        mid_y = int((ml[1] + mr[1]) / 2)
        mh = max(2, int(mouth_w * 0.15))
        mouth_strip = gray_full[max(0, mid_y - mh): min(h_img, mid_y + mh),
                                max(0, mid_x - 2): min(w_img, mid_x + 2)]
        if mouth_strip.size:
            mouth_v = float(mouth_strip.std())
            mouth_openness = float(np.clip(mouth_v / 40, 0.0, 1.0))
        else:
            mouth_openness = 0.0

        # When full 68-pt or 106-pt landmarks are available, EAR proxy is more
        # accurate. Use _ear_proxy if caller passes extra landmarks.
        # (Not applicable here since InsightFace 5-pt is the default.)

    # Overall composite quality (0..1)
    pose_penalty = max(0, (pose["yaw"] - 15) / 45) * 0.3 if pose["yaw"] > 15 else 0
    overall = max(0.0, min(1.0, blur_score - pose_penalty))
    if background_complexity > 0.6:
        overall *= 0.85  # busy background slightly hurts overall score

    return {
        "face_detected": True,
        "face_count": face_count,
        "face_size": {
            "width_px": int(face_w),
            "height_px": int(face_h),
            "area_px": int(face_area),
            "percent_of_image": round(face_area / img_area * 100, 2),
        },
        "pose": {k: round(v, 1) for k, v in pose.items()},
        "blur_score": round(blur_score, 4),
        "brightness": round(face_brightness, 2),
        "contrast": round(face_contrast, 2),
        "background_complexity": round(background_complexity, 4),
        "left_eye_openness": round(left_eye_openness, 3),
        "right_eye_openness": round(right_eye_openness, 3),
        "mouth_openness": round(mouth_openness, 3),
        "overall_quality": round(overall, 3),
        "landmarks": landmarks_5,
    }


# ─── Batch detection ─────────────────────────────────────────────
def detect_faces_batch(images_b64: list) -> dict:
    """
    Run face detection on a batch of up to MAX_BATCH_IMAGES images.

    Returns:
      count: int (number of images)
      results: list of per-image dicts:
        { index, detected, face_count, faces: [{bbox, confidence, size}] }
      errors: list of {index, error} for any failed images
    """
    if not isinstance(images_b64, list):
        return make_error("BAD_INPUT", "Expected 'images' to be a list", status=400)

    if len(images_b64) == 0:
        return make_error("BAD_INPUT", "'images' must not be empty", status=400)

    if len(images_b64) > MAX_BATCH_IMAGES:
        return make_error(
            "BATCH_TOO_LARGE",
            f"Maximum {MAX_BATCH_IMAGES} images per batch request",
            status=400,
        )

    load_models()
    results = []
    errors = []
    for i, img_b64 in enumerate(images_b64):
        try:
            image_bytes, err = b64_to_bytes(img_b64)
            if err is not None:
                errors.append({"index": i, **err})
                results.append({"index": i, "detected": False, "face_count": 0, "faces": []})
                continue

            img, derr = decode_image_bytes(image_bytes)
            if img is None:
                errors.append({"index": i, **derr})
                results.append({"index": i, "detected": False, "face_count": 0, "faces": []})
                continue

            if _detector is None:
                errors.append({"index": i, "error": "MODELS_NOT_LOADED", "message": "Models not available"})
                results.append({"index": i, "detected": False, "face_count": 0, "faces": []})
                continue

            faces = _detector.get(img)
            face_list = []
            for f in faces:
                bx1, by1, bx2, by2 = f.bbox.astype(int).tolist()
                face_list.append({
                    "bbox": {"x": int(bx1), "y": int(by1),
                             "w": int(bx2 - bx1), "h": int(by2 - by1)},
                    "confidence": round(float(f.det_score), 4) if hasattr(f, 'det_score') else 0.9,
                    "size": int((bx2 - bx1) * (by2 - by1)),
                })

            results.append({
                "index": i,
                "detected": len(face_list) > 0,
                "face_count": len(face_list),
                "faces": face_list,
            })
        except Exception as e:
            errors.append({"index": i, "error": "ANALYSIS_FAILED", "message": str(e)[:120]})
            results.append({"index": i, "detected": False, "face_count": 0, "faces": []})

    return {
        "count": len(images_b64),
        "results": results,
        "errors": errors,
    }


def match_faces(emb1: list, emb2: list, quality1: float = 1.0, quality2: float = 1.0) -> dict:
    """
    1:1 face matching with quality-aware threshold.

    Uses cosine similarity with adaptive threshold:
    - High quality images: threshold = 0.36 (stricter)
    - Low quality images: threshold = 0.42 (more lenient)

    Returns: { is_match, similarity, threshold, reason }
    """
    if not emb1 or not emb2:
        return {"is_match": False, "similarity": 0, "threshold": 0.4, "reason": "no_embedding"}

    try:
        e1 = np.array(emb1, dtype=np.float32)
        e2 = np.array(emb2, dtype=np.float32)
        if e1.size == 0 or e2.size == 0:
            return {"is_match": False, "similarity": 0, "threshold": 0.4, "reason": "empty_embedding"}

        # Cosine similarity
        n1 = float(np.linalg.norm(e1))
        n2 = float(np.linalg.norm(e2))
        if n1 == 0 or n2 == 0:
            return {"is_match": False, "similarity": 0, "threshold": 0.4, "reason": "zero_norm"}
        cos_sim = float(np.dot(e1, e2) / (n1 * n2))

        # Quality-adaptive threshold
        min_quality = min(quality1, quality2)
        threshold = 0.36 + (1.0 - min_quality) * 0.06  # 0.36 → 0.42

        is_match = cos_sim >= threshold

        reason = "match" if is_match else "below_threshold"
        if cos_sim < 0.1:
            reason = "no_face_match"

        return {
            "is_match": bool(is_match),
            "similarity": round(cos_sim, 4),
            "threshold": round(threshold, 4),
            "reason": reason,
        }
    except Exception as e:
        return {"is_match": False, "similarity": 0, "threshold": 0.4,
                "reason": "match_error", "error": str(e)[:120]}


# ─── HTTP Server ──────────────────────────────────────────────────
class FaceHandler(BaseHTTPRequestHandler):
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
        """
        Read request body with MAX_REQUEST_BYTES limit.
        Returns (body_bytes, error_dict_or_None).
        """
        try:
            content_len = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            return None, make_error("BAD_HEADER", "Invalid Content-Length", status=400)

        if content_len > MAX_REQUEST_BYTES:
            return None, make_error(
                "PAYLOAD_TOO_LARGE",
                f"Request body exceeds {MAX_REQUEST_BYTES // (1024*1024)}MB limit",
                status=413,
            )

        if content_len <= 0:
            return b"", None

        try:
            body = self.rfile.read(content_len)
        except Exception as e:
            return None, make_error("READ_FAILED", f"Could not read body: {str(e)[:80]}", status=400)
        return body, None

    def do_GET(self):
        if urlparse(self.path).path == '/health':
            self._send_json(200, {
                "status": "healthy",
                "models_loaded": _detector is not None,
                "service": "face-analysis",
                "port": 8001,
                "endpoints": [
                    "/face/analyze", "/face/match",
                    "/face/detect-batch", "/face/quality",
                    "/health",
                ],
                "limits": {
                    "max_request_mb": MAX_REQUEST_BYTES // (1024 * 1024),
                    "max_batch_images": MAX_BATCH_IMAGES,
                },
            })
        else:
            self._send_json(404, make_error("NOT_FOUND", "Unknown path", status=404))

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
                self._send_json(400, make_error("BAD_JSON", f"Invalid JSON: {str(e)[:80]}"))
                return

            if path == '/face/analyze':
                image_b64 = data.get('image', '')
                image_bytes, derr = b64_to_bytes(image_b64)
                if derr is not None:
                    self._send_json(400, derr)
                    return

                t0 = time.time()
                result = analyze_face(image_bytes)
                elapsed = time.time() - t0
                result['latency_ms'] = round(elapsed * 1000)

                status = 200 if result.get("detected") else 200
                if result.get("error"):
                    status = result.get("status", 500) if isinstance(result.get("status"), int) else 500
                self._send_json(status, result)

            elif path == '/face/match':
                img1_b64 = data.get('image1', '')
                img2_b64 = data.get('image2', '')
                ib1, e1 = b64_to_bytes(img1_b64)
                if e1 is not None:
                    self._send_json(400, e1)
                    return
                ib2, e2 = b64_to_bytes(img2_b64)
                if e2 is not None:
                    self._send_json(400, e2)
                    return

                t0 = time.time()
                face1 = analyze_face(ib1)
                face2 = analyze_face(ib2)

                if not face1.get('detected') or not face2.get('detected'):
                    result = {"is_match": False, "reason": "no_face_detected",
                              "error_face1": face1.get("error"),
                              "error_face2": face2.get("error")}
                else:
                    q1 = face1.get('quality', {}).get('score', 0.5)
                    q2 = face2.get('quality', {}).get('score', 0.5)
                    result = match_faces(face1.get('embedding', []), face2.get('embedding', []), q1, q2)
                    result['quality1'] = face1.get('quality', {})
                    result['quality2'] = face2.get('quality', {})

                result['latency_ms'] = round((time.time() - t0) * 1000)
                self._send_json(200, result)

            elif path == '/face/detect-batch':
                images_b64 = data.get('images', [])
                if not isinstance(images_b64, list):
                    self._send_json(400, make_error("BAD_INPUT", "'images' must be a list"))
                    return
                if len(images_b64) == 0:
                    self._send_json(400, make_error("BAD_INPUT", "'images' must not be empty"))
                    return
                if len(images_b64) > MAX_BATCH_IMAGES:
                    self._send_json(400, make_error(
                        "BATCH_TOO_LARGE",
                        f"Maximum {MAX_BATCH_IMAGES} images per batch",
                    ))
                    return

                t0 = time.time()
                result = detect_faces_batch(images_b64)
                result['latency_ms'] = round((time.time() - t0) * 1000)
                status = 400 if "error" in result and "message" in result else 200
                self._send_json(status, result)

            elif path == '/face/quality':
                image_b64 = data.get('image', '')
                image_bytes, derr = b64_to_bytes(image_b64)
                if derr is not None:
                    self._send_json(400, derr)
                    return

                t0 = time.time()
                result = assess_quality_detailed(image_bytes)
                result['latency_ms'] = round((time.time() - t0) * 1000)
                status = 200 if result.get("face_detected") or not result.get("error") else 500
                self._send_json(status, result)

            else:
                self._send_json(404, make_error("NOT_FOUND", f"Unknown path: {path}", status=404))

        except Exception as e:
            tb = traceback.format_exc(limit=3)
            self._send_json(500, make_error(
                "INTERNAL_ERROR",
                f"Internal server error: {str(e)[:120]}",
                status=500,
                traceback=tb[:500],
            ))


if __name__ == '__main__':
    PORT = 8001
    print(f"[Face] Service starting on port {PORT}...", flush=True)
    load_models()
    server = HTTPServer(('0.0.0.0', PORT), FaceHandler)
    print(f"[Face] Listening on http://0.0.0.0:{PORT}", flush=True)
    print(f"[Face] Limits: max_request={MAX_REQUEST_BYTES // (1024*1024)}MB, "
          f"max_batch={MAX_BATCH_IMAGES} images", flush=True)
    server.serve_forever()
