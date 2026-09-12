import { NextRequest, NextResponse } from "next/server";
import { checkLivenessSelfHosted } from "@/lib/liveness-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import type { LivenessAction } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 30;

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
        engine: "self-hosted",
      });
    }

    // Try the persistent liveness mini-service first
    const serviceResult = await callLivenessService(frames, actions);
    if (serviceResult && !serviceResult.error) {
      return NextResponse.json({ result: serviceResult, engine: "self-hosted-service" });
    }

    // Fallback: in-process liveness check
    const result = await checkLivenessSelfHosted(frames, actions);
    return NextResponse.json({ result, engine: "self-hosted" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Liveness check failed" }, { status: 500 });
  }
}
