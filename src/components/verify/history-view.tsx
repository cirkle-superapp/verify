"use client";

import { useEffect, useState, useCallback } from "react";
import { History, Trash2, Eye, RefreshCw, ShieldCheck, ArrowLeft, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScoreBadge, StatusBadge } from "@/components/verify/score-badge";
import { DOC_TYPES, type VerificationRecord } from "@/lib/verification-types";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function HistoryView({ onBack }: { onBack: () => void }) {
  const [records, setRecords] = useState<VerificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<VerificationRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/verify/records");
      const json = await res.json();
      setRecords(json.records ?? []);
    } catch (e) {
      toast.error("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const del = async (id: string) => {
    if (!confirm("Delete this verification record?")) return;
    try {
      await fetch(`/api/verify/records/${id}`, { method: "DELETE" });
      setRecords((r) => r.filter((x) => x.id !== id));
      toast.success("Record deleted");
    } catch {
      toast.error("Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <History className="h-5 w-5 text-emerald-600" /> Verification history
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <ShieldCheck className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
            <p className="font-medium">No verifications yet</p>
            <p className="text-sm">Run your first identity verification to see it here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((r) => {
            const meta = DOC_TYPES.find((d) => d.id === (r.docType as any));
            return (
              <Card key={r.id} className="overflow-hidden hover:shadow-md transition">
                <CardContent className="p-4 flex items-center gap-4">
                  {r.docImageFront ? (
                    <img src={r.docImageFront} alt="doc" className="h-16 w-20 object-cover rounded-md border bg-black/5 shrink-0" />
                  ) : (
                    <div className="h-16 w-20 rounded-md bg-muted flex items-center justify-center shrink-0">
                      <ShieldCheck className="h-6 w-6 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{r.fullNameEn || r.fullNameAr || "Unknown"}</span>
                      {r.fullNameAr && (
                        <span className="text-sm text-emerald-700 font-arabic" dir="rtl" lang="ar">{r.fullNameAr}</span>
                      )}
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>{meta?.label ?? r.docType}</span>
                      {r.nationalId && <span className="font-mono">NID: {r.nationalId}</span>}
                      {r.documentNo && <span className="font-mono">Doc: {r.documentNo}</span>}
                      <span>{new Date(r.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <ScoreBadge score={Math.round(r.docConfidence * 100)} label="OCR" threshold={60} />
                      <ScoreBadge score={Math.round(r.faceMatchScore)} label="Face" threshold={70} />
                      <ScoreBadge score={Math.round(r.livenessScore)} label="Live" threshold={70} />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(r)}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del(r.id)}>
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DetailDialog record={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function DetailDialog({ record, onClose }: { record: VerificationRecord | null; onClose: () => void }) {
  if (!record) return null;
  const meta = DOC_TYPES.find((d) => d.id === (record.docType as any));
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            Verification detail
            <StatusBadge status={record.status} />
          </DialogTitle>
          <DialogDescription>
            {meta?.label} · {new Date(record.createdAt).toLocaleString()} · ID {record.id}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {record.docImageFront && <ImgBlock label="Document front" src={record.docImageFront} />}
          {record.docImageBack && <ImgBlock label="Document back" src={record.docImageBack} />}
          {record.selfieImage && <ImgBlock label="Selfie" src={record.selfieImage} />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <MiniStat label="OCR confidence" value={`${Math.round(record.docConfidence * 100)}%`} />
          <MiniStat label="Image quality" value={record.imageQuality ? `${Math.round(record.imageQuality * 100)}%` : "—"} />
          <MiniStat label="Face match" value={`${Math.round(record.faceMatchScore)}%`} />
          <MiniStat label="Liveness" value={`${Math.round(record.livenessScore)}%`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <KV label="Name (Ar)" value={record.fullNameAr} ar />
          <KV label="Name (En)" value={record.fullNameEn} />
          <KV label="National ID" value={record.nationalId} mono />
          <KV label="Document No" value={record.documentNo} mono />
          <KV label="Date of birth" value={record.birthDate} />
          <KV label="Expiry" value={record.expiryDate} />
          <KV label="Gender" value={record.gender} />
          <KV label="Nationality" value={record.nationality} />
          <KV label="Address" value={record.address} />
          <KV label="Profession" value={record.job} />
          <KV label="Religion" value={record.religion} />
          <KV label="Marital status" value={record.maritalStatus} />
        </div>

        {record.notes && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>Notes:</strong> {record.notes}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ImgBlock({ label, src }: { label: string; src: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <img src={src} alt={label} className="w-full rounded-md border max-h-40 object-contain bg-black/5" />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function KV({ label, value, ar, mono }: { label: string; value?: string | null; ar?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b border-dashed py-1">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className={`font-medium text-right ${mono ? "font-mono text-xs" : ""}`} dir={ar ? "rtl" : "auto"} lang={ar ? "ar" : undefined}>
        {value || "—"}
      </span>
    </div>
  );
}
