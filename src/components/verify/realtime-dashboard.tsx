"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, AlertTriangle, Radio, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

/**
 * RealtimeDashboard — live monitoring of the Cirkle platform.
 *
 * Connects to the Cirkle monitoring mini-service (Bun WebSocket on
 * port 3033, forwarded by Caddy via ?XTransformPort=3033) and renders:
 *
 *   - Connection status pill (connected / connecting / disconnected)
 *   - Harmony score (animated number that smoothly tweens to the latest
 *     value via framer-motion's `animate` prop)
 *   - Component status grid (Turso / Neon / Inngest / AI / …) — each
 *     cell shows a green / yellow / red dot depending on its status
 *   - Latency sparkline — last 20 harmony latency samples, drawn as a
 *     tiny inline SVG so we don't need a charting lib on the client
 *   - Alert feed — most recent 5 alerts (status transitions), with the
 *     newest one fading in with a subtle scale animation
 *
 * The connection auto-reconnects on close with exponential backoff
 * (1s → 2s → 4s → 8s → 16s, capped at 16s).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "polling";

interface HarmonyData {
  score: number;
  verdict: string;
  latencyMs: number;
}

interface ComponentInfo {
  name: string;
  status: "healthy" | "degraded" | "down" | "unknown";
  latencyMs?: number;
  detail?: string;
}

interface HealthData {
  overall: "healthy" | "degraded" | "down" | "unknown";
  components: ComponentInfo[];
}

interface MetricsData {
  counters: Record<string, number>;
  gauges: Record<string, number>;
}

interface AlertData {
  component: string;
  from: "healthy" | "degraded" | "down" | "unknown";
  to: "healthy" | "degraded" | "down" | "unknown";
  detail?: string;
}

interface BroadcastFrame {
  type: "harmony" | "health" | "metrics" | "alert";
  timestamp: string;
  data: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(s: ComponentInfo["status"]): string {
  switch (s) {
    case "healthy":
      return "#22c55e"; // green-500
    case "degraded":
      return "#eab308"; // yellow-500
    case "down":
      return "#ef4444"; // red-500
    default:
      return "#6b7280"; // gray-500
  }
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const ref = useRef<number | null>(null);
  useEffect(() => {
    if (ref.current) cancelAnimationFrame(ref.current);
    const from = display;
    const to = value;
    const duration = 600;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(from + (to - from) * eased);
      if (t < 1) ref.current = requestAnimationFrame(step);
    };
    ref.current = requestAnimationFrame(step);
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current);
    };
  }, [value]);
  return <>{Math.round(display)}</>;
}

/**
 * Tiny inline-SVG sparkline — last N samples. Width/height fixed at
 * 240×48 (scales down on mobile via CSS max-w-full).
 */
function Sparkline({ samples, max }: { samples: number[]; max: number }) {
  const w = 240;
  const h = 48;
  if (samples.length < 2) {
    return (
      <div className="text-xs text-muted-foreground font-mono h-12 flex items-center">
        collecting…
      </div>
    );
  }
  const safeMax = max > 0 ? max : 1;
  const stepX = w / (samples.length - 1);
  const points = samples
    .map((s, i) => `${(i * stepX).toFixed(1)},${(h - (s / safeMax) * h).toFixed(1)}`)
    .join(" ");
  const last = samples[samples.length - 1];
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block"
      aria-label={`Latency sparkline, last sample ${Math.round(last)}ms`}
      role="img"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#22c55e"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={(samples.length - 1) * stepX}
        cy={h - (last / safeMax) * h}
        r={2.5}
        fill="#22c55e"
      />
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RealtimeDashboard({ onBack }: { onBack?: () => void }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [harmony, setHarmony] = useState<HarmonyData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [alerts, setAlerts] = useState<Array<{ timestamp: string; data: AlertData }>>([]);
  const [latencySamples, setLatencySamples] = useState<number[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleFrame = useCallback((frame: BroadcastFrame) => {
    switch (frame.type) {
      case "harmony":
        setHarmony(frame.data as HarmonyData);
        setLatencySamples((prev) => {
          const next = [...prev, (frame.data as HarmonyData).latencyMs];
          if (next.length > 20) next.shift();
          return next;
        });
        break;
      case "health":
        setHealth(frame.data as HealthData);
        break;
      case "metrics":
        setMetrics(frame.data as MetricsData);
        break;
      case "alert": {
        const a = frame.data as AlertData;
        setAlerts((prev) => [{ timestamp: frame.timestamp, data: a }, ...prev].slice(0, 5));
        break;
      }
    }
  }, []);

  // Refs break the circular dependency between `connect` and `scheduleReconnect`.
  // The actual function bodies are assigned in the effects below.
  const connectRef = useRef<() => void>(() => {});
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    connectRef.current();
  }, []);

  // Assign the real implementations to the refs (kept fresh on every render so
  // they always close over the latest state).
  useEffect(() => {
    scheduleReconnectRef.current = () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      const attempt = reconnectAttempt.current++;
      const delay = Math.min(1000 * 2 ** attempt, 16000); // 1s → 2s → 4s … → 16s
      reconnectTimer.current = setTimeout(() => connectRef.current(), delay);
    };
    connectRef.current = () => {
      setStatus("connecting");
      // Pick the URL — in dev (localhost:3000), Caddy runs on port 81.
      // In prod (vercel.app), Caddy isn't available so we fall back to REST polling.
      const isDev = typeof window !== "undefined" && window.location.hostname === "localhost";
      const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
      const host = typeof window !== "undefined" ? window.location.host : "localhost:3000";

      // In dev, connect to Caddy on port 81 which forwards to the monitoring service.
      // In prod, try same-origin (works only if Caddy is in front of Vercel — otherwise falls back to polling).
      const wsHost = isDev ? "localhost:81" : host;
      const url = `${proto}://${wsHost}/?XTransformPort=3033`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        // Failed construction — fall back to REST polling
        startPollingFallback();
        return;
      }
      wsRef.current = ws;

      // If WebSocket fails to connect within 3s, fall back to REST polling.
      const fallbackTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          try { ws.close(); } catch { /* ignore */ }
          startPollingFallback();
        }
      }, 3000);

      ws.onopen = () => {
        clearTimeout(fallbackTimer);
        reconnectAttempt.current = 0;
        setStatus("connected");
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data as string) as BroadcastFrame;
          handleFrame(frame);
        } catch {
          // Ignore malformed frames
        }
      };
      ws.onclose = () => {
        clearTimeout(fallbackTimer);
        setStatus("disconnected");
        // Don't immediately retry WebSocket — switch to polling fallback
        startPollingFallback();
      };
      ws.onerror = () => {
        // close handler will fire next; no-op here
      };
    };

    // REST API polling fallback — used when WebSocket is not available
    // (e.g., on Vercel production where there's no Caddy to forward the WS).
    const startPollingFallback = () => {
      if (pollingIntervalRef.current) return; // already polling
      setStatus("polling");
      const poll = async () => {
        try {
          const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
          const [healthRes, harmonyRes, deepRes] = await Promise.all([
            fetch(`${base}/api/health`).then(r => r.json()).catch(() => null),
            fetch(`${base}/api/platform/harmony`).then(r => r.json()).catch(() => null),
            fetch(`${base}/api/v1/verify/health/deep`).then(r => r.json()).catch(() => null),
          ]);
          if (harmonyRes) {
            handleFrame({ type: "harmony", timestamp: new Date().toISOString(), data: harmonyRes.harmony });
          }
          // Merge deep health (has components) with basic health (has checks.database)
          if (deepRes && deepRes.components) {
            handleFrame({
              type: "health",
              timestamp: new Date().toISOString(),
              data: {
                overall: deepRes.overall || healthRes?.status || "unknown",
                components: deepRes.components,
                platforms: harmonyRes?.platforms,
                checks: healthRes?.checks,
              },
            });
          } else if (healthRes) {
            handleFrame({ type: "health", timestamp: new Date().toISOString(), data: healthRes });
          }
        } catch {
          // Ignore polling errors — will retry next interval
        }
      };
      poll(); // immediate first poll
      pollingIntervalRef.current = setInterval(poll, 5000);
    };
  });

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const maxLatency = Math.max(...latencySamples, 1);
  const overallColor = statusColor(health?.overall ?? "unknown");
  const counterCount = metrics ? Object.keys(metrics.counters).length : 0;
  const gaugeCount = metrics ? Object.keys(metrics.gauges).length : 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="relative flex h-2.5 w-2.5"
            aria-hidden
          >
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${status === "connected" ? "animate-ping bg-emerald-500" : status === "connecting" ? "bg-yellow-500" : status === "polling" ? "bg-blue-500" : "bg-red-500"}`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-yellow-500" : status === "polling" ? "bg-blue-500" : "bg-red-500"}`}
            />
          </div>
          <h2 className="text-lg sm:text-xl font-semibold">Live Dashboard</h2>
          <Badge variant="outline" className="text-xs font-normal">
            {status === "polling" ? "REST polling" : status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {(status === "disconnected" || status === "polling") && (
            <Button size="sm" variant="outline" onClick={connect}>
              Reconnect
            </Button>
          )}
          {onBack && (
            <Button size="sm" variant="ghost" onClick={onBack}>
              Back
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Harmony score */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-4 w-4" /> Harmony Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-bold tabular-nums">
                {harmony ? <AnimatedNumber value={harmony.score} /> : "—"}
              </span>
              <span className="text-sm text-muted-foreground">/ 100</span>
            </div>
            <p className="text-xs mt-1">
              <span className="font-medium">Verdict:</span>{" "}
              <span style={{ color: overallColor }}>
                {harmony?.verdict ?? "—"}
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Latency sparkline */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Zap className="h-4 w-4" /> Latency (ms)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkline samples={latencySamples} max={maxLatency} />
            <div className="flex items-center justify-between text-xs text-muted-foreground mt-1 font-mono">
              <span>last: {latencySamples.length > 0 ? Math.round(latencySamples[latencySamples.length - 1]) : "—"}ms</span>
              <span>peak: {Math.round(maxLatency)}ms</span>
            </div>
          </CardContent>
        </Card>

        {/* Metrics counters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Radio className="h-4 w-4" /> Prometheus Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-2xl font-bold tabular-nums">{counterCount}</div>
                <div className="text-xs text-muted-foreground">counters</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums">{gaugeCount}</div>
                <div className="text-xs text-muted-foreground">gauges</div>
              </div>
            </div>
            {metrics && (
              <ScrollArea className="max-h-24 mt-2 text-xs font-mono">
                <dl className="space-y-0.5">
                  {Object.entries(metrics.gauges).slice(0, 6).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="truncate text-muted-foreground">{k}</dt>
                      <dd className="tabular-nums">{typeof v === "number" ? v.toFixed(2) : v}</dd>
                    </div>
                  ))}
                </dl>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Component status grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Platform Components</CardTitle>
        </CardHeader>
        <CardContent>
          {!health || !health.components ? (
            <p className="text-sm text-muted-foreground">waiting for first health snapshot…</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {health.components.map((c) => (
                <div
                  key={c.name}
                  className="rounded-lg border p-3 flex items-center gap-2"
                  style={{ borderColor: statusColor(c.status) + "55" }}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ background: statusColor(c.status) }}
                    aria-label={c.status}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground capitalize">{c.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Alert feed */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <AlertTriangle className="h-4 w-4" /> Alert Feed
            <span className="ml-auto text-xs text-muted-foreground">{alerts.length} recent</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alerts — all components stable.</p>
          ) : (
            <ScrollArea className="max-h-72">
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {alerts.map((a, i) => (
                    <motion.li
                      key={`${a.timestamp}-${i}`}
                      initial={{ opacity: 0, x: -12, scale: 0.97 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: 12 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-start gap-2 text-sm border-b pb-2 last:border-b-0"
                    >
                      <span
                        className="mt-1 inline-block h-2 w-2 rounded-full shrink-0"
                        style={{ background: statusColor(a.data.to) }}
                        aria-label={a.data.to}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">{a.data.component}</span>{" "}
                        <span className="text-muted-foreground">
                          {a.data.from} →{" "}
                          <span style={{ color: statusColor(a.data.to) }} className="font-medium">
                            {a.data.to}
                          </span>
                        </span>
                        {a.data.detail && (
                          <span className="block text-xs text-muted-foreground truncate">
                            {a.data.detail}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {new Date(a.timestamp).toLocaleTimeString()}
                      </span>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
