import { NextRequest, NextResponse } from "next/server";
import {
  ContinuousAuthEngine,
  type ContinuousAuthSignal,
  type AuthSession,
  type SessionSummary,
  type DriftResult,
  type ReverifyDecision,
  type AnomalyResult,
  type AuditTrailExport,
  DEFAULT_CONFIG,
} from "@/lib/continuous-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — continuous-auth endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/continuous-auth
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── In-memory engine ────────────────────────────────────────────────────
//
// The ContinuousAuthEngine persists across requests within a single Vercel
// instance lifecycle (resets on cold start). In production, sessions are
// also persisted to Turso (continuous_auth_sessions + continuous_auth_signals
// tables) so they survive across instances.

const engine = new ContinuousAuthEngine(DEFAULT_CONFIG);

/**
 * Continuous Auth API request payload.
 *
 * `action` selects the engine operation. The remaining fields are
 * conditionally required based on the action.
 */
interface ContinuousAuthRequest {
  /** Engine operation to perform. */
  action: "start" | "signal" | "status" | "revoke" | "audit";
  /** Session ID (required for signal / status / revoke / audit). */
  sessionId?: string;
  /** User ID (required for start). */
  userId?: string;
  /** Initial trust score 0..1 for the new session (default 1.0; used by start). */
  initialTrust?: number;
  /** Continuous-auth signal to record (required for signal). */
  signal?: ContinuousAuthSignal;
  /** Reason for revocation (used by revoke). */
  reason?: string;
  /** ISO-8601 timestamp at which to compute decayed trust (used by status). */
  atTime?: string;
}

/**
 * POST /api/v1/verify/continuous-auth
 *
 * Continuous authentication — periodic re-verification during a session.
 *
 * Standard auth is "front-loaded": verify once at login, trust for the
 * rest of the session. This is a fatal flaw — it assumes the actor at
 * minute 30 is the same as the actor at minute 0. Continuous authentication
 * samples passive biometric signals every few minutes; when drift crosses
 * a threshold, the engine forces step-up re-verification; when drift
 * crosses a higher revocation threshold, the session is killed instantly.
 *
 * ## Actions
 *
 *   - `start` → { sessionId, startedAt, initialTrust }
 *   - `signal` → { drift, shouldReverify, recommendedModality, anomalyDetected }
 *   - `status` → { session, summary, trustDecay, driftTrend, status }
 *   - `revoke` → { revoked: true, reason, timestamp }
 *   - `audit` → { entries, hash } (SHA-256 chained audit trail)
 *
 * ## Trust model
 *
 * Trust decays exponentially: trust(t) = trust_0 * exp(-0.05 * hours_since_last_verified).
 * Any new verified signal resets the clock and lifts trust back toward
 * baseline. Trust never exceeds 1.0.
 *
 * ## Competitor gap
 *
 * Onfido, Jumio, Veriff, Sumsub all do one-shot identity verification.
 * None of them ship continuous re-verification during the post-authn
 * session — the single largest source of post-auth fraud (account
 * takeover, session hijack, insider misuse).
 *
 * @example
 * # Start a session
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/continuous-auth \
 *   -H "Content-Type: application/json" \
 *   -d '{"action":"start","userId":"user-123","initialTrust":0.95}'
 *
 * # Record a signal
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/continuous-auth \
 *   -H "Content-Type: application/json" \
 *   -d '{"action":"signal","sessionId":"cas_xxx","signal":{"timestamp":"2026-09-12T10:00:00Z","type":"face","value":0.9,"drift":0.1,"detail":"face crop cosine 0.9"}}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ContinuousAuthRequest;

    if (!body || typeof body.action !== "string") {
      return NextResponse.json(
        { error: "action (string) is required", code: "INVALID_INPUT" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    switch (body.action) {
      // ─── start ────────────────────────────────────────────────────
      case "start": {
        if (typeof body.userId !== "string" || body.userId.length === 0) {
          return NextResponse.json(
            { error: "userId is required for action=start", code: "MISSING_USER_ID" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        const initialTrust = typeof body.initialTrust === "number"
          ? Math.max(0, Math.min(1, body.initialTrust))
          : 1.0;
        const session = engine.startSession(body.userId, initialTrust);
        return NextResponse.json(
          {
            sessionId: session.sessionId,
            startedAt: session.startedAt,
            initialTrust: session.baselineTrust,
          },
          { status: 201, headers: CORS_HEADERS },
        );
      }

      // ─── signal ───────────────────────────────────────────────────
      case "signal": {
        if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
          return NextResponse.json(
            { error: "sessionId is required for action=signal", code: "MISSING_SESSION_ID" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        if (!body.signal || typeof body.signal !== "object") {
          return NextResponse.json(
            { error: "signal (ContinuousAuthSignal) is required for action=signal", code: "MISSING_SIGNAL" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        try {
          engine.recordSignal(body.sessionId, body.signal);
        } catch (e: any) {
          // recordSignal throws on unknown or revoked sessions.
          return NextResponse.json(
            {
              drift: 1,
              shouldReverify: true,
              recommendedModality: "face",
              anomalyDetected: true,
              anomaly: {
                isAnomalous: true,
                anomalyType: "missing_signals",
                severity: "critical",
                detail: e?.message || "session unavailable",
              },
              error: e?.message,
            },
            { status: 410, headers: CORS_HEADERS },
          );
        }
        const drift: DriftResult = engine.computeDrift(body.sessionId);
        const decision: ReverifyDecision = engine.shouldReverify(body.sessionId);
        const anomaly: AnomalyResult = engine.detectAnomaly(body.sessionId);
        return NextResponse.json(
          {
            drift: drift.drift,
            driftTrend: drift.trend,
            driftConfidence: drift.confidence,
            shouldReverify: decision.should,
            reason: decision.reason,
            recommendedModality: decision.recommendedModality,
            anomalyDetected: anomaly.isAnomalous,
            anomaly,
          },
          { headers: CORS_HEADERS },
        );
      }

      // ─── status ───────────────────────────────────────────────────
      case "status": {
        if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
          return NextResponse.json(
            { error: "sessionId is required for action=status", code: "MISSING_SESSION_ID" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        // We don't expose the full session (signals could be large); instead
        // surface the summary + drift + trust decay.
        const session: AuthSession | undefined = (engine as any).sessions?.get(body.sessionId) as AuthSession | undefined;
        if (!session) {
          return NextResponse.json(
            {
              session: null,
              summary: {
                sessionId: body.sessionId,
                duration: 0,
                signalCount: 0,
                meanTrust: 0,
                minTrust: 0,
                driftTrend: "stable",
                status: "revoked",
              } as SessionSummary,
              trustDecay: 0,
              driftTrend: "stable",
              status: "unknown",
            },
            { status: 404, headers: CORS_HEADERS },
          );
        }
        const summary: SessionSummary = engine.getSessionSummary(body.sessionId);
        const drift = engine.computeDrift(body.sessionId);
        const atTime = typeof body.atTime === "string" ? body.atTime : new Date().toISOString();
        const trustDecay = engine.getTrustDecay(body.sessionId, atTime);
        return NextResponse.json(
          {
            session: {
              sessionId: session.sessionId,
              userId: session.userId,
              startedAt: session.startedAt,
              lastVerifiedAt: session.lastVerifiedAt,
              verificationCount: session.verificationCount,
              trustScore: session.trustScore,
              baselineTrust: session.baselineTrust,
              status: session.status,
              revokeReason: session.revokeReason,
            },
            summary,
            trustDecay,
            driftTrend: drift.trend,
            status: session.status,
          },
          { headers: CORS_HEADERS },
        );
      }

      // ─── revoke ───────────────────────────────────────────────────
      case "revoke": {
        if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
          return NextResponse.json(
            { error: "sessionId is required for action=revoke", code: "MISSING_SESSION_ID" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        const reason = typeof body.reason === "string" && body.reason.length > 0
          ? body.reason
          : "manual revocation via API";
        try {
          engine.revoke(body.sessionId, reason);
        } catch (e: any) {
          return NextResponse.json(
            { revoked: false, error: e?.message || "session not found" },
            { status: 404, headers: CORS_HEADERS },
          );
        }
        return NextResponse.json(
          {
            revoked: true,
            reason,
            timestamp: new Date().toISOString(),
          },
          { headers: CORS_HEADERS },
        );
      }

      // ─── audit ────────────────────────────────────────────────────
      case "audit": {
        if (typeof body.sessionId !== "string" || body.sessionId.length === 0) {
          return NextResponse.json(
            { error: "sessionId is required for action=audit", code: "MISSING_SESSION_ID" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        const trail: AuditTrailExport = engine.exportAuditTrail(body.sessionId);
        return NextResponse.json(
          {
            entries: trail.entries,
            hash: trail.hash,
          },
          { headers: CORS_HEADERS },
        );
      }

      default: {
        return NextResponse.json(
          {
            error: `Unknown action '${body.action}'. Supported: start, signal, status, revoke, audit.`,
            code: "UNKNOWN_ACTION",
          },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "continuous auth operation failed",
        code: "CONTINUOUS_AUTH_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/continuous-auth
 *
 * Returns API documentation and a description of the trust model.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "Continuous Authentication API",
      version: "1.0.0",
      description:
        "Continuous authentication — periodic re-verification during a session. Samples passive biometric signals (face crops, voice, keystrokes, mouse, device angle) every few minutes; forces step-up re-verification when drift crosses a threshold; kills the session when drift crosses a higher revocation threshold.",
      competitiveAdvantage:
        "Onfido, Jumio, Veriff, Sumsub all do one-shot identity verification. None ship continuous re-verification during the post-authn session — the single largest source of post-auth fraud (account takeover, session hijack, insider misuse).",
      endpoints: {
        POST: "Submit an action (start / signal / status / revoke / audit).",
        GET: "This documentation + trust model.",
        OPTIONS: "CORS preflight (204 No Content).",
      },
      actions: {
        start: {
          body: { action: "start", userId: "string", initialTrust: "number 0..1 (default 1.0)" },
          response: { sessionId: "string", startedAt: "ISO-8601", initialTrust: "number" },
        },
        signal: {
          body: {
            action: "signal",
            sessionId: "string",
            signal: "ContinuousAuthSignal { timestamp, type, value, drift, detail, location?, deviceId? }",
          },
          response: {
            drift: "number 0..1",
            driftTrend: "'increasing' | 'decreasing' | 'stable'",
            shouldReverify: "boolean",
            recommendedModality: "BiometricModality",
            anomalyDetected: "boolean",
            anomaly: "AnomalyResult",
          },
        },
        status: {
          body: { action: "status", sessionId: "string", atTime: "ISO-8601 (optional)" },
          response: {
            session: "session metadata (no signals)",
            summary: "SessionSummary",
            trustDecay: "number 0..1 (decayed trust at atTime)",
            driftTrend: "'increasing' | 'decreasing' | 'stable'",
            status: "'active' | 'reverify' | 'revoked'",
          },
        },
        revoke: {
          body: { action: "revoke", sessionId: "string", reason: "string (optional)" },
          response: { revoked: "true", reason: "string", timestamp: "ISO-8601" },
        },
        audit: {
          body: { action: "audit", sessionId: "string" },
          response: { entries: "AuditEntry[]", hash: "SHA-256 chain head" },
        },
      },
      trustModel: {
        decay: "trust(t) = trust_0 * exp(-0.05 * hours_since_last_verified)",
        halfLife: "≈ 13.86 hours (ln(2) / 0.05)",
        bumpOnSignal: "verified signal lifts trust toward baseline by 50% of the gap",
        clamp: "trust ∈ [0, 1]",
      },
      thresholds: {
        checkIntervalMs: DEFAULT_CONFIG.checkIntervalMs,
        driftThreshold: DEFAULT_CONFIG.driftThreshold,
        revocationThreshold: DEFAULT_CONFIG.revocationThreshold,
        maxSignals: DEFAULT_CONFIG.maxSignals,
      },
      signalTypes: ["face", "voice", "behavioral", "device", "location"],
      anomalyDetectors: [
        "sudden_drift — single-signal drift jump > 0.3",
        "missing_signals — no signal in 3 × checkIntervalMs",
        "impossible_location_change — two location signals > 900 km/h apart",
        "device_switch — different deviceId within 5 signals",
        "behavioral_shift — behavioral match drops > 0.4 from rolling mean",
      ],
      auditTrail: {
        algorithm: "SHA-256(prevHash || timestamp || action || details) — chained",
        regulatorySupport: ["SOC 2 Type II", "ISO 27001", "EU AI Act (high-risk logging)"],
      },
      example: {
        start: { action: "start", userId: "user-123", initialTrust: 0.95 },
        signal: {
          action: "signal",
          sessionId: "cas_xxx",
          signal: {
            timestamp: "2026-09-12T10:00:00Z",
            type: "face",
            value: 0.9,
            drift: 0.1,
            detail: "face crop cosine 0.9",
          },
        },
        status: { action: "status", sessionId: "cas_xxx" },
        revoke: { action: "revoke", sessionId: "cas_xxx", reason: "session hijack detected" },
        audit: { action: "audit", sessionId: "cas_xxx" },
      },
    },
    { headers: CORS_HEADERS },
  );
}
