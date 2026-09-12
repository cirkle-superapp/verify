import { NextRequest, NextResponse } from "next/server";

/**
 * Cirkle Verify API v1 — Public API Documentation
 *
 * This endpoint serves as the public API landing page for the Cirkle
 * Identity Verification service. We are the API provider.
 *
 * Endpoints:
 *   POST /api/v1/verify/document   — Extract fields from an ID document
 *   POST /api/v1/verify/face-match — Compare selfie to document photo
 *   POST /api/v1/verify/liveness   — Check liveness from webcam frames
 *   GET  /api/v1/verify/specs      — Get document specs for 32+ countries
 *   GET  /api/v1/verify/health     — Service health check
 *
 * All processing is self-hosted — no external API calls.
 * Engine: Tesseract.js (OCR) + face-api.js (face) + custom liveness
 */

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    name: "Cirkle Verify API",
    version: "1.0.0",
    description: "Self-hosted identity verification API for Egyptian and Arabic documents. No external dependencies.",
    endpoints: {
      document: {
        method: "POST",
        path: "/api/v1/verify/document",
        description: "Extract structured fields from an ID document image using self-hosted Tesseract.js OCR",
        body: { frontImage: "data:image/jpeg;base64,...", backImage: "data:image/jpeg;base64,...", docType: "national_id" },
        response: { fullNameAr: "string", nationalId: "string", confidence: "number" },
      },
      faceMatch: {
        method: "POST",
        path: "/api/v1/verify/face-match",
        description: "Compare a selfie face to a document photo using face-api.js",
        body: { selfie: "data:image/jpeg;base64,...", docImage: "data:image/jpeg;base64,..." },
        response: { isMatch: "boolean", similarity: "number (0-100)", reasoning: "string" },
      },
      liveness: {
        method: "POST",
        path: "/api/v1/verify/liveness",
        description: "Check liveness from a sequence of webcam frames",
        body: { frames: ["data:image/jpeg;base64,..."], actions: ["turn_left","smile"] },
        response: { isLive: "boolean", score: "number (0-100)", detectedActions: "string[]" },
      },
      specs: {
        method: "GET",
        path: "/api/v1/verify/specs",
        description: "Get document specifications for 32+ countries (field positions, MRZ, validation patterns)",
        query: { country: "ISO code (e.g. EG)", docType: "national_id|passport|driver_license" },
      },
      health: {
        method: "GET",
        path: "/api/v1/verify/health",
        description: "Service health check",
      },
    },
    engine: {
      ocr: "Tesseract.js v7 (Arabic + English traineddata)",
      faceMatch: "@vladmandic/face-api v1.7 (TensorFlow.js, SsdMobilenetv1 + 68 landmarks + 128-d descriptor)",
      liveness: "Custom frame-differencing (pixel diff + brightness + edge density variance)",
      documentParser: "Rule-based using worldwide document specs catalog",
      externalApis: "ZERO — fully self-hosted",
    },
    coverage: {
      countries: 32,
      documentTypes: ["national_id", "passport", "driver_license", "residence"],
      totalSpecs: 41,
      languages: ["ar", "en", "fr", "de", "tr", "pt", "zh", "ja", "ru"],
    },
    license: "MIT",
    rateLimits: { document: "10/min", faceMatch: "15/min", liveness: "10/min" },
  });
}
