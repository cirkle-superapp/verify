/**
 * Verification session management.
 *
 * Creates, tracks, and manages verification sessions with:
 *  - Unique session IDs
 *  - Expiry (sessions auto-expire after 30 minutes)
 *  - State tracking (each step recorded)
 *  - Audit trail (every action logged)
 *  - Resume capability (user can leave and come back)
 *
 * Competitors charge for session management; Cirkle provides it free.
 */

import { createHash, randomBytes } from "crypto";

export type SessionState = "created" | "doc_uploaded" | "doc_extracted" | "selfie_captured" | "liveness_passed" | "completed" | "failed" | "expired";

export interface VerificationSession {
  id: string;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  ip: string;
  docType?: string;
  stepsCompleted: string[];
  auditLog: AuditEntry[];
  result?: {
    status: string;
    confidence: number;
    recordId?: string;
  };
}

interface AuditEntry {
  timestamp: string;
  action: string;
  details?: string;
  ip?: string;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const sessions = new Map<string, VerificationSession>();

/**
 * Create a new verification session.
 */
export function createSession(ip: string): VerificationSession {
  const id = "vs_" + randomBytes(12).toString("hex");
  const now = new Date().toISOString();
  const session: VerificationSession = {
    id,
    state: "created",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    ip,
    stepsCompleted: [],
    auditLog: [{
      timestamp: now,
      action: "session_created",
      ip,
    }],
  };
  sessions.set(id, session);
  return session;
}

/**
 * Get a session by ID. Returns null if not found or expired.
 */
export function getSession(id: string): VerificationSession | null {
  const session = sessions.get(id);
  if (!session) return null;

  // Check expiry
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    session.state = "expired";
    session.auditLog.push({
      timestamp: new Date().toISOString(),
      action: "session_expired",
    });
    return session;
  }
  return session;
}

/**
 * Update a session's state and add an audit entry.
 */
export function updateSession(
  id: string,
  state: SessionState,
  stepCompleted?: string,
  details?: string
): VerificationSession | null {
  const session = sessions.get(id);
  if (!session) return null;

  // Check expiry
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    session.state = "expired";
    return session;
  }

  session.state = state;
  session.updatedAt = new Date().toISOString();
  if (stepCompleted && !session.stepsCompleted.includes(stepCompleted)) {
    session.stepsCompleted.push(stepCompleted);
  }
  session.auditLog.push({
    timestamp: session.updatedAt,
    action: `state_changed:${state}`,
    details: details || stepCompleted,
  });
  return session;
}

/**
 * Set the final result on a session.
 */
export function setSessionResult(
  id: string,
  result: { status: string; confidence: number; recordId?: string }
): VerificationSession | null {
  const session = sessions.get(id);
  if (!session) return null;
  session.result = result;
  session.state = result.status === "verified" ? "completed" : "failed";
  session.updatedAt = new Date().toISOString();
  session.auditLog.push({
    timestamp: session.updatedAt,
    action: `result_set:${result.status}`,
    details: `confidence: ${result.confidence}`,
  });
  return session;
}

/**
 * Get all sessions (for admin dashboard).
 */
export function getAllSessions(): VerificationSession[] {
  return Array.from(sessions.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Clean up expired sessions.
 */
export function cleanupSessions(): number {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, session] of sessions) {
    if (new Date(session.expiresAt).getTime() < now) {
      sessions.delete(id);
      cleaned++;
    }
  }
  return cleaned;
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupSessions, 5 * 60 * 1000).unref?.();
}
