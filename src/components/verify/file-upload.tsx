"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, RefreshCw, Check, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileUploadProps {
  onUpload: (dataUrl: string) => void;
  uploadedImage?: string | null;
  title?: string;
  subtitle?: string;
  aspect?: string;
  captureLabel?: string;
  retakeLabel?: string;
  className?: string;
}

/** Resize & compress an uploaded image file to a JPEG data URL.
 *  Allows LARGE photos through (up to ~1.8MB) so users aren't blocked.
 *  The server-side VLM service further normalizes if the AI rejects an image.
 */
function fileToCompressedDataUrl(
  file: File,
  maxSize = 1600,
  initialQuality = 0.85,
  maxBytes = 1800 * 1024 // ~1.8MB — allows large high-quality photos
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () =>
        reject(
          new Error(
            "Could not decode this image. If it's a HEIC photo from an iPhone, please convert it to JPG first."
          )
        );
      img.onload = () => {
        let { width, height } = img;
        // Only downscale if truly huge (>2200px). Otherwise keep original resolution
        // so OCR has maximum detail to work with.
        const HARD_MAX = 2200;
        if (width > HARD_MAX || height > HARD_MAX) {
          if (width >= height) {
            height = Math.round((height * HARD_MAX) / width);
            width = HARD_MAX;
          } else {
            width = Math.round((width * HARD_MAX) / height);
            height = HARD_MAX;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas error"));
        ctx.drawImage(img, 0, 0, width, height);

        // Iteratively lower quality to hit the byte budget.
        let quality = initialQuality;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (dataUrl.length > maxBytes * 1.37 && quality > 0.45) {
          quality = Math.max(0.45, quality - 0.1);
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }

        // If still too big, downscale the canvas and retry.
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

        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
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
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        if (!file.type.startsWith("image/")) {
          throw new Error("Please select an image file (JPG, PNG, etc).");
        }
        const dataUrl = await fileToCompressedDataUrl(file);
        onUpload(dataUrl);
      } catch (e: any) {
        setError(e?.message || "Could not load image.");
      } finally {
        setBusy(false);
      }
    },
    [onUpload]
  );

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
            <span className="text-sm font-medium">Click or drop image here</span>
            <span className="text-xs">JPG / PNG / WEBP (auto-compressed)</span>
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
