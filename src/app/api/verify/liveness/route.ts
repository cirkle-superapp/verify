import { NextRequest, NextResponse } from "next/server";
import { checkLivenessSelfHosted } from "@/lib/liveness-engine";
import { checkLivenessPro, proToLegacyResult, type LivenessProScore } from "@/lib/liveness-pro";
import { checkLiveness as checkLivenessConsensus, isConsensusModeActive } from "@/lib/vlm-service";
import { checkRateLimit } from "@/lib/rate-limit";
import type { LivenessAction, LivenessResult } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Liveness check endpoint — CONSENSUS MODE + LIVENESS PRO.
 *
 * Runs in parallel:
 *   1. Self-hosted liveness (port 3032 or in-process) — frame differencing
 *   2. Liveness Pro — directional motion + challenge-response + anti-spoofing
 *   3. AI Consensus: Gemini + OpenRouter + NVIDIA vision (parallel) + cross-check
 *
 * Final verdict: combine all signals.
 * The Liveness Pro result provides a detailed breakdown for the UI.
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

    // ── Run self-hosted + liveness-pro + AI consensus in PARALLEL ────
    const [selfHostedResult, proResult, consensusResult] = await Promise.allSettled([
      // Track 1: self-hosted liveness (basic frame diff)
      (async () => {
        const serviceResult = await callLivenessService(frames, actions);
        if (serviceResult && !serviceResult.error) return serviceResult as LivenessResult;
        return await checkLivenessSelfHosted(frames, actions);
      })(),
      // Track 2: Liveness Pro (directional motion + anti-spoofing)
      checkLivenessPro(frames, actions),
      // Track 3: AI consensus (Gemini + OpenRouter + NVIDIA in parallel)
      consensusActive ? checkLivenessConsensus(frames, actions) : Promise.resolve(null),
    ]);

    const selfHosted = selfHostedResult.status === "fulfilled" ? selfHostedResult.value : null;
    const pro = proResult.status === "fulfilled" ? proResult.value : null;
    const consensus = consensusResult.status === "fulfilled" ? consensusResult.value : null;

    if (!selfHosted && !pro && !consensus) {
      return NextResponse.json({ error: "Liveness check failed on all engines" }, { status: 500 });
    }

    // MERGE: combine all 3 signals
    let result: LivenessResult;
    let proScore: LivenessProScore | null = pro;

    const scores: number[] = [];
    if (selfHosted?.score) scores.push(selfHosted.score);
    if (pro?.totalScore) scores.push(pro.totalScore);
    if (consensus?.score) scores.push(consensus.score);
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Live requires: at least 2 engines agree it's live, OR one engine very high
    const liveVotes = [selfHosted?.isLive, pro?.isLive, consensus?.isLive].filter((v) => v === true).length;
    const isLive = liveVotes >= 2 || maxScore >= 80;

    if (pro) {
      // Liveness Pro provides the detailed breakdown
      result = proToLegacyResult(pro);
      result.score = maxScore; // use the best score from all engines
      result.isLive = isLive;
      result.reasoning = [
        `Pro: ${pro.totalScore}/100 (motion ${pro.motionScore}/40, challenge ${pro.challengeScore}/30, anti-spoof ${pro.printAttackScore + pro.screenArtifactScore + pro.depthScore}/20, temporal ${pro.motionSmoothnessScore + pro.velocityProfileScore}/10).`,
        selfHosted ? `Self-hosted: ${selfHosted.score}/100.` : "",
        consensus ? `AI consensus: ${consensus.score}/100.` : "",
        `Live votes: ${liveVotes}/3.`,
        pro.issues.length > 0 ? `Issues: ${pro.issues.join("; ")}.` : "",
        pro.suggestions.length > 0 ? `Suggestions: ${pro.suggestions.join("; ")}.` : "",
      ].filter(Boolean).join(" ");
      result.consensus = consensus?.consensus || undefined;
    } else if (selfHosted && consensus) {
      result = {
        isLive,
        score: maxScore,
        detectedActions: Array.from(new Set([
          ...(selfHosted.detectedActions || []),
          ...(consensus.detectedActions || []),
        ])),
        reasoning: `Self-hosted (${selfHosted.score}%) + AI consensus (${consensus.score}%). Live votes: ${liveVotes}/2. ${consensus.reasoning || ""}`.trim(),
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
      proBreakdown: pro,  // detailed breakdown for UI
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Liveness check failed" }, { status: 500 });
  }
}
