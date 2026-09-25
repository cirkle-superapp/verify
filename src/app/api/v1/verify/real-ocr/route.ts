import { NextRequest, NextResponse } from "next/server";
import { runRealOcr, type RealOcrResult, type RealOcrOptions } from "@/lib/real-ocr";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CORS headers — real-ocr endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/real-ocr
 *
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/real-ocr
 *
 * Describes the endpoint and lists the supported languages.
 */
export async function GET() {
  return NextResponse.json(
    {
      description:
        "Real OCR pipeline — Tesseract.js + OCR post-processing + field extraction. Works without external AI providers.",
      method: "POST",
      body: {
        image: "string (base64 data URL or raw base64) — required",
        languages: "string[]? — default ['ara', 'eng']",
        enhance: "boolean? — default true (grayscale + sharpen + downscale)",
      },
      response: {
        text: "string — full recognized text (post-processed)",
        arabicText: "string — Arabic-script lines only",
        englishText: "string — Latin-script lines only",
        words: "Array<{ text, confidence, bbox }>",
        lines: "Array<{ text, bbox, language }>",
        fields: "Record<fieldName, { field, value, language }>",
        processingTimeMs: "number",
        engine: "'tesseract' | 'regex-fallback'",
        confidence: "number (0..1)",
        fallbackReason: "string? — set when engine === 'regex-fallback'",
      },
      supportedFields: [
        "fullNameAr",
        "fullNameEn",
        "nationalId",
        "documentNo",
        "birthDate",
        "gender",
        "nationality",
        "expiryDate",
      ],
      notes: [
        "Tesseract.js downloads traineddata from the jsdelivr CDN on first use (~5 MB per language).",
        "If Tesseract.js fails to initialize (Bun regenerator-runtime issue), falls back to a regex extractor.",
        "The regex extractor scans raw text for phone numbers, dates, ID-like numbers, email addresses, and document numbers.",
      ],
    },
    { headers: CORS_HEADERS },
  );
}

/**
 * POST /api/v1/verify/real-ocr
 *
 * Runs the real OCR pipeline on a base64-encoded image and returns the
 * structured result (text, words with bboxes, lines with language tags,
 * and extracted fields).
 *
 * Body:
 *   {
 *     image: string,           // data URL or raw base64
 *     languages?: string[],    // default ["ara", "eng"]
 *     enhance?: boolean,       // default true
 *   }
 *
 * Returns: RealOcrResult
 */
export async function POST(req: NextRequest) {
  // Light rate-limit — OCR is CPU-heavy.
  const limited = checkRateLimit(req, {
    maxRequests: 20,
    windowMs: 60_000,
    prefix: "real-ocr",
  });
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => ({}));
    const image: string | undefined = body?.image;
    if (!image || typeof image !== "string" || image.length < 32) {
      return NextResponse.json(
        { error: "image (base64 data URL or raw base64) required", code: "BAD_IMAGE" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const options: RealOcrOptions = {};
    if (Array.isArray(body?.languages) && body.languages.length > 0) {
      options.languages = body.languages.filter((l: unknown) => typeof l === "string" && l.length <= 8);
    }
    if (typeof body?.enhance === "boolean") {
      options.enhance = body.enhance;
    }

    const result: RealOcrResult = await runRealOcr(image, options);

    logAudit({
      type: "real_ocr_called",
      ip: getClientIp(req),
      success: result.engine === "tesseract",
      metadata: {
        engine: result.engine,
        words: result.words.length,
        lines: result.lines.length,
        fieldsExtracted: Object.keys(result.fields),
        processingTimeMs: result.processingTimeMs,
        fallbackReason: result.fallbackReason,
      },
    });

    return NextResponse.json(result, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "real OCR failed",
        code: "REAL_OCR_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
