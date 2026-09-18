import { NextResponse } from "next/server";
import { renderPrometheus, incCounter, setGauge } from "@/lib/metrics";
import { allBreakerSnapshots } from "@/lib/platform/circuit-breaker";
import { getReplicationState } from "@/lib/platform/neon-recovery-adapter";
import { getAllSessions } from "@/lib/session-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CORS headers — Prometheus metrics are cross-origin accessible.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
};

const CORS_HEADERS_JSON = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/metrics
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS_JSON });
}

/**
 * Map circuit-breaker state name to a numeric gauge value:
 *   CLOSED     → 0 (healthy)
 *   HALF_OPEN  → 1 (probe)
 *   OPEN       → 2 (tripped)
 */
function breakerStateValue(state: string): number {
  switch (state) {
    case "CLOSED": return 0;
    case "HALF_OPEN": return 1;
    case "OPEN": return 2;
    default: return -1;
  }
}

/**
 * GET /api/v1/verify/metrics
 *
 * Prometheus-format metrics endpoint. Returns text/plain exposition
 * suitable for scraping by `prometheus` or `grafana-agent`.
 *
 * Metrics exposed:
 *   cirkle_verifications_total{status}              counter — total verifications
 *   cirkle_verification_duration_seconds            histogram — pipeline latency
 *   cirkle_ai_provider_errors_total{provider}       counter — per-provider errors
 *   cirkle_turso_queries_total                      counter — Turso queries issued
 *   cirkle_turso_query_duration_seconds             histogram — Turso latency
 *   cirkle_neon_replication_lag_seconds             gauge — Neon replication lag
 *   cirkle_circuit_breaker_state{name,state}        gauge — breaker state
 *   cirkle_active_sessions                          gauge — live session count
 *
 * All counters live in module-level Maps (see src/lib/metrics.ts).
 * The values reset on cold start (Vercel serverless instance lifecycle).
 */
export async function GET() {
  try {
    // Refresh gauges from the live in-memory platform state
    // (counters/histograms are incremented by their respective code paths
    // and read directly from the registry in renderPrometheus())

    // Neon replication lag (gauge — re-derived from in-memory platform state)
    const replication = getReplicationState();
    setGauge("cirkle_neon_replication_lag_seconds", replication.replicationLagSeconds);

    // Circuit breaker states — emit one gauge per breaker with the
    // {name, state} label set, plus a numeric state gauge
    for (const breaker of allBreakerSnapshots()) {
      setGauge("cirkle_circuit_breaker_state", breakerStateValue(breaker.state), {
        name: breaker.name,
        state: breaker.state,
      });
    }

    // Active verification sessions (gauge — re-derived from in-memory store)
    try {
      const sessions = getAllSessions();
      setGauge("cirkle_active_sessions", sessions.length);
    } catch {
      // session-manager may be unavailable in some runtimes — emit 0
      setGauge("cirkle_active_sessions", 0);
    }

    // Touch the verification counter so it appears in the output even if
    // nothing has been counted yet (this is a no-op when the value is 0)
    incCounter("cirkle_verifications_total", { status: "verified" }, 0);
    incCounter("cirkle_verifications_total", { status: "rejected" }, 0);
    incCounter("cirkle_ai_provider_errors_total", { provider: "gemini" }, 0);
    incCounter("cirkle_turso_queries_total", {}, 0);

    const text = renderPrometheus();
    return new NextResponse(text, { status: 200, headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "metrics scrape failed", code: "METRICS_FAILURE" },
      { status: 500, headers: CORS_HEADERS_JSON },
    );
  }
}
