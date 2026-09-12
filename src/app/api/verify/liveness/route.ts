import { NextRequest, NextResponse } from "next/server";
import { checkLivenessSelfHosted } from "@/lib/liveness-engine";
import { checkRateLimit } from "@/lib/rate-limit";
import type { LivenessAction } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 60_000, prefix: "live" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const frames: string[] = body.frames;
    const actions: LivenessAction[] = body.actions;

    if (!Array.isArray(frames) || frames.length === 0) {
      // No frames captured — return a failed result (not an error)
      return NextResponse.json({
        result: {
          isLive: false,
          score: 0,
          detectedActions: [],
          reasoning: "No frames were captured (camera unavailable or blocked). Liveness could not be verified.",
        },
        engine: "self-hosted",
      });
    }

    const result = await checkLivenessSelfHosted(frames, actions || []);
    return NextResponse.json({ result, engine: "self-hosted" });
  } catch (e: any) {
    console.error("[/api/verify/liveness] error", e);
    return NextResponse.json({ error: e?.message || "Liveness check failed" }, { status: 500 });
  }
}
