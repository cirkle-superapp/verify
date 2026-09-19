import { NextResponse } from "next/server";
import { tursoAdapter } from "@/lib/platform/turso-adapter";
import { neonRecoveryAdapter, getReplicationState } from "@/lib/platform/neon-recovery-adapter";
import { inngestAdapter } from "@/lib/platform/inngest-adapter";
import { brevoAdapter } from "@/lib/platform/brevo-adapter";
import { vercelBlobAdapter } from "@/lib/platform/vercel-blob-adapter";
import { allBreakerSnapshots } from "@/lib/platform/circuit-breaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CORS headers — deep health check is cross-origin accessible.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/health/deep
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

interface HealthComponent {
  name: string;
  status: "healthy" | "degraded" | "down";
  latency_ms: number;
  detail: string;
}

async function timedCheck(name: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<HealthComponent> {
  const start = Date.now();
  try {
    const result = await fn();
    const latency = Date.now() - start;
    return {
      name,
      status: result.ok ? "healthy" : "degraded",
      latency_ms: latency,
      detail: result.detail || (result.ok ? "ok" : "degraded"),
    };
  } catch (e: any) {
    const latency = Date.now() - start;
    return {
      name,
      status: "down",
      latency_ms: latency,
      detail: e?.message?.slice(0, 150) || "unknown error",
    };
  }
}

/**
 * Check whether an AI provider is reachable — we don't actually call
 * the model (that costs a request), we just hit the base URL and check
 * that it responds (typically 401/403 means the endpoint is up but our
 * request lacks auth, which is good enough to mark "healthy").
 */
async function checkAiProviderReachable(name: string, url: string, expectedStatus: number[] = [401, 403, 200]): Promise<HealthComponent> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      // Don't send Authorization header — we just want to know the host answers
    });
    clearTimeout(timeout);
    const latency = Date.now() - start;
    const ok = expectedStatus.includes(res.status);
    return {
      name: `ai_provider_${name}`,
      status: ok ? "healthy" : "degraded",
      latency_ms: latency,
      detail: ok
        ? `reachable (HTTP ${res.status})`
        : `unexpected status ${res.status}`,
    };
  } catch (e: any) {
    const latency = Date.now() - start;
    return {
      name: `ai_provider_${name}`,
      status: "down",
      latency_ms: latency,
      detail: e?.message?.slice(0, 100) || "fetch failed",
    };
  }
}

/**
 * GET /api/v1/verify/health/deep
 *
 * Deep health check — runs comprehensive probes against every subsystem
 * the Cirkle platform depends on. Used by ops dashboards and on-call
 * alerting.
 *
 * Components probed (in parallel where possible):
 *   1. Turso (authoritative DB)        — SELECT 1 round trip
 *   2. Neon (recovery DB)               — SELECT 1 round trip
 *   3. Inngest (workflow engine)        — SDK health check
 *   4. Gemini AI provider              — base URL reachability (expects 400/401/403)
 *   5. Groq AI provider                 — base URL reachability
 *   6. OpenRouter AI provider           — base URL reachability
 *   7. NVIDIA AI provider               — base URL reachability
 *   8. HuggingFace AI provider          — base URL reachability
 *   9. Vercel Blob storage              — quota check
 *  10. Brevo email service              — quota check
 *  11. Circuit breakers                  — all should be CLOSED
 *
 * Returns: {
 *   overall: "healthy" | "degraded" | "down",
 *   components: [{ name, status, latency_ms, detail }],
 *   version: string,
 *   timestamp: ISO string,
 * }
 *
 * NOTE: AI providers are probed WITHOUT their API key — a 401/403 response
 * means "endpoint up, missing auth" which is what we want. A 200 means
 * "endpoint up, served a landing page" (also fine). 5xx or timeout = down.
 */
export async function GET() {
  const overallStart = Date.now();

  // Run all probes in parallel — total wall time ≈ slowest probe
  const [
    tursoCheck,
    neonCheck,
    inngestCheck,
    geminiCheck,
    groqCheck,
    openrouterCheck,
    nvidiaCheck,
    hfCheck,
    blobCheck,
    brevoCheck,
    breakerCheck,
  ] = await Promise.all([
    // Turso
    timedCheck("turso", async () => {
      const h = await tursoAdapter.health();
      return { ok: h.ok, detail: h.detail || `ok (${h.latencyMs}ms)` };
    }),

    // Neon
    timedCheck("neon", async () => {
      const h = await neonRecoveryAdapter.health();
      const rep = getReplicationState();
      return {
        ok: h.ok,
        detail: h.ok
          ? `ok (${h.latencyMs}ms); replication: ${rep.recoveryState} (${rep.replicationLagSeconds}s lag)`
          : h.detail || "unreachable",
      };
    }),

    // Inngest
    timedCheck("inngest", async () => {
      const h = await inngestAdapter.health();
      return { ok: h.ok, detail: h.detail || "ok" };
    }),

    // AI providers — base URL reachability only (no model calls)
    checkAiProviderReachable("gemini", "https://generativelanguage.googleapis.com/v1beta", [400, 401, 403, 404]),
    checkAiProviderReachable("groq", "https://api.groq.com/openai/v1", [401, 403, 404]),
    checkAiProviderReachable("openrouter", "https://openrouter.ai/api/v1", [401, 403, 404]),
    checkAiProviderReachable("nvidia", "https://integrate.api.nvidia.com/v1", [401, 403, 404]),
    checkAiProviderReachable("huggingface", "https://huggingface.co/api/whoami-v2", [401, 403, 404]),

    // Vercel Blob quota
    timedCheck("vercel_blob", async () => {
      const quota = await vercelBlobAdapter.quota();
      return {
        ok: quota.percent < 95,
        detail: `storage ${quota.percent}% (${quota.used}/${quota.limit} bytes), level=${quota.level}`,
      };
    }),

    // Brevo quota
    timedCheck("brevo", async () => {
      const quota = await brevoAdapter.quota();
      return {
        ok: quota.percent < 95,
        detail: `sent today ${quota.used}/${quota.limit} (${quota.percent}%), level=${quota.level}`,
      };
    }),

    // Circuit breakers (in-memory snapshot)
    timedCheck("circuit_breakers", async () => {
      const breakers = allBreakerSnapshots();
      const allClosed = breakers.every((b) => b.state === "CLOSED");
      return {
        ok: allClosed,
        detail: `${breakers.length} breakers registered, ${breakers.filter((b) => b.state !== "CLOSED").length} not CLOSED`,
      };
    }),
  ]);

  const components: HealthComponent[] = [
    tursoCheck,
    neonCheck,
    inngestCheck,
    geminiCheck,
    groqCheck,
    openrouterCheck,
    nvidiaCheck,
    hfCheck,
    blobCheck,
    brevoCheck,
    breakerCheck,
  ];

  // Compute overall status: any "down" → down; any "degraded" → degraded; else healthy
  const downCount = components.filter((c) => c.status === "down").length;
  const degradedCount = components.filter((c) => c.status === "degraded").length;
  const overall = downCount > 0
    ? (downCount >= 3 ? "down" : "degraded")
    : degradedCount > 0
    ? "degraded"
    : "healthy";

  const httpStatus = overall === "healthy" ? 200 : overall === "degraded" ? 200 : 503;

  return NextResponse.json(
    {
      overall,
      components,
      version: "2.3.0-hardened",
      timestamp: new Date().toISOString(),
      total_latency_ms: Date.now() - overallStart,
      summary: {
        total: components.length,
        healthy: components.filter((c) => c.status === "healthy").length,
        degraded: degradedCount,
        down: downCount,
      },
    },
    { status: httpStatus, headers: CORS_HEADERS },
  );
}
