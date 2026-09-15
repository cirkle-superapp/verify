/**
 * Inngest Workflow Adapter — uses the official Inngest SDK.
 *
 * Per architecture mandate:
 *   - Inngest = durable workflows, retries, scheduled jobs, event orchestration
 *   - NOT for ordinary synchronous CRUD
 *   - Every workflow must be idempotent (idempotencyKey enforced)
 *   - Every step must be safely replayable
 *
 * Uses the Inngest SDK client (registered at /api/inngest) to enqueue events.
 * The SDK handles: deduplication (by event.id), retries, step-level replay.
 *
 * Implements WorkflowPort. No Inngest-specific code leaks into business logic
 * beyond calling workflow.enqueue(...).
 */

import type { WorkflowPort } from "./ports";
import { PlatformError } from "./ports";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";
import { inngest } from "./inngest-functions";

const INNGEST_BREAKER = {
  name: "inngest",
  failureThreshold: 3,
  openDurationMs: 30_000,
  halfOpenProbes: 2,
};

export const inngestAdapter: WorkflowPort = {
  name: "inngest",

  async enqueue(event) {
    try {
      // The Inngest SDK client handles dedup automatically by event.id (idempotencyKey)
      // On conflict (same id), Inngest returns the existing event — no error.
      const result = await withBreaker(INNGEST_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          await inngest.send({
            name: event.name,
            data: event.data,
            // id = idempotency key — Inngest dedupes by this
            id: event.idempotencyKey,
            // If correlationId is a user id, attach it for Inngest user-scoped dedup
            user: event.correlationId ? { external_id: event.correlationId } : undefined,
            // ts ensures ordering
            ts: Date.now(),
          });
          return { status: "ok", eventId: event.idempotencyKey };
        }),
      );

      return {
        eventId: result?.eventId || event.idempotencyKey,
        queued: true,
      };
    } catch (e: any) {
      // Workflow enqueue failure should NOT block business transaction.
      // The outbox event remains in "pending" state and will be retried
      // by the drainOutbox cron/relay.
      if (e instanceof PlatformError) throw e;
      throw new PlatformError(
        "WORKFLOW_FAILURE",
        e?.message || "Inngest enqueue failed",
        e,
        true,
        "inngest",
      );
    }
  },

  async health() {
    const signingKey = process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_EVENT_KEY;
    if (!signingKey) return { ok: false, detail: "INNGEST_SIGNING_KEY not configured" };
    // The SDK client is initialized lazily — if it didn't throw, we're healthy.
    // For a deeper probe, we'd call the Inngest API, but that costs a request.
    // We consider "SDK initialized + key present" as healthy.
    return { ok: true };
  },
};
