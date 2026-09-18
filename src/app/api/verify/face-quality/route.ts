import { NextRequest, NextResponse } from "next/server";
import { scoreFaceImageQuality } from "@/lib/face-quality";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/verify/face-quality
 * Body: { image: "data:image/jpeg;base64,...", landmarks?: Array<{x,y}> }
 *
 * Scores face image quality on 13 dimensions (ISO/IEC 19794-5 inspired, v2):
 *
 *   Legacy 5 (backward compatible):
 *     - brightness (not too dark/bright)
 *     - contrast (sufficient dynamic range)
 *     - sharpness (Laplacian variance — not blurry)
 *     - faceSizeEstimate (face fills sufficient frame)
 *     - backgroundUniformity (no distracting background)
 *
 *   New v2 (sophisticated quality metrics):
 *     - pose { yaw, pitch, roll, score } (head pose from landmarks or gradient fallback)
 *     - occlusion (eyes/nose/mouth visibility via variance + edge density)
 *     - lightingUniformity (coefficient of variation of intensities across face)
 *     - colorNaturalness (no red/blue/green cast)
 *     - backgroundSimplicity (edge density in background regions)
 *     - faceSymmetry (left/right half comparison)
 *     - defocusBlur (Laplacian variance over face ROI)
 *     - motionBlur { score, direction } (directional gradient analysis)
 *
 * Returns: FaceQualityScore with 5 legacy + 8 new sub-scores + overall (legacy 5)
 *          + compositeQuality (13-dim weighted average) + issues + suggestions + pass.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image = body.image;
    if (!image || !image.startsWith("data:image/")) {
      return NextResponse.json({ error: "image (data URL) required" }, { status: 400 });
    }

    const landmarks = Array.isArray(body.landmarks) ? body.landmarks : undefined;
    const result = await scoreFaceImageQuality(image, landmarks);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "quality check failed" }, { status: 500 });
  }
}

/** GET — returns info. */
export async function GET() {
  return NextResponse.json({
    description: "Face image quality scorer (ISO/IEC 19794-5 inspired, v2)",
    dimensions: {
      legacy: ["brightness", "contrast", "sharpness", "faceSizeEstimate", "backgroundUniformity"],
      v2: ["pose", "occlusion", "lightingUniformity", "colorNaturalness",
           "backgroundSimplicity", "faceSymmetry", "defocusBlur", "motionBlur"],
    },
    weights: {
      brightness: 0.08, contrast: 0.08, sharpness: 0.18, faceSize: 0.15,
      background: 0.08, pose: 0.12, occlusion: 0.10, lightingUniformity: 0.05,
      colorNaturalness: 0.05, backgroundSimplicity: 0.03, faceSymmetry: 0.03,
      defocusBlur: 0.03, motionBlur: 0.02,
    },
    passThreshold: 0.5,
    algorithms: {
      brightness: "Mean luminance (ITU-R BT.601), optimal 80-180",
      contrast: "Brightness stddev, optimal 40-80",
      sharpness: "Laplacian variance (kernel [0,1,0;1,-4,1;0,1,0])",
      faceSize: "Center-region local variance (face presence proxy)",
      background: "Corner region stddev (uniformity)",
      pose: "Landmark-based yaw/pitch/roll (5/68/468-point auto-detected) or gradient 2nd-moment fallback",
      occlusion: "Local variance + Sobel edge density in eyes/nose/mouth regions",
      lightingUniformity: "Coefficient of variation (CV=std/mean) of face-region intensities",
      colorNaturalness: "RGB skin-tone ordering + distance from canonical skin chromaticity",
      backgroundSimplicity: "Sobel edge density in 4 corner regions",
      faceSymmetry: "Mirrored-row abs-diff between left and right face halves",
      defocusBlur: "Laplacian variance over face ROI",
      motionBlur: "Ratio of horizontal vs vertical gradient magnitudes (directional imbalance)",
    },
    poseThresholds: { yaw: 30, pitch: 30, roll: 15 },
  });
}
