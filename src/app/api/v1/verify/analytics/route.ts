import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/v1/verify/analytics — real-time verification analytics dashboard
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") || "30");

    // Get all records
    const records = await db.verification.findMany({ take: 10000 });

    // Calculate metrics
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    const recentRecords = records.filter((r: any) => {
      try { return new Date(r.createdAt).getTime() > cutoff; } catch { return false; }
    });

    const total = records.length;
    const recent = recentRecords.length;
    const verified = records.filter((r: any) => r.status === "verified").length;
    const failed = records.filter((r: any) => r.status === "failed").length;
    const pending = records.filter((r: any) => r.status === "pending").length;

    const verifiedRate = total > 0 ? Math.round((verified / total) * 100) : 0;
    const failedRate = total > 0 ? Math.round((failed / total) * 100) : 0;

    // Average scores
    const avgDocConfidence = records.length > 0
      ? records.reduce((sum: number, r: any) => sum + (r.docConfidence || 0), 0) / records.length
      : 0;
    const avgFaceMatch = records.length > 0
      ? records.reduce((sum: number, r: any) => sum + (r.faceMatchScore || 0), 0) / records.length
      : 0;
    const avgLiveness = records.length > 0
      ? records.reduce((sum: number, r: any) => sum + (r.livenessScore || 0), 0) / records.length
      : 0;
    const avgImageQuality = records.length > 0
      ? records.reduce((sum: number, r: any) => sum + (r.imageQuality || 0), 0) / records.length
      : 0;

    // By document type
    const byDocType: Record<string, number> = {};
    for (const r of records) {
      byDocType[(r as any).docType] = (byDocType[(r as any).docType] || 0) + 1;
    }

    // By status (last N days)
    const recentByStatus = { verified: 0, failed: 0, pending: 0 };
    for (const r of recentRecords) {
      recentByStatus[(r as any).status as keyof typeof recentByStatus]++;
    }

    // Hourly distribution (last 24h)
    const hourly = new Array(24).fill(0);
    for (const r of records) {
      try {
        const d = new Date((r as any).createdAt);
        if (now - d.getTime() < 24 * 60 * 60 * 1000) {
          hourly[d.getHours()]++;
        }
      } catch {}
    }

    return NextResponse.json({
      total,
      recent,
      verified,
      failed,
      pending,
      verifiedRate,
      failedRate,
      avgScores: {
        docConfidence: Math.round(avgDocConfidence * 100) / 100,
        faceMatch: Math.round(avgFaceMatch),
        liveness: Math.round(avgLiveness),
        imageQuality: Math.round(avgImageQuality * 100) / 100,
      },
      byDocType,
      recentByStatus,
      hourlyDistribution: hourly,
      period: { days },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
