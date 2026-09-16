import { NextRequest, NextResponse } from "next/server";
import { parseMrz, type MrzResult } from "@/lib/mrz-parser";

export const runtime = "nodejs";

/**
 * POST /api/verify/parse-mrz
 * Body: { text: "P<EGYMOHAMED<<SALAH..." }  (MRZ text, 2-3 lines)
 *
 * Parses ICAO 9303 Machine Readable Zone (TD1/TD2/TD3).
 * Auto-detects format, validates check digits, extracts structured fields.
 *
 * Returns MrzResult with:
 *   format, documentCode, issuingCountry, documentNumber, name, sex,
 *   birthDate, expiryDate, nationality, all check-digit validations,
 *   composite check, and any errors.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = body.text || "";
    if (!text || text.trim().length < 20) {
      return NextResponse.json({
        error: "MRZ text required (min 20 chars, 2-3 lines of A-Z, 0-9, <)",
      }, { status: 400 });
    }
    const result: MrzResult | null = parseMrz(text);
    if (!result) {
      return NextResponse.json({
        error: "Could not detect MRZ format. Expected TD1 (3×30), TD2 (2×36), or TD3 (2×44).",
        received: text.split("\n").map((l: string) => ({ line: l.trim(), length: l.trim().length })),
      }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "MRZ parse failed" }, { status: 500 });
  }
}

/**
 * GET /api/verify/parse-mrz — returns example MRZ samples for testing.
 */
export async function GET() {
  return NextResponse.json({
    description: "ICAO 9303 MRZ parser — POST { text: '...' } to parse",
    formats: ["TD1 (3×30, ID cards)", "TD2 (2×36, passport cards)", "TD3 (2×44, passport booklets)"],
    examples: {
      td3_egypt_passport: "P<EGYMOHAMED<<SALAH<MOHAMED<<<<<<<<<<<<<<<<<<<<<\n197912315EGY9101012M2801019<<<<<<<<<<<<<<06",
      td1_sample: "IDLITABC1234567<1<<<<<<<<<<\n9001011F3001019EGY<<<<<<<<<<<<<\nMOHAMED<<SALAH<MOHAMED<<<<<<<<<<<<",
    },
    checkDigitAlgorithm: "Mod-10 with weights 7,3,1 repeating. A=10..Z=35, <=0",
    countryCodes: "ISO 3166-1 alpha-3 (EGY, USA, GBR, etc.)",
  });
}
