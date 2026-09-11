import { NextRequest, NextResponse } from "next/server";
import { extractDocumentData } from "@/lib/vlm-service";
import { normalizeForVlm, isLikelyTooLarge, parseDataUrl } from "@/lib/image-server";
import { checkRateLimit } from "@/lib/rate-limit";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  // Rate limit: 10 document extractions per minute per IP
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 60_000, prefix: "doc" });
  if (limited) return limited;

  const startedAt = Date.now();
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

    // Validate the data URL is actually decodable.
    const parsed = parseDataUrl(frontImage);
    if (!parsed || parsed.buffer.length < 100) {
      return NextResponse.json(
        {
          error:
            "The uploaded image could not be read. Please re-take the photo with better lighting and try again.",
          code: "invalid_image",
        },
        { status: 400 }
      );
    }

    // Pre-normalize if the image looks too large (saves a VLM round-trip).
    if (isLikelyTooLarge(frontImage)) {
      try {
        frontImage = await normalizeForVlm(frontImage);
      } catch {
        // continue with original — VLM service will retry on 1210
      }
    }

    const data = await extractDocumentData(frontImage, backImage, docType);
    return NextResponse.json({ data, elapsedMs: Date.now() - startedAt });
  } catch (e: any) {
    console.error("[/api/verify/document] error", e);
    const msg = String(e?.message || e?.toString?.() || "");

    // Map known VLM errors to user-friendly messages
    if (msg.includes("1210") || msg.includes("图片输入格式") || msg.includes("图片解析错误")) {
      return NextResponse.json(
        {
          error:
            "The image format could not be processed by the AI. We automatically re-compress images, but this photo may be corrupted or in an unsupported format. Please re-take the photo as a clear JPEG/PNG.",
          code: "image_format_error",
        },
        { status: 422 }
      );
    }
    if (msg.includes("1213") || msg.includes("内容")) {
      return NextResponse.json(
        {
          error:
            "The AI model declined to process this image (possibly flagged content). Please try a different, clearer photo of the document.",
          code: "content_filtered",
        },
        { status: 422 }
      );
    }
    if (msg.includes("timeout") || msg.includes("ETIMEDOUT") || msg.includes("aborted")) {
      return NextResponse.json(
        {
          error:
            "The AI service took too long to respond. Please try again — the document image may be very complex.",
          code: "timeout",
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: e?.message || "Failed to extract document data. Please try again.", code: "unknown" },
      { status: 500 }
    );
  }
}
