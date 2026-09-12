/**
 * Lightweight audit logger for API operations.
 *
 * Logs structured events to console (and could be extended to a DB table
 * or external service). Each log entry includes:
 *  - timestamp
 *  - operation type
 *  - IP address
 *  - duration
 *  - success/failure
 *  - relevant metadata (docType, recordId, etc.)
 *
 * In production, these logs are captured by Vercel's log infrastructure.
 */

export type AuditEventType =
  | "document_extract"
  | "face_match"
  | "liveness_check"
  | "record_create"
  | "record_list"
  | "record_delete"
  | "sample_create"
  | "sample_delete"
  | "eval_run"
  | "export"
  | "rate_limited"
  | "auth_error";

export interface AuditEvent {
  type: AuditEventType;
  ip?: string;
  durationMs?: number;
  success: boolean;
  docType?: string;
  recordId?: string;
  country?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

const LOG_PREFIX = "[AUDIT]";

export function logAudit(event: AuditEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    type: event.type,
    ip: event.ip || "unknown",
    success: event.success,
    durationMs: event.durationMs,
    docType: event.docType,
    recordId: event.recordId,
    country: event.country,
    error: event.error,
    ...event.metadata,
  };
  // In production, Vercel captures console.log output
  console.log(LOG_PREFIX, JSON.stringify(entry));
}

/** Wrap an async handler with audit logging + timing. */
export async function withAudit<T>(
  type: AuditEventType,
  ip: string | undefined,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await fn();
    logAudit({
      type,
      ip,
      success: true,
      durationMs: Date.now() - t0,
      ...metadata,
    });
    return result;
  } catch (e: any) {
    logAudit({
      type,
      ip,
      success: false,
      durationMs: Date.now() - t0,
      error: e?.message || "unknown",
      ...metadata,
    });
    throw e;
  }
}
