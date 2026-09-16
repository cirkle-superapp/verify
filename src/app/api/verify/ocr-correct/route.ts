import { NextRequest, NextResponse } from "next/server";
import { postProcessField, type OcrCorrectionResult } from "@/lib/ocr-postprocess";

export const runtime = "nodejs";

/**
 * POST /api/verify/ocr-correct
 * Body: { field: "fullNameAr", value: "محماد صلاح" }
 *
 * Corrects OCR errors using:
 *   1. Levenshtein distance against Arabic/Western name dictionaries
 *   2. Common OCR confusion patterns (O→0, l→1, S→5, etc.)
 *   3. Field label stripping (الاسم: → "")
 *   4. ID cleanup (remove spaces/dashes)
 *
 * Returns: { original, corrected, changed, corrections[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const field = body.field || "fullNameAr";
    const value = body.value || "";

    if (!value) {
      return NextResponse.json({ error: "value required" }, { status: 400 });
    }

    const result: OcrCorrectionResult = postProcessField(field, value);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "correction failed" }, { status: 500 });
  }
}

/** GET — returns info + example corrections. */
export async function GET() {
  return NextResponse.json({
    description: "OCR post-processing — corrects OCR errors using Levenshtein + confusion patterns",
    correctableFields: ["fullNameAr", "fullNameEn", "nationalId", "documentNo", "nationality"],
    dictionaries: {
      arabicNames: "60+ common Arabic male/female names + surnames",
      westernNames: "50+ common Western names",
      countries: "30+ country names (Arabic + English)",
    },
    confusionPatterns: ["O→0", "l→1", "I→1", "S→5", "B→8", "Z→2", "G→6", "D→0", "Q→0"],
    example: {
      field: "fullNameAr",
      value: "محماد صلاح",
      expectedCorrection: "محمد صلاح (Levenshtein distance 1 → closest dictionary match)",
    },
  });
}
