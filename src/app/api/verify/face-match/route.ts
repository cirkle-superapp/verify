import { NextRequest, NextResponse } from "next/server";
import { matchFaceSelfHosted } from "@/lib/face-engine";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 15, windowMs: 60_000, prefix: "face" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const selfie: string | undefined = body.selfie;
    const docImage: string | undefined = body.docImage;

    if (!selfie || !docImage) {
      return NextResponse.json({ error: "selfie and docImage are required" }, { status: 400 });
    }

    const result = await matchFaceSelfHosted(selfie, docImage);
    return NextResponse.json({ result, engine: "self-hosted" });
  } catch (e: any) {
    console.error("[/api/verify/face-match] error", e);
    return NextResponse.json({ error: e?.message || "Face match failed" }, { status: 500 });
  }
}
