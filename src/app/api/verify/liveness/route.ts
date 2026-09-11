import { NextRequest, NextResponse } from "next/server";
import { checkLiveness } from "@/lib/vlm-service";
import type { LivenessAction } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const frames: string[] = body.frames;
    const actions: LivenessAction[] = body.actions;

    if (!Array.isArray(frames) || frames.length === 0) {
      // No frames captured (camera unavailable) — return a failed result instead of erroring,
      // so the client can still finalize the verification record.
      return NextResponse.json({
        result: {
          isLive: false,
          score: 0,
          detectedActions: [],
          reasoning: "No frames were captured (camera unavailable or blocked). Liveness could not be verified.",
        },
      });
    }

    const result = await checkLiveness(frames, actions || []);
    return NextResponse.json({ result });
  } catch (e: any) {
    console.error("[/api/verify/liveness] error", e);
    return NextResponse.json({ error: e?.message || "Failed to check liveness" }, { status: 500 });
  }
}
