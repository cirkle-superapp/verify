"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Gauge,
  Play,
  Download,
  RefreshCw,
  Activity,
  CheckCircle2,
  AlertCircle,
  Clock,
  Target,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

// ─── Types — mirror the /api/v1/verify/benchmark response shape ──────

interface BenchmarkPerField {
  correct: number;
  total: number;
}

interface BenchmarkAccuracy {
  overall: number; // 0..1
  samples_with_output: number;
  per_field: Record<string, BenchmarkPerField>;
}

interface BenchmarkResult {
  samples_processed: number;
  mean_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  p99_latency_ms: number;
  max_latency_ms: number;
  min_latency_ms: number;
  errors: Array<{ sample_id: string; error: string }>;
  accuracy?: BenchmarkAccuracy;
  doc_type_filter?: string;
  timestamp: string;
}

// ─── Honest competitor estimates (publicly reported figures) ─────────
//
// These are public ballpark numbers for marketing pages and papers —
// not real benchmarks we ran ourselves. They're labeled as "estimated"
// in the table to make the comparison honest. The actual numbers vary
// widely depending on document type, country, network conditions, and
// pricing tier. We use them only as reference points to demonstrate
// where Cirkle sits relative to the well-known competitors.
//
// Sources: Onfido/Jumio/Veriff/Sumsub marketing pages and Veriff's
// public benchmark whitepapers (2023-2024). These are not benchmarks
// of those competitors — they're the figures the competitors publish
// about themselves.

interface CompetitorRow {
  name: string;
  meanLatencyMs: number;
  p95LatencyMs: number;
  overallAccuracy: number; // 0..1
  source: "self-benchmark" | "vendor-published-estimate";
  notes: string;
}

const FIELD_DISPLAY_NAMES: Record<string, string> = {
  nameAr: "Arabic Name",
  nameEn: "Latin Name",
  nationalId: "National ID",
  documentNo: "Document No",
  birthDate: "Birth Date",
  gender: "Gender",
  expiry: "Expiry",
};

const FIELD_BAR_COLORS = [
  "#16a34a", "#0d9488", "#0891b2", "#7c3aed",
  "#db2777", "#ca8a04", "#65a30d",
];

const COMPETITOR_BAR_COLORS = [
  "#16a34a", // Cirkle (green)
  "#0ea5e9", // Onfido (sky)
  "#8b5cf6", // Jumio (violet)
  "#f59e0b", // Veriff (amber)
  "#ef4444", // Sumsub (red)
];

/**
 * BenchmarkDashboard — honest accuracy/latency metrics.
 *
 * Fetches `/api/v1/verify/benchmark?sample_count=5` on mount, displays
 * the mean / p95 / p99 latency, per-field accuracy, overall accuracy,
 * sample count, and any errors. A bar chart visualizes per-field
 * accuracy (0..100 %). A comparison table shows Cirkle vs the four
 * well-known competitors (with honest "estimated" values for the
 * competitors, since we can't actually run their pipelines).
 *
 * Buttons:
 *   - "Run Benchmark" — re-runs the benchmark with a fresh sample
 *   - "Download Report" — exports the latest benchmark result + the
 *     competitor table as a JSON file
 */
export function BenchmarkDashboard({ onBack }: { onBack: () => void }) {
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBenchmark = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/verify/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_count: 5 }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as BenchmarkResult;
      setResult(json);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      setError(msg);
      toast.error(`Benchmark fetch failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBenchmark();
  }, [fetchBenchmark]);

  const runBenchmark = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/v1/verify/benchmark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample_count: 5 }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as BenchmarkResult;
      setResult(json);
      toast.success(`Benchmark complete — ${json.samples_processed} samples processed`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "fetch failed";
      toast.error(`Benchmark run failed: ${msg}`);
    } finally {
      setRunning(false);
    }
  }, []);

  const downloadReport = useCallback(() => {
    if (!result) {
      toast.warning("No benchmark result to download yet");
      return;
    }
    const report = {
      generatedAt: new Date().toISOString(),
      pipeline: "Cirkle Identity Verification — v3.2.0",
      cirkle: result,
      competitors: COMPETITOR_TABLE,
      notes: [
        "Cirkle numbers are real benchmarks run on synthetic samples (see samples_processed).",
        "Competitor numbers are estimated from vendor-published marketing pages and whitepapers (2023-2024).",
        "Actual competitor accuracy varies by document type, country, network conditions, and pricing tier.",
        "Latency includes image rendering + AI consensus + OCR post-processing + cross-field validation.",
      ],
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cirkle-benchmark-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Benchmark report downloaded");
  }, [result]);

  // Per-field accuracy chart data (recharts format).
  const fieldChartData = (() => {
    if (!result?.accuracy?.per_field) return [];
    return Object.entries(result.accuracy.per_field).map(([field, stats]) => {
      const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      return {
        field: FIELD_DISPLAY_NAMES[field] || field,
        accuracy: pct,
        correct: stats.correct,
        total: stats.total,
      };
    });
  })();

  // Latency chart data (mean / p50 / p95 / p99 / max).
  const latencyChartData = (() => {
    if (!result) return [];
    return [
      { label: "Mean", ms: result.mean_latency_ms },
      { label: "P50", ms: result.p50_latency_ms },
      { label: "P95", ms: result.p95_latency_ms },
      { label: "P99", ms: result.p99_latency_ms },
      { label: "Max", ms: result.max_latency_ms },
    ];
  })();

  // Competitor comparison chart data (latency).
  const competitorLatencyData = (() => {
    const cirkleMean = result?.mean_latency_ms ?? 0;
    return [
      { name: "Cirkle", ms: cirkleMean, source: "self-benchmark" },
      ...COMPETITOR_TABLE.map((c) => ({
        name: c.name,
        ms: c.meanLatencyMs,
        source: c.source,
      })),
    ];
  })();

  const overallAccuracy = result?.accuracy?.overall ?? 0;
  const accuracyPct = Math.round(overallAccuracy * 100);
  const samplesProcessed = result?.samples_processed ?? 0;
  const errorCount = result?.errors?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Verify
          </Button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Gauge className="h-5 w-5 text-teal-600" /> Benchmark Dashboard
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {result?.timestamp && !loading && !running && (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3 mr-1" /> {new Date(result.timestamp).toLocaleString()}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={downloadReport} disabled={!result}>
            <Download className="h-4 w-4 mr-1" /> Download Report
          </Button>
          <Button size="sm" onClick={runBenchmark} disabled={running || loading}>
            <Play className={`h-4 w-4 mr-1 ${running ? "animate-pulse" : ""}`} />
            {running ? "Running…" : "Run Benchmark"}
          </Button>
        </div>
      </div>

      {loading ? (
        <BenchmarkSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="p-6 flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <div>
              <div className="font-medium">Failed to load benchmark</div>
              <div className="text-sm text-muted-foreground">{error}</div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchBenchmark} className="ml-auto">
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : result ? (
        <>
          {/* Headline KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="Samples Processed"
              value={samplesProcessed.toString()}
              icon={<Target className="h-4 w-4" />}
              tone="default"
            />
            <KpiCard
              label="Overall Accuracy"
              value={`${accuracyPct}%`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              tone={accuracyPct >= 80 ? "good" : accuracyPct >= 50 ? "warn" : "bad"}
            />
            <KpiCard
              label="Mean Latency"
              value={`${result.mean_latency_ms} ms`}
              icon={<Clock className="h-4 w-4" />}
              tone={result.mean_latency_ms < 2000 ? "good" : result.mean_latency_ms < 5000 ? "warn" : "bad"}
            />
            <KpiCard
              label="Errors"
              value={errorCount.toString()}
              icon={<AlertCircle className="h-4 w-4" />}
              tone={errorCount === 0 ? "good" : errorCount < 3 ? "warn" : "bad"}
            />
          </div>

          {/* Latency stats row */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-teal-600" /> Latency Percentiles
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                <StatBox label="Mean" value={`${result.mean_latency_ms} ms`} />
                <StatBox label="P50" value={`${result.p50_latency_ms} ms`} />
                <StatBox label="P95" value={`${result.p95_latency_ms} ms`} />
                <StatBox label="P99" value={`${result.p99_latency_ms} ms`} />
                <StatBox label="Max" value={`${result.max_latency_ms} ms`} />
              </div>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={latencyChartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#6b7280" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
                    <Tooltip
                      formatter={(v: number) => [`${v} ms`, "Latency"]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    />
                    <Bar dataKey="ms" name="Latency (ms)" radius={[6, 6, 0, 0]}>
                      {latencyChartData.map((_, i) => (
                        <Cell key={`lat-${i}`} fill={FIELD_BAR_COLORS[i % FIELD_BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Per-field accuracy */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-teal-600" /> Per-Field Accuracy
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {fieldChartData.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4 text-center">
                  No accuracy data — AI providers returned no structured fields.
                  Latency is still measured; accuracy requires the AI consensus to return fields.
                </div>
              ) : (
                <>
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={fieldChartData}
                        margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                        <XAxis dataKey="field" tick={{ fontSize: 11 }} stroke="#6b7280" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} stroke="#6b7280" />
                        <Tooltip
                          formatter={(v: number, _n, p: any) => [
                            `${v}% (${p?.payload?.correct}/${p?.payload?.total})`,
                            "Accuracy",
                          ]}
                          contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                        />
                        <Bar dataKey="accuracy" name="Accuracy %" radius={[6, 6, 0, 0]}>
                          {fieldChartData.map((d, i) => (
                            <Cell
                              key={`fld-${i}`}
                              fill={
                                d.accuracy >= 80
                                  ? "#16a34a"
                                  : d.accuracy >= 50
                                    ? "#f59e0b"
                                    : "#ef4444"
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                    {fieldChartData.map((f) => (
                      <div
                        key={f.field}
                        className="flex items-center justify-between p-2 rounded-md bg-muted/40"
                      >
                        <span className="text-xs font-medium">{f.field}</span>
                        <Badge variant="outline" className="text-xs">
                          {f.accuracy}% ({f.correct}/{f.total})
                        </Badge>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Overall accuracy progress */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-teal-600" /> Overall Accuracy
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Computed over {result?.accuracy?.samples_with_output ?? 0} samples with structured output
                </span>
                <Badge variant="outline">{accuracyPct}%</Badge>
              </div>
              <Progress value={accuracyPct} className="h-3" />
              <p className="text-xs text-muted-foreground">
                Overall = mean of per-field accuracy across samples. AI providers
                must return structured fields (nationalId, fullNameAr, etc.) for
                accuracy to be computed. When providers aren&apos;t configured
                (sandbox), accuracy is undefined and only latency is reported.
              </p>
            </CardContent>
          </Card>

          {/* Competitor comparison table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-teal-600" /> Cirkle vs Competitors
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-[260px] w-full mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={competitorLatencyData}
                    margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#6b7280" />
                    <YAxis tick={{ fontSize: 12 }} stroke="#6b7280" />
                    <Tooltip
                      formatter={(v: number) => [`${v} ms`, "Mean latency"]}
                      contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb" }}
                    />
                    <Legend />
                    <Bar dataKey="ms" name="Mean latency (ms)" radius={[6, 6, 0, 0]}>
                      {competitorLatencyData.map((_, i) => (
                        <Cell key={`cmp-${i}`} fill={COMPETITOR_BAR_COLORS[i % COMPETITOR_BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead className="text-right">Mean Latency</TableHead>
                      <TableHead className="text-right">P95 Latency</TableHead>
                      <TableHead className="text-right">Accuracy</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-teal-50/40">
                      <TableCell className="font-medium">Cirkle (this run)</TableCell>
                      <TableCell className="text-right">{result.mean_latency_ms} ms</TableCell>
                      <TableCell className="text-right">{result.p95_latency_ms} ms</TableCell>
                      <TableCell className="text-right">
                        {result.accuracy ? `${accuracyPct}%` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="default" className="text-[10px]">self-benchmark</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        Run on {samplesProcessed} synthetic samples
                      </TableCell>
                    </TableRow>
                    {COMPETITOR_TABLE.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-right">~{c.meanLatencyMs} ms</TableCell>
                        <TableCell className="text-right">~{c.p95LatencyMs} ms</TableCell>
                        <TableCell className="text-right">~{Math.round(c.overallAccuracy * 100)}%</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">estimated</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                <strong>Honesty note:</strong> The competitor numbers above are
                estimates from publicly available marketing pages and whitepapers
                (2023–2024), not benchmarks we ran ourselves. They are included
                only as reference points. Real-world accuracy/latency varies
                significantly by document type, country, network conditions, and
                pricing tier — vendors&apos; published numbers tend to be best-case.
              </p>
            </CardContent>
          </Card>

          {/* Errors list */}
          {errorCount > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <AlertCircle className="h-4 w-4" /> Errors ({errorCount})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.errors.map((err, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{err.sample_id}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{err.error}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneColor =
    tone === "good"
      ? "text-teal-700"
      : tone === "warn"
        ? "text-amber-700"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className={toneColor}>{icon}</span>
        </div>
        <div className={`text-2xl font-bold ${toneColor}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 p-3 rounded-md bg-muted/40">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{value}</span>
    </div>
  );
}

function BenchmarkSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

// ─── Competitor estimates (publicly published) ───────────────────────
//
// These numbers come from vendor marketing pages and Veriff's
// 2023-2024 benchmark whitepaper. They're labeled as "estimated"
// in the comparison table. Real-world values vary.

const COMPETITOR_TABLE: Array<{
  name: string;
  meanLatencyMs: number;
  p95LatencyMs: number;
  overallAccuracy: number;
  source: "vendor-published-estimate";
  notes: string;
}> = [
  {
    name: "Onfido",
    meanLatencyMs: 3500,
    p95LatencyMs: 8000,
    overallAccuracy: 0.987,
    source: "vendor-published-estimate",
    notes: "Real-time API; mean ~3-4 s per Onfido marketing. Accuracy on standard ID documents.",
  },
  {
    name: "Jumio",
    meanLatencyMs: 5000,
    p95LatencyMs: 12000,
    overallAccuracy: 0.99,
    source: "vendor-published-estimate",
    notes: "Netverify ~5 s mean; accuracy per Jumio 2024 product brochure.",
  },
  {
    name: "Veriff",
    meanLatencyMs: 6000,
    p95LatencyMs: 15000,
    overallAccuracy: 0.995,
    source: "vendor-published-estimate",
    notes: "Decision time ~60 s for full session; pure extraction ~6 s per Veriff whitepaper 2024.",
  },
  {
    name: "Sumsub",
    meanLatencyMs: 4000,
    p95LatencyMs: 10000,
    overallAccuracy: 0.992,
    source: "vendor-published-estimate",
    notes: "Average processing ~4 s per Sumsub product docs; accuracy per their published benchmarks.",
  },
];
