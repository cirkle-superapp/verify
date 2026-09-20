/**
 * Cirkle Real-Time Monitoring Service
 *
 * Bun WebSocket server on port 3033 that polls the Cirkle platform
 * endpoints every 5 seconds and broadcasts to all connected clients:
 *
 *   - harmony    (score 0..100, verdict, latencyMs)
 *   - health     (per-component status: turso, neon, inngest, ai, …)
 *   - metrics    (Prometheus counters + gauges parsed from /metrics)
 *   - alerts     (when a component transitions from healthy → degraded)
 *
 * Uses Bun.serve() with native WebSocket upgrade. Path is "/" so Caddy
 * can forward `?XTransformPort=3033` from the Next.js gateway.
 *
 * Broadcast frame format:
 *   { type: "harmony"|"health"|"metrics"|"alert", timestamp: ISO, data: {...} }
 *
 * Connections auto-receive the latest snapshot on connect (so the UI
 * doesn't have to wait 5 seconds for the first paint).
 */

const PORT = 3033;
const PLATFORM_BASE = process.env.CIRKLE_BASE_URL || "http://localhost:3000";
const POLL_INTERVAL_MS = 5_000;

// ─── Types ────────────────────────────────────────────────────────────────────

type BroadcastType = "harmony" | "health" | "metrics" | "alert";

interface HarmonySnapshot {
  score: number;
  verdict: string;
  latencyMs: number;
}

interface ComponentStatus {
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs?: number;
  detail?: string;
}

interface HealthSnapshot {
  overall: "healthy" | "degraded" | "down" | "unknown";
  components: ComponentStatus[];
}

interface MetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  raw: string;
}

interface AlertPayload {
  component: string;
  from: "healthy" | "degraded" | "down" | "unknown";
  to: "healthy" | "degraded" | "down" | "unknown";
  detail?: string;
}

interface BroadcastFrame {
  type: BroadcastType;
  timestamp: string;
  data: unknown;
}

// ─── Mutable state (latest snapshots + previous status for alert diffing) ─────

let latestHarmony: HarmonySnapshot | null = null;
let latestHealth: HealthSnapshot | null = null;
let latestMetrics: MetricsSnapshot | null = null;
let lastComponentStatuses = new Map<string, ComponentStatus["status"]>();
const alertLog: Array<{ timestamp: string; alert: AlertPayload }> = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJson(url: string, timeoutMs = 4000): Promise<any | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

/**
 * Parse a Prometheus exposition into counters + gauges.
 * Lines look like: `metric_name{label="x"} value`
 */
function parsePrometheus(text: string): MetricsSnapshot {
  const counters: Record<string, number> = {};
  const gauges: Record<string, number> = {};
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([0-9.eE+-]+)$/);
    if (!match) continue;
    const metric = match[1];
    const labels = match[2] || "";
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    // Heuristic: "_total" suffix or "count" in the name → counter, otherwise gauge
    const key = labels ? `${metric}${labels}` : metric;
    if (key in counters || key in gauges) {
      // duplicate — skip
      continue;
    }
    seen.add(key);
    if (metric.endsWith("_total") || /count/i.test(metric)) {
      counters[key] = value;
    } else {
      gauges[key] = value;
    }
  }
  return { counters, gauges, raw: text.slice(0, 8192) };
}

/**
 * Diff the latest component statuses against the previous snapshot.
 * Whenever a component transitions FROM healthy → degraded/down, we
 * emit an alert. Recovery (degraded → healthy) is also reported so the
 * dashboard can clear its alert feed.
 */
function diffAlerts(snapshot: HealthSnapshot | null): AlertPayload[] {
  if (!snapshot) return [];
  const alerts: AlertPayload[] = [];
  const next = new Map<string, ComponentStatus["status"]>();
  for (const c of snapshot.components) {
    next.set(c.name, c.status);
    const prev = lastComponentStatuses.get(c.name);
    if (prev === undefined) {
      // First observation — don't alert, just record baseline.
      continue;
    }
    if (prev !== c.status) {
      alerts.push({
        component: c.name,
        from: prev,
        to: c.status,
        detail: c.detail,
      });
    }
  }
  lastComponentStatuses = next;
  return alerts;
}

// ─── Pollers ─────────────────────────────────────────────────────────────────

async function pollHarmony() {
  const t0 = Date.now();
  const body = await fetchJson(`${PLATFORM_BASE}/api/platform/harmony`);
  const latencyMs = Date.now() - t0;
  if (!body) {
    latestHarmony = latestHarmony || { score: 0, verdict: "unknown", latencyMs };
    return null;
  }
  // Cirkle's harmony route returns { harmony: { score, verdict, ... }, latency, ... }
  const harmony = body.harmony || {};
  const snapshot: HarmonySnapshot = {
    score: typeof harmony.score === "number" ? harmony.score : 0,
    verdict: typeof harmony.verdict === "string" ? harmony.verdict : "unknown",
    latencyMs: typeof body.latency === "number" ? body.latency : latencyMs,
  };
  latestHarmony = snapshot;
  const frame: BroadcastFrame = {
    type: "harmony",
    timestamp: new Date().toISOString(),
    data: snapshot,
  };
  return frame;
}

async function pollHealth(): Promise<BroadcastFrame[]> {
  const body = await fetchJson(`${PLATFORM_BASE}/api/v1/verify/health/deep`);
  let snapshot: HealthSnapshot;
  if (!body || !Array.isArray(body.components)) {
    snapshot = {
      overall: "unknown",
      components: [
        { name: "turso", status: "unknown" },
        { name: "neon", status: "unknown" },
        { name: "inngest", status: "unknown" },
        { name: "ai", status: "unknown" },
      ],
    };
  } else {
    snapshot = {
      overall: body.overall || "unknown",
      components: body.components.map((c: any) => ({
        name: c.name || c.component || "unknown",
        status: (c.status || "unknown").toLowerCase(),
        latencyMs: c.latencyMs ?? c.latency_ms,
        detail: c.detail,
      })),
    };
  }
  latestHealth = snapshot;
  const frames: BroadcastFrame[] = [];
  frames.push({
    type: "health",
    timestamp: new Date().toISOString(),
    data: snapshot,
  });

  // Diff + emit alerts
  const alerts = diffAlerts(snapshot);
  for (const a of alerts) {
    const timestamp = new Date().toISOString();
    const frame: BroadcastFrame = { type: "alert", timestamp, data: a };
    frames.push(frame);
    alertLog.push({ timestamp, alert: a });
    if (alertLog.length > 100) alertLog.shift();
  }
  return frames;
}

async function pollMetrics(): Promise<BroadcastFrame | null> {
  const text = await fetchText(`${PLATFORM_BASE}/api/v1/verify/metrics`);
  if (text === null) return null;
  const snapshot = parsePrometheus(text);
  latestMetrics = snapshot;
  return {
    type: "metrics",
    timestamp: new Date().toISOString(),
    data: {
      counters: snapshot.counters,
      gauges: snapshot.gauges,
    },
  };
}

async function pollOnce() {
  try {
    const frames: BroadcastFrame[] = [];
    const [harm, healthFrames, metrics] = await Promise.all([
      pollHarmony(),
      pollHealth(),
      pollMetrics(),
    ]);
    if (harm) frames.push(harm);
    frames.push(...healthFrames);
    if (metrics) frames.push(metrics);

    // Broadcast every frame to every connected client
    for (const f of frames) {
      const payload = JSON.stringify(f);
      for (const ws of clients.values()) {
        try {
          if (ws.readyState === 1) {
            // 1 = OPEN
            ws.send(payload);
          }
        } catch {
          // individual send failure shouldn't kill the broadcast
        }
      }
    }
  } catch (e: any) {
    // Any error during the poll cycle is logged but doesn't crash the service.
    console.error("[MON] poll cycle error:", e?.message || String(e));
  }
}

// ─── Bun.serve with WebSocket ─────────────────────────────────────────────────

const clients = new Set<any>();

const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    // Upgrade any GET on "/" to a WebSocket connection
    const url = new URL(req.url);
    if (url.pathname === "/" && server.upgrade(req)) {
      return; // upgrade succeeded, response handled by Bun
    }
    // Simple health-check for HTTP clients (curl)
    if (url.pathname === "/health") {
      return Response.json(
        {
          status: "ok",
          port: PORT,
          connectedClients: clients.size,
          lastHarmony: latestHarmony,
          lastHealth: latestHealth,
          lastMetrics: latestMetrics
            ? { counters: Object.keys(latestMetrics.counters).length, gauges: Object.keys(latestMetrics.gauges).length }
            : null,
          alerts: alertLog.slice(-5),
        },
        {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
          },
        },
      );
    }
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }
    return new Response("Not found — connect via WebSocket on /", { status: 404 });
  },
  websocket: {
    open(ws: any) {
      clients.add(ws);
      console.log(`[MON] client connected (${clients.size} total)`);
      // Immediately push the latest snapshots so the UI paints without
      // waiting for the next poll cycle.
      const now = new Date().toISOString();
      if (latestHarmony) {
        ws.send(JSON.stringify({ type: "harmony", timestamp: now, data: latestHarmony }));
      }
      if (latestHealth) {
        ws.send(JSON.stringify({ type: "health", timestamp: now, data: latestHealth }));
      }
      if (latestMetrics) {
        ws.send(
          JSON.stringify({
            type: "metrics",
            timestamp: now,
            data: { counters: latestMetrics.counters, gauges: latestMetrics.gauges },
          }),
        );
      }
      // Send the last 5 alerts so the dashboard has history
      for (const a of alertLog.slice(-5)) {
        ws.send(JSON.stringify({ type: "alert", timestamp: a.timestamp, data: a.alert }));
      }
    },
    message() {
      // Ignore inbound messages — this service is broadcast-only.
    },
    close(ws: any) {
      clients.delete(ws);
      console.log(`[MON] client disconnected (${clients.size} total)`);
    },
  },
});

// ─── Start polling ────────────────────────────────────────────────────────────

console.log(`[MON] Cirkle monitoring service on http://localhost:${PORT}`);
console.log(`[MON] Polling ${PLATFORM_BASE} every ${POLL_INTERVAL_MS}ms`);

// ─── Process-level guards ─────────────────────────────────────────────────────
//
// Bun crashes by default on unhandled promise rejections. Wrap the entire
// poll cycle in try/catch (above) so an error from a single fetch doesn't
// take the service down. The handlers below log the diagnostic info if a
// stray rejection or uncaught exception ever slips through.

process.on("unhandledRejection", (reason) => {
  console.error("[MON] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[MON] uncaughtException:", err?.message || String(err));
});
process.on("exit", (code) => {
  console.log(`[MON] process exit (code=${code})`);
});

// Kick off the first poll immediately, then on an interval
pollOnce().catch((e) => console.error("[MON] poll error:", e?.message || e));
const pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);

// Graceful shutdown
const shutdown = (sig: string) => () => {
  console.log(`[MON] ${sig} received, shutting down…`);
  clearInterval(pollTimer);
  for (const ws of clients.values()) {
    try {
      ws.close(1001, "server shutting down");
    } catch {}
  }
  server.stop(true);
  process.exit(0);
};
process.on("SIGTERM", shutdown("SIGTERM"));
process.on("SIGINT", shutdown("SIGINT"));

export {};
