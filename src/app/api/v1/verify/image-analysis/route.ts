import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Shared types (mirror client-side @/lib/image-auto-adjust) ─────────

type DocType = "national_id" | "passport" | "driver_license";

const DOC_DIMENSIONS_MM: Record<DocType, [number, number]> = {
  national_id: [85.6, 54],
  passport: [125, 88],
  driver_license: [85.6, 54],
};

interface ImageQualityIssue {
  type:
    | "blur"
    | "dark"
    | "bright"
    | "low_contrast"
    | "glare"
    | "skew"
    | "low_resolution"
    | "noise";
  severity: "low" | "medium" | "high";
  value: number;
  threshold: number;
  recommendation: string;
}

interface ImageQualityMetrics {
  sharpness: number;
  brightness: number;
  contrast: number;
  noise: number;
  resolution: { width: number; height: number; dpi: number };
  glare: number;
  skew: number;
}

interface ImageQualityReport {
  overall: "excellent" | "good" | "acceptable" | "poor";
  score: number;
  issues: ImageQualityIssue[];
  metrics: ImageQualityMetrics;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function decodeBase64Image(image: string): Buffer {
  const base64 = image.includes(",") ? image.split(",")[1] : image;
  if (!base64 || base64.length < 100) {
    throw new Error("image payload too small — expected JPEG/PNG base64 ≥ 100 bytes");
  }
  return Buffer.from(base64, "base64");
}

/**
 * Downscale a buffer to a grayscale Float32Array with width w and height h.
 * Used by all metric calculations.
 */
async function toGrayFloat(
  buffer: Buffer,
  targetLongEdge: number
): Promise<{ gray: Float32Array; width: number; height: number }> {
  // Get metadata for source dimensions
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const srcW = meta.width || 1;
  const srcH = meta.height || 1;
  const longEdge = Math.max(srcW, srcH);
  const scale = longEdge > targetLongEdge ? targetLongEdge / longEdge : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const { data } = await sharp(buffer, { failOn: "none" })
    .resize(w, h, { fit: "inside", withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const gray = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) {
    gray[i] = data[i];
  }
  return { gray, width: w, height: h };
}

/** Compute Laplacian variance (sharpness proxy). */
function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        -4 * gray[i] +
        gray[i - 1] +
        gray[i + 1] +
        gray[i - w] +
        gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

/** 3x3 box blur — used as a fast low-pass for noise estimation. */
function boxBlur3x3(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = Math.min(w - 1, Math.max(0, x + dx));
          const py = Math.min(h - 1, Math.max(0, y + dy));
          acc += gray[py * w + px];
          n++;
        }
      }
      out[y * w + x] = acc / n;
    }
  }
  return out;
}

/** Estimate noise as RMS of high-frequency content (image - blurred). */
function estimateNoise(gray: Float32Array, w: number, h: number): number {
  const blurred = boxBlur3x3(gray, w, h);
  let acc = 0;
  let n = 0;
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - blurred[i];
    acc += d * d;
    n++;
  }
  return Math.sqrt(acc / Math.max(1, n));
}

/** Estimate skew via gradient-direction histogram (cardinal ratio). */
function estimateSkew(gray: Float32Array, w: number, h: number): number {
  const angles: number[] = [];
  const magnitudes: number[] = [];
  let totalMag = 0;
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const mag = Math.hypot(gx, gy);
      if (mag < 30) continue;
      const ang = Math.atan2(gy, gx);
      angles.push(ang);
      magnitudes.push(mag);
      totalMag += mag;
    }
  }
  if (totalMag === 0) return 0;
  const bins = 36;
  const hist = new Float32Array(bins);
  for (let k = 0; k < angles.length; k++) {
    const bin = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((angles[k] + Math.PI) / (2 * Math.PI)) * bins))
    );
    hist[bin] += magnitudes[k];
  }
  let nonCardinal = 0;
  let cardinal = 0;
  for (let b = 0; b < bins; b++) {
    const a = (b / bins) * 2 * Math.PI - Math.PI;
    const deg = (a * 180) / Math.PI;
    const near =
      Math.abs(deg) < 8 ||
      Math.abs(deg - 90) < 8 ||
      Math.abs(deg + 90) < 8 ||
      Math.abs(deg - 180) < 8 ||
      Math.abs(deg + 180) < 8;
    if (near) cardinal += hist[b];
    else nonCardinal += hist[b];
  }
  const ratio = nonCardinal / (nonCardinal + cardinal + 1e-6);
  return Math.min(15, ratio * 30);
}

/** Detect specular highlights via count of >= 240 pixels in raw RGB. */
async function detectGlare(buffer: Buffer): Promise<number> {
  const { data, info } = await sharp(buffer, { failOn: "none" })
    .resize(512, 512, { fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let count = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += channels) {
    total++;
    const r = data[i];
    const g = data[i + 1];
    const b = channels > 2 ? data[i + 2] : r;
    if (r >= 240 && g >= 240 && b >= 240) count++;
  }
  return total > 0 ? count / total : 0;
}

// ─── Build the report ─────────────────────────────────────────────

async function analyzeQuality(
  buffer: Buffer,
  docType: DocType = "national_id"
): Promise<ImageQualityReport> {
  // Original dimensions (for DPI / resolution issues)
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const origW = meta.width || 0;
  const origH = meta.height || 0;

  // Grayscale for analysis (capped at 1024px long edge for speed)
  const { gray, width: w, height: h } = await toGrayFloat(buffer, 1024);

  // Mean / std → brightness & contrast
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  const brightness = sum / gray.length;
  let acc = 0;
  for (let i = 0; i < gray.length; i++) acc += (gray[i] - brightness) ** 2;
  const contrast = Math.sqrt(acc / gray.length);

  const sharpness = laplacianVariance(gray, w, h);
  const noise = estimateNoise(gray, w, h);
  const glare = await detectGlare(buffer);
  const skew = estimateSkew(gray, w, h);

  // DPI estimate from document dimensions
  const [docWmm, docHmm] = DOC_DIMENSIONS_MM[docType] || DOC_DIMENSIONS_MM.national_id;
  const longEdgePx = Math.max(origW, origH);
  const longEdgeMm = Math.max(docWmm, docHmm);
  const dpi = longEdgePx > 0 ? Math.round(longEdgePx / (longEdgeMm / 25.4)) : 0;

  // Issues (mirrors client logic)
  const issues: ImageQualityIssue[] = [];

  if (sharpness < 50) {
    issues.push({
      type: "blur",
      severity: "high",
      value: Math.round(sharpness),
      threshold: 100,
      recommendation: "Image is blurry. Hold the camera steady and use tap-to-focus.",
    });
  } else if (sharpness < 100) {
    issues.push({
      type: "blur",
      severity: "low",
      value: Math.round(sharpness),
      threshold: 100,
      recommendation: "Image is slightly soft. Move closer and ensure autofocus has locked.",
    });
  }

  if (brightness < 60) {
    issues.push({
      type: "dark",
      severity: "high",
      value: Math.round(brightness),
      threshold: 90,
      recommendation: "Image is too dark. Increase lighting or move to a brighter location.",
    });
  } else if (brightness < 90) {
    issues.push({
      type: "dark",
      severity: "low",
      value: Math.round(brightness),
      threshold: 90,
      recommendation: "Image is a bit dark. Auto-enhance will compensate; consider adding light.",
    });
  } else if (brightness > 220) {
    issues.push({
      type: "bright",
      severity: "high",
      value: Math.round(brightness),
      threshold: 200,
      recommendation: "Image is overexposed. Reduce lighting or move away from direct light.",
    });
  } else if (brightness > 200) {
    issues.push({
      type: "bright",
      severity: "low",
      value: Math.round(brightness),
      threshold: 200,
      recommendation: "Image is slightly bright. Auto-enhance will tone it down.",
    });
  }

  if (contrast < 20) {
    issues.push({
      type: "low_contrast",
      severity: "high",
      value: Math.round(contrast),
      threshold: 30,
      recommendation: "Low contrast — text may be hard to read. Use a darker background and even lighting.",
    });
  } else if (contrast < 30) {
    issues.push({
      type: "low_contrast",
      severity: "low",
      value: Math.round(contrast),
      threshold: 30,
      recommendation: "Slightly low contrast. Auto-contrast will help.",
    });
  }

  if (noise > 14) {
    issues.push({
      type: "noise",
      severity: "high",
      value: Math.round(noise * 10) / 10,
      threshold: 8,
      recommendation: "High sensor noise detected. Use better lighting or a higher-quality camera.",
    });
  } else if (noise > 8) {
    issues.push({
      type: "noise",
      severity: "low",
      value: Math.round(noise * 10) / 10,
      threshold: 8,
      recommendation: "Some noise present. Median denoise will clean it.",
    });
  }

  if (glare > 0.04) {
    issues.push({
      type: "glare",
      severity: "high",
      value: Math.round(glare * 1000) / 10,
      threshold: 3,
      recommendation: "Significant glare detected. Tilt the document slightly or change angle to avoid reflections.",
    });
  } else if (glare > 0.02) {
    issues.push({
      type: "glare",
      severity: "low",
      value: Math.round(glare * 1000) / 10,
      threshold: 3,
      recommendation: "Minor glare. Auto-enhance will reduce visibility.",
    });
  }

  if (skew > 5) {
    issues.push({
      type: "skew",
      severity: "high",
      value: Math.round(skew * 10) / 10,
      threshold: 5,
      recommendation: "Document appears skewed. Align edges horizontally before capturing.",
    });
  } else if (skew > 2) {
    issues.push({
      type: "skew",
      severity: "low",
      value: Math.round(skew * 10) / 10,
      threshold: 5,
      recommendation: "Slight skew. Auto-crop will straighten.",
    });
  }

  const minPx = 1012;
  if (origW < minPx * 0.7 || origH < minPx * 0.7 * (637 / 1012)) {
    issues.push({
      type: "low_resolution",
      severity: "medium",
      value: origW,
      threshold: minPx,
      recommendation: `Image resolution is low (${origW}×${origH}). Move closer or use a higher-resolution camera.`,
    });
  }

  // Score
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === "high") score -= 25;
    else if (issue.severity === "medium") score -= 12;
    else score -= 6;
  }
  score = Math.max(0, score);

  let overall: ImageQualityReport["overall"] = "excellent";
  if (score < 50) overall = "poor";
  else if (score < 70) overall = "acceptable";
  else if (score < 90) overall = "good";

  const highCount = issues.filter((i) => i.severity === "high").length;
  if (highCount >= 2 && overall !== "poor") overall = "poor";
  else if (highCount >= 1 && overall === "excellent") overall = "acceptable";

  return {
    overall,
    score,
    issues,
    metrics: {
      sharpness: Math.round(sharpness * 10) / 10,
      brightness: Math.round(brightness * 10) / 10,
      contrast: Math.round(contrast * 10) / 10,
      noise: Math.round(noise * 10) / 10,
      resolution: { width: origW, height: origH, dpi },
      glare: Math.round(glare * 10000) / 10000,
      skew: Math.round(skew * 10) / 10,
    },
  };
}

// ─── Route handler ────────────────────────────────────────────────────

/**
 * POST /api/v1/verify/image-analysis
 *
 * Server-side image quality pre-check. Computes the same
 * ImageQualityReport as the client-side analyzeImageQuality() but
 * using sharp for pixel access — useful when:
 *   - The client can't run canvas (e.g. server-side ingest)
 *   - You want to double-check before sending to OCR
 *   - You're processing a batch from another source
 *
 * Body: { image: string (base64 data URL or raw), docType?: string }
 *
 * Returns: ImageQualityReport + durationMs
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const image: string | undefined = body?.image;
    const docTypeRaw = body?.docType || "national_id";
    const docType: DocType = (
      ["national_id", "passport", "driver_license"].includes(docTypeRaw as DocType)
        ? (docTypeRaw as DocType)
        : "national_id"
    );

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "image (base64 string) is required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const buffer = decodeBase64Image(image);
    const report = await analyzeQuality(buffer, docType);

    return NextResponse.json(
      {
        ...report,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { headers: CORS_HEADERS }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "image analysis failed",
        code: "IMAGE_ANALYSIS_FAILURE",
        durationMs: Date.now() - startedAt,
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

/**
 * GET /api/v1/verify/image-analysis
 * API documentation + the thresholds the analyzer applies.
 */
export async function GET() {
  return NextResponse.json(
    {
      description:
        "Server-side image quality pre-check — analyzes sharpness, brightness, contrast, noise, glare, skew, and resolution before OCR/AI ingest.",
      method: "POST",
      body: {
        image: "base64-encoded JPEG/PNG (data URL or raw)",
        docType: "national_id | passport | driver_license (default: national_id)",
      },
      metrics: {
        sharpness: "Laplacian variance — threshold > 100 for sharp edges",
        brightness: "Mean luminance — 90..200 is good",
        contrast: "Std deviation of luminance — > 30 is good",
        noise: "High-frequency RMS via box-blur residual — < 8 is clean",
        glare: "Fraction of >= 240 RGB pixels — < 2% is good",
        skew: "Gradient-direction cardinal ratio — < 2° is good",
        resolution: "Width × height + DPI estimate from doc dimensions",
      },
      thresholds: {
        sharpnessExcellent: 200,
        sharpnessGood: 100,
        brightnessGood: [90, 200],
        contrastGood: 30,
        noiseAcceptable: 8,
        glareAcceptable: 0.02,
        skewAcceptableDeg: 2,
      },
      docDimensionsMM: DOC_DIMENSIONS_MM,
      competitiveAdvantage:
        "Most KYC vendors blindly send captured images to OCR. Cirkle runs a full quality pre-check and surfaces actionable recommendations to the user — saving OCR tokens and boosting extraction accuracy.",
    },
    { headers: CORS_HEADERS }
  );
}
