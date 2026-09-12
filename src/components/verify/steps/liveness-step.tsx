"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowLeft, Loader2, Play, CheckCircle2, XCircle, RotateCcw, Hand, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useVerificationStore } from "@/lib/verification-store";
import { LIVENESS_ACTIONS, type LivenessAction } from "@/lib/verification-types";
import { LivenessWebcam } from "@/components/verify/liveness-webcam";
import { ScoreBadge } from "@/components/verify/score-badge";
import { toast } from "sonner";

const FRAMES_PER_ACTION = 5;
const SECONDS_PER_ACTION = 4;

export function LivenessStep() {
  const { livenessActions, livenessFrames, addLivenessFrame, clearLivenessFrames, setLivenessResult, livenessResult, goNext, setStep, selfie } =
    useVerificationStore();

  const [phase, setPhase] = useState<"preview" | "performing" | "done" | "analyzing">("preview");
  const [actionIdx, setActionIdx] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_ACTION);
  const [framesThisAction, setFramesThisAction] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const currentAction: LivenessAction | null = livenessActions[actionIdx] ?? null;
  const currentMeta = currentAction ? LIVENESS_ACTIONS.find((a) => a.id === currentAction)! : null;

  // countdown + frame-count tracking
  useEffect(() => {
    if (phase !== "performing") return;
    setSecondsLeft(SECONDS_PER_ACTION);
    setFramesThisAction(0);
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000;
      const left = Math.max(0, SECONDS_PER_ACTION - elapsed);
      setSecondsLeft(left);
      if (left <= 0) {
        clearInterval(tick);
        // advance to next action or finish
        if (actionIdx < livenessActions.length - 1) {
          setActionIdx((i) => i + 1);
        } else {
          setPhase("done");
        }
      }
    }, 100);
    return () => clearInterval(tick);
  }, [phase, actionIdx, livenessActions.length]);

  const onFrame = useCallback(
    (dataUrl: string) => {
      if (phase !== "performing") return;
      // limit total frames to avoid huge payload
      if (livenessFrames.length >= FRAMES_PER_ACTION * livenessActions.length + 2) return;
      addLivenessFrame(dataUrl);
      setFramesThisAction((n) => n + 1);
    },
    [phase, livenessFrames.length, livenessActions.length, addLivenessFrame]
  );

  // when entering "done" phase, run the analysis exactly once
  const analyzedRef = useRef(false);
  useEffect(() => {
    if (phase !== "done") return;
    if (analyzedRef.current) return;
    analyzedRef.current = true;
    let cancelled = false;
    (async () => {
      setPhase("analyzing");
      setError(null);
      try {
        if (livenessFrames.length === 0) {
          throw new Error("No frames were captured — your camera may be unavailable or blocked. Please redo the challenge with camera access enabled.");
        }
        const res = await fetch("/api/verify/liveness", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            frames: livenessFrames,
            actions: livenessActions,
          }),
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.error || "Liveness check failed");
        setLivenessResult(json.result);
        if (json.result?.isLive) {
          toast.success(`Liveness verified (${Math.round(json.result.score)}%)`);
        } else {
          toast.warning(`Liveness check scored ${Math.round(json.result?.score ?? 0)}%`);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to analyze liveness");
          toast.error("Liveness analysis failed");
        }
      } finally {
        if (!cancelled) setPhase("done");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, livenessFrames, livenessActions, setLivenessResult]);

  const startChallenge = () => {
    clearLivenessFrames();
    setLivenessResult(null);
    setError(null);
    analyzedRef.current = false;
    setActionIdx(0);
    setPhase("performing");
  };

  const restartChallenge = () => {
    clearLivenessFrames();
    setLivenessResult(null);
    setError(null);
    analyzedRef.current = false;
    setActionIdx(0);
    setPhase("preview");
  };

  const totalProgress = livenessActions.length === 0 ? 0 : ((actionIdx + (phase === "performing" ? 0 : 1)) / livenessActions.length) * 100;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Live movement check</h2>
        <p className="text-muted-foreground" dir="rtl" lang="ar">فحص الحركة الحية — أدر رأسك بحسب التعليمات</p>
      </div>

      <Alert>
        <Activity className="h-4 w-4" />
        <AlertTitle>How liveness works</AlertTitle>
        <AlertDescription>
          You will be asked to perform <strong>{livenessActions.length} quick movements</strong>.
          The camera captures a few frames during each movement. Our AI verifies the motion is
          real — this protects against photos or screen replays.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <LivenessWebcam
            action={currentAction}
            phase={phase === "analyzing" ? "done" : phase}
            onFrame={onFrame}
            frameCount={framesThisAction}
            framesPerAction={FRAMES_PER_ACTION}
            secondsLeft={Math.ceil(secondsLeft)}
          />

          {phase === "preview" && (
            <div className="mt-3 flex justify-center">
              <Button size="lg" onClick={startChallenge}>
                <Play className="h-4 w-4 mr-2" /> Start movement challenge
              </Button>
            </div>
          )}

          {phase === "done" && livenessResult && (
            <div className="mt-3 flex justify-center">
              <Button variant="outline" onClick={restartChallenge}>
                <RotateCcw className="h-4 w-4 mr-2" /> Redo challenge
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {/* action checklist */}
          <Card>
            <CardContent className="p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Hand className="h-4 w-4 text-teal-600" /> Movement sequence
              </h3>
              <ol className="space-y-2">
                {livenessActions.map((a, i) => {
                  const m = LIVENESS_ACTIONS.find((x) => x.id === a)!;
                  const done = phase === "done" || phase === "analyzing" || i < actionIdx;
                  const active = i === actionIdx && phase === "performing";
                  return (
                    <li
                      key={a}
                      className={`flex items-center gap-3 rounded-lg border p-2.5 transition ${
                        active ? "border-teal-500 bg-teal-50" : done ? "border-teal-200 bg-teal-50/50" : "border-border"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                          done ? "bg-teal-600 text-white" : active ? "bg-teal-500 text-white animate-pulse" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? "✓" : i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">{m.label}</div>
                        <div className="text-xs text-teal-700 font-arabic" dir="rtl" lang="ar">{m.labelAr}</div>
                      </div>
                      {active && (
                        <span className="text-xs font-mono tabular-nums text-teal-700">{Math.ceil(secondsLeft)}s</span>
                      )}
                    </li>
                  );
                })}
              </ol>

              {(phase === "performing" || phase === "analyzing") && (
                <div className="mt-3">
                  <Progress value={totalProgress} className="h-1.5" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* live instruction */}
          {phase === "performing" && currentMeta && (
            <Card className="border-teal-300">
              <CardContent className="p-5 text-center">
                <div className="text-lg font-bold" dir="rtl" lang="ar">{currentMeta.instructionAr}</div>
                <div className="text-sm text-muted-foreground">{currentMeta.instruction}</div>
              </CardContent>
            </Card>
          )}

          {/* result */}
          {phase === "analyzing" && (
            <Card>
              <CardContent className="p-5 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
                  Analyzing captured frames for liveness…
                </div>
                <Progress value={80} className="h-1.5" />
              </CardContent>
            </Card>
          )}

          {phase === "done" && livenessResult && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  {livenessResult.isLive ? (
                    <CheckCircle2 className="h-10 w-10 text-teal-600" />
                  ) : (
                    <XCircle className="h-10 w-10 text-rose-600" />
                  )}
                  <div className="space-y-1">
                    <div className="font-semibold">
                      {livenessResult.isLive ? "Live person confirmed" : "Liveness not confirmed"}
                    </div>
                    <ScoreBadge score={livenessResult.score} label="Liveness" threshold={70} />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{livenessResult.reasoning}</p>
                {livenessResult.detectedActions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {livenessResult.detectedActions.map((a) => {
                      const m = LIVENESS_ACTIONS.find((x) => x.id === a);
                      return m ? (
                        <span key={a} className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs text-teal-700">
                          <CheckCircle2 className="h-3 w-3" /> {m.label}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Liveness analysis failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => setStep("selfie")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <Button onClick={goNext} disabled={phase !== "done" || (!livenessResult && !error)}>
          See verification result <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
