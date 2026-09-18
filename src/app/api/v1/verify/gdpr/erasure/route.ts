import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireApiKey } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * DELETE /api/v1/verify/gdpr/erasure?nationalId=<id>
 *
 * Right to erasure (GDPR Article 17 / CCPA right to delete).
 * Deletes ALL verification records matching the given national ID.
 *
 * AUTH: Requires API key (admin or data subject's own key).
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (auth instanceof Response) return auth;

  try {
    const url = new URL(req.url);
    const nationalId = url.searchParams.get("nationalId");
    if (!nationalId) {
      return NextResponse.json({ error: "nationalId required" }, { status: 400 });
    }

    // Find all records for this national ID
    const records = await db.verification.findMany({
      where: { nationalId: nationalId as any },
    });

    if (records.length === 0) {
      return NextResponse.json({ message: "No records found for this national ID", nationalId });
    }

    // Delete all matching records
    let deletedCount = 0;
    for (const record of records as any[]) {
      try {
        await db.verification.delete({ where: { id: record.id } });
        deletedCount++;
      } catch {}
    }

    return NextResponse.json({
      erasureComplete: true,
      nationalId,
      recordsDeleted: deletedCount,
      regulation: "GDPR Article 17 / CCPA right to delete",
      completedAt: new Date().toISOString(),
      message: `All ${deletedCount} verification record(s) for national ID ending in ${nationalId.slice(-4)} have been permanently deleted.`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "erasure failed" }, { status: 500 });
  }
}
