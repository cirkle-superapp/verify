import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";

/**
 * CORS headers — audit chain endpoint is cross-origin accessible.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/audit-chain
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── In-memory audit chain ───────────────────────────────────────
//
// The audit chain is a sequence of events where each event's hash depends
// on the previous event's hash (SHA-256(prev_hash || event_payload)).
// This makes any tampering detectable: changing event N invalidates the
// hash of event N+1 and every subsequent event.
//
// In production, the chain is persisted in Turso (event_id, event_type,
// payload, prev_hash, event_hash, created_at). For this endpoint, an
// in-memory chain is used (resets per cold start).

interface ChainEvent {
  index: number;
  event_type: string;
  timestamp: string;
  payload: unknown;
  prev_hash: string;
  event_hash: string;
}

interface ChainHead {
  length: number;
  totalEvents: number;
  head: string; // hash of the last event (or "0".repeat(64) if empty)
  lastEvent: ChainEvent | null;
  createdAt: string;
}

const GENESIS_HASH = "0".repeat(64);

// Module-level audit chain state. Persists across requests within a single
// Vercel instance lifecycle (resets on cold start).
const auditChain: ChainEvent[] = [];
const chainCreatedAt = new Date().toISOString();

/**
 * Compute SHA-256(prev_hash || canonical_event_payload) — the chaining hash.
 */
function computeEventHash(prevHash: string, event: { event_type: string; timestamp: string; payload: unknown }): string {
  const canonical = JSON.stringify({
    event_type: event.event_type,
    timestamp: event.timestamp,
    payload: event.payload,
  });
  return createHash("sha256")
    .update(prevHash + canonical)
    .digest("hex");
}

/**
 * Verify the integrity of an arbitrary chain of events. Every event's
 * prev_hash MUST equal the previous event's event_hash.
 *
 * Returns { verified, length, head, broken_at? }.
 */
function verifyChain(events: Array<{ event_type: string; timestamp: string; payload: unknown; prev_hash: string; event_hash: string }>): {
  verified: boolean;
  length: number;
  head: string;
  broken_at?: number;
} {
  if (events.length === 0) {
    return { verified: true, length: 0, head: GENESIS_HASH };
  }
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.prev_hash !== prevHash) {
      return { verified: false, length: events.length, head: events[events.length - 1].event_hash, broken_at: i };
    }
    const recomputed = computeEventHash(prevHash, {
      event_type: ev.event_type,
      timestamp: ev.timestamp,
      payload: ev.payload,
    });
    if (recomputed !== ev.event_hash) {
      return { verified: false, length: events.length, head: events[events.length - 1].event_hash, broken_at: i };
    }
    prevHash = ev.event_hash;
  }
  return { verified: true, length: events.length, head: events[events.length - 1].event_hash };
}

/**
 * GET /api/v1/verify/audit-chain
 *
 * Returns the current audit chain head — last hash, total events, length.
 *
 * Response: {
 *   verified: boolean,        // true if the chain is internally consistent
 *   length: number,           // number of events in the chain
 *   totalEvents: number,      // alias for length
 *   head: string,             // SHA-256 hash of the last event (or genesis)
 *   lastEvent: ChainEvent | null,
 *   createdAt: string,        // when this in-memory chain was started
 * }
 */
export async function GET() {
  const verification = verifyChain(auditChain);
  const head: ChainHead = {
    length: auditChain.length,
    totalEvents: auditChain.length,
    head: verification.head,
    lastEvent: auditChain.length > 0 ? auditChain[auditChain.length - 1] : null,
    createdAt: chainCreatedAt,
  };
  return NextResponse.json(
    { verified: verification.verified, ...head },
    { headers: CORS_HEADERS },
  );
}

/**
 * POST /api/v1/verify/audit-chain
 *
 * Append events to the audit chain. Each event is hashed with SHA-256
 * and chained to the previous event (prev_hash || event_payload).
 *
 * Body: { events: [{ event_type: string, timestamp?: string, payload: unknown }] }
 *
 * After appending, the chain integrity is verified. If any prior event was
 * tampered with, `verified` becomes false and `broken_at` is set.
 *
 * Response: {
 *   verified: boolean,
 *   length: number,
 *   head: string,           // hash of the last event
 *   added: number,          // number of events added
 *   broken_at?: number,     // index of the first broken event (if any)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const events: Array<{ event_type: string; timestamp?: string; payload: unknown }> = body?.events;

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: "events array required", code: "INVALID_INPUT" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (events.length > 1000) {
      return NextResponse.json(
        { error: "Max 1000 events per request", code: "TOO_MANY_EVENTS" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    let prevHash = auditChain.length > 0 ? auditChain[auditChain.length - 1].event_hash : GENESIS_HASH;
    let startIndex = auditChain.length;
    let added = 0;

    for (const ev of events) {
      if (!ev || typeof ev.event_type !== "string") {
        continue; // skip malformed events
      }
      const timestamp = ev.timestamp || new Date().toISOString();
      const event_hash = computeEventHash(prevHash, {
        event_type: ev.event_type,
        timestamp,
        payload: ev.payload,
      });
      auditChain.push({
        index: startIndex + added,
        event_type: ev.event_type,
        timestamp,
        payload: ev.payload,
        prev_hash: prevHash,
        event_hash,
      });
      prevHash = event_hash;
      added++;
    }

    const verification = verifyChain(auditChain);

    return NextResponse.json(
      {
        verified: verification.verified,
        length: auditChain.length,
        head: verification.head,
        added,
        broken_at: verification.broken_at,
      },
      { status: 201, headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "audit chain append failed",
        code: "AUDIT_CHAIN_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * DELETE /api/v1/verify/audit-chain
 *
 * Reset the in-memory audit chain (dev/test only — production chain is
 * immutable). Returns the prior head for audit purposes.
 */
export async function DELETE() {
  const prevHead = auditChain.length > 0 ? auditChain[auditChain.length - 1].event_hash : GENESIS_HASH;
  const prevLength = auditChain.length;
  auditChain.length = 0;
  return NextResponse.json(
    {
      reset: true,
      prevHead,
      prevLength,
    },
    { headers: CORS_HEADERS },
  );
}
