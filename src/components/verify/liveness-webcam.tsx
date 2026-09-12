"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LivenessAction } from "@/lib/verification-types";
import { LIVENESS_ACTIONS } from "@/lib/verification-types";

interface LivenessWebcamProps {
  /** the current action being requested */
  action: LivenessAction | null;
  /** phase of the liveness flow */
  phase: "idle" | "preview" | "performing" | "done";
  /** called every time a frame is captured during performing phase */
  onFrame: (dataUrl: string) => void;
  /** number of frames captured so far */
  frameCount: number;
  /** target frames to capture per action */
  framesPerAction: number;
  /** seconds remaining in the action */
  secondsLeft: number;
  className?: string;
}

export function LivenessWebcam({
  action,
  phase,
  onFrame,
  frameCount,
  framesPerAction,
  secondsLeft,
  className,
}: LivenessWebcamProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    if (captureTimerRef.current) {
      clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setReady(false);
  }, []);

  const startStream = useCallback(async () => {
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);
    } catch (e: any) {
      setError(
        e?.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access."
          : e?.message || "Could not start camera."
      );
    }
  }, []);

  // start/stop stream based on phase
  useEffect(() => {
    if (phase === "idle" || phase === "done") {
      stopStream();
    } else if (!streamRef.current) {
      startStream();
    }
    return () => {
      if (phase === "idle" || phase === "done") stopStream();
    };
  }, [phase, startStream, stopStream]);

  // capture frames on an interval while performing
  useEffect(() => {
    if (phase !== "performing" || !ready) return;
    if (captureTimerRef.current) clearInterval(captureTimerRef.current);
    captureTimerRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      const canvas = document.createElement("canvas");
      // downscale to keep payload small
      const scale = Math.min(1, 480 / Math.max(w, h));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // mirror to match preview
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      onFrame(dataUrl);
    }, 700); // capture a frame every 700ms
    return () => {
      if (captureTimerRef.current) {
        clearInterval(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    };
  }, [phase, ready, onFrame]);

  const actionMeta = action ? LIVENESS_ACTIONS.find((a) => a.id === action) : null;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative w-full overflow-hidden rounded-xl border-2 border-border bg-black" style={{ aspectRatio: "3/4" }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn("absolute inset-0 h-full w-full object-cover -scale-x-100")}
        />
        {/* face oval */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="rounded-[50%] border-2 border-white/80 shadow-[0_0_0_2000px_rgba(0,0,0,0.4)]"
            style={{ width: "62%", height: "82%" }}
          />
        </div>

        {/* big instruction overlay */}
        {phase === "performing" && actionMeta && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-4 pt-10 text-center text-white">
            <div className="text-2xl font-bold drop-shadow">{actionMeta.instructionAr}</div>
            <div className="text-sm opacity-90">{actionMeta.instruction}</div>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs">
              <span className="font-mono text-base tabular-nums">{secondsLeft}s</span>
              <span className="opacity-80">left</span>
              <span className="opacity-60">•</span>
              <span>frame {Math.min(frameCount + 1, framesPerAction)}/{framesPerAction}</span>
            </div>
          </div>
        )}

        {phase === "preview" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10 text-center text-white">
            <div className="text-sm opacity-90">Position your face inside the oval</div>
          </div>
        )}

        {phase === "done" && (
          <div className="absolute inset-0 flex items-center justify-center bg-teal-600/80 text-white font-semibold">
            Done capturing frames
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-rose-300">
            <CameraOff className="h-6 w-6" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
            <Camera className="h-5 w-5 mr-2" /> Starting camera…
          </div>
        )}
      </div>
    </div>
  );
}
