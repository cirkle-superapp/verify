import { NextRequest, NextResponse } from "next/server";
import { runOCRMulti } from "@/lib/ocr-engine";
import { extractDocumentSelfHosted } from "@/lib/doc-parser";
import { normalizeForVlm, isLikelyTooLarge, parseDataUrl } from "@/lib/image-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Document extraction endpoint.
 *
 * Calls the persistent OCR mini-service (port 3030) via the gateway,
 * then runs the rule-based document parser on the OCR text.
 *
 * If the mini-service is unreachable (e.g. during local dev), falls back
 * to in-process Tesseract.js OCR.
 */

async function callOCRService(image: string): Promise<{ text: string; confidence: number; words: any[] } | null> {
  try {
    const res = await fetch("http://localhost:3030/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { text: j.text, confidence: j.confidence, words: j.words };
  } catch {
    // Mini-service not available (local dev) — fall back to in-process OCR
    return null;
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 60_000, prefix: "doc" });
  if (limited) {
    logAudit({ type: "rate_limited", ip: getClientIp(req), success: false });
    return limited;
  }

  const startedAt = Date.now();
  const ip = getClientIp(req);
  try {
    const body = await req.json();
    let frontImage: string | undefined = body.frontImage;
    const backImage: string | null = body.backImage ?? null;
    const docType: DocType = (body.docType as DocType) || "national_id";

    if (!frontImage || !frontImage.startsWith("data:image/")) {
      return NextResponse.json({ error: "frontImage (data URL) is required", code: "missing_image" }, { status: 400 });
    }

    const parsed = parseDataUrl(frontImage);
    if (!parsed || parsed.buffer.length < 100) {
      return NextResponse.json({ error: "Image could not be read. Please retake.", code: "invalid_image" }, { status: 400 });
    }

    // Pre-normalize large images
    if (isLikelyTooLarge(frontImage)) {
      try { frontImage = await normalizeForVlm(frontImage); } catch {}
    }

    // Try the persistent OCR mini-service first (fast: 2-5s with warm worker)
    let frontOcr = await callOCRService(frontImage);
    let backOcr = null;

    if (!frontOcr) {
      // Fallback: in-process Tesseract.js (slow: 30-60s on cold start)
      const ocrResults = await runOCRMulti(frontImage, backImage);
      frontOcr = ocrResults.front;
      backOcr = ocrResults.back;
    } else if (backImage) {
      backOcr = await callOCRService(backImage);
    }

    // Rule-based field extraction
    const data = await extractDocumentSelfHosted(frontOcr as any, backOcr as any, docType, frontImage);

    const elapsed = Date.now() - startedAt;
    logAudit({ type: "document_extract", ip, success: true, durationMs: elapsed, docType, country: data?.extraFields?._detectedCountry });

    return NextResponse.json({ data, elapsedMs: elapsed, engine: "self-hosted" });
  } catch (e: any) {
    console.error("[/api/verify/document] error", e);
    return NextResponse.json({ error: e?.message || "Extraction failed", code: "unknown" }, { status: 500 });
  }
}
