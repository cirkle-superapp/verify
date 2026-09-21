import { NextRequest, NextResponse } from "next/server";
import { submitRectification, recordAudit } from "@/lib/gdpr-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — GDPR endpoints are cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/gdpr/rectify
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Allowed rectification fields (whitelist).
 *
 * Biometric fields (face template, fingerprint, iris) are NOT in this
 * list — biometric data is special-category data under GDPR Art. 9
 * and cannot be rectified through a self-service endpoint; it must
 * be re-captured by a fresh verification.
 */
const ALLOWED_FIELDS = ["name", "email", "address"] as const;
type RectifyField = (typeof ALLOWED_FIELDS)[number];

/**
 * POST /api/v1/verify/gdpr/rectify
 *
 * GDPR Article 16 — Right to rectification. The data subject can
 * request correction of inaccurate personal data. Requests enter
 * a `pending_review` state and a Data Protection Officer (DPO) must
 * approve or reject them within 30 days (the same SLA as erasure).
 *
 * Body:
 *   {
 *     user_id: string,
 *     field: "name" | "email" | "address",
 *     current_value: string,
 *     requested_value: string,
 *     reason: string
 *   }
 *
 * Validation:
 *   - user_id, field, current_value, requested_value, reason required
 *   - field must be one of the whitelisted fields
 *   - Biometric fields (face, fingerprint, iris) are explicitly rejected
 *
 * Response:
 *   {
 *     request_id: "gdpr-rect-...",
 *     status: "pending_review",
 *     submitted_at: ISO,
 *     estimated_response_at: ISO+30days,
 *     review_url: "/api/v1/verify/gdpr/rectify?request_id=..."
 *   }
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/gdpr/rectify \
 *   -H "Content-Type: application/json" \
 *   -d '{"user_id":"u_123","field":"name","current_value":"Mohamed","requested_value":"Mohammad","reason":"spelling"}'
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
    const field: unknown = body.field;
    const current_value: unknown = body.current_value;
    const requested_value: unknown = body.requested_value;
    const reason: unknown = body.reason;

    if (typeof user_id !== "string" || user_id.length === 0) {
      return NextResponse.json(
        { error: "user_id (string) required", code: "MISSING_USER_ID" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (typeof field !== "string" || !ALLOWED_FIELDS.includes(field as RectifyField)) {
      return NextResponse.json(
        {
          error: `field must be one of: ${ALLOWED_FIELDS.join(", ")}. Biometric fields (face, fingerprint, iris) are NOT rectifiable — re-capture via a new verification.`,
          code: "INVALID_FIELD",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (typeof current_value !== "string" || current_value.length === 0) {
      return NextResponse.json(
        { error: "current_value (string) required", code: "MISSING_CURRENT_VALUE" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (typeof requested_value !== "string" || requested_value.length === 0) {
      return NextResponse.json(
        { error: "requested_value (string) required", code: "MISSING_REQUESTED_VALUE" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (current_value === requested_value) {
      return NextResponse.json(
        { error: "requested_value must differ from current_value", code: "NO_CHANGE" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (typeof reason !== "string" || reason.length === 0) {
      return NextResponse.json(
        { error: "reason (string) required", code: "MISSING_REASON" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const request = submitRectification(
      user_id,
      field as RectifyField,
      current_value,
      requested_value,
      reason,
    );

    recordAudit(
      "rectify_submitted",
      user_id,
      {
        request_id: request.request_id,
        field: request.field,
        current_value,
        requested_value,
        reason,
      },
      "user",
    );

    return NextResponse.json(
      {
        request_id: request.request_id,
        status: request.status,
        submitted_at: request.submitted_at,
        estimated_response_at: request.estimated_response_at,
        review_url: `/api/v1/verify/gdpr/rectify?request_id=${encodeURIComponent(request.request_id)}`,
        regulation: "GDPR Article 16 — Right to rectification",
        note: "Request will be reviewed by a Data Protection Officer. Biometric data cannot be rectified — re-capture via a new verification.",
      },
      { status: 202, headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "rectification submission failed", code: "RECTIFY_FAILURE" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/gdpr/rectify?user_id=<id>
 *
 * Returns all rectification requests for the user (useful for the
 * user to track the status of pending requests).
 *
 * Response:
 *   {
 *     user_id: string,
 *     requests: RectificationRequest[]
 *   }
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
  // Lazy-import to avoid circular deps at module-load time.
  const { getRectificationRequests } = await import("@/lib/gdpr-store");
  const requests = getRectificationRequests(user_id);
  return NextResponse.json(
    { user_id, requests, count: requests.length },
    { headers: CORS_HEADERS },
  );
}
