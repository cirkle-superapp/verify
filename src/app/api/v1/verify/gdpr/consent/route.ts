import { NextRequest, NextResponse } from "next/server";
import { getConsent, setConsent, recordAudit } from "@/lib/gdpr-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — GDPR endpoints are cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/gdpr/consent
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Allowed consent flags (whitelist).
 */
const ALLOWED_FLAGS = ["marketing", "analytics", "profiling", "third_party_sharing"] as const;
type ConsentFlag = (typeof ALLOWED_FLAGS)[number];

/**
 * GET /api/v1/verify/gdpr/consent?user_id=<id>
 *
 * GDPR Articles 7 + 13 — Right to know what consent has been given
 * and to withdraw it at any time. Returns the current consent state
 * for the user. If no consent record exists yet, returns all-false
 * (opt-in default per GDPR Art. 7 — no pre-checked boxes).
 *
 * Response:
 *   {
 *     user_id: string,
 *     consents: { marketing: bool, analytics: bool, profiling: bool, third_party_sharing: bool },
 *     updated_at: ISO
 *   }
 *
 * @example
 * curl 'https://cirkle-verify.vercel.app/api/v1/verify/gdpr/consent?user_id=u_123'
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
  const state = getConsent(user_id);
  return NextResponse.json(state, { headers: CORS_HEADERS });
}

/**
 * POST /api/v1/verify/gdpr/consent
 *
 * Update the user's consent state. Only the four whitelisted flags
 * are accepted; any other key in the consents object is rejected with
 * 400. Partial updates are supported — only the flags present in the
 * request body are mutated; the rest keep their previous value.
 *
 * Body: { user_id: string, consents: { marketing?, analytics?, profiling?, third_party_sharing? } }
 *
 * Each change is recorded in the GDPR audit chain via {@link recordAudit}.
 *
 * Response:
 *   {
 *     user_id: string,
 *     consents: { ... },
 *     updated_at: ISO,
 *     changes: { marketing?: "off→on" | "on→off", ... }
 *   }
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/gdpr/consent \
 *   -H "Content-Type: application/json" \
 *   -d '{"user_id":"u_123","consents":{"marketing":true,"analytics":false}}'
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
    const consents: unknown = body.consents;

    if (typeof user_id !== "string" || user_id.length === 0) {
      return NextResponse.json(
        { error: "user_id (string) required", code: "MISSING_USER_ID" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (!consents || typeof consents !== "object" || Array.isArray(consents)) {
      return NextResponse.json(
        { error: "consents (object) required", code: "INVALID_CONSENTS" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Validate keys + values
    const incoming = consents as Record<string, unknown>;
    const clean: Partial<Record<ConsentFlag, boolean>> = {};
    const changes: Record<string, string> = {};
    for (const key of Object.keys(incoming)) {
      if (!ALLOWED_FLAGS.includes(key as ConsentFlag)) {
        return NextResponse.json(
          {
            error: `Unknown consent flag: ${key}. Allowed: ${ALLOWED_FLAGS.join(", ")}`,
            code: "UNKNOWN_FLAG",
          },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      const v = incoming[key];
      if (typeof v !== "boolean") {
        return NextResponse.json(
          { error: `consents.${key} must be boolean`, code: "INVALID_FLAG_VALUE" },
          { status: 400, headers: CORS_HEADERS },
        );
      }
      clean[key as ConsentFlag] = v;
    }

    // Compute the diff for the audit log
    const prev = getConsent(user_id);
    for (const k of Object.keys(clean) as ConsentFlag[]) {
      const before = prev.consents[k];
      const after = clean[k]!;
      if (before !== after) {
        changes[k] = `${before ? "on" : "off"}→${after ? "on" : "off"}`;
      }
    }

    const next = setConsent(user_id, clean);

    // Record the change in the GDPR audit chain (only if something changed)
    if (Object.keys(changes).length > 0) {
      recordAudit(
        "consent_change",
        user_id,
        { before: prev.consents, after: next.consents, changes },
        "user",
      );
    }

    return NextResponse.json(
      {
        user_id: next.user_id,
        consents: next.consents,
        updated_at: next.updated_at,
        changes,
        regulation: "GDPR Article 7 — Conditions for consent",
      },
      { headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "consent update failed", code: "CONSENT_FAILURE" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
