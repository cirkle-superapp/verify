import { NextRequest, NextResponse } from "next/server";
import { getAuditEvents, getAuditChainHead, verifyAuditChain } from "@/lib/gdpr-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — GDPR endpoints are cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/gdpr/audit
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/gdpr/audit?user_id=<id>
 *
 * GDPR Article 15 + Article 30 — Right of access + records of
 * processing activities. Returns every GDPR-related event recorded
 * for the user, chained with SHA-256 (every event's hash depends on
 * the previous event's hash, so any tampering is detectable).
 *
 * Event types in the chain:
 *   - consent_change       — user opted in/out of marketing, analytics, etc.
 *   - erasure_scheduled    — user requested deletion (Article 17)
 *   - erasure_cancelled    — scheduled deletion was cancelled
 *   - rectify_submitted    — user requested a correction (Article 16)
 *   - rectify_reviewed     — DPO approved/rejected the rectification
 *   - data_export          — user exported their data (Article 20)
 *
 * Response:
 *   {
 *     user_id: string,
 *     events: [{ type, timestamp, details, actor, event_hash }],
 *     chain: {
 *       verified: boolean,           // true if internally consistent
 *       length: number,              // total events in this user's chain
 *       head: "SHA-256 chained",     // hash of the last event (or genesis)
 *       broken_at?: number,          // index of first broken event (if any)
 *     },
 *     hash: "SHA-256 chained"        // alias for chain.head
 *   }
 *
 * @example
 * curl 'https://cirkle-verify.vercel.app/api/v1/verify/gdpr/audit?user_id=u_123'
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const user_id = url.searchParams.get("user_id");
  if (!user_id || user_id.length === 0) {
    return NextResponse.json(
      { error: "user_id query parameter required", code: "MISSING_USER_ID" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const events = getAuditEvents(user_id);
  const head = getAuditChainHead();
  const verification = verifyAuditChain();

  return NextResponse.json(
    {
      user_id,
      events: events.map((e) => ({
        type: e.type,
        timestamp: e.timestamp,
        details: e.details,
        actor: e.actor,
        event_hash: e.event_hash,
        prev_hash: e.prev_hash,
      })),
      chain: {
        verified: verification.verified,
        length: events.length,
        head,
        broken_at: verification.broken_at,
      },
      hash: head,
      regulation: "GDPR Article 15 — Right of access + Article 30 — Records of processing",
      note: "Every event in the chain is hashed with SHA-256(prev_hash || canonical_payload). Tampering with any event invalidates the hash of every subsequent event.",
    },
    { headers: CORS_HEADERS },
  );
}
