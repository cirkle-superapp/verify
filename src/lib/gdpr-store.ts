/**
 * GDPR in-memory store — shared across GDPR route handlers.
 *
 * Holds:
 *   - Per-user consent state (marketing / analytics / profiling / third_party_sharing)
 *   - Erasure jobs (scheduled, in-progress, completed)
 *   - Rectification requests (pending_review / approved / rejected)
 *   - GDPR audit events (consent_change, erasure_scheduled, rectify_submitted,
 *     data_export, etc.) chained with SHA-256(prev_hash || canonical_payload)
 *
 * Module-level state — persists across requests within a single Vercel instance
 * lifecycle. Resets on cold start. In production, all of this would be persisted
 * in Turso / Neon.
 *
 * Used by:
 *   - src/app/api/v1/verify/gdpr/consent/route.ts
 *   - src/app/api/v1/verify/gdpr/erasure/route.ts
 *   - src/app/api/v1/verify/gdpr/rectify/route.ts
 *   - src/app/api/v1/verify/gdpr/audit/route.ts
 *   - src/app/api/v1/verify/gdpr/export/route.ts
 */

import { createHash, randomUUID } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConsentState {
  user_id: string;
  consents: {
    marketing: boolean;
    analytics: boolean;
    profiling: boolean;
    third_party_sharing: boolean;
  };
  updated_at: string;
}

export interface ErasureJob {
  job_id: string;
  user_id: string;
  reason?: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  scheduled_at: string;
  deletion_at: string;
  affected_records: number;
  cancelled_reason?: string;
}

export interface RectificationRequest {
  request_id: string;
  user_id: string;
  field: "name" | "email" | "address";
  current_value: string;
  requested_value: string;
  reason: string;
  status: "pending_review" | "approved" | "rejected" | "completed";
  submitted_at: string;
  estimated_response_at: string;
  reviewed_at?: string;
  reviewer?: string;
  review_notes?: string;
}

export type GdprEventType =
  | "consent_change"
  | "erasure_scheduled"
  | "erasure_cancelled"
  | "rectify_submitted"
  | "rectify_reviewed"
  | "data_export";

export interface GdprAuditEvent {
  type: GdprEventType;
  user_id: string;
  timestamp: string;
  details: Record<string, unknown>;
  actor: "user" | "dpo" | "system";
  prev_hash: string;
  event_hash: string;
}

// ─── Module-level state ───────────────────────────────────────────────────────

const consentStore = new Map<string, ConsentState>();
const erasureJobs = new Map<string, ErasureJob>();
const rectificationRequests = new Map<string, RectificationRequest>();
const auditEvents: GdprAuditEvent[] = [];
const GENESIS_HASH = "0".repeat(64);

// ─── Hashing ──────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256(prev_hash || canonical_payload) — the chaining hash.
 */
function computeHash(prevHash: string, payload: unknown): string {
  const canonical = JSON.stringify(payload, Object.keys(payload as object).sort());
  return createHash("sha256").update(prevHash + canonical).digest("hex");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Default consent state — all flags false until the user explicitly opts in.
 * GDPR Art. 7 requires consent to be opt-in (no pre-checked boxes).
 */
function defaultConsents(): ConsentState["consents"] {
  return {
    marketing: false,
    analytics: false,
    profiling: false,
    third_party_sharing: false,
  };
}

/**
 * Get (or initialize) the consent record for a user.
 */
export function getConsent(user_id: string): ConsentState {
  let entry = consentStore.get(user_id);
  if (!entry) {
    entry = {
      user_id,
      consents: defaultConsents(),
      updated_at: new Date().toISOString(),
    };
    consentStore.set(user_id, entry);
  }
  return entry;
}

/**
 * Set the full consent record for a user. Returns the updated entry.
 * Does NOT record an audit event — caller must call {@link recordAudit}
 * if needed (the consent route does this).
 */
export function setConsent(
  user_id: string,
  consents: Partial<ConsentState["consents"]>,
): ConsentState {
  const current = consentStore.get(user_id);
  const merged: ConsentState["consents"] = {
    marketing: consents.marketing ?? current?.consents.marketing ?? false,
    analytics: consents.analytics ?? current?.consents.analytics ?? false,
    profiling: consents.profiling ?? current?.consents.profiling ?? false,
    third_party_sharing:
      consents.third_party_sharing ?? current?.consents.third_party_sharing ?? false,
  };
  const entry: ConsentState = {
    user_id,
    consents: merged,
    updated_at: new Date().toISOString(),
  };
  consentStore.set(user_id, entry);
  return entry;
}

/**
 * Schedule an erasure job. The deletion is NOT performed — it would be
 * picked up by an Inngest workflow (`gdpr-erasure-executor`) at the
 * scheduled deletion time. Returns the new job record.
 */
export function scheduleErasure(
  user_id: string,
  reason: string | undefined,
  affectedRecords: number,
): ErasureJob {
  const now = new Date();
  const deletionAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days
  const job: ErasureJob = {
    job_id: `gdpr-eras-${randomUUID().slice(0, 12)}`,
    user_id,
    reason,
    status: "scheduled",
    scheduled_at: now.toISOString(),
    deletion_at: deletionAt.toISOString(),
    affected_records: affectedRecords,
  };
  erasureJobs.set(job.job_id, job);
  return job;
}

/**
 * Fetch all known erasure jobs for a user.
 */
export function getErasureJobs(user_id: string): ErasureJob[] {
  return Array.from(erasureJobs.values()).filter((j) => j.user_id === user_id);
}

/**
 * Submit a rectification request. Returns the new request record.
 */
export function submitRectification(
  user_id: string,
  field: RectificationRequest["field"],
  current_value: string,
  requested_value: string,
  reason: string,
): RectificationRequest {
  const now = new Date();
  const responseEta = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 days per GDPR
  const req: RectificationRequest = {
    request_id: `gdpr-rect-${randomUUID().slice(0, 12)}`,
    user_id,
    field,
    current_value,
    requested_value,
    reason,
    status: "pending_review",
    submitted_at: now.toISOString(),
    estimated_response_at: responseEta.toISOString(),
  };
  rectificationRequests.set(req.request_id, req);
  return req;
}

/**
 * Fetch all rectification requests for a user.
 */
export function getRectificationRequests(user_id: string): RectificationRequest[] {
  return Array.from(rectificationRequests.values()).filter((r) => r.user_id === user_id);
}

/**
 * Append an event to the GDPR audit chain. Each event's hash depends on the
 * previous event's hash (SHA-256(prev_hash || canonical_payload)).
 * Returns the recorded event.
 */
export function recordAudit(
  type: GdprEventType,
  user_id: string,
  details: Record<string, unknown>,
  actor: GdprAuditEvent["actor"] = "system",
): GdprAuditEvent {
  const timestamp = new Date().toISOString();
  const prevHash = auditEvents.length > 0
    ? auditEvents[auditEvents.length - 1].event_hash
    : GENESIS_HASH;
  const payload = { type, user_id, timestamp, details, actor };
  const event_hash = computeHash(prevHash, payload);
  const event: GdprAuditEvent = {
    type,
    user_id,
    timestamp,
    details,
    actor,
    prev_hash: prevHash,
    event_hash,
  };
  auditEvents.push(event);
  return event;
}

/**
 * Return all GDPR audit events for a user, in chronological order.
 */
export function getAuditEvents(user_id: string): GdprAuditEvent[] {
  return auditEvents.filter((e) => e.user_id === user_id);
}

/**
 * Return the SHA-256 hash of the entire audit chain head (the last
 * event's event_hash, or genesis if empty). Used to demonstrate that
 * the chain is tamper-evident.
 */
export function getAuditChainHead(): string {
  return auditEvents.length > 0
    ? auditEvents[auditEvents.length - 1].event_hash
    : GENESIS_HASH;
}

/**
 * Verify the integrity of the in-memory audit chain. Each event's
 * prev_hash MUST equal the previous event's event_hash, and recomputing
 * the hash of each event MUST match its stored event_hash.
 */
export function verifyAuditChain(): {
  verified: boolean;
  length: number;
  broken_at?: number;
} {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < auditEvents.length; i++) {
    const ev = auditEvents[i];
    if (ev.prev_hash !== prevHash) {
      return { verified: false, length: auditEvents.length, broken_at: i };
    }
    const payload = {
      type: ev.type,
      user_id: ev.user_id,
      timestamp: ev.timestamp,
      details: ev.details,
      actor: ev.actor,
    };
    const recomputed = computeHash(prevHash, payload);
    if (recomputed !== ev.event_hash) {
      return { verified: false, length: auditEvents.length, broken_at: i };
    }
    prevHash = ev.event_hash;
  }
  return { verified: true, length: auditEvents.length };
}
