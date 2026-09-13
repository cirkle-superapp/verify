/**
 * Customer-Funded SMS Adapter + State Machine.
 *
 * Per architecture mandate:
 *   - SMS is NOT free platform service
 *   - OPTIONAL CUSTOMER-FUNDED COMMUNICATION only
 *   - Platform NEVER pays SMS charges from infrastructure budget
 *   - Every SMS requires: customer_id + consent + charge disclosure + billing authorization
 *
 * State machine:
 *   NOT_REQUESTED → QUOTED → AUTHORIZED → QUEUED → SUBMITTED → DELIVERED → CHARGED
 *                                                                     ↘ FAILED
 *                                                              CHARGE_PENDING → REFUNDED
 *   Any state → CANCELLED (until SUBMITTED)
 *
 * Implements SmsPort. Provider-neutral — actual vendor configured per-customer.
 * Fail-closed: never sends without explicit authorization.
 */

import type { SmsPort, SmsRequest, SmsResult, QuotaSnapshot, FailureType, SmsState } from "./ports";
import { PlatformError } from "./ports";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";

const SMS_BREAKER = {
  name: "sms_provider",
  failureThreshold: 3,
  openDurationMs: 60_000,
  halfOpenProbes: 2,
};

// ─── In-memory authorization ledger (production: Turso table) ─────
interface AuthorizationRecord {
  smsRequestId: string;
  customerId: string;
  state: SmsState;
  estimatedCost: number;
  currency: string;
  authorizationReference: string | null;
  consentReference: string | null;
  createdAt: string;
  authorizedAt: string | null;
  providerMessageId: string | null;
  failureType: FailureType | null;
  reason: string | null;
}

const authorizations = new Map<string, AuthorizationRecord>();

function newState(smsRequestId: string, customerId: string): AuthorizationRecord {
  return {
    smsRequestId,
    customerId,
    state: "NOT_REQUESTED",
    estimatedCost: 0,
    currency: "USD",
    authorizationReference: null,
    consentReference: null,
    createdAt: new Date().toISOString(),
    authorizedAt: null,
    providerMessageId: null,
    failureType: null,
    reason: null,
  };
}

function setState(rec: AuthorizationRecord, next: SmsState, reason?: string) {
  // Enforce valid transitions (fail-closed on invalid)
  const valid: Record<SmsState, SmsState[]> = {
    NOT_REQUESTED: ["QUOTED", "CANCELLED"],
    QUOTED: ["AUTHORIZED", "CANCELLED"],
    AUTHORIZED: ["QUEUED", "CANCELLED", "FAILED"],
    QUEUED: ["SUBMITTED", "FAILED", "CANCELLED"],
    SUBMITTED: ["DELIVERED", "FAILED"],
    DELIVERED: ["CHARGE_PENDING", "CHARGED"],
    FAILED: ["CHARGE_PENDING", "REFUNDED", "CANCELLED"],
    CHARGE_PENDING: ["CHARGED", "REFUNDED"],
    CHARGED: ["REFUNDED"],
    REFUNDED: [],
    CANCELLED: [],
  };
  if (!valid[rec.state].includes(next)) {
    throw new PlatformError(
      "CONFLICT",
      `Invalid SMS state transition: ${rec.state} → ${next} (smsRequestId=${rec.smsRequestId})`,
      undefined,
      false,
      "sms",
    );
  }
  rec.state = next;
  if (reason) rec.reason = reason;
}

export const customerFundedSmsAdapter: SmsPort = {
  name: "customer-funded-sms",

  async quote(req): Promise<{ estimatedCost: number; currency: string; validForSeconds: number }> {
    const smsRequestId = "sms_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const rec = newState(smsRequestId, req.customerId);
    rec.estimatedCost = req.estimatedCost || estimateCost(req.destination, req.message);
    rec.currency = req.currency || "USD";
    setState(rec, "QUOTED");
    authorizations.set(smsRequestId, rec);
    return {
      estimatedCost: rec.estimatedCost,
      currency: rec.currency,
      validForSeconds: 300, // quote valid 5 min
    };
  },

  async authorize(smsRequestId, customerId): Promise<{ authorized: boolean; authorizationReference: string }> {
    const rec = authorizations.get(smsRequestId);
    if (!rec) {
      throw new PlatformError("NOT_FOUND", `SMS request ${smsRequestId} not found`, undefined, false, "sms");
    }
    if (rec.customerId !== customerId) {
      throw new PlatformError("AUTHORIZATION_ERROR", "Customer mismatch", undefined, false, "sms");
    }
    // In production: verify billing/credit authorization here
    const authorizationReference = "auth_" + Math.random().toString(36).slice(2, 12);
    rec.authorizationReference = authorizationReference;
    rec.authorizedAt = new Date().toISOString();
    setState(rec, "AUTHORIZED");
    return { authorized: true, authorizationReference };
  },

  async send(req: SmsRequest): Promise<SmsResult> {
    const rec = authorizations.get(req.smsRequestId);
    if (!rec) {
      // Auto-create + quote (caller may skip explicit quote step)
      authorizations.set(req.smsRequestId, newState(req.smsRequestId, req.customerId));
    }

    const record = authorizations.get(req.smsRequestId)!;

    // FAIL CLOSED: require explicit authorization
    if (record.state !== "AUTHORIZED" && record.state !== "QUEUED") {
      return {
        smsRequestId: req.smsRequestId,
        status: "FAILED",
        failureType: "SMS_AUTHORIZATION_FAILED",
        reason: `Cannot send: state is ${record.state}. Authorization required (QUOTED → AUTHORIZED → send).`,
      };
    }

    setState(record, "QUEUED");

    // Check SMS provider config
    const providerKey = process.env.SMS_PROVIDER_API_KEY;
    const providerName = process.env.SMS_PROVIDER || "none";
    if (providerName === "none" || !providerKey) {
      // No provider configured — fail closed (NOT a platform-funded gap)
      setState(record, "FAILED", "No SMS provider configured (SMS_PROVIDER=none)");
      return {
        smsRequestId: req.smsRequestId,
        status: "FAILED",
        failureType: "SMS_PAYMENT_REQUIRED",
        reason: "SMS provider not configured. Customer must authorize a paid provider.",
      };
    }

    setState(record, "SUBMITTED");

    try {
      const result = await withBreaker(SMS_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          // Provider-neutral HTTP call — actual vendor configured per-customer
          // This is a placeholder for the real provider adapter
          throw new PlatformError(
            "DEPENDENCY_UNAVAILABLE",
            `SMS provider ${providerName} adapter not yet implemented for this customer`,
            undefined,
            false,
            "sms",
          );
        }),
      );
      setState(record, "DELIVERED");
      record.providerMessageId = result as unknown as string;
      return {
        smsRequestId: req.smsRequestId,
        status: "DELIVERED",
        providerMessageId: record.providerMessageId || undefined,
      };
    } catch (e: any) {
      const ft: FailureType = e instanceof PlatformError ? e.type : "UNKNOWN_INFRASTRUCTURE_FAILURE";
      setState(record, "FAILED", e?.message?.slice(0, 200));
      record.failureType = ft;
      return {
        smsRequestId: req.smsRequestId,
        status: "FAILED",
        failureType: ft,
        reason: e?.message?.slice(0, 200),
      };
    }
  },

  async quota(): Promise<QuotaSnapshot> {
    // SMS is customer-funded — quota is per-customer, not platform-wide.
    // This returns aggregate stats for observability.
    let totalRequested = 0;
    let totalDelivered = 0;
    let totalFailed = 0;
    let totalCost = 0;
    for (const rec of authorizations.values()) {
      totalRequested++;
      if (rec.state === "DELIVERED" || rec.state === "CHARGED") {
        totalDelivered++;
        totalCost += rec.estimatedCost;
      } else if (rec.state === "FAILED") {
        totalFailed++;
      }
    }
    return {
      provider: "sms",
      resource: "customer_funded_usage",
      used: totalDelivered,
      limit: totalRequested || 1, // no platform limit — customer-funded
      percent: totalRequested > 0 ? (totalDelivered / totalRequested) * 100 : 0,
      level: "ok",
      remaining: 999999, // no platform-funded limit
      lastUpdated: new Date().toISOString(),
    };
  },
};

function estimateCost(destination: string, message: string): number {
  // Rough estimate — real pricing depends on destination country + provider
  const segLen = Math.ceil((message?.length || 0) / 160);
  const base = destination?.startsWith("+1") ? 0.0079 : 0.04; // USD per segment
  return Math.round(base * segLen * 100) / 100;
}

/** Get an SMS authorization record (for audit/billing). */
export function getSmsRecord(smsRequestId: string): AuthorizationRecord | null {
  return authorizations.get(smsRequestId) || null;
}
