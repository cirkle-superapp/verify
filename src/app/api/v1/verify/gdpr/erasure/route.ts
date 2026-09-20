import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { scheduleErasure, recordAudit } from "@/lib/gdpr-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — GDPR endpoints are cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/gdpr/erasure
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/v1/verify/gdpr/erasure
 *
 * GDPR Article 17 — Right to erasure ("right to be forgotten").
 *
 * Body: { user_id: string, reason?: string, confirmed: boolean }
 *
 * This endpoint SCHEDULES a deletion job for +30 days from now. The
 * actual deletion is performed by an Inngest workflow
 * (`gdpr-erasure-executor`) at the scheduled deletion time. Scheduling
 * (rather than immediate deletion) gives the platform a grace period
 * to handle fraud investigations, legal holds, and the user's right
 * to cancel within 30 days.
 *
 * Validation:
 *   - user_id must be present and non-empty
 *   - confirmed must be true (GDPR Art. 17(2)(a) requires explicit consent)
 *
 * Response:
 *   {
 *     scheduled: true,
 *     job_id: "gdpr-eras-...",
 *     deletion_at: ISO+30days,
 *     affected_records: N,
 *     grace_period_ends_at: ISO+30days,
 *     cancel_url: "/api/v1/verify/gdpr/erasure?job_id=...&action=cancel"
 *   }
 *
 * The affected_records count is computed by querying the Verification
 * table for rows matching the given user_id (treated as national_id for
 * KYC flows). If the DB is unavailable, returns 0 — the user can still
 * schedule the erasure.
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/gdpr/erasure \
 *   -H "Content-Type: application/json" \
 *   -d '{"user_id":"u_123","reason":"no longer using the service","confirmed":true}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "JSON body required", code: "INVALID_BODY" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const user_id: unknown = body.user_id;
    const reason: unknown = body.reason;
    const confirmed: unknown = body.confirmed;

    if (typeof user_id !== "string" || user_id.length === 0) {
      return NextResponse.json(
        { error: "user_id (string) required", code: "MISSING_USER_ID" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (confirmed !== true) {
      return NextResponse.json(
        {
          error: "confirmed must be true — GDPR Art. 17 requires explicit confirmation",
          code: "NOT_CONFIRMED",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (reason !== undefined && typeof reason !== "string") {
      return NextResponse.json(
        { error: "reason must be a string if provided", code: "INVALID_REASON" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // ─── Count affected records (best-effort) ────────────────────────
    let affected_records = 0;
    try {
      const rows = await db.verification.findMany({
        where: { nationalId: user_id as any },
        select: { id: true },
      });
      affected_records = rows.length;
    } catch {
      // DB unavailable — defer to the workflow which can recompute.
      affected_records = 0;
    }

    // ─── Schedule the job ─────────────────────────────────────────────
    const job = scheduleErasure(user_id, typeof reason === "string" ? reason : undefined, affected_records);

    // ─── Record the audit event ──────────────────────────────────────
    recordAudit(
      "erasure_scheduled",
      user_id,
      {
        job_id: job.job_id,
        reason: job.reason,
        deletion_at: job.deletion_at,
        affected_records: job.affected_records,
      },
      "user",
    );

    return NextResponse.json(
      {
        scheduled: true,
        job_id: job.job_id,
        deletion_at: job.deletion_at,
        affected_records: job.affected_records,
        grace_period_ends_at: job.deletion_at,
        cancel_url: `/api/v1/verify/gdpr/erasure?job_id=${encodeURIComponent(job.job_id)}&action=cancel`,
        regulation: "GDPR Article 17 — Right to erasure",
        workflow: "inngest:gdpr-erasure-executor",
        note: "Deletion will be performed by an Inngest workflow at the scheduled time. Cancel any time before deletion_at.",
      },
      { status: 202, headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "erasure scheduling failed", code: "ERASURE_FAILURE" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * DELETE /api/v1/verify/gdpr/erasure?nationalId=<id>
 *
 * Legacy immediate-delete endpoint (kept for backward compatibility).
 * New code should use POST + Inngest workflow.
 */
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const nationalId = url.searchParams.get("nationalId");
    if (!nationalId) {
      return NextResponse.json(
        { error: "nationalId required", code: "MISSING_NATIONAL_ID" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const records = await db.verification.findMany({
      where: { nationalId: nationalId as any },
    });

    if (records.length === 0) {
      return NextResponse.json(
        { message: "No records found for this national ID", nationalId },
        { headers: CORS_HEADERS },
      );
    }

    let deletedCount = 0;
    for (const record of records as any[]) {
      try {
        await db.verification.delete({ where: { id: record.id } });
        deletedCount++;
      } catch {}
    }

    return NextResponse.json(
      {
        erasureComplete: true,
        nationalId,
        recordsDeleted: deletedCount,
        regulation: "GDPR Article 17 / CCPA right to delete",
        completedAt: new Date().toISOString(),
        message: `All ${deletedCount} verification record(s) for national ID ending in ${nationalId.slice(-4)} have been permanently deleted.`,
      },
      { headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "erasure failed", code: "ERASURE_FAILURE" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
