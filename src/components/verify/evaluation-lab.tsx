"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, Play, Trash2, ArrowLeft, FlaskConical, Gauge, Timer, CheckCircle2, XCircle,
  RefreshCw, Loader2, Database, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { toast } from "sonner";
import type { EvaluationRunRow, EvaluationResultRow, DocType } from "@/lib/verification-types";

const PIE_COLORS = ["#16a34a", "#dc2626"];

interface RunWithResults extends EvaluationRunRow {
  results?: EvaluationResultRow[];
}

export function EvaluationLab({ onBack }: { onBack: () => void }) {
  const [runs, setRuns] = useState<EvaluationRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [sampleCount, setSampleCount] = useState<number>(0);
  const [activeRun, setActiveRun] = useState<RunWithResults | null>(null);
  const [concurrency, setConcurrency] = useState<number>(2);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [runsRes, samplesRes] = await Promise.all([
        fetch("/api/verify/evaluate").then((r) => r.json()),
        fetch("/api/verify/samples?withImage=0").then((r) => r.json()),
      ]);
      setRuns(runsRes.runs || []);
      setSampleCount(samplesRes.samples?.length || 0);
    } catch {
      toast.error("Failed to load evaluation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // poll active run if it's running
  const pollActive = useCallback(async () => {
    if (!activeRun || activeRun.status !== "running") return;
    try {
      const res = await fetch(`/api/verify/evaluate/${activeRun.id}`);
      const json = await res.json();
      if (json.run) {
        setActiveRun(json.run);
        // also update in the list
        setRuns((prev) => prev.map((r) => (r.id === json.run.id ? json.run : r)));
      }
    } catch {}
  }, [activeRun]);

  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const t = setInterval(pollActive, 2500);
    return () => clearInterval(t);
  }, [activeRun, pollActive]);

  const startRun = async () => {
    if (sampleCount === 0) {
      toast.warning("No training samples found. Seed synthetic samples first.");
      return;
    }
    setRunning(true);
    try {
      // 1. create run
      const createRes = await fetch("/api/verify/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Stress test ${new Date().toLocaleString()}`, concurrency }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) throw new Error(createJson.error);
      const run = createJson.run;

      // 2. fetch samples list (ids only)
      const samplesRes = await fetch("/api/verify/samples?withImage=0").then((r) => r.json());
      const sampleIds: string[] = (samplesRes.samples || []).map((s: any) => s.id);

      setActiveRun({ ...run, results: [] });
      toast.info(`Running stress test on ${sampleIds.length} samples (concurrency ${concurrency})…`);

      // 3. dispatch in batches respecting concurrency
      const queue = [...sampleIds];
      const workers: Promise<void>[] = [];
      const worker = async () => {
        while (queue.length > 0) {
          const sampleId = queue.shift()!;
          try {
            await fetch("/api/verify/evaluate/run", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ runId: run.id, sampleId }),
            });
          } catch (e) {
            // continue on single sample failure
          }
          // refresh active run view after each completion
          setRunning(true);
        }
      };
      for (let i = 0; i < concurrency; i++) workers.push(worker());
      await Promise.all(workers);

      // 4. final refresh
      const finalRes = await fetch(`/api/verify/evaluate/${run.id}`);
      const finalJson = await finalRes.json();
      if (finalJson.run) {
        setActiveRun(finalJson.run);
        toast.success("Stress test completed");
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Stress test failed");
    } finally {
      setRunning(false);
    }
  };

  const delRun = async (id: string) => {
    if (!confirm("Delete this evaluation run and all its results?")) return;
    try {
      await fetch(`/api/verify/evaluate/${id}`, { method: "DELETE" });
      setRuns((r) => r.filter((x) => x.id !== id));
      if (activeRun?.id === id) setActiveRun(null);
      toast.success("Run deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  const openRun = async (run: EvaluationRunRow) => {
    try {
      const res = await fetch(`/api/verify/evaluate/${run.id}`);
      const json = await res.json();
      setActiveRun(json.run);
    } catch {
      toast.error("Failed to load run detail");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-emerald-600" /> Evaluation Lab
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Controls + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-600" /> Run stress test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Runs the full multi-pass VLM extraction pipeline against every sample in the
              training database and measures per-field OCR accuracy, response time, and image
              quality score. Each sample is processed independently with configurable concurrency.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Concurrency:</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((c) => (
                    <button
                      key={c}
                      onClick={() => setConcurrency(c)}
                      className={`h-8 w-8 rounded-md border text-sm font-medium transition ${
                        concurrency === c
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <Badge variant="outline" className="gap-1">
                <Database className="h-3 w-3" /> {sampleCount} samples
              </Badge>
            </div>
            <Button onClick={startRun} disabled={running || sampleCount === 0} size="lg">
              {running ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running…</>
              ) : (
                <><Play className="h-4 w-4 mr-2" /> Run stress test</>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-600" /> Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total runs</span><span className="font-semibold">{runs.length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Completed</span><span className="font-semibold">{runs.filter((r) => r.status === "completed").length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Running</span><span className="font-semibold text-amber-600">{runs.filter((r) => r.status === "running").length}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Best accuracy</span><span className="font-semibold text-emerald-600">{Math.round(Math.max(0, ...runs.map((r) => r.overallAccuracy * 100)))}%</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Active run progress + charts */}
      {activeRun && (
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
              <span className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-emerald-600" /> {activeRun.name || "Run"}
              </span>
              <Badge variant={activeRun.status === "completed" ? "default" : "secondary"}
                className={activeRun.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                {activeRun.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{activeRun.completedSamples} / {activeRun.totalSamples} samples</span>
              </div>
              <Progress value={activeRun.totalSamples ? (activeRun.completedSamples / activeRun.totalSamples) * 100 : 0} className="h-2" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Overall accuracy" value={`${Math.round(activeRun.overallAccuracy * 100)}%`} icon={CheckCircle2} good={activeRun.overallAccuracy >= 0.7} />
              <Stat label="Passed" value={`${activeRun.passedSamples}/${activeRun.completedSamples}`} icon={activeRun.passedSamples >= activeRun.completedSamples / 2 ? CheckCircle2 : XCircle} good={activeRun.passedSamples >= activeRun.completedSamples / 2} />
              <Stat label="Avg response" value={`${(activeRun.avgDocTimeMs / 1000).toFixed(1)}s`} icon={Timer} />
              <Stat label="Avg quality" value={`${Math.round(activeRun.avgQualityScore * 100)}%`} icon={Gauge} good={activeRun.avgQualityScore >= 0.7} />
            </div>

            {/* Per-field accuracy chart */}
            {activeRun.fieldAccuracy && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Per-field accuracy</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={fieldAccuracyData(activeRun.fieldAccuracy)}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="field" tick={{ fontSize: 12 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                      <Tooltip formatter={(v: any) => `${v}%`} />
                      <Bar dataKey="accuracy" name="Accuracy" radius={[6, 6, 0, 0]}>
                        {fieldAccuracyData(activeRun.fieldAccuracy).map((d, i) => (
                          <Cell key={i} fill={d.accuracy >= 70 ? "#16a34a" : d.accuracy >= 40 ? "#f59e0b" : "#dc2626"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Pass/fail pie + response time scatter */}
            {activeRun.results && activeRun.results.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Pass vs Fail</h4>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: "Passed", value: activeRun.results.filter((r) => r.passed).length },
                            { name: "Failed", value: activeRun.results.filter((r) => !r.passed).length },
                          ]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={45}
                          outerRadius={75}
                        >
                          {PIE_COLORS.map((c, i) => <Cell key={i} fill={c} />)}
                        </Pie>
                        <Legend />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Response time per sample</h4>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={activeRun.results.map((r, i) => ({ idx: i + 1, time: +(r.responseTimeMs / 1000).toFixed(2), name: r.sampleName?.slice(0, 16) }))}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis dataKey="idx" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} unit="s" />
                        <Tooltip />
                        <Line type="monotone" dataKey="time" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}

            {/* Results table */}
            {activeRun.results && activeRun.results.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Per-sample results</h4>
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="min-w-[180px]">Sample</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-center">Name Ar</TableHead>
                        <TableHead className="text-center">Name En</TableHead>
                        <TableHead className="text-center">NID</TableHead>
                        <TableHead className="text-center">DocNo</TableHead>
                        <TableHead className="text-center">DOB</TableHead>
                        <TableHead className="text-center">Gender</TableHead>
                        <TableHead className="text-center">Expiry</TableHead>
                        <TableHead className="text-right">Time</TableHead>
                        <TableHead className="text-center">Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeRun.results.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium truncate max-w-[180px]">{r.sampleName}</TableCell>
                          <TableCell className="text-xs">{r.docType}</TableCell>
                          <ResultCell correct={r.nameArCorrect} expected={r.expectedNameAr} actual={r.actualNameAr} />
                          <ResultCell correct={r.nameEnCorrect} expected={r.expectedNameEn} actual={r.actualNameEn} />
                          <ResultCell correct={r.nationalIdCorrect} expected={r.expectedNationalId} actual={r.actualNationalId} mono />
                          <ResultCell correct={r.documentNoCorrect} expected={r.expectedDocumentNo} actual={r.actualDocumentNo} mono />
                          <ResultCell correct={r.birthDateCorrect} expected={r.expectedBirthDate} actual={r.actualBirthDate} mono />
                          <ResultCell correct={r.genderCorrect} expected={r.expectedGender} actual={r.actualGender} />
                          <ResultCell correct={r.expiryCorrect} expected={r.expectedExpiry} actual={r.actualExpiry} mono />
                          <TableCell className="text-right font-mono text-xs">{(r.responseTimeMs / 1000).toFixed(1)}s</TableCell>
                          <TableCell className="text-center">
                            {r.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600 inline" /> : <XCircle className="h-4 w-4 text-rose-500 inline" />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Runs list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All evaluation runs</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No evaluation runs yet.</p>
              <p className="text-sm">Seed training samples then click "Run stress test".</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Progress</TableHead>
                    <TableHead className="text-right">Accuracy</TableHead>
                    <TableHead className="text-right">Passed</TableHead>
                    <TableHead className="text-right">Avg time</TableHead>
                    <TableHead className="text-right">Concurrency</TableHead>
                    <TableHead className="text-right">Started</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => openRun(r)}>
                      <TableCell className="font-medium truncate max-w-[200px]">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant={r.status === "completed" ? "default" : "secondary"}
                          className={r.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs">{r.completedSamples}/{r.totalSamples}</TableCell>
                      <TableCell className="text-right font-mono">{Math.round(r.overallAccuracy * 100)}%</TableCell>
                      <TableCell className="text-right">{r.passedSamples}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{(r.avgDocTimeMs / 1000).toFixed(1)}s</TableCell>
                      <TableCell className="text-right">{r.concurrency}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); delRun(r.id); }}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon: Icon, good }: { label: string; value: string; icon: any; good?: boolean }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${good === false ? "text-rose-500" : good === true ? "text-emerald-600" : "text-muted-foreground"}`} />
        {label}
      </div>
      <div className={`text-xl font-bold ${good === false ? "text-rose-600" : good === true ? "text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}

function ResultCell({ correct, expected, actual, mono }: { correct: boolean; expected?: string | null; actual?: string | null; mono?: boolean }) {
  return (
    <TableCell className="text-center">
      <div className="flex flex-col items-center gap-0.5">
        {correct ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-rose-500" />}
        {actual ? (
          <span className={`text-xs ${mono ? "font-mono" : ""} truncate max-w-[120px]`} title={actual || ""} dir="auto">{actual}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic">—</span>
        )}
      </div>
    </TableCell>
  );
}

function fieldAccuracyData(json: string): { field: string; accuracy: number }[] {
  try {
    const stats = JSON.parse(json);
    const labels: Record<string, string> = {
      nameAr: "Name (Ar)",
      nameEn: "Name (En)",
      nationalId: "National ID",
      documentNo: "Doc No",
      birthDate: "Birth Date",
      gender: "Gender",
      expiry: "Expiry",
    };
    return Object.entries(stats).map(([k, v]: [string, any]) => ({
      field: labels[k] || k,
      accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    }));
  } catch {
    return [];
  }
}
