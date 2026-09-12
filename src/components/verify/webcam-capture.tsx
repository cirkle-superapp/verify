"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, RefreshCw, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface WebcamCaptureProps {
  onCapture: (dataUrl: string) => void;
  capturedImage?: string | null;
  title?: string;
  subtitle?: string;
  /** mirror the video feed (selfie mode) */
  mirror?: boolean;
  /** aspect ratio for the overlay frame, e.g. "4/3", "3/4", "1/1" */
  aspect?: string;
  /** show a face oval guide */
  faceGuide?: boolean;
  /** capture button label */
  captureLabel?: string;
  retakeLabel?: string;
  /** constraints */
  facingMode?: "user" | "environment";
  className?: string;
}

export function WebcamCapture({
  onCapture,
  capturedImage,
  title,
  subtitle,
  mirror = false,
  aspect = "4/3",
  faceGuide = false,
  captureLabel = "Capture",
  retakeLabel = "Retake",
  facingMode = "environment",
  className,
}: WebcamCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const startStream = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 960 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (e: any) {
      const msg =
        e?.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access and retry."
          : e?.name === "NotFoundError"
          ? "No camera found on this device."
          : e?.message || "Could not start camera.";
      setError(msg);
    } finally {
      setStarting(false);
    }
  }, [facingMode]);

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  // Start camera automatically when there is no captured image
  useEffect(() => {
    if (!capturedImage && !ready && !starting && !error) {
      startStream();
    }
    if (capturedImage) {
      stopStream();
    }
  }, [capturedImage, ready, starting, error, startStream, stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 960;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    onCapture(dataUrl);
  }, [mirror, onCapture]);

  const retake = useCallback(() => {
    onCapture("");
    // restart stream
    setTimeout(() => startStream(), 50);
  }, [onCapture, startStream]);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {(title || subtitle) && (
        <div className="text-center space-y-1">
          {title && <h3 className="font-semibold text-base">{title}</h3>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      <div
        className="relative w-full overflow-hidden rounded-xl border-2 border-border bg-black"
        style={{ aspectRatio: aspect }}
      >
        {capturedImage ? (
          <img
            src={capturedImage}
            alt="Captured"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                "absolute inset-0 h-full w-full object-cover",
                mirror && "-scale-x-100"
              )}
            />
            {/* face guide overlay */}
            {faceGuide && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div
                  className="rounded-[50%] border-2 border-white/70 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]"
                  style={{ width: "55%", height: "78%" }}
                />
              </div>
            )}
            {/* corner accents */}
            <div className="pointer-events-none absolute left-3 top-3 h-6 w-6 border-l-2 border-t-2 border-white/80" />
            <div className="pointer-events-none absolute right-3 top-3 h-6 w-6 border-r-2 border-t-2 border-white/80" />
            <div className="pointer-events-none absolute bottom-3 left-3 h-6 w-6 border-b-2 border-l-2 border-white/80" />
            <div className="pointer-events-none absolute bottom-3 right-3 h-6 w-6 border-b-2 border-r-2 border-white/80" />
            {starting && (
              <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
                Starting camera…
              </div>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
          <CameraOff className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-center gap-2">
        {capturedImage ? (
          <>
            <Button variant="outline" onClick={retake} type="button">
              <RefreshCw className="h-4 w-4 mr-1" /> {retakeLabel}
            </Button>
            <Button variant="default" onClick={() => {}} type="button" disabled className="opacity-90">
              <Check className="h-4 w-4 mr-1" /> Captured
            </Button>
          </>
        ) : (
          <Button onClick={capture} disabled={!ready} type="button">
            <Camera className="h-4 w-4 mr-1" /> {captureLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
