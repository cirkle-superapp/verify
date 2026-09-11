"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, ShieldCheck, RotateCcw, History, Loader2, Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useVerificationStore } from "@/lib/verification-store";
import { ScoreBadge, StatusBadge } from "@/components/verify/score-badge";
import { DOC_TYPES } from "@/lib/verification-types";
import { toast } from "sonner";

export function ResultStep({ onViewHistory }: { onViewHistory: () => void }) {
  const {
    docType,
    docFront,
    docBack,
    docExtracted,
    selfie,
    livenessActions,
    livenessFrames,
    livenessResult,
    faceMatch,
    recordId,
    setRecordId,
    isSubmitting,
    setSubmitting,
    reset,
  } = useVerificationStore();
  const meta = DOC_TYPES.find((d) => d.id === docType)!;

  useEffect(() => {
    if (recordId || isSubmitting) return;
    let cancelled = false;
    (async () => {
      setSubmitting(true);
      try {
        const res = await fetch("/api/verify/records", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType,
            docSide: meta.needsBack ? "both" : "front",
            docImageFront: docFront,
            docImageBack: docBack,
            docExtracted,
            selfieImage: selfie,
            livenessFrames,
            livenessActions,
            faceMatch,
            liveness: livenessResult,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || "Could not save record");
        setRecordId(json.record.id);
        toast.success("Verification record saved");
      } catch (e: any) {
        if (!cancelled) toast.error("Failed to save record");
      } finally {
        if (!cancelled) setSubmitting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const docScore = Math.round((docExtracted?.confidence ?? 0) * 100);
  const faceScore = Math.round(faceMatch?.similarity ?? 0);
  const livenessScore = Math.round(livenessResult?.score ?? 0);
  const overall = Math.round((docScore * 0.3 + faceScore * 0.4 + livenessScore * 0.3));

  const passed = docScore >= 60 && faceMatch?.isMatch && livenessResult?.isLive;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex">
          {passed ? (
            <div className="rounded-full bg-emerald-100 p-4">
              <CheckCircle2 className="h-14 w-14 text-emerald-600" />
            </div>
          ) : (
            <div className="rounded-full bg-rose-100 p-4">
              <XCircle className="h-14 w-14 text-rose-600" />
            </div>
          )}
        </div>
        <h1 className="text-3xl font-bold">
          {passed ? "Identity Verified" : "Verification Failed"}
        </h1>
        <p className="text-muted-foreground" dir="rtl" lang="ar">
          {passed ? "تم التحقق من الهوية بنجاح" : "فشل التحقق من الهوية"}
        </p>
        {recordId && (
          <div className="flex justify-center">
            <StatusBadge status={passed ? "verified" : "failed"} />
          </div>
        )}
      </div>

      {/* Overall score gauge */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm text-muted-foreground">Overall verification score</div>
              <div className="text-3xl font-bold">{overall}%</div>
            </div>
            <ShieldCheck className={`h-10 w-10 ${passed ? "text-emerald-600" : "text-rose-500"}`} />
          </div>
          <Progress value={overall} className={`h-2.5 ${passed ? "[&>div]:bg-emerald-500" : "[&>div]:bg-rose-500"}`} />
        </CardContent>
      </Card>

      {/* Score breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <ScoreCard label="Document OCR" labelAr="قراءة المستند" score={docScore} threshold={60} desc={docExtracted?.fullNameAr || docExtracted?.fullNameEn || "Extraction complete"} />
        <ScoreCard label="Face Match" labelAr="مطابقة الوجه" score={faceScore} threshold={70} desc={faceMatch?.isMatch ? "Same person" : "Low similarity"} />
        <ScoreCard label="Liveness" labelAr="الحياة" score={livenessScore} threshold={70} desc={livenessResult?.isLive ? "Live person" : "Not confirmed"} />
      </div>

      {/* summary detail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-600" /> Verification summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <Row label="Document type" value={`${meta.label} (${meta.labelAr})`} />
            <Row label="Name (Ar)" value={docExtracted?.fullNameAr} ar />
            <Row label="Name (En)" value={docExtracted?.fullNameEn} />
            <Row label="National ID" value={docExtracted?.nationalId} />
            <Row label="Document No" value={docExtracted?.documentNo} />
            <Row label="Date of birth" value={docExtracted?.birthDate} />
            <Row label="Gender" value={docExtracted?.gender} />
            <Row label="Address" value={docExtracted?.address} />
            <Row label="Movements performed" value={`${livenessActions.length} actions`} />
            <Row label="Frames analyzed" value={`${livenessFrames.length} frames`} />
            <Row label="Record ID" value={recordId ?? "—"} mono />
          </div>
        </CardContent>
      </Card>

      {/* Images */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {docFront && <ImgCard label="Document front" src={docFront} />}
        {docBack && <ImgCard label="Document back" src={docBack} />}
        {selfie && <ImgCard label="Selfie" src={selfie} />}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {isSubmitting && (
          <Button disabled>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving record…
          </Button>
        )}
        {!isSubmitting && (
          <>
            <Button onClick={reset} size="lg">
              <RotateCcw className="h-4 w-4 mr-2" /> New verification
            </Button>
            <Button variant="outline" onClick={onViewHistory}>
              <History className="h-4 w-4 mr-2" /> View history
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function ScoreCard({ label, labelAr, score, threshold, desc }: { label: string; labelAr: string; score: number; threshold: number; desc?: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-emerald-700 font-arabic" dir="rtl" lang="ar">{labelAr}</div>
          </div>
          <ScoreBadge score={score} threshold={threshold} />
        </div>
        <Progress value={score} className={`h-1.5 ${score >= threshold ? "[&>div]:bg-emerald-500" : "[&>div]:bg-rose-500"}`} />
        {desc && <div className="text-xs text-muted-foreground truncate" dir="auto">{desc}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, ar, mono }: { label: string; value?: string | null; ar?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-dashed py-1.5">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span
        className={`font-medium text-right ${mono ? "font-mono text-xs" : ""}`}
        dir={ar ? "rtl" : "auto"}
        lang={ar ? "ar" : undefined}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function ImgCard({ label, src }: { label: string; src: string }) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <img src={src} alt={label} className="w-full rounded-md border max-h-48 object-contain bg-black/5" />
      </CardContent>
    </Card>
  );
}
