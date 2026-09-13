import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { getEdgeDb, getCentralDb } from "@/lib/db";
import { edgeVerifications } from "@/lib/db/schema-turso";
import { verifications, auditLogs } from "@/lib/db/schema-postgres";
import { getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/v1/verify/dual-demo
 *
 * Demonstrates the Dual-Database (Hybrid Edge/Central) architecture:
 *  1. READ from edgeDb (Turso) — low-latency verification list
 *  2. WRITE to centralDb (Neon Postgres) — permanent record + audit log
 *
 * This is a single operation that reads from the edge and writes to central,
 * showcasing how both databases work together without type mismatches.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const startedAt = Date.now();

  try {
    const body = await req.json();

    // ═══════════════════════════════════════════════════════════════
    // 1. READ from edgeDb (Turso) — fetch recent verifications
    // ═══════════════════════════════════════════════════════════════
    const edge = getEdgeDb();
    let recentRecords: any[] = [];
    if (edge) {
      try {
        const result = await edge.select()
          .from(edgeVerifications)
          .orderBy(desc(edgeVerifications.createdAt))
          .limit(5);
        recentRecords = result;
      } catch (e) {
        // Edge DB might be unavailable — continue without it
        console.log("[dual-demo] Edge DB read failed:", (e as any)?.message?.slice(0, 80));
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. WRITE to centralDb (Neon Postgres) — permanent record
    // ═══════════════════════════════════════════════════════════════
    const central = getCentralDb();
    let writeResult = null;

    if (central && body.fullNameAr) {
      const id = "dual_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

      // Insert verification record (Drizzle handles type casting automatically)
      await central.insert(verifications).values({
        id,
        docType: body.docType || "national_id",
        docSide: body.docSide || "front",
        fullNameAr: body.fullNameAr,
        fullNameEn: body.fullNameEn || null,
        nationalId: body.nationalId || null,
        birthDate: body.birthDate || null,
        gender: body.gender || null,
        documentNo: body.documentNo || null,
        expiryDate: body.expiryDate || null,
        nationality: body.nationality || null,
        status: body.status || "pending",
        docConfidence: body.docConfidence || 0,
        faceMatchScore: body.faceMatchScore || 0,
        livenessScore: body.livenessScore || 0,
        imageQuality: body.imageQuality || 0,
      });

      // ═════════════════════════════════════════════════════════════
      // 3. WRITE audit log to centralDb (Neon Postgres)
      // ═════════════════════════════════════════════════════════════
      await central.insert(auditLogs).values({
        id: "audit_" + Date.now().toString(36),
        eventType: "verification_created",
        ip,
        success: true,
        durationMs: Date.now() - startedAt,
        docType: body.docType || "national_id",
        recordId: id,
        country: body.country || null,
        metadata: { source: "dual-demo", edgeRecordsRead: recentRecords.length },
      });

      writeResult = { id, status: "written to Neon Postgres" };
    }

    // ═══════════════════════════════════════════════════════════════
    // Response: combine edge read + central write results
    // ═══════════════════════════════════════════════════════════════
    return NextResponse.json({
      architecture: "dual-database (edge/central)",
      edge: {
        database: "Turso (libSQL)",
        runtime: "edge-capable",
        action: "read",
        recordsRead: recentRecords.length,
        sample: recentRecords[0]
          ? {
              id: recentRecords[0].id,
              fullNameAr: recentRecords[0].fullNameAr,
              status: recentRecords[0].status,
            }
          : null,
      },
      central: {
        database: "Neon Postgres",
        runtime: "nodejs",
        action: "write",
        writeResult,
        auditLogCreated: !!writeResult,
      },
      totalMs: Date.now() - startedAt,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message, stack: e.stack?.slice(0, 200) },
      { status: 500 }
    );
  }
}
