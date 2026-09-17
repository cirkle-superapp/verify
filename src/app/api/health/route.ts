import { NextResponse } from "next/server";
import { tursoAdapter } from "@/lib/platform/turso-adapter";
import { neonRecoveryAdapter, getReplicationState } from "@/lib/platform/neon-recovery-adapter";
import { isConsensusModeActive, getConfiguredProviders } from "@/lib/vlm-service";
import { allBreakerSnapshots } from "@/lib/platform/circuit-breaker";
import { getEpoch } from "@/lib/platform/epoch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — comprehensive health check
 *
 * Checks ALL platform components:
 *   - Turso (authoritative database)
 *   - Neon (recovery database + replication state)
 *   - AI consensus (5 providers)
 *   - Circuit breakers (all should be CLOSED)
 *   - Database epoch (fencing)
 *
 * Returns 200 if Turso is healthy, 503 if degraded.
 */
export async function GET() {
  const start = Date.now();

  // Check Turso (authoritative)
  const tursoHealth = await tursoAdapter.health();

  // Check Neon (recovery)
  const neonHealth = await neonRecoveryAdapter.health();
  const replication = getReplicationState();

  // Check AI consensus
  const consensusActive = isConsensusModeActive();
  const providers = getConfiguredProviders();

  // Check circuit breakers
  const breakers = allBreakerSnapshots();
  const allClosed = breakers.every((b) => b.state === "CLOSED");

  // Check epoch
  const epoch = getEpoch();

  const latency = Date.now() - start;
  const dbOk = tursoHealth.ok;
  const status = dbOk ? "healthy" : "degraded";
  const httpStatus = dbOk ? 200 : 503;

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime ? `${Math.floor(process.uptime())}s` : "unknown",
      latency: `${latency}ms`,
      epoch: { epoch: epoch.epoch, primary: epoch.primary },
      checks: {
        database: {
          turso: {
            ok: tursoHealth.ok,
            latency: `${tursoHealth.latencyMs}ms`,
            role: "primary (authoritative)",
            detail: tursoHealth.detail,
          },
          neon: {
            ok: neonHealth.ok,
            latency: `${neonHealth.latencyMs}ms`,
            role: "recovery (projection)",
            replicationState: replication.recoveryState,
            replicationLagSeconds: replication.replicationLagSeconds,
            detail: neonHealth.detail,
          },
        },
        aiConsensus: {
          ok: consensusActive,
          active: consensusActive,
          providerCount: providers.length,
          providers: providers,
        },
        circuitBreakers: {
          ok: allClosed,
          count: breakers.length,
          allClosed,
          breakers: breakers.map((b) => ({ name: b.name, state: b.state })),
        },
        rateLimit: { ok: true, type: "in-memory" },
      },
      version: "2.2.0",
      invariant: "ZERO-COST-BY-DEFAULT · FAIL-CLOSED · NO R2 · NO RESEND",
    },
    { status: httpStatus }
  );
}
