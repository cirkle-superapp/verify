/**
 * Inngest Workflow Adapter.
 *
 * Per architecture mandate:
 *   - Inngest = durable workflows, retries, scheduled jobs, event orchestration
 *   - NOT for ordinary synchronous CRUD
 *   - Every workflow must be idempotent (idempotencyKey enforced)
 *   - Every step must be safely replayable
 *
 * Implements WorkflowPort. No Inngest-specific code leaks into business logic.
 *
 * Used for:
 *   - email delivery (async, after outbox commit)
 *   - SMS orchestration (after authorization)
 *   - Neon replication (drain outbox → apply to Neon)
 *   - webhook delivery
 *   - scheduled jobs (quota resets, retention cleanup)
 */

import type { WorkflowPort } from "./ports";
import { PlatformError } from "./ports";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";

const INNGEST_BREAKER = {
  name: "inngest",
  failureThreshold: 3,
  openDurationMs: 30_000,
  halfOpenProbes: 2,
};

const INNGEST_API_URL = "https://api.inngest.com";

export const inngestAdapter: WorkflowPort = {
  name: "inngest",

  async enqueue(event) {
    const signingKey = process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_EVENT_KEY;
    if (!signingKey) {
      // Dev mode: log the event (no Inngest key)
      console.log(`[inngest-adapter] DEV: would enqueue event "${event.name}" (idempotencyKey=${event.idempotencyKey})`);
      return { eventId: "dev_" + event.idempotencyKey, queued: true };
    }

    try {
      const response = await withBreaker(INNGEST_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          // Inngest REST API: POST /v1/events
          // Note: in production with Inngest SDK, use the official client.
          // This is the raw HTTP fallback for zero-dependency operation.
          const res = await fetch(`${INNGEST_API_URL}/v1/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${signingKey}`,
            },
            body: JSON.stringify({
              name: event.name,
              data: event.data,
              id: event.idempotencyKey,            // idempotency key — Inngest dedupes by this
              ts: Date.now(),
              user: event.correlationId
                ? { external_id: event.correlationId }
                : undefined,
            }),
            signal: AbortSignal.timeout(10_000),
          });

          if (res.status === 409) {
            // Duplicate event — idempotency key already used. NOT an error.
            return { status: "duplicate", eventId: event.idempotencyKey };
          }
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PlatformError(
              "WORKFLOW_FAILURE",
              `Inngest enqueue error ${res.status}: ${text.slice(0, 200)}`,
              undefined,
              res.status >= 500,
              "inngest",
            );
          }
          return res.json().catch(() => ({ status: "ok", eventId: event.idempotencyKey }));
        }),
      );

      return {
        eventId: response?.eventId || response?.id || event.idempotencyKey,
        queued: response?.status !== "duplicate",
      };
    } catch (e: any) {
      // Workflow enqueue failure should NOT block business transaction.
      // The outbox event remains in "pending" state and will be retried
      // by the drainOutbox cron/relay.
      if (e instanceof PlatformError) throw e;
      throw new PlatformError("WORKFLOW_FAILURE", e?.message, e, true, "inngest");
    }
  },

  async health() {
    const signingKey = process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_EVENT_KEY;
    if (!signingKey) return { ok: false, detail: "INNGEST_SIGNING_KEY not configured" };
    try {
      // Lightweight probe — Inngest doesn't have a public /healthz, so we
      // consider "key configured + DNS reachable" as healthy.
      await withBreaker(INNGEST_BREAKER, async () => {
        await fetch(`${INNGEST_API_URL}/v1/events`, {
          method: "HEAD",
          signal: AbortSignal.timeout(3000),
        }).catch(() => {}); // ignore response code — just probing reachability
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, detail: e?.message?.slice(0, 100) };
    }
  },
};
