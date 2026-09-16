import { NextRequest, NextResponse } from "next/server";
import { checkLivenessPro } from "@/lib/liveness-pro";
import { checkRateLimit } from "@/lib/rate-limit";
import type { LivenessAction } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/verify/liveness-pro
 *
 * Enhanced liveness detection with:
 *   1. Directional motion analysis (4×4 block-based optical flow)
 *   2. Challenge-response verification (verify requested action was performed)
 *   3. Anti-spoofing: print attack, screen replay (moiré), depth estimation
 *   4. Temporal analysis: motion smoothness (jerk), velocity profile (bell curve)
 *
 * Body: { frames: string[], actions: LivenessAction[] }
 * Returns: LivenessProScore with detailed breakdown
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 60_000, prefix: "liveness-pro" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const frames: string[] = body.frames || [];
    const actions: LivenessAction[] = body.actions || [];

    if (frames.length < 3) {
      return NextResponse.json({
        error: "Need at least 3 frames for pro liveness analysis",
        received: frames.length,
      }, { status: 400 });
    }

    const result = await checkLivenessPro(frames, actions);
    return NextResponse.json({ result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "liveness-pro failed" }, { status: 500 });
  }
}

/** GET — returns info about the pro liveness detection. */
export async function GET() {
  return NextResponse.json({
    description: "Enhanced liveness detection with anti-spoofing",
    capabilities: {
      motionAnalysis: "4×4 block-based optical flow (directional: left/right/up/down)",
      challengeResponse: "Verifies requested action was actually performed",
      antiSpoofing: [
        "Print attack (uniform texture detection)",
        "Screen replay (moiré pattern / high-frequency noise)",
        "Depth estimation (3D face has brightness gradient)",
      ],
      temporalAnalysis: [
        "Motion smoothness (jerk = human, smooth = robotic)",
        "Velocity profile (bell curve = human, flat = static)",
      ],
    },
    scoreBreakdown: {
      motion: "0-40 (avg inter-frame diff)",
      challenge: "0-30 (action matches motion direction)",
      antiSpoofing: "0-20 (print 0-10, screen 0-5, depth 0-5)",
      temporal: "0-10 (smoothness 0-5, velocity 0-5)",
    },
    passThreshold: 60,
    minFrames: 3,
    supportedActions: ["turn_left", "turn_right", "look_up", "blink", "smile"],
  });
}
