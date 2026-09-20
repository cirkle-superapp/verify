"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Circle, X, FileText, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/components/i18n/use-i18n";

export type OcrStageId =
  | "loadingImage"
  | "preprocessing"
  | "arabicOcr"
  | "englishOcr"
  | "mrzParsing"
  | "crossField"
  | "done";

export interface OcrStage {
  id: OcrStageId;
  /** Translation key under `ocr.feedback.stage.<id>` */
  key: string;
  /** Approximate weight (out of 100) this stage contributes to overall progress. */
  weight: number;
}

/** Fixed 7-stage pipeline. The component always renders these in order. */
export const OCR_STAGES: OcrStage[] = [
  { id: "loadingImage", key: "ocr.feedback.stage.loadingImage", weight: 8 },
  { id: "preprocessing", key: "ocr.feedback.stage.preprocessing", weight: 15 },
  { id: "arabicOcr", key: "ocr.feedback.stage.arabicOcr", weight: 28 },
  { id: "englishOcr", key: "ocr.feedback.stage.englishOcr", weight: 20 },
  { id: "mrzParsing", key: "ocr.feedback.stage.mrzParsing", weight: 14 },
  { id: "crossField", key: "ocr.feedback.stage.crossField", weight: 13 },
  { id: "done", key: "ocr.feedback.stage.done", weight: 2 },
];

export type OcrStageState = "pending" | "active" | "complete";

/** A partial result message ("Detected: …"). */
export interface OcrPartialResult {
  field: string;
  value: string;
  confidence?: number;
}

interface OcrFeedbackProps {
  /** When true, run the simulated progress pipeline. */
  active: boolean;
  /** Called when the user clicks cancel. */
  onCancel: () => void;
  /** Called when the pipeline reaches the "done" stage. */
  onComplete?: () => void;
  /** Optional pre-seeded partial results (e.g. when real results come in via SSE). */
  externalResults?: OcrPartialResult[];
  /** Optional pre-seeded stage (used by parent to skip ahead). */
  startStage?: OcrStageId;
  /** Render inside a Card (default true). */
  card?: boolean;
}

/** Map a stage id to its cumulative-progress percentage at completion. */
function stageEndProgress(stageIdx: number): number {
  let sum = 0;
  for (let i = 0; i <= stageIdx; i++) sum += OCR_STAGES[i].weight;
  return Math.min(100, sum);
}

/** Approximate duration (ms) per stage for the simulated progress. */
const STAGE_DURATIONS: Record<OcrStageId, number> = {
  loadingImage: 250,
  preprocessing: 600,
  arabicOcr: 2200,
  englishOcr: 1600,
  mrzParsing: 700,
  crossField: 500,
  done: 150,
};

/**
 * Real-time OCR feedback panel.
 *
 * Shows a 7-stage progress pipeline: loading image → pre-processing → Arabic
 * OCR → English OCR → MRZ parsing → cross-field validation → done.
 * Each stage shows ✓ when complete, a spinner when active, or a dim circle
 * when pending. Partial results stream in below.
 *
 * The component *simulates* progress for now (no real SSE backend) but is
 * designed so externalResults can be pushed in incrementally to drive the
 * real flow later.
 */
export function OcrFeedback({
  active,
  onCancel,
  onComplete,
  externalResults,
  startStage,
  card = true,
}: OcrFeedbackProps) {
  const { t } = useI18n();
  const [stageIdx, setStageIdx] = useState(0);
  const [progress, setProgress] = useState(0);
  const [partial, setPartial] = useState<OcrPartialResult[]>([]);
  const [cancelled, setCancelled] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const completedRef = useRef(false);

  // Reset when (de)activated.
  // Note: queueMicrotask is used so the setState calls happen inside a callback,
  // not synchronously in the effect body (avoids the cascading-render lint rule).
  useEffect(() => {
    if (active) {
      queueMicrotask(() => {
        setCancelled(false);
        completedRef.current = false;
        setStageIdx(0);
        setProgress(0);
        setPartial([]);
      });
    }
  }, [active]);

  // Clear all timers on unmount.
  useEffect(() => {
    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, []);

  // If startStage is provided, jump to that stage.
  // Wrapped in queueMicrotask so the setState calls happen inside a callback.
  useEffect(() => {
    if (!startStage) return;
    const idx = OCR_STAGES.findIndex((s) => s.id === startStage);
    if (idx >= 0 && idx > stageIdx) {
      queueMicrotask(() => {
        setStageIdx(idx);
        setProgress(stageEndProgress(idx - 1));
      });
    }
  }, [startStage, stageIdx]);

  // Merge external results into the partial list.
  // Wrapped in queueMicrotask so the setState call happens inside a callback.
  useEffect(() => {
    if (externalResults && externalResults.length > 0) {
      queueMicrotask(() => {
        setPartial((prev) => {
          const seen = new Set(prev.map((p) => p.field));
          const merged = [...prev];
          for (const r of externalResults) {
            if (!seen.has(r.field)) merged.push(r);
            else {
              const idx = merged.findIndex((p) => p.field === r.field);
              if (idx >= 0) merged[idx] = r;
            }
          }
          return merged;
        });
      });
    }
  }, [externalResults]);

  // Drive the simulated progress pipeline.
  useEffect(() => {
    if (!active || cancelled) return;
    if (stageIdx >= OCR_STAGES.length) return;

    const stage = OCR_STAGES[stageIdx];
    const startPct = stageIdx === 0 ? 0 : stageEndProgress(stageIdx - 1);
    const endPct = stageEndProgress(stageIdx);
    const duration = STAGE_DURATIONS[stage.id];

    // Animate progress smoothly within the stage.
    const stepMs = 60;
    const steps = Math.max(1, Math.floor(duration / stepMs));
    const perStep = (endPct - startPct) / steps;

    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      setProgress(Math.min(endPct, startPct + perStep * step));
      if (step >= steps) {
        clearInterval(interval);
        // Inject a fake partial result for some stages (simulated stream).
        if (stage.id === "arabicOcr") {
          setPartial((p) =>
            p.some((x) => x.field === t("ocr.feedback.detected") + " — name")
              ? p
              : [
                  ...p,
                  { field: "name", value: "محمد أحمد", confidence: 0.92 },
                ],
          );
        }
        if (stage.id === "englishOcr") {
          setPartial((p) =>
            p.some((x) => x.field === "national_id")
              ? p
              : [
                  ...p,
                  { field: "national_id", value: "29608010101234", confidence: 0.88 },
                ],
          );
        }
        if (stage.id === "mrzParsing") {
          setPartial((p) =>
            p.some((x) => x.field === "document_no")
              ? p
              : [
                  ...p,
                  { field: "document_no", value: "A12345678", confidence: 0.85 },
                ],
          );
        }
        // Advance to the next stage.
        const nextIdx = stageIdx + 1;
        setStageIdx(nextIdx);
        if (nextIdx >= OCR_STAGES.length - 1) {
          setProgress(100);
          if (!completedRef.current) {
            completedRef.current = true;
            // Fire onComplete shortly after the "done" stage shows.
            const t1 = setTimeout(() => {
              onComplete?.();
            }, 250);
            timersRef.current.push(t1);
          }
        }
      }
    }, stepMs);

    timersRef.current.push(interval as unknown as ReturnType<typeof setTimeout>);
    return () => clearInterval(interval);
  }, [active, cancelled, stageIdx, onComplete]);

  const handleCancel = useCallback(() => {
    setCancelled(true);
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    onCancel();
  }, [onCancel]);

  const stagesState: OcrStageState[] = OCR_STAGES.map((_, i) => {
    if (cancelled) return "pending";
    if (i < stageIdx) return "complete";
    if (i === stageIdx && stageIdx < OCR_STAGES.length - 1) return "active";
    if (i === stageIdx && stageIdx === OCR_STAGES.length - 1 && progress >= 100) return "complete";
    return "pending";
  });

  const content = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-teal-600 shrink-0" />
            <h3 className="text-sm font-semibold">{t("ocr.feedback.title")}</h3>
          </div>
          <p className="text-xs text-muted-foreground">{t("ocr.feedback.subtitle")}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={cancelled || progress >= 100}
          className="shrink-0 h-7"
        >
          <X className="h-3.5 w-3.5 mr-1" /> {t("ocr.feedback.cancel")}
        </Button>
      </div>

      <Progress value={progress} className="h-1.5" />

      <ol className="space-y-1.5">
        {OCR_STAGES.map((stage, i) => {
          const state = stagesState[i];
          const label = t(stage.key);
          return (
            <li
              key={stage.id}
              className={`flex items-center gap-2 text-xs transition-opacity ${
                state === "pending" ? "opacity-40" : "opacity-100"
              }`}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center shrink-0">
                {state === "complete" && (
                  <CheckCircle2 className="h-4 w-4 text-teal-600" />
                )}
                {state === "active" && (
                  <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
                )}
                {state === "pending" && (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </span>
              <span
                className={
                  state === "active"
                    ? "font-semibold text-teal-700"
                    : state === "complete"
                    ? "text-teal-700 line-through decoration-teal-300"
                    : "text-muted-foreground"
                }
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Partial results */}
      <div className="rounded-md bg-muted/40 px-3 py-2 min-h-[2.5rem]">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          {t("ocr.feedback.detected")}
        </div>
        {partial.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            {t("ocr.feedback.noPartialResults")}
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {partial.map((p, i) => (
                <motion.div
                  key={p.field + i}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="text-xs flex items-baseline gap-2"
                  dir="auto"
                >
                  <span className="font-mono text-muted-foreground shrink-0">{p.field}:</span>
                  <span className="font-medium break-all">{p.value}</span>
                  {p.confidence !== undefined && (
                    <span className="text-[10px] font-mono text-teal-700 ml-auto shrink-0">
                      {Math.round(p.confidence * 100)}%
                    </span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {cancelled && (
        <div className="text-xs text-amber-700 font-medium">{t("ocr.feedback.cancelled")}</div>
      )}
    </div>
  );

  if (!card) return content;
  return (
    <Card>
      <CardContent className="p-4">{content}</CardContent>
    </Card>
  );
}
