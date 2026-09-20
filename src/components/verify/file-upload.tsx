"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import { Upload, RefreshCw, Check, ImageIcon, Wand2, Gauge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  autoAdjustImage,
  type AutoAdjustResult,
  type ImageQualityReport,
  type DocType,
} from "@/lib/image-auto-adjust";

interface FileUploadProps {
  onUpload: (dataUrl: string) => void;
  uploadedImage?: string | null;
  title?: string;
  subtitle?: string;
  aspect?: string;
  captureLabel?: string;
  retakeLabel?: string;
  className?: string;
  /** Document type — drives optimal resize + quality thresholds. */
  docType?: DocType | string;
  /** Optional callback fired with the full auto-adjust report. */
  onQualityReport?: (report: AutoAdjustResult) => void;
}

// ─── Quality report → toast rendering ────────────────────────────────

const OVERALL_STYLES: Record<
  ImageQualityReport["overall"],
  { color: "success" | "info" | "warning" | "error"; icon: string; tone: string }
> = {
  excellent: { color: "success", icon: "✅", tone: "Excellent" },
  good: { color: "success", icon: "✅", tone: "Good" },
  acceptable: { color: "warning", icon: "⚠️", tone: "Acceptable" },
  poor: { color: "error", icon: "⛔", tone: "Poor" },
};

/** Render a compact, human-readable quality toast. */
function showQualityToast(report: AutoAdjustResult): void {
  const q = report.quality;
  const style = OVERALL_STYLES[q.overall];
  const title = `${style.icon} Image quality: ${style.tone} (score ${q.score}/100)`;

  const head = [
    `${report.adjustedSize.width}×${report.adjustedSize.height}px`,
    `${Math.round(report.adjustedSize.bytes / 1024)}KB`,
    `${report.processingTimeMs}ms`,
  ];
  if (report.cropped) {
    head.push(`auto-crop ✓ (${(report.cropConfidence * 100).toFixed(0)}%)`);
  }
  if (report.rotated) {
    head.push(`EXIF rotated (orientation ${report.exifOrientation})`);
  }
  if (report.adjustments.reasons.length > 0) {
    head.push(`${report.adjustments.reasons.length} enhancements`);
  }

  // Compose the body: lines of recommendations, capped at 4
  const recommendations = q.issues
    .slice(0, 4)
    .map((issue) => {
      const icon = issue.severity === "high" ? "⛔" : issue.severity === "medium" ? "⚠️" : "ℹ️";
      return `${icon} ${issue.recommendation}`;
    });

  const metrics = [
    `sharpness ${q.metrics.sharpness}`,
    `brightness ${q.metrics.brightness}`,
    `contrast ${q.metrics.contrast}`,
    `glare ${(q.metrics.glare * 100).toFixed(1)}%`,
    `skew ${q.metrics.skew}°`,
    `dpi ${q.metrics.resolution.dpi}`,
  ];

  const description = [
    head.join(" · "),
    recommendations.length > 0 ? recommendations.join("\n") : "All metrics within target range.",
    `Metrics: ${metrics.join(" · ")}`,
  ].join("\n\n");

  // Pick the right sonner helper
  if (style.color === "success") {
    toast.success(title, { description });
  } else if (style.color === "warning") {
    toast.warning(title, { description });
  } else if (style.color === "error") {
    toast.error(title, { description });
  } else {
    toast.info(title, { description });
  }
}

export function FileUpload({
  onUpload,
  uploadedImage,
  title,
  subtitle,
  aspect = "4/3",
  captureLabel = "Upload Photo",
  retakeLabel = "Replace",
  className,
  docType = "national_id",
  onQualityReport,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Auto-adjust toggle (default ON). When OFF, falls back to raw upload.
  const [autoAdjust, setAutoAdjust] = useState(true);
  // Last quality report — surfaced as a hint badge under the upload.
  const [lastReport, setLastReport] = useState<AutoAdjustResult | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        if (!file.type.startsWith("image/")) {
          throw new Error("Please select an image file (JPG, PNG, etc).");
        }

        if (autoAdjust) {
          const result = await autoAdjustImage(file, {
            docType,
            crop: true,
            enhance: true,
            rotate: true,
            maxSize: 2200,
          });
          setLastReport(result);
          onQualityReport?.(result);
          onUpload(result.dataUrl);
          showQualityToast(result);
        } else {
          // Raw fallback — just decode + compress, no enhancements.
          const dataUrl = await fileToRawCompressedDataUrl(file);
          setLastReport(null);
          onUpload(dataUrl);
          toast.info("Uploaded (raw — no auto-adjust)", {
            description: `${file.name} · ${Math.round(file.size / 1024)}KB`,
          });
        }
      } catch (e: any) {
        setError(
          e?.message ||
            "Could not process image. Try a different file or disable auto-adjust."
        );
        toast.error("Image processing failed", {
          description: e?.message || "Unknown error",
        });
      } finally {
        setBusy(false);
      }
    },
    [autoAdjust, docType, onUpload, onQualityReport]
  );

  // Compact inline badge for the upload box (shown only when a report exists)
  const qualityBadge = useMemo(() => {
    if (!lastReport) return null;
    const q = lastReport.quality;
    const palette: Record<string, string> = {
      excellent: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
      good: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
      acceptable: "bg-amber-500/10 text-amber-700 border-amber-500/30",
      poor: "bg-rose-500/10 text-rose-700 border-rose-500/30",
    };
    return (
      <div
        className={cn(
          "absolute top-2 right-2 z-10 rounded-md border px-2 py-1 text-xs font-medium backdrop-blur",
          palette[q.overall] || palette.acceptable
        )}
      >
        {q.overall} · {q.score}/100
      </div>
    );
  }, [lastReport]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {(title || subtitle) && (
        <div className="text-center space-y-1">
          {title && <h3 className="font-semibold text-base">{title}</h3>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}

      <div
        className="relative w-full overflow-hidden rounded-xl border-2 border-dashed border-border bg-muted/30"
        style={{ aspectRatio: aspect }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
      >
        {qualityBadge}
        {uploadedImage ? (
          <img
            src={uploadedImage}
            alt="Uploaded document"
            className="absolute inset-0 h-full w-full object-contain bg-black/5"
          />
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/50 transition",
              dragOver && "bg-primary/10 text-primary"
            )}
          >
            {busy ? (
              <RefreshCw className="h-7 w-7 animate-spin" />
            ) : (
              <Upload className="h-7 w-7" />
            )}
            <span className="text-sm font-medium">
              {busy ? "Processing…" : "Click or drop image here"}
            </span>
            <span className="text-xs">
              JPG / PNG / WEBP {autoAdjust ? "· auto-adjusted" : "· raw upload"}
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Auto-adjust toggle — gives the user control over the pipeline */}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          <div className="flex flex-col">
            <Label htmlFor="auto-adjust-toggle" className="text-sm font-medium cursor-pointer">
              Auto-adjust
            </Label>
            <span className="text-xs text-muted-foreground">
              EXIF · auto-crop · enhance · resize · quality check
            </span>
          </div>
        </div>
        <Switch
          id="auto-adjust-toggle"
          checked={autoAdjust}
          onCheckedChange={setAutoAdjust}
          disabled={busy}
        />
      </div>

      {/* Show top recommendation when a quality report exists */}
      {lastReport && lastReport.quality.issues.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <Gauge className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {lastReport.quality.issues[0].recommendation}
            {lastReport.quality.issues.length > 1 && (
              <span className="text-muted-foreground">
                {" "}
                · +{lastReport.quality.issues.length - 1} more
              </span>
            )}
          </span>
        </div>
      )}

      <div className="flex justify-center gap-2">
        {uploadedImage ? (
          <>
            <Button variant="outline" onClick={() => inputRef.current?.click()} type="button">
              <RefreshCw className="h-4 w-4 mr-1" /> {retakeLabel}
            </Button>
            <Button variant="default" disabled type="button" className="opacity-90">
              <Check className="h-4 w-4 mr-1" /> Uploaded
            </Button>
          </>
        ) : (
          <Button onClick={() => inputRef.current?.click()} disabled={busy} type="button">
            {busy ? <RefreshCw className="h-4 w-4 mr-1 animate-spin" /> : <ImageIcon className="h-4 w-4 mr-1" />}
            {captureLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Raw fallback (auto-adjust disabled) ──────────────────────────────

/**
 * Minimal resize+compress fallback when the user disables auto-adjust.
 * Mirrors the original behavior — cap at 2200px, <1.8MB JPEG.
 */
function fileToRawCompressedDataUrl(
  file: File,
  maxSize = 2200,
  initialQuality = 0.85,
  maxBytes = 1800 * 1024
): Promise<string> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(blobUrl);
    img.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Could not decode this image. If it's a HEIC photo from an iPhone, please convert it to JPG first."
        )
      );
    };
    img.onload = () => {
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (width > maxSize || height > maxSize) {
        if (width >= height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        return reject(new Error("Canvas error"));
      }
      ctx.drawImage(img, 0, 0, width, height);
      let quality = initialQuality;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > maxBytes * 1.37 && quality > 0.45) {
        quality = Math.max(0.45, quality - 0.1);
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      let scale = 1;
      while (dataUrl.length > maxBytes * 1.37 && scale > 0.5) {
        scale = Math.round(scale * 0.85 * 10) / 10;
        const sw = Math.max(1, Math.round(width * scale));
        const sh = Math.max(1, Math.round(height * scale));
        const c2 = document.createElement("canvas");
        c2.width = sw;
        c2.height = sh;
        const cx2 = c2.getContext("2d");
        if (!cx2) break;
        cx2.drawImage(img, 0, 0, sw, sh);
        dataUrl = c2.toDataURL("image/jpeg", Math.max(0.55, quality));
      }
      cleanup();
      resolve(dataUrl);
    };
    img.src = blobUrl;
  });
}
