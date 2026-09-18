import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiKey } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * GET /api/v1/verify/gdpr/export?nationalId=<id>
 *
 * Right to data portability (GDPR Article 20 / CCPA right to access).
 * Exports ALL verification data for a given identity as JSON.
 *
 * AUTH: Requires API key.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(req.url);
    const nationalId = url.searchParams.get("nationalId");
    if (!nationalId) {
      return NextResponse.json({ error: "nationalId required" }, { status: 400 });
    }

    const records = await db.verification.findMany({
      where: { nationalId: nationalId as any },
    });

    return NextResponse.json({
      regulation: "GDPR Article 20 / CCPA right to access",
      nationalId: nationalId.slice(0, 4) + "****" + nationalId.slice(-4),
      recordCount: records.length,
      exportedAt: new Date().toISOString(),
      data: records.map((r: any) => ({
        verificationId: r.id,
        docType: r.docType,
        fullNameAr: r.fullNameAr,
        fullNameEn: r.fullNameEn,
        nationalId: r.nationalId,
        birthDate: r.birthDate,
        gender: r.gender,
        nationality: r.nationality,
        status: r.status,
        docConfidence: r.docConfidence,
        faceMatchScore: r.faceMatchScore,
        livenessScore: r.livenessScore,
        notes: r.notes,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        // Images are NOT included (deleted after verification, not persisted)
        images: "NOT RETAINED — deleted immediately after verification per GDPR policy",
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "export failed" }, { status: 500 });
  }
}
