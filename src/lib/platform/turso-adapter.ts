/**
 * Turso Database Adapter — AUTHORITATIVE.
 *
 * Per architecture mandate:
 *   "Turso remains THE SINGLE AUTHORITATIVE TRANSACTIONAL DATABASE."
 *   "Never use Turso + Neon simultaneous writes for ordinary transactions."
 *
 * All ordinary business writes go here. Neon is NEVER written to directly
 * by business code — it only receives events via the outbox → Inngest relay.
 *
 * Implements DatabasePort with role="primary" and epoch fencing.
 */

import type { DatabasePort, DbTransaction, OutboxEventInput, OutboxEvent } from "./ports";
import { PlatformError } from "./ports";
import { isWritable, issueFencingToken, verifyEpoch } from "./epoch";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";

// Turso breaker config
const TURSO_BREAKER = {
  name: "turso",
  failureThreshold: 5,
  openDurationMs: 30_000,
  halfOpenProbes: 2,
  maxOpenRetries: 10,
};

// Use the existing TursoHttpClient class (raw /v2/pipeline) which bypasses
// the libsql SDK 401 bug. Instantiated lazily. Returns null in local dev
// mode (no TURSO_DATABASE_URL → using local SQLite via Prisma instead).
let tursoClient: any = null;
let tursoInitFailed = false;

async function getClient(): Promise<any | null> {
  if (tursoInitFailed) return null;
  if (tursoClient) return tursoClient;

  const url = process.env.TURSO_DATABASE_URL;
  if (!url || !url.startsWith("libsql://")) {
    // Local dev mode — no Turso HTTP endpoint. Outbox events can't be
    // persisted via the raw HTTP client; the verification record itself
    // is still saved via Prisma (local SQLite). Outbox is a no-op here.
    tursoInitFailed = true;
    return null;
  }

  try {
    const { TursoHttpClient } = await import("@/lib/turso-http-client");
    tursoClient = new TursoHttpClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return tursoClient;
  } catch (e: any) {
    console.error("[turso-adapter] failed to init TursoHttpClient:", e?.message?.slice(0, 100));
    tursoInitFailed = true;
    return null;
  }
}


function toOutboxRow(e: OutboxEventInput, eventId: string): Record<string, unknown> {
  return {
    event_id: eventId,
    aggregate_type: e.aggregateType,
    aggregate_id: e.aggregateId,
    event_type: e.eventType,
    schema_version: 1,
    payload: JSON.stringify(e.payload),
    tenant_id: e.tenantId || null,
    idempotency_key: e.idempotencyKey,
    correlation_id: e.correlationId || null,
    causation_id: e.causationId || null,
    status: "pending",
    attempt_count: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    processed_at: null,
  };
}

/** Ensure the outbox table exists (idempotent DDL — split into separate statements). */
const OUTBOX_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS outbox_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    tenant_id TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    correlation_id TEXT,
    causation_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON outbox_events(aggregate_type, aggregate_id)`,
];

let initialized = false;

async function ensureSchema() {
  if (initialized) return;
  const client = await getClient();
  if (!client) {
    // Local dev mode — no Turso HTTP client. Outbox is a no-op.
    initialized = true;
    return;
  }
  try {
    // Execute each DDL statement separately (Turso v2/pipeline rejects multi-statement strings)
    for (const ddl of OUTBOX_DDL_STATEMENTS) {
      await client.execute(ddl);
    }
    initialized = true;
  } catch (e: any) {
    console.error("[turso-adapter] schema init failed:", e?.message?.slice(0, 100));
  }
}

class TursoTransaction implements DbTransaction {
  private events: OutboxEventInput[] = [];
  private statements: { sql: string; params?: any[] }[] = [];
  private committed = false;
  private rolledBack = false;

  query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (this.committed || this.rolledBack) {
      throw new PlatformError("INTERNAL_ERROR", "Transaction already finalized");
    }
    this.statements.push({ sql, params });
    return Promise.resolve([] as T[]);
  }

  appendOutbox(event: OutboxEventInput): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  async commit(): Promise<void> {
    if (this.committed) throw new PlatformError("INTERNAL_ERROR", "Already committed");
    if (this.rolledBack) throw new PlatformError("INTERNAL_ERROR", "Already rolled back");

    // Verify epoch fencing before commit
    const token = issueFencingToken();
    verifyEpoch(token);
    if (!isWritable("primary")) {
      throw new PlatformError(
        "DATABASE_UNAVAILABLE",
        "Turso is not the current writable primary (epoch promotion may have occurred)",
        undefined,
        false,
        "turso",
      );
    }

    const client = await getClient();
    if (!client) {
      // Local dev mode — outbox is a no-op (events are just logged).
      // In production with Turso configured, events persist to outbox_events.
      if (this.events.length > 0) {
        console.log(`[turso-adapter] DEV: ${this.events.length} outbox event(s) would be persisted (no Turso HTTP client)`);
      }
      this.committed = true;
      return;
    }
    // Build a single batched pipeline: business statements + outbox inserts
    const stmts = [...this.statements];
    for (const e of this.events) {
      const eventId = "evt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const row = toOutboxRow(e, eventId);
      const cols = Object.keys(row).join(",");
      const placeholders = Object.keys(row).map(() => "?").join(","); // positional ? placeholders
      stmts.push({
        sql: `INSERT INTO outbox_events (${cols}) VALUES (${placeholders})`,
        args: Object.values(row),  // positional args array (TursoHttpClient wraps each)
      });
    }

    if (stmts.length > 0) {
      await withBreaker(TURSO_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          await client.batch(stmts);
        }),
      );
    }
    this.committed = true;
  }

  async rollback(): Promise<void> {
    this.rolledBack = true;
  }
}

export const tursoAdapter: DatabasePort = {
  name: "turso",
  role: "primary",

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    await ensureSchema();
    if (!isWritable("primary")) {
      throw new PlatformError(
        "DATABASE_UNAVAILABLE",
        "Turso is not the current writable primary",
        undefined,
        false,
        "turso",
      );
    }
    return withBreaker(TURSO_BREAKER, () =>
      withRetry(DEFAULT_RETRY, async () => {
        const client = await getClient();
        const result = await client.execute(sql, params);
        return (result?.rows || []) as T[];
      }),
    );
  },

  async transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    await ensureSchema();
    const tx = new TursoTransaction();
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  },

  async health() {
    const start = Date.now();
    try {
      await ensureSchema();
      const client = await getClient();
      await client.execute("SELECT 1");
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - start, detail: e?.message?.slice(0, 100) };
    }
  },
};

/** Drain pending outbox events (called by Inngest relay or cron). Returns events claimed. */
export async function drainOutbox(batchSize = 20): Promise<OutboxEvent[]> {
  await ensureSchema();
  const client = await getClient();
  if (!client) return []; // dev mode — no outbox table
  // Claim a batch of pending events atomically
  const claimResult = await client.execute(
    `UPDATE outbox_events
     SET status = 'processing', attempt_count = attempt_count + 1
     WHERE event_id IN (
       SELECT event_id FROM outbox_events
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT ${Number(batchSize)}
     )
     RETURNING *`,
  );
  const rows = claimResult?.rows || [];
  return rows.map((r: any) => ({
    eventId: r.event_id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    payload: JSON.parse(r.payload || "{}"),
    tenantId: r.tenant_id,
    idempotencyKey: r.idempotency_key,
    correlationId: r.correlation_id,
    causationId: r.causation_id,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    attemptCount: r.attempt_count,
    status: r.status,
    lastError: r.last_error,
  }));
}

/** Mark an outbox event as processed (after Inngest accepts it). */
export async function markOutboxProcessed(eventId: string): Promise<void> {
  const client = await getClient();
  if (!client) return;
  await client.execute(
    `UPDATE outbox_events SET status = 'processed', processed_at = ? WHERE event_id = ?`,
    [new Date().toISOString(), eventId],
  );
}

/** Mark an outbox event as failed (dead-letter after max attempts). */
export async function markOutboxFailed(eventId: string, error: string, deadLetter = false): Promise<void> {
  const client = await getClient();
  if (!client) return;
  await client.execute(
    `UPDATE outbox_events
     SET status = ?, last_error = ?, attempt_count = attempt_count + 1
     WHERE event_id = ?`,
    [deadLetter ? "dead_letter" : "failed", error.slice(0, 500), eventId],
  );
}
