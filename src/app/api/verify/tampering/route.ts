import { NextRequest, NextResponse } from "next/server";
import { detectTampering } from "@/lib/tampering-detection";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/verify/tampering
 * Detect document image tampering (forgery, Photoshop, clone-stamp).
 *
 * Body: { image: "data:image/jpeg;base64,..." }
 * Returns: TamperingResult (score, signals, details, reasoning)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image = body.image;
    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json({ error: "image (data URL) required" }, { status: 400 });
    }

    const result = await detectTampering(image);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "tampering detection failed" }, { status: 500 });
  }
}

/** GET — returns info. */
export async function GET() {
  return NextResponse.json({
    description: "Document tampering detection — outsmarts competitors",
    checks: [
      "EXIF metadata analysis (Photoshop/GIMP/Lightroom detection)",
      "Error Level Analysis (ELA) — splice/paste region detection",
      "Noise inconsistency — copy-paste region detection",
      "Clone detection — clone-stamp tool detection",
    ],
    scoreRange: "0-1 (higher = more likely tampered)",
    threshold: ">0.3 = likely tampered",
    competitiveAdvantage: "Onfido/Jumio charge extra for 'advanced forgery detection'. Cirkle: free.",
  });
}
