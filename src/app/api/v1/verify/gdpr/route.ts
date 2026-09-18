import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/v1/verify/gdpr
 *
 * GDPR/CCPA compliance information + data retention policy.
 */
export async function GET() {
  return NextResponse.json({
    regulation: "GDPR (EU) + CCPA (California)",
    dataRetention: {
      policy: "Verification records retained for 90 days, then automatically deleted",
      imagesDeleted: "Document + selfie images deleted immediately after verification (not persisted in DB)",
      outboxEvents: "Deleted after 30 days (processed events cleaned up by cron)",
      apiKeys: "Retained indefinitely (hashed, not raw) until revoked by admin",
      certificateValidity: "90 days (matches retention period)",
    },
    rights: {
      access: "GET /api/v1/verify/gdpr/export?nationalId=<id> — export all data for a given identity",
      erasure: "DELETE /api/v1/verify/gdpr/erasure?nationalId=<id> — delete all verification records for an identity",
      portability: "Export returns JSON with all fields + timestamps",
      consent: "Verification requires explicit consent (checkbox in UI before capture)",
    },
    security: {
      encryption: "All data in transit (HTTPS/TLS 1.3) + at rest (Turso encrypted, Neon encrypted)",
      access: "API key required for all v1 endpoints + per-key rate limiting",
      audit: "All access logged in AuditLog table + outbox_events",
      breach: "Epoch fencing prevents split-brain, circuit breakers prevent cascade failures",
    },
    dpo: {
      contact: "dpo@cirkle.verify",
      responseTime: "30 days (GDPR requirement)",
    },
    competitiveAdvantage: "Onfido/Jumio charge extra for GDPR compliance. Cirkle: free, built-in.",
  });
}
