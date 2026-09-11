import { NextRequest, NextResponse } from "next/server";
import { extractDocumentData } from "@/lib/vlm-service";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const frontImage: string | undefined = body.frontImage;
    const backImage: string | null = body.backImage ?? null;
    const docType: DocType = (body.docType as DocType) || "national_id";

    if (!frontImage || !frontImage.startsWith("data:image/")) {
      return NextResponse.json({ error: "frontImage (data URL) is required" }, { status: 400 });
    }

    const data = await extractDocumentData(frontImage, backImage, docType);
    return NextResponse.json({ data });
  } catch (e: any) {
    console.error("[/api/verify/document] error", e);
    return NextResponse.json({ error: e?.message || "Failed to extract document data" }, { status: 500 });
  }
}
