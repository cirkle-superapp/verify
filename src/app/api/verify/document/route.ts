import { NextRequest, NextResponse } from "next/server";
import { runOCRMulti } from "@/lib/ocr-engine";
import { extractDocumentSelfHosted } from "@/lib/doc-parser";
import { normalizeForVlm, isLikelyTooLarge, parseDataUrl } from "@/lib/image-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 120;

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
      return NextResponse.json(
        { error: "frontImage (data URL) is required", code: "missing_image" },
        { status: 400 }
      );
    }

    const parsed = parseDataUrl(frontImage);
    if (!parsed || parsed.buffer.length < 100) {
      return NextResponse.json(
        { error: "The uploaded image could not be read. Please re-take the photo.", code: "invalid_image" },
        { status: 400 }
      );
    }

    // Pre-normalize large images for OCR
    if (isLikelyTooLarge(frontImage)) {
      try {
        frontImage = await normalizeForVlm(frontImage);
      } catch {}
    }

    // Self-hosted OCR pipeline (no external API calls)
    // Pass 1: Tesseract.js OCR on front + back
    const ocrResults = await runOCRMulti(frontImage, backImage);

    // Pass 2: Rule-based field extraction using OCR text + specs catalog
    const data = await extractDocumentSelfHosted(
      ocrResults.front,
      ocrResults.back,
      docType,
      frontImage
    );

    const elapsed = Date.now() - startedAt;
    logAudit({
      type: "document_extract",
      ip,
      success: true,
      durationMs: elapsed,
      docType,
      country: data?.extraFields?._detectedCountry as string | undefined,
    });

    return NextResponse.json({ data, elapsedMs: elapsed, engine: "self-hosted" });
  } catch (e: any) {
    console.error("[/api/verify/document] error", e);
    return NextResponse.json(
      { error: e?.message || "Failed to extract document data", code: "unknown" },
      { status: 500 }
    );
  }
}
