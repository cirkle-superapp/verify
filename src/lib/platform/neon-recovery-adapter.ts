/**
 * Neon Recovery Adapter — RECOVERY PROJECTION ONLY.
 *
 * Per architecture mandate:
 *   "Neon is a recovery projection."
 *   "Never implement try Turso / catch / write Neon."
 *   "Never use Turso + Neon simultaneous writes for ordinary transactions."
 *
 * Neon receives events from the outbox via Inngest. It NEVER receives
 * direct business writes. Only a formally authorized database promotion
 * (epoch increment) can make Neon writable, and only for the duration
 * of a Turso outage — never automatic.
 *
 * Tracks replication lag for observability.
 */

import type { DatabasePort, OutboxEvent } from "./ports";
import { PlatformError } from "./ports";
import { isWritable, getEpoch } from "./epoch";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";

const NEON_BREAKER = {
  name: "neon",
  failureThreshold: 3,
  openDurationMs: 60_000,
  halfOpenProbes: 2,
};

// Reuse existing neon client (HTTP-based via @neondatabase/serverless)
let neonSql: ((strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>) | null = null;

async function getSql() {
  if (!neonSql) {
    try {
      const { neon } = await import("@neondatabase/serverless");
      const url = process.env.NEON_DATABASE_URL;
      if (!url) return null;
      neonSql = neon(url);
    } catch {
      return null;
    }
  }
  return neonSql;
}

// ─── Replication state tracking ──────────────────────────────────
interface ReplicationState {
  lastAuthoritativeEventId: string | null;
  lastReplicatedEventId: string | null;
  replicationLagEvents: number;
  replicationLagSeconds: number;
  lastSuccessfulReplicationAt: string | null;
  recoveryState: "in_sync" | "lagging" | "stale" | "promoted" | "unreachable";
  databaseEpoch: number;
}

let replicationState: ReplicationState = {
  lastAuthoritativeEventId: null,
  lastReplicatedEventId: null,
  replicationLagEvents: 0,
  replicationLagSeconds: 0,
  lastSuccessfulReplicationAt: null,
  recoveryState: "in_sync",
  databaseEpoch: getEpoch().epoch,
};

/** Apply a batch of outbox events to Neon (called by Inngest relay). Idempotent. */
export async function applyEvents(events: OutboxEvent[]): Promise<{ applied: number; skipped: number; failed: number }> {
  const sql = await getSql();
  if (!sql) {
    replicationState.recoveryState = "unreachable";
    return { applied: 0, skipped: 0, failed: events.length };
  }

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const e of events) {
    try {
      // Idempotent: use ON CONFLICT (idempotency_key) DO NOTHING
      // Schema-agnostic: stores raw event in an `event_log` table for
      // replay. Domain-specific projections would update business tables.
      await withBreaker(NEON_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          await sql`
            INSERT INTO event_log (
              event_id, aggregate_type, aggregate_id, event_type,
              schema_version, payload, tenant_id, idempotency_key,
              correlation_id, causation_id, replicated_at
            ) VALUES (
              ${e.eventId}, ${e.aggregateType}, ${e.aggregateId}, ${e.eventType},
              ${e.schemaVersion}, ${JSON.stringify(e.payload)}, ${e.tenantId || null},
              ${e.idempotencyKey}, ${e.correlationId || null}, ${e.causationId || null},
              NOW()
            )
            ON CONFLICT (idempotency_key) DO NOTHING
          `;
        }),
      );
      replicationState.lastReplicatedEventId = e.eventId;
      replicationState.lastSuccessfulReplicationAt = new Date().toISOString();
      replicationState.recoveryState = "in_sync";
      applied++;
    } catch (e: any) {
      // Idempotency conflict = skipped, not failed
      if (e?.message?.includes("duplicate") || e?.message?.includes("ON CONFLICT")) {
        skipped++;
      } else {
        failed++;
      }
    }
  }

  // Update lag tracking
  replicationState.replicationLagSeconds = replicationState.lastSuccessfulReplicationAt
    ? Math.floor((Date.now() - new Date(replicationState.lastSuccessfulReplicationAt).getTime()) / 1000)
    : 0;
  replicationState.databaseEpoch = getEpoch().epoch;

  return { applied, skipped, failed };
}

/** Ensure the event_log table exists in Neon (idempotent). */
export async function ensureNeonSchema(): Promise<boolean> {
  const sql = await getSql();
  if (!sql) return false;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS event_log (
        event_id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        payload JSONB NOT NULL,
        tenant_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        correlation_id TEXT,
        causation_id TEXT,
        replicated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_event_log_aggregate ON event_log(aggregate_type, aggregate_id)`;
    return true;
  } catch (e: any) {
    console.error("[neon-adapter] schema init failed:", e?.message?.slice(0, 100));
    return false;
  }
}

export const neonRecoveryAdapter: DatabasePort = {
  name: "neon",
  role: "recovery",

  async query<T = any>(sqlText: string, _params?: any[]): Promise<T[]> {
    const sql = await getSql();
    if (!sql) {
      throw new PlatformError("DATABASE_UNAVAILABLE", "Neon not configured (NEON_DATABASE_URL missing)", undefined, false, "neon");
    }
    // Recovery reads are always allowed (for reconciliation dashboards)
    return withBreaker(NEON_BREAKER, () =>
      withRetry(DEFAULT_RETRY, async () => {
        const res = await sql(sqlText as any);
        return (res || []) as T[];
      }),
    );
  },

  async transaction<T>(_fn: (tx: any) => Promise<T>): Promise<T> {
    // Writes to Neon are FORBIDDEN unless explicitly promoted via epoch
    if (!isWritable("recovery")) {
      throw new PlatformError(
        "AUTHORIZATION_ERROR",
        "Neon is a recovery projection — writes are forbidden unless formally promoted (epoch incremented). " +
          "Use the outbox → Inngest relay for replication, or call promoteDatabase('neon', ...) for controlled failover.",
        undefined,
        false,
        "neon",
      );
    }
    // Only reachable after a controlled promotion
    throw new PlatformError(
      "INTERNAL_ERROR",
      "Neon promotion path requires explicit operator action + schema migration. Not implemented for automatic failover.",
      undefined,
      false,
      "neon",
    );
  },

  async health() {
    const start = Date.now();
    const sql = await getSql();
    if (!sql) return { ok: false, latencyMs: 0, detail: "NEON_DATABASE_URL not configured" };
    try {
      await withBreaker(NEON_BREAKER, () => sql`SELECT 1`);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e: any) {
      replicationState.recoveryState = "unreachable";
      return { ok: false, latencyMs: Date.now() - start, detail: e?.message?.slice(0, 100) };
    }
  },
};

/** Current replication state (for observability dashboard). */
export function getReplicationState(): ReplicationState {
  return { ...replicationState };
}
