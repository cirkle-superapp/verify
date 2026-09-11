import { NextRequest, NextResponse } from "next/server";
import { matchFace } from "@/lib/vlm-service";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const selfie: string | undefined = body.selfie;
    const docImage: string | undefined = body.docImage;

    if (!selfie || !docImage) {
      return NextResponse.json({ error: "selfie and docImage are required" }, { status: 400 });
    }

    const result = await matchFace(selfie, docImage);
    return NextResponse.json({ result });
  } catch (e: any) {
    console.error("[/api/verify/face-match] error", e);
    return NextResponse.json({ error: e?.message || "Failed to match face" }, { status: 500 });
  }
}
