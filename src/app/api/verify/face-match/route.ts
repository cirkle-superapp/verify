import { NextRequest, NextResponse } from "next/server";
import { matchFaceSelfHosted } from "@/lib/face-engine";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    // Try the persistent face mini-service first
    const serviceResult = await callFaceService(selfie, docImage);
    if (serviceResult && !serviceResult.error) {
      return NextResponse.json({ result: serviceResult, engine: "self-hosted-service" });
    }

    // Fallback: in-process face-api.js
    const result = await matchFaceSelfHosted(selfie, docImage);
    return NextResponse.json({ result, engine: "self-hosted" });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Face match failed" }, { status: 500 });
  }
}
