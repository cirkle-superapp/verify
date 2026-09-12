import { NextRequest, NextResponse } from "next/server";
import { runFraudChecks, imageHash } from "@/lib/fraud-detection";
import { getClientIp } from "@/lib/rate-limit";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST /api/v1/verify/fraud-check — run fraud detection on extracted data
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ip = getClientIp(req);

    // Get known IDs from existing records for duplicate check
    let knownIds = new Set<string>();
    let knownHashes = new Set<string>();
    try {
      const records = await db.verification.findMany({ take: 1000 });
      knownIds = new Set(records.map((r: any) => r.nationalId).filter(Boolean));
      knownHashes = new Set(records.map((r: any) => r.docImageFront).filter(Boolean).map((h: string) => imageHash(h)));
    } catch {}

    const result = runFraudChecks({
      ip,
      fullName: body.fullNameAr,
      fullNameEn: body.fullNameEn,
      nationalId: body.nationalId,
      birthDate: body.birthDate,
      expiryDate: body.expiryDate,
      imageHash: body.imageData ? imageHash(body.imageData) : undefined,
      knownIds,
      knownHashes,
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
