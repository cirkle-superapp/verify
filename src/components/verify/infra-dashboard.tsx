"use client";

import { useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  Gauge,
  RefreshCw,
  Database,
  HardDrive,
  Mail,
  MessageSquare,
  Workflow,
  Cloud,
  Shield,
  Zap,
  CircleCheck,
  CircleAlert,
  Lock,
  Unlock,
  Coins,
  Clock,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

// ─── Types (mirror /api/platform/status response shape) ────────────────────

type QuotaLevel = "ok" | "monitoring" | "warning" | "restrict" | "emergency" | "exhausted";

interface QuotaSnapshot {
  provider: string;
  resource: string;
  used: number;
  limit: number;
  percent: number;
  level: QuotaLevel;
  remaining: number;
  resetsAt?: string;
  lastUpdated: string;
}

interface HealthInfo {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

interface ReplicationState {
  lastReplicatedEventId?: string;
  replicationLagEvents: number;
  replicationLagSeconds: number;
  recoveryState: string;
  databaseEpoch: number;
}

interface CircuitSnapshot {
  name: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  halfOpenAt: string | null;
}

interface PlatformStatus {
  epoch: {
    epoch: number;
    primary: "turso" | "neon";
    promotedAt: string;
    reason: string;
    fencingToken: string;
  };
  writablePrimary: "turso" | "neon";
  databases: {
    turso: { role: "primary"; writable: boolean; health: HealthInfo };
    neon: {
      role: "recovery";
      writable: boolean;
      replication: ReplicationState;
      health: HealthInfo;
    };
  };
  storage: {
    quota: QuotaSnapshot;
    full: {
      storage: QuotaSnapshot;
      ops: QuotaSnapshot;
      transfer: QuotaSnapshot;
    };
  };
  email: { quota: QuotaSnapshot };
  sms: { quota: QuotaSnapshot };
  workflows: { health: { ok: boolean; detail?: string } };
  breakers: CircuitSnapshot[];
  costModel: {
    platformFunded: string[];
    customerFunded: string[];
  };
}

// ─── Color helpers (NO indigo/blue. teal/amber/rose/orange palette) ──────────

const QUOTA_LEVEL_STYLES: Record<QuotaLevel, { text: string; bg: string; bar: string; dot: string }> = {
  ok: { text: "text-teal-700", bg: "bg-teal-50 border-teal-200", bar: "bg-teal-500", dot: "bg-teal-500" },
  monitoring: { text: "text-teal-700", bg: "bg-teal-50 border-teal-200", bar: "bg-teal-500", dot: "bg-teal-500" },
  warning: { text: "text-amber-700", bg: "bg-amber-50 border-amber-200", bar: "bg-amber-500", dot: "bg-amber-500" },
  restrict: { text: "text-orange-700", bg: "bg-orange-50 border-orange-200", bar: "bg-orange-500", dot: "bg-orange-500" },
  emergency: { text: "text-rose-700", bg: "bg-rose-50 border-rose-200", bar: "bg-rose-500", dot: "bg-rose-500" },
  exhausted: { text: "text-rose-700", bg: "bg-rose-50 border-rose-200", bar: "bg-rose-500", dot: "bg-rose-500" },
};

const BREAKER_STYLES: Record<CircuitSnapshot["state"], { text: string; bg: string; dot: string; label: string }> = {
  CLOSED: { text: "text-teal-700", bg: "bg-teal-50 border-teal-200", dot: "bg-teal-500", label: "CLOSED" },
  OPEN: { text: "text-rose-700", bg: "bg-rose-50 border-rose-200", dot: "bg-rose-500", label: "OPEN" },
  HALF_OPEN: { text: "text-amber-700", bg: "bg-amber-50 border-amber-200", dot: "bg-amber-500", label: "HALF_OPEN" },
};

// ─── Number / time formatting helpers ───────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCountdown(resetsAt?: string): string {
  if (!resetsAt) return "—";
  const target = new Date(resetsAt).getTime();
  const now = Date.now();
  const diff = target - now;
  if (diff <= 0) return "resets soon";
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  if (h > 0) return `resets in ${h}h ${m}m`;
  if (m > 0) return `resets in ${m}m ${s}s`;
  return `resets in ${s}s`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1_000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ─── Main component ─────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 30_000;

export function InfraDashboard({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [nextRefreshIn, setNextRefreshIn] = useState<number>(REFRESH_INTERVAL_MS / 1000);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/status", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as PlatformStatus;
      setStatus(json);
      setLastFetched(new Date());
      setNextRefreshIn(REFRESH_INTERVAL_MS / 1000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      setError(msg);
      if (silent) toast.error(`Infra refresh failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial + 30s auto-refresh
  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Countdown ticker (updates every second)
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setNextRefreshIn((n) => (n <= 1 ? REFRESH_INTERVAL_MS / 1000 : n - 1));
    }, 1_000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Verify
          </Button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Gauge className="h-5 w-5 text-teal-600" /> Infrastructure Dashboard
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastFetched && !loading && !error && (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" /> {timeAgo(lastFetched.toISOString())} · auto in {nextRefreshIn}s
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <ErrorState error={error} onRetry={() => load()} />
      ) : status ? (
        <>
          {/* Epoch banner */}
          <EpochBanner status={status} />

          {/* Provider cards grid */}
          <section>
            <SectionHeader icon={Activity} title="Providers" subtitle="Live infrastructure health & quotas" />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
              <TursoCard status={status} />
              <NeonCard status={status} />
              <VercelBlobCard status={status} />
              <BrevoCard status={status} />
              <SmsCard status={status} />
              <InngestCard status={status} />
              <CloudflareCard />
            </div>
          </section>

          {/* Circuit breakers */}
          <section>
            <SectionHeader
              icon={Zap}
              title="Circuit Breakers"
              subtitle="Per-provider failure isolation state"
            />
            <Card className="mt-3">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Provider</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Failures</TableHead>
                      <TableHead className="text-right">Successes</TableHead>
                      <TableHead>Last failure</TableHead>
                      <TableHead>Opened at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {status.breakers.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                          No circuit breakers registered.
                        </TableCell>
                      </TableRow>
                    ) : (
                      status.breakers.map((b) => {
                        const style = BREAKER_STYLES[b.state];
                        return (
                          <TableRow key={b.name}>
                            <TableCell className="font-medium">{b.name}</TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${style.bg} ${style.text}`}
                              >
                                <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
                                {style.label}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-mono text-rose-700">{b.failureCount}</TableCell>
                            <TableCell className="text-right font-mono text-teal-700">{b.successCount}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{timeAgo(b.lastFailureAt)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{timeAgo(b.openedAt)}</TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </section>

          {/* Cost model */}
          <section>
            <SectionHeader
              icon={Coins}
              title="Cost Model"
              subtitle="Who pays for what. Fail-closed vs. explicit-authorization."
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-3">
              {/* Platform-funded */}
              <Card className="border-teal-200 bg-teal-50/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Unlock className="h-4 w-4 text-teal-600" />
                    Platform-funded
                    <Badge variant="outline" className="ml-auto text-[10px] text-teal-700 border-teal-300 bg-teal-50">
                      fail-closed on quota
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Free-tier providers. The platform absorbs cost. When a quota is exhausted, the
                    corresponding write path fails closed (returns a quota error) instead of
                    silently dropping work or charging the customer.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {status.costModel.platformFunded.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="text-[11px] border-teal-300 bg-teal-50 text-teal-800"
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Customer-funded */}
              <Card className="border-rose-200 bg-rose-50/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Lock className="h-4 w-4 text-rose-600" />
                    Customer-funded
                    <Badge variant="outline" className="ml-auto text-[10px] text-rose-700 border-rose-300 bg-rose-50">
                      explicit authorization required
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="text-xs text-muted-foreground">
                    Billable per-use. Each send requires a prior <code className="text-xs">quote → authorize</code>{" "}
                    flow with a customer-signed consent reference. Failure to authorize fails closed
                    with <code className="text-xs">SMS_AUTHORIZATION_FAILED</code> or{" "}
                    <code className="text-xs">SMS_PAYMENT_REQUIRED</code>.
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {status.costModel.customerFunded.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="text-[11px] border-rose-300 bg-rose-50 text-rose-800"
                      >
                        {p}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

// ─── Epoch banner ────────────────────────────────────────────────────────────

function EpochBanner({ status }: { status: PlatformStatus }) {
  const { epoch } = status;
  const primaryLabel = epoch.primary === "turso" ? "Turso Primary" : "Neon Primary";
  const promotedDate = new Date(epoch.promotedAt);

  return (
    <Card className="border-teal-200 bg-gradient-to-br from-teal-50 via-background to-background">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-teal-700 font-medium uppercase tracking-wide">
              <Shield className="h-3.5 w-3.5" /> Database Epoch
            </div>
            <div className="text-2xl sm:text-3xl font-bold tracking-tight">
              Epoch {epoch.epoch}
              <span className="text-teal-600 mx-2">·</span>
              <span className="text-teal-700">{primaryLabel}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Promoted {timeAgo(epoch.promotedAt)} · reason:{" "}
              <span className="font-medium text-foreground">{epoch.reason}</span>
              <span className="hidden sm:inline">
                {" · "}promotedAt: {promotedDate.toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
            <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 text-[10px]">
              writable: {status.writablePrimary}
            </Badge>
            <div className="text-[10px] text-muted-foreground font-mono max-w-[260px] truncate" title={epoch.fencingToken}>
              fencing: {epoch.fencingToken}
            </div>
            <div className="text-[10px] text-muted-foreground italic">
              promotion is controlled — never automatic
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Provider cards ─────────────────────────────────────────────────────────

function HealthBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 text-[10px]">
      <CircleCheck className="h-3 w-3 mr-0.5" /> healthy
    </Badge>
  ) : (
    <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-800 text-[10px]">
      <CircleAlert className="h-3 w-3 mr-0.5" /> unhealthy
    </Badge>
  );
}

function RoleBadge({ role }: { role: string }) {
  const isPrimary = role === "primary";
  return (
    <Badge
      variant="outline"
      className={
        isPrimary
          ? "border-amber-300 bg-amber-50 text-amber-800 text-[10px]"
          : "border-teal-300 bg-teal-50 text-teal-800 text-[10px]"
      }
    >
      {role}
    </Badge>
  );
}

function WritableBadge({ writable }: { writable: boolean }) {
  return writable ? (
    <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-800 text-[10px]">
      <Unlock className="h-3 w-3 mr-0.5" /> writable
    </Badge>
  ) : (
    <Badge variant="outline" className="border-muted-foreground/30 bg-muted text-muted-foreground text-[10px]">
      <Lock className="h-3 w-3 mr-0.5" /> read-only
    </Badge>
  );
}

function QuotaRow({ quota, label }: { quota: QuotaSnapshot; label?: string }) {
  const style = QUOTA_LEVEL_STYLES[quota.level] ?? QUOTA_LEVEL_STYLES.ok;
  const isBytes = quota.resource.endsWith("_bytes") || quota.resource.includes("bytes");
  const used = isBytes ? formatBytes(quota.used) : formatNumber(quota.used);
  const limit = isBytes ? formatBytes(quota.limit) : formatNumber(quota.limit);
  const remaining = isBytes ? formatBytes(quota.remaining) : formatNumber(quota.remaining);

  return (
    <div className="space-y-1">
      {label && <div className="text-[11px] text-muted-foreground">{label}</div>}
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-sm font-semibold ${style.text}`}>
          {used} <span className="text-muted-foreground font-normal">/ {limit}</span>
        </span>
        <span className="text-[11px] text-muted-foreground">{quota.percent.toFixed(1)}%</span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${style.bar}`}
          style={{ width: `${Math.min(100, Math.max(0, quota.percent))}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${style.dot} mr-1 align-middle`} />
          {quota.level}
        </span>
        <span>{remaining} left</span>
      </div>
    </div>
  );
}

function ProviderCardShell({
  icon: Icon,
  title,
  subtitle,
  badges,
  children,
  accent = "teal",
}: {
  icon: any;
  title: string;
  subtitle?: string;
  badges?: ReactNode;
  children: ReactNode;
  accent?: "teal" | "amber" | "rose" | "orange";
}) {
  const accentClasses: Record<string, string> = {
    teal: "bg-teal-50 text-teal-700 border-teal-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return (
    <Card className="hover:shadow-md transition border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <div className={`rounded-lg p-2 border ${accentClasses[accent]}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate">{title}</div>
            {subtitle && <div className="text-[11px] text-muted-foreground font-normal">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1 flex-wrap justify-end">{badges}</div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function TursoCard({ status }: { status: PlatformStatus }) {
  const t = status.databases.turso;
  return (
    <ProviderCardShell
      icon={Database}
      title="Turso"
      subtitle="SQLite @ libSQL · authoritative"
      accent="teal"
      badges={
        <>
          <RoleBadge role={t.role} />
          <HealthBadge ok={t.health.ok} />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <KV label="Latency" value={`${t.health.latencyMs} ms`} />
        <KV label="Writable" value={t.writable ? "yes" : "no"} ok={t.writable} />
      </div>
      {t.health.detail && (
        <div className="text-[11px] text-muted-foreground rounded-md bg-muted p-2 break-words">
          {t.health.detail}
        </div>
      )}
      {status.writablePrimary === "turso" && (
        <div className="text-[11px] text-teal-700 font-medium flex items-center gap-1">
          <Shield className="h-3 w-3" /> Authoritative primary for epoch {status.epoch.epoch}
        </div>
      )}
    </ProviderCardShell>
  );
}

function NeonCard({ status }: { status: PlatformStatus }) {
  const n = status.databases.neon;
  const lagOk = n.replication.replicationLagSeconds <= 5 && n.replication.replicationLagEvents <= 10;
  const inSync = n.replication.recoveryState === "in_sync";
  return (
    <ProviderCardShell
      icon={Database}
      title="Neon"
      subtitle="Postgres · recovery projection"
      accent="amber"
      badges={
        <>
          <RoleBadge role={n.role} />
          <HealthBadge ok={n.health.ok} />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <KV label="Latency" value={`${n.health.latencyMs} ms`} />
        <KV label="Recovery" value={n.replication.recoveryState} ok={inSync} />
        <KV label="Lag (events)" value={formatNumber(n.replication.replicationLagEvents)} ok={lagOk} />
        <KV label="Lag (seconds)" value={`${n.replication.replicationLagSeconds}s`} ok={lagOk} />
        <KV label="DB epoch" value={String(n.replication.databaseEpoch)} ok={n.replication.databaseEpoch === status.epoch.epoch} />
        <KV label="Writable" value={n.writable ? "yes" : "no"} ok={n.writable} />
      </div>
      <div className="text-[11px] text-muted-foreground">
        Last replicated event:{" "}
        <code className="text-[10px] font-mono break-all">
          {n.replication.lastReplicatedEventId ?? "—"}
        </code>
      </div>
    </ProviderCardShell>
  );
}

function VercelBlobCard({ status }: { status: PlatformStatus }) {
  const s = status.storage;
  return (
    <ProviderCardShell
      icon={HardDrive}
      title="Vercel Blob"
      subtitle="Object storage · platform-funded"
      accent="teal"
      badges={<HealthBadge ok={s.quota.level !== "exhausted"} />}
    >
      <QuotaRow quota={s.full.storage} label="Storage" />
      <QuotaRow quota={s.full.ops} label="Monthly operations" />
      <QuotaRow quota={s.full.transfer} label="Monthly transfer" />
    </ProviderCardShell>
  );
}

function BrevoCard({ status }: { status: PlatformStatus }) {
  const e = status.email.quota;
  return (
    <ProviderCardShell
      icon={Mail}
      title="Brevo"
      subtitle="Transactional email · daily quota"
      accent="teal"
      badges={<HealthBadge ok={e.level !== "exhausted"} />}
    >
      <QuotaRow quota={e} label={`${e.resource} · resets daily`} />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Resets: <span className="font-medium text-foreground">{formatCountdown(e.resetsAt)}</span>
        </span>
        <span>{formatNumber(e.remaining)} left</span>
      </div>
    </ProviderCardShell>
  );
}

function SmsCard({ status }: { status: PlatformStatus }) {
  const sms = status.sms.quota;
  const used = sms.used > 0;
  return (
    <ProviderCardShell
      icon={MessageSquare}
      title="SMS"
      subtitle="Per-use billable · customer-funded"
      accent="rose"
      badges={
        <Badge variant="outline" className="border-rose-300 bg-rose-50 text-rose-800 text-[10px]">
          <Lock className="h-3 w-3 mr-0.5" /> auth required
        </Badge>
      }
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <KV label="Provider" value={sms.provider} />
        <KV label="Resource" value={sms.resource} />
        <KV label="Used" value={used ? formatNumber(sms.used) : "0 (no charges)"} ok={!used} />
        <KV label="Limit" value={sms.limit >= 999999 ? "uncapped" : formatNumber(sms.limit)} />
      </div>
      <div className="text-[11px] text-muted-foreground rounded-md bg-rose-50/50 border border-rose-200 p-2">
        No platform cost. Each send requires a prior{" "}
        <code className="text-[10px]">quote → authorize</code> flow with a customer-signed consent reference.
      </div>
    </ProviderCardShell>
  );
}

function InngestCard({ status }: { status: PlatformStatus }) {
  const wf = status.workflows.health;
  return (
    <ProviderCardShell
      icon={Workflow}
      title="Inngest"
      subtitle="Durable workflows · platform-funded"
      accent="teal"
      badges={<HealthBadge ok={wf.ok} />}
    >
      <div className="grid grid-cols-1 gap-1 text-sm">
        <KV label="Workflow engine" value={wf.ok ? "operational" : "degraded"} ok={wf.ok} />
      </div>
      {wf.detail && (
        <div className="text-[11px] text-muted-foreground rounded-md bg-muted p-2 break-words">
          {wf.detail}
        </div>
      )}
      <div className="text-[11px] text-teal-700 font-medium">
        Drives outbox drain + durable async processing.
      </div>
    </ProviderCardShell>
  );
}

function CloudflareCard() {
  return (
    <ProviderCardShell
      icon={Cloud}
      title="Cloudflare"
      subtitle="Edge layer · architectural role"
      accent="amber"
      badges={
        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800 text-[10px]">
          edge
        </Badge>
      }
    >
      <div className="text-sm text-muted-foreground">
        Edge cache + WAF in front of the origin. No live quota surfaced here — this card is an
        architectural reminder that the edge sits between clients and the platform.
      </div>
      <div className="text-[11px] text-amber-700 font-medium">
        Not metered via <code className="text-[10px]">/api/platform/status</code>.
      </div>
    </ProviderCardShell>
  );
}

// ─── Skeleton / error states ────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div>
        <Skeleton className="h-5 w-32 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-200 bg-rose-50/40">
      <CardContent className="p-8 text-center space-y-3">
        <CircleAlert className="h-10 w-10 mx-auto text-rose-500" />
        <div>
          <p className="font-semibold text-rose-800">Failed to load infra status</p>
          <p className="text-xs text-rose-700 font-mono mt-1 break-all">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 mr-1" /> Retry
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Small shared bits ───────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Icon className="h-4 w-4 text-teal-600" />
        {title}
      </h3>
      {subtitle && <span className="text-xs text-muted-foreground">· {subtitle}</span>}
    </div>
  );
}

function KV({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  const color = ok === undefined ? "" : ok ? "text-teal-700" : "text-rose-700";
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-medium truncate ${color}`} title={value}>
        {value}
      </div>
    </div>
  );
}
