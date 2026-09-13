import { NextRequest, NextResponse } from "next/server";
import { drainOutbox, markOutboxProcessed, markOutboxFailed, applyEvents, workflow as inngestAdapter } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/platform/outbox/drain
 *
 * Drains pending outbox events from Turso (authoritative) and relays them to:
 *   1. Inngest (for durable async workflows — email, SMS, webhooks)
 *   2. Neon (for recovery projection — idempotent event_log inserts)
 *
 * This endpoint is normally triggered by Inngest cron OR a lightweight
 * Cloudflare Worker on a schedule. It is NOT user-facing.
 *
 * Atomicity: each event is claimed (status=pending→processing) before relay,
 * then marked processed/failed. Failures are bounded by attempt_count → dead_letter.
 */

const MAX_ATTEMPTS = 5;
const DEAD_LETTER_THRESHOLD = MAX_ATTEMPTS;

export async function POST(req: NextRequest) {
  // Lightweight auth: Inngest cron calls with shared signing key
  const authHeader = req.headers.get("authorization") || "";
  const expected = process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_EVENT_KEY || "";
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(50, Math.max(1, Number(body.batchSize) || 20));

    const events = await drainOutbox(batchSize);
    if (events.length === 0) {
      return NextResponse.json({ drained: 0, applied: 0, failed: 0, skipped: 0 });
    }

    // Parallel relay: Inngest (for async workflows) + Neon (for recovery projection)
    const [inngestResults, neonResult] = await Promise.allSettled([
      Promise.all(
        events.map(async (e) => {
          try {
            const r = await inngestAdapter.enqueue({
              name: `${e.aggregateType}.${e.eventType}`,
              data: { ...e.payload, _eventId: e.eventId, _aggregateId: e.aggregateId },
              idempotencyKey: e.idempotencyKey,
              correlationId: e.correlationId || undefined,
              causationId: e.causationId || undefined,
            });
            await markOutboxProcessed(e.eventId);
            return { eventId: e.eventId, ok: true, queued: r.queued };
          } catch (err: any) {
            if (e.attemptCount >= DEAD_LETTER_THRESHOLD) {
              await markOutboxFailed(e.eventId, err?.message || "max attempts exceeded", true);
            } else {
              await markOutboxFailed(e.eventId, err?.message || "enqueue failed", false);
            }
            return { eventId: e.eventId, ok: false, error: err?.message?.slice(0, 100) };
          }
        }),
      ),
      // Neon recovery projection — idempotent, best-effort
      applyEvents(events).catch((err) => {
        console.error("[outbox/drain] Neon projection failed:", err?.message?.slice(0, 100));
        return { applied: 0, skipped: 0, failed: events.length };
      }),
    ]);

    const inngestOk = inngestResults.status === "fulfilled" ? inngestResults.value : [];
    const neonStats = neonResult.status === "fulfilled" ? neonResult.value : { applied: 0, skipped: 0, failed: 0 };

    return NextResponse.json({
      drained: events.length,
      inngest: {
        sent: inngestOk.filter((r) => r.ok).length,
        failed: inngestOk.filter((r) => !r.ok).length,
      },
      neon: neonStats,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "drain failed" }, { status: 500 });
  }
}
