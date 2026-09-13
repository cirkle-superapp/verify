import { NextRequest, NextResponse } from "next/server";
import { matchFaceSelfHosted } from "@/lib/face-engine";
import { matchFace as matchFaceConsensus, isConsensusModeActive } from "@/lib/vlm-service";
import { checkRateLimit } from "@/lib/rate-limit";
import type { FaceMatchResult } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Face match endpoint — CONSENSUS MODE.
 *
 * Runs in parallel:
 *   1. Self-hosted face-api.js (port 3031 or in-process) — 128-d descriptor + cosine
 *   2. AI Consensus: Gemini + OpenRouter + NVIDIA vision (parallel) + cross-check
 *
 * Final verdict: combine both signals.
 *   - isMatch = selfHosted.isMatch AND consensus.isMatch
 *     (or selfHosted similarity >= 80 if consensus is unavailable)
 *   - similarity = max(selfHosted.similarity, consensus.similarity)
 *
 * If no AI providers configured, falls back to self-hosted only.
 */

async function callFaceService(selfie: string, docImage: string) {
  try {
    const res = await fetch("http://localhost:3031/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selfie, document: docImage }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 15, windowMs: 60_000, prefix: "face" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const selfie = body.selfie;
    const docImage = body.docImage;
    if (!selfie || !docImage) {
      return NextResponse.json({ error: "selfie and docImage are required" }, { status: 400 });
    }

    const consensusActive = isConsensusModeActive();

    // ── Run self-hosted + AI consensus in PARALLEL ────────────────
    const [selfHostedResult, consensusResult] = await Promise.allSettled([
      // Track 1: self-hosted face-api.js
      (async () => {
        const serviceResult = await callFaceService(selfie, docImage);
        if (serviceResult && !serviceResult.error) return serviceResult as FaceMatchResult;
        return await matchFaceSelfHosted(selfie, docImage);
      })(),
      // Track 2: AI consensus (Gemini + OpenRouter + NVIDIA in parallel)
      consensusActive ? matchFaceConsensus(selfie, docImage) : Promise.resolve(null),
    ]);

    const selfHosted = selfHostedResult.status === "fulfilled" ? selfHostedResult.value : null;
    const consensus = consensusResult.status === "fulfilled" ? consensusResult.value : null;

    if (!selfHosted && !consensus) {
      return NextResponse.json({ error: "Face match failed on all engines" }, { status: 500 });
    }

    // MERGE: combine both signals
    let result: FaceMatchResult;
    if (selfHosted && consensus) {
      const sSelf = selfHosted.similarity || 0;
      const sCons = consensus.similarity || 0;
      const sim = Math.max(sSelf, sCons);
      const bothAgree = selfHosted.isMatch === consensus.isMatch;
      const isMatch = bothAgree
        ? selfHosted.isMatch
        : (sSelf >= 85 || sCons >= 85);

      result = {
        isMatch,
        samePerson: isMatch,
        similarity: sim,
        reasoning: `Cross-checked by self-hosted face-api.js (${Math.round(sSelf)}%) and AI consensus (${Math.round(sCons)}%). ${consensus.reasoning || ""}`.trim(),
        consensus: consensus.consensus,
      };
    } else if (consensus) {
      result = consensus;
      result.reasoning = `AI consensus only (self-hosted unavailable). ${result.reasoning || ""}`.trim();
    } else {
      result = selfHosted!;
      result.reasoning = `Self-hosted only (AI consensus unavailable). ${result.reasoning || ""}`.trim();
    }

    return NextResponse.json({
      result,
      engine: consensusActive ? "consensus-merged" : "self-hosted",
      consensus: result.consensus,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Face match failed" }, { status: 500 });
  }
}
