import { NextRequest, NextResponse } from "next/server";
import { scoreFaceImageQuality } from "@/lib/face-quality";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/verify/face-quality
 * Body: { image: "data:image/jpeg;base64,..." }
 *
 * Scores face image quality on 5 dimensions (ISO/IEC 19794-5 inspired):
 *   - brightness (not too dark/bright)
 *   - contrast (sufficient dynamic range)
 *   - sharpness (Laplacian variance — not blurry)
 *   - faceSizeEstimate (face fills sufficient frame)
 *   - backgroundUniformity (no distracting background)
 *
 * Returns: { brightness, contrast, sharpness, faceSizeEstimate,
 *           backgroundUniformity, overall, issues[], suggestions[], pass }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image = body.image;
    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json({ error: "image (data URL) required" }, { status: 400 });
    }

    const result = await scoreFaceImageQuality(image);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "quality check failed" }, { status: 500 });
  }
}

/** GET — returns info. */
export async function GET() {
  return NextResponse.json({
    description: "Face image quality scorer (ISO/IEC 19794-5 inspired)",
    dimensions: ["brightness", "contrast", "sharpness", "faceSizeEstimate", "backgroundUniformity"],
    weights: { brightness: 0.15, contrast: 0.15, sharpness: 0.30, faceSize: 0.25, background: 0.15 },
    passThreshold: 0.5,
    algorithms: {
      brightness: "Mean luminance (ITU-R BT.601), optimal 80-180",
      contrast: "Brightness stddev, optimal 40-80",
      sharpness: "Laplacian variance (kernel [0,1,0;1,-4,1;0,1,0])",
      faceSize: "Center-region local variance (face presence proxy)",
      background: "Corner region stddev (uniformity)",
    },
  });
}
