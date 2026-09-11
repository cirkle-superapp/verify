import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { DocType, ExtractedDocumentData, FaceMatchResult, LivenessAction, LivenessResult, VerificationStatus } from "@/lib/verification-types";

export const runtime = "nodejs";

// GET /api/verify/records — list all
export async function GET() {
  try {
    const records = await db.verification.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ records });
  } catch (e: any) {
    console.error("[/api/verify/records GET] error", e);
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}

// POST /api/verify/records — create a verification record
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const docType: DocType = body.docType || "national_id";
    const docSide: string = body.docSide || "front";
    const docImageFront: string | null = body.docImageFront ?? null;
    const docImageBack: string | null = body.docImageBack ?? null;

    const extracted: ExtractedDocumentData | undefined = body.docExtracted;
    const selfieImage: string | null = body.selfieImage ?? null;
    const livenessFrames: string[] = body.livenessFrames ?? [];
    const livenessActions: LivenessAction[] = body.livenessActions ?? [];
    const faceMatch: FaceMatchResult | null = body.faceMatch ?? null;
    const liveness: LivenessResult | null = body.liveness ?? null;

    const docConfidence = extracted?.confidence ?? 0;
    const faceMatchScore = faceMatch?.similarity ?? 0;
    const livenessScore = liveness?.score ?? 0;
    const imageQuality = extracted?.imageQuality?.overallQuality ?? 0;
    const fieldConfidence = extracted?.fieldConfidence ? JSON.stringify(extracted.fieldConfidence) : null;

    // decide status
    let status: VerificationStatus = "pending";
    const notes: string[] = [];
    if (docConfidence < 0.6) notes.push("Low document extraction confidence");
    if (faceMatch && !faceMatch.isMatch) notes.push("Face does not match document");
    if (liveness && !liveness.isLive) notes.push("Liveness check failed");

    const allPassed =
      docConfidence >= 0.6 &&
      (!faceMatch || faceMatch.isMatch) &&
      (!liveness || liveness.isLive);
    status = allPassed ? "verified" : notes.length > 0 ? "failed" : "pending";

    const created = await db.verification.create({
      data: {
        docType,
        docSide,
        docImageFront,
        docImageBack,
        fullNameAr: extracted?.fullNameAr ?? null,
        fullNameEn: extracted?.fullNameEn ?? null,
        nationalId: extracted?.nationalId ?? null,
        birthDate: extracted?.birthDate ?? null,
        address: extracted?.address ?? null,
        gender: extracted?.gender ?? null,
        documentNo: extracted?.documentNo ?? null,
        expiryDate: extracted?.expiryDate ?? null,
        nationality: extracted?.nationality ?? null,
        job: extracted?.job ?? null,
        religion: extracted?.religion ?? null,
        maritalStatus: extracted?.maritalStatus ?? null,
        extraFields: extracted?.extraFields ? JSON.stringify(extracted.extraFields) : null,
        imageQuality,
        fieldConfidence,
        selfieImage,
        livenessFrames: livenessFrames.length ? JSON.stringify(livenessFrames) : null,
        livenessActions: livenessActions.length ? JSON.stringify(livenessActions) : null,
        docConfidence,
        faceMatchScore,
        livenessScore,
        status,
        notes: notes.length ? notes.join("; ") : null,
      },
    });

    return NextResponse.json({ record: created });
  } catch (e: any) {
    console.error("[/api/verify/records POST] error", e);
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}
