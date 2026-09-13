import { NextRequest, NextResponse } from "next/server";
import { checkLivenessSelfHosted } from "@/lib/liveness-engine";
import { checkLiveness as checkLivenessConsensus, isConsensusModeActive } from "@/lib/vlm-service";
import { checkRateLimit } from "@/lib/rate-limit";
import type { LivenessAction, LivenessResult } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Liveness check endpoint — CONSENSUS MODE.
 *
 * Runs in parallel:
 *   1. Self-hosted liveness (port 3032 or in-process) — frame differencing
 *   2. AI Consensus: Gemini + OpenRouter + NVIDIA vision (parallel) + cross-check
 *
 * Final verdict: combine both signals.
 * If no AI providers configured, falls back to self-hosted only.
 */

async function callLivenessService(frames: string[], actions: LivenessAction[]) {
  try {
    const res = await fetch("http://localhost:3032/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frames, actions }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 60_000, prefix: "live" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const frames: string[] = body.frames || [];
    const actions: LivenessAction[] = body.actions || [];

    if (frames.length === 0) {
      return NextResponse.json({
        result: { isLive: false, score: 0, detectedActions: [], reasoning: "No frames captured." },
        engine: "consensus-merged",
      });
    }

    const consensusActive = isConsensusModeActive();

    // ── Run self-hosted + AI consensus in PARALLEL ────────────────
    const [selfHostedResult, consensusResult] = await Promise.allSettled([
      // Track 1: self-hosted liveness
      (async () => {
        const serviceResult = await callLivenessService(frames, actions);
        if (serviceResult && !serviceResult.error) return serviceResult as LivenessResult;
        return await checkLivenessSelfHosted(frames, actions);
      })(),
      // Track 2: AI consensus (Gemini + OpenRouter + NVIDIA in parallel)
      consensusActive ? checkLivenessConsensus(frames, actions) : Promise.resolve(null),
    ]);

    const selfHosted = selfHostedResult.status === "fulfilled" ? selfHostedResult.value : null;
    const consensus = consensusResult.status === "fulfilled" ? consensusResult.value : null;

    if (!selfHosted && !consensus) {
      return NextResponse.json({ error: "Liveness check failed on all engines" }, { status: 500 });
    }

    // MERGE
    let result: LivenessResult;
    if (selfHosted && consensus) {
      const score = Math.max(selfHosted.score || 0, consensus.score || 0);
      const bothAgree = selfHosted.isLive === consensus.isLive;
      const isLive = bothAgree
        ? selfHosted.isLive
        : (selfHosted.score >= 80 || consensus.score >= 80);

      const actions_ = Array.from(new Set([
        ...(selfHosted.detectedActions || []),
        ...(consensus.detectedActions || []),
      ]));

      result = {
        isLive,
        score,
        detectedActions: actions_,
        reasoning: `Cross-checked by self-hosted liveness (${selfHosted.score || 0}%) and AI consensus (${consensus.score || 0}%). ${consensus.reasoning || ""}`.trim(),
        consensus: consensus.consensus,
      };
    } else if (consensus) {
      result = consensus;
      result.reasoning = `AI consensus only. ${result.reasoning || ""}`.trim();
    } else {
      result = selfHosted!;
      result.reasoning = `Self-hosted only. ${result.reasoning || ""}`.trim();
    }

    return NextResponse.json({
      result,
      engine: consensusActive ? "consensus-merged" : "self-hosted",
      consensus: result.consensus,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Liveness check failed" }, { status: 500 });
  }
}
