import { NextResponse } from "next/server";

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
 * OPTIONS /api/v1/verify/gdpr
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/gdpr
 *
 * GDPR/CCPA compliance information + data retention policy + index of
 * every GDPR sub-endpoint.
 *
 * Sub-endpoints:
 *   - GET  /api/v1/verify/gdpr/export?user_id=<id>            — Article 20 portability (data export)
 *   - POST /api/v1/verify/gdpr/erasure                        — Article 17 right to erasure (schedule deletion +30 days)
 *   - GET  /api/v1/verify/gdpr/consent?user_id=<id>           — Article 7  consent state
 *   - POST /api/v1/verify/gdpr/consent                        — Article 7  update consent
 *   - POST /api/v1/verify/gdpr/rectify                       — Article 16 right to rectification (submit request)
 *   - GET  /api/v1/verify/gdpr/rectify?user_id=<id>          — list pending rectification requests
 *   - GET  /api/v1/verify/gdpr/audit?user_id=<id>            — Article 15 right of access + Article 30 records (chained audit log)
 */
export async function GET() {
  return NextResponse.json(
    {
      regulation: "GDPR (EU) + CCPA (California)",
      endpoints: {
        info: "GET /api/v1/verify/gdpr",
        export: "GET  /api/v1/verify/gdpr/export?user_id=<id> — Article 20 portability",
        erasure: "POST /api/v1/verify/gdpr/erasure — Article 17 erasure (schedules +30 days)",
        consent_get: "GET  /api/v1/verify/gdpr/consent?user_id=<id> — Article 7 consent state",
        consent_set: "POST /api/v1/verify/gdpr/consent — Article 7 update consent",
        rectify_submit: "POST /api/v1/verify/gdpr/rectify — Article 16 rectification request",
        rectify_list: "GET  /api/v1/verify/gdpr/rectify?user_id=<id> — list pending requests",
        audit: "GET  /api/v1/verify/gdpr/audit?user_id=<id> — Article 15 + 30 chained audit log",
      },
      dataRetention: {
        policy: "Verification records retained for 90 days, then automatically deleted",
        imagesDeleted: "Document + selfie images deleted immediately after verification (not persisted in DB)",
        outboxEvents: "Deleted after 30 days (processed events cleaned up by cron)",
        apiKeys: "Retained indefinitely (hashed, not raw) until revoked by admin",
        certificateValidity: "90 days (matches retention period)",
        erasureGracePeriod: "30 days (user can cancel any time before deletion_at)",
      },
      rights: {
        access: "GET /api/v1/verify/gdpr/audit?user_id=<id> — full audit log",
        portability: "GET /api/v1/verify/gdpr/export?user_id=<id> — JSON data export (downloadable)",
        erasure: "POST /api/v1/verify/gdpr/erasure — schedule deletion",
        rectification: "POST /api/v1/verify/gdpr/rectify — submit correction request",
        consent: "GET/POST /api/v1/verify/gdpr/consent — view/update consent",
      },
      security: {
        encryption: "All data in transit (HTTPS/TLS 1.3) + at rest (Turso encrypted, Neon encrypted)",
        access: "API key required for all v1 endpoints + per-key rate limiting",
        audit: "All access logged in the GDPR audit chain (SHA-256 chained, tamper-evident)",
        breach: "Epoch fencing prevents split-brain, circuit breakers prevent cascade failures",
      },
      dpo: {
        contact: "dpo@cirkle.verify",
        responseTime: "30 days (GDPR requirement)",
      },
      competitiveAdvantage: "Onfido/Jumio charge extra for GDPR compliance. Cirkle: free, built-in.",
    },
    { headers: CORS_HEADERS },
  );
}
