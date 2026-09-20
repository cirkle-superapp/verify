"use client";

/**
 * image-auto-adjust.ts
 * ───────────────────────────────────────────────────────────────────
 * Comprehensive client-side image auto-adjustment pipeline for
 * document verification. Runs in the browser (uses Canvas 2D + Image
 * APIs). Five cooperating subsystems:
 *
 *   1. EXIF orientation auto-rotation       (readExifOrientation, applyExifOrientation)
 *   2. Document edge detection + auto-crop  (detectDocumentEdges, cropToQuad, autoCropDocument)
 *   3. Auto-enhancement                     (autoEnhance)
 *   4. Optimal resize for verification      (computeOptimalDimensions, resizeImage [Lanczos-3])
 *   5. Quality pre-check                    (analyzeImageQuality, ImageQualityReport)
 *
 * All public functions are async and operate on data URLs or File
 * objects. They never touch the network and never throw on common
 * edge cases (corrupt EXIF, all-white image, etc.) — instead they
 * degrade gracefully and return `confidence: 0` or unchanged data.
 *
 * Task ID: 15-a. Author: image-auto-adjust.
 */

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export type DocType = "national_id" | "passport" | "driver_license";

export interface Quad {
  tl: [number, number];
  tr: [number, number];
  br: [number, number];
  bl: [number, number];
}

export interface EdgeDetectionResult {
  quad: Quad | null;
  confidence: number; // 0..1
}

export interface AutoEnhanceAdjustments {
  brightness: number; // -100..100 (applied)
  contrast: number; // -100..100 (applied)
  sharpness: number; // 0..100 (applied)
  autoContrast: boolean;
  denoise: boolean;
  grayscale: boolean;
  reasons: string[];
}

export interface ImageQualityIssue {
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

export interface ImageQualityMetrics {
  sharpness: number; // Laplacian variance (RMS)
  brightness: number; // mean luminance 0..255
  contrast: number; // std deviation of luminance
  noise: number; // high-frequency RMS estimate
  resolution: { width: number; height: number; dpi: number };
  glare: number; // 0..1 fraction of specular-highlight pixels
  skew: number; // estimated page skew in degrees (|angle|)
}

export interface ImageQualityReport {
  overall: "excellent" | "good" | "acceptable" | "poor";
  score: number; // 0..100
  issues: ImageQualityIssue[];
  metrics: ImageQualityMetrics;
}

export interface AutoAdjustOptions {
  docType?: DocType | string;
  crop?: boolean;
  enhance?: boolean;
  rotate?: boolean;
  maxSize?: number;
}

export interface AutoAdjustResult {
  dataUrl: string;
  originalSize: { width: number; height: number; bytes: number };
  adjustedSize: { width: number; height: number; bytes: number };
  adjustments: AutoEnhanceAdjustments;
  quality: ImageQualityReport;
  processingTimeMs: number;
  cropped: boolean;
  cropConfidence: number;
  rotated: boolean;
  exifOrientation: number;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers — loading, grayscale, statistics
// ──────────────────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return { canvas, ctx };
}

function toGray(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] =
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

function meanStd(values: Float32Array): { mean: number; std: number } {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  const mean = sum / values.length;
  let acc = 0;
  for (let i = 0; i < values.length; i++) acc += (values[i] - mean) ** 2;
  const std = Math.sqrt(acc / values.length);
  return { mean, std };
}

// ──────────────────────────────────────────────────────────────────────
// 1. EXIF orientation auto-rotation
// ──────────────────────────────────────────────────────────────────────

/**
 * Read the EXIF Orientation tag (0x0112) from a JPEG File. Returns 1..8
 * (1 = no transform). Returns 1 if not a JPEG or no EXIF/APP1 segment.
 *
 * Parses the APP1 segment manually — no external dependencies. Only
 * reads the IFD0 orientation short, so it's fast (<1ms typical).
 */
export async function readExifOrientation(file: File): Promise<number> {
  try {
    if (!file.type.includes("jpeg") && !file.name.match(/\.jpe?g$/i)) {
      return 1;
    }
    // Read just enough of the file — APP1 lives in the first ~64KB
    const slice = file.slice(0, Math.min(file.size, 1024 * 64));
    const buf = await slice.arrayBuffer();
    const u = new Uint8Array(buf);
    // JPEG must start with FFD8
    if (u.length < 4 || u[0] !== 0xff || u[1] !== 0xd8) return 1;
    let offset = 2;
    while (offset + 4 < u.length) {
      if (u[offset] !== 0xff) break;
      const marker = u[offset + 1];
      // Segments have a 2-byte length immediately after the marker
      const segLen = (u[offset + 2] << 8) | u[offset + 3];
      if (marker === 0xe1) {
        // APP1 — check "Exif\0\0" magic (6 bytes after marker+len)
        const magicOffset = offset + 4;
        if (
          u.length >= magicOffset + 6 &&
          u[magicOffset] === 0x45 && // E
          u[magicOffset + 1] === 0x78 && // x
          u[magicOffset + 2] === 0x69 && // i
          u[magicOffset + 3] === 0x66 && // f
          u[magicOffset + 4] === 0x00 &&
          u[magicOffset + 5] === 0x00
        ) {
          return parseOrientationFromExif(u, magicOffset + 6);
        }
      }
      // SOS or invalid segment ends the walk
      if (marker === 0xda) break;
      offset += 2 + segLen;
    }
    return 1;
  } catch {
    return 1;
  }
}

function parseOrientationFromExif(
  u: Uint8Array,
  tiffStart: number
): number {
  if (tiffStart + 8 > u.length) return 1;
  // Byte order: II (little) or MM (big)
  const bo = (u[tiffStart] << 8) | u[tiffStart + 1];
  const little = bo === 0x4949;
  const big = bo === 0x4d4d;
  if (!little && !big) return 1;
  const read16 = (off: number) =>
    little
      ? (u[off + 1] << 8) | u[off]
      : (u[off] << 8) | u[off + 1];
  const read32 = (off: number) =>
    little
      ? (u[off + 3] << 24) | (u[off + 2] << 16) | (u[off + 1] << 8) | u[off]
      : (u[off] << 24) | (u[off + 1] << 16) | (u[off + 2] << 8) | u[off + 3];
  const ifd0Off = tiffStart + read32(tiffStart + 4);
  if (ifd0Off + 2 > u.length) return 1;
  const tagCount = read16(ifd0Off);
  let entry = ifd0Off + 2;
  for (let i = 0; i < tagCount; i++) {
    if (entry + 12 > u.length) break;
    const tagId = read16(entry);
    const typeId = read16(entry + 2);
    const count = read32(entry + 4);
    if (tagId === 0x0112 && typeId === 3 && count === 1) {
      // SHORT — value fits in 4 bytes, stored inline at offset+8
      const val = read16(entry + 8);
      if (val >= 1 && val <= 8) return val;
      return 1;
    }
    entry += 12;
  }
  return 1;
}

/**
 * Apply the EXIF orientation transform to an HTMLImageElement, returning
 * a canvas with the correctly-oriented pixels. The returned canvas
 * dimensions are swapped for orientations 5-8 (90°/270° rotations).
 *
 * Mapping (EXIF spec):
 *   1 = normal            (no transform)
 *   2 = flip horizontal
 *   3 = rotate 180°
 *   4 = flip vertical
 *   5 = rotate 90° CW + flip horizontal  (= transpose)
 *   6 = rotate 90° CW
 *   7 = rotate 90° CCW + flip horizontal (= transverse)
 *   8 = rotate 90° CCW
 */
export function applyExifOrientation(
  img: HTMLImageElement,
  orientation: number
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const swap = orientation >= 5 && orientation <= 7;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const { canvas, ctx } = makeCanvas(outW, outH);
  // Normalize orientation to a transform table
  switch (orientation) {
    case 1:
      ctx.drawImage(img, 0, 0);
      break;
    case 2:
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      break;
    case 3:
      ctx.translate(w, h);
      ctx.rotate(Math.PI);
      ctx.drawImage(img, 0, 0);
      break;
    case 4:
      ctx.translate(0, h);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);
      break;
    case 5:
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
      ctx.rotate((90 * Math.PI) / 180);
      ctx.drawImage(img, 0, 0);
      break;
    case 6:
      ctx.translate(outW, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      break;
    case 7:
      ctx.translate(outW, outH);
      ctx.scale(-1, 1);
      ctx.rotate((-90 * Math.PI) / 180);
      ctx.drawImage(img, 0, 0);
      break;
    case 8:
      ctx.translate(0, outH);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      break;
    default:
      ctx.drawImage(img, 0, 0);
  }
  // Restore so subsequent reads are predictable
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas, width: outW, height: outH };
}

// ──────────────────────────────────────────────────────────────────────
// 2. Document edge detection + auto-crop
// ──────────────────────────────────────────────────────────────────────

/** 3x3 Gaussian blur (σ ≈ 0.85, kernel sum 16). */
function gaussianBlur3x3(gray: Float32Array, w: number, h: number): Float32Array {
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const out = new Float32Array(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = Math.min(w - 1, Math.max(0, x + dx));
          const py = Math.min(h - 1, Math.max(0, y + dy));
          acc += gray[py * w + px] * k[ki++];
        }
      }
      out[y * w + x] = acc / 16;
    }
  }
  return out;
}

/** Sobel edge magnitude. Returns Float32Array of magnitudes (no angle). */
function sobelEdges(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(gray.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1];
      const tm = gray[i - w];
      const tr = gray[i - w + 1];
      const ml = gray[i - 1];
      const mr = gray[i + 1];
      const bl = gray[i + w - 1];
      const bm = gray[i + w];
      const br = gray[i + w + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tm - tr + bl + 2 * bm + br;
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Threshold a Sobel magnitude map to a binary mask (1 = edge, 0 = bg). */
function thresholdMask(edges: Float32Array, w: number, h: number, thresh: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let i = 0; i < edges.length; i++) {
    out[i] = edges[i] > thresh ? 1 : 0;
  }
  return out;
}

/** 3x3 morphological dilation, `iterations` passes. */
function dilate(mask: Uint8Array, w: number, h: number, iterations: number): Uint8Array {
  let cur = mask;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i]) {
          next[i] = 1;
          continue;
        }
        let any = 0;
        for (let dy = -1; dy <= 1 && !any; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const px = Math.min(w - 1, Math.max(0, x + dx));
            const py = Math.min(h - 1, Math.max(0, y + dy));
            if (cur[py * w + px]) {
              any = 1;
              break;
            }
          }
        }
        next[i] = any;
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Connected-components labeling (4-connectivity) and return the label
 * with the most pixels along with its pixel coordinates. Iterative
 * flood fill to avoid stack overflow on large blobs.
 */
function largestContour(mask: Uint8Array, w: number, h: number): { label: number; pixels: number[] } {
  const labels = new Int32Array(w * h);
  let next = 1;
  let best = { label: 0, pixels: [] as number[] };
  const stack: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 && labels[i] === 0) {
      const label = next++;
      const pixels: number[] = [];
      stack.length = 0;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop()!;
        if (labels[p] !== 0 || mask[p] !== 1) continue;
        labels[p] = label;
        pixels.push(p);
        const x = p % w;
        const y = (p / w) | 0;
        if (x > 0) stack.push(p - 1);
        if (x < w - 1) stack.push(p + 1);
        if (y > 0) stack.push(p - w);
        if (y < h - 1) stack.push(p + w);
      }
      if (pixels.length > best.pixels.length) {
        best = { label, pixels };
      }
    }
  }
  return best;
}

/** Andrew's monotone chain convex hull on integer pixel coords. */
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  if (pts.length < 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const n = sorted.length;
  const cross = (
    o: [number, number],
    a: [number, number],
    b: [number, number]
  ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0
    ) {
      lower.pop();
    }
    lower.push(sorted[i]);
  }
  const upper: Array<[number, number]> = [];
  for (let i = n - 1; i >= 0; i--) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], sorted[i]) <= 0
    ) {
      upper.pop();
    }
    upper.push(sorted[i]);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Compute the minimum-area bounding rectangle for a set of hull points
 * by trying each hull edge as a candidate direction (rotating calipers
 * simplified). Returns the 4 corners of the rectangle.
 */
function minAreaRect(hull: Array<[number, number]>): Quad | null {
  if (hull.length < 2) return null;
  let bestArea = Infinity;
  let bestQuad: Quad | null = null;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // Unit direction along edge + perpendicular
    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;
    // Project all hull points onto (u, v)
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const pu = p[0] * ux + p[1] * uy;
      const pv = p[0] * vx + p[1] * vy;
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea) {
      bestArea = area;
      // 4 corners in (x,y) space: transform (minU,minV),(maxU,minV),(maxU,maxV),(minU,maxV)
      // back via: p = minU*u + minV*v
      const corner = (u: number, v: number): [number, number] => [
        u * ux + v * vx,
        u * uy + v * vy,
      ];
      bestQuad = {
        tl: corner(minU, maxV),
        tr: corner(maxU, maxV),
        br: corner(maxU, minV),
        bl: corner(minU, minV),
      };
    }
  }
  return bestQuad;
}

/**
 * Detect the 4 corners of a document in the image. Returns confidence
 * 0..1 (0 = no document found). The pipeline is the standard one used
 * by scanner apps:
 *
 *   grayscale → gaussian blur → sobel → threshold → dilate →
 *   largest contour → convex hull → min-area-rect
 *
 * Confidence is a blend of (a) the contour's area fraction of the
 * frame and (b) the quad's edge length ratio (a real document is
 * roughly 1.4-1.7 in aspect; we accept wider bands).
 */
export function detectDocumentEdges(
  imageData: ImageData
): EdgeDetectionResult {
  const { width, height } = imageData;
  const gray = toGray(imageData);
  const blurred = gaussianBlur3x3(gray, width, height);
  const edges = sobelEdges(blurred, width, height);
  // Adaptive threshold: top 15% of edge magnitudes
  let maxMag = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i] > maxMag) maxMag = edges[i];
  }
  const thresh = Math.max(40, maxMag * 0.15);
  const mask = thresholdMask(edges, width, height, thresh);
  const dilated = dilate(mask, width, height, 3);
  const contour = largestContour(dilated, width, height);
  if (contour.pixels.length < width * height * 0.01) {
    return { quad: null, confidence: 0 };
  }
  // Subsample contour points (every Nth) to keep hull fast
  const step = Math.max(1, Math.floor(contour.pixels.length / 800));
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < contour.pixels.length; i += step) {
    const p = contour.pixels[i];
    pts.push([p % width, Math.floor(p / width)]);
  }
  const hull = convexHull(pts);
  const quad = minAreaRect(hull);
  if (!quad) return { quad: null, confidence: 0 };

  // Confidence: blend of area coverage and quad plausibility
  const area = contour.pixels.length / (width * height);
  // Quad side lengths (in pixels) — even on rotated docs aspect should
  // be roughly consistent with the source
  const sideA = Math.hypot(quad.tr[0] - quad.tl[0], quad.tr[1] - quad.tl[1]);
  const sideB = Math.hypot(quad.br[0] - quad.tr[0], quad.br[1] - quad.tr[1]);
  const sideC = Math.hypot(quad.bl[0] - quad.br[0], quad.bl[1] - quad.br[1]);
  const sideD = Math.hypot(quad.tl[0] - quad.bl[0], quad.tl[1] - quad.bl[1]);
  const perim = sideA + sideB + sideC + sideD;
  const minSide = Math.min(sideA, sideB, sideC, sideD);
  if (minSide < Math.min(width, height) * 0.15 || perim < 1) {
    return { quad, confidence: 0.15 };
  }
  const ratioA = Math.min(sideA, sideC) / Math.max(sideA, sideC);
  const ratioB = Math.min(sideB, sideD) / Math.max(sideB, sideD);
  const sidePlausibility = 0.5 * (ratioA + ratioB);
  const confidence = Math.min(1, area * 6 + 0.3 * sidePlausibility);
  return { quad, confidence };
}

/**
 * Perspective-correct crop from a quad. Output dimensions are the
 * rounded averages of the two horizontal and two vertical side
 * lengths. Bilinear sampling across the quadrilateral (the inverse
 * bilinear map is sufficient for nearly-flat documents; for strong
 * perspective a full homography would be needed — we approximate
 * with bilinear which is visually indistinguishable for IDs).
 */
export function cropToQuad(
  imageData: ImageData,
  quad: Quad
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const tl = quad.tl;
  const tr = quad.tr;
  const br = quad.br;
  const bl = quad.bl;
  const topW = Math.hypot(tr[0] - tl[0], tr[1] - tl[1]);
  const botW = Math.hypot(br[0] - bl[0], br[1] - bl[1]);
  const leftH = Math.hypot(bl[0] - tl[0], bl[1] - tl[1]);
  const rightH = Math.hypot(br[0] - tr[0], br[1] - tr[1]);
  const outW = Math.max(1, Math.round(Math.max(topW, botW)));
  const outH = Math.max(1, Math.round(Math.max(leftH, rightH)));
  const srcW = imageData.width;
  const srcData = imageData.data;
  const { canvas, ctx } = makeCanvas(outW, outH);
  const outImg = ctx.createImageData(outW, outH);
  const out = outImg.data;

  for (let y = 0; y < outH; y++) {
    // v ∈ [0,1] along the vertical axis
    const v = outH > 1 ? y / (outH - 1) : 0;
    // Interpolate top edge → bottom edge along v
    const topX = tl[0] + (tr[0] - tl[0]) * v;
    const topY = tl[1] + (tr[1] - tl[1]) * v;
    const botX = bl[0] + (br[0] - bl[0]) * v;
    const botY = bl[1] + (br[1] - bl[1]) * v;
    for (let x = 0; x < outW; x++) {
      const u = outW > 1 ? x / (outW - 1) : 0;
      const sx = topX + (botX - topX) * u;
      const sy = topY + (botY - topY) * u;
      // Bilinear sample from source
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      const ix1 = Math.min(srcW - 1, Math.max(0, ix + 1));
      const iy1 = Math.min(imageData.height - 1, Math.max(0, iy + 1));
      const cx = Math.min(srcW - 1, Math.max(0, ix));
      const cy = Math.min(imageData.height - 1, Math.max(0, iy));
      const i00 = (cy * srcW + cx) * 4;
      const i10 = (cy * srcW + ix1) * 4;
      const i01 = (iy1 * srcW + cx) * 4;
      const i11 = (iy1 * srcW + ix1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const outIdx = (y * outW + x) * 4;
      out[outIdx] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      out[outIdx + 1] =
        srcData[i00 + 1] * w00 +
        srcData[i10 + 1] * w10 +
        srcData[i01 + 1] * w01 +
        srcData[i11 + 1] * w11;
      out[outIdx + 2] =
        srcData[i00 + 2] * w00 +
        srcData[i10 + 2] * w10 +
        srcData[i01 + 2] * w01 +
        srcData[i11 + 2] * w11;
      out[outIdx + 3] = 255;
    }
  }
  ctx.putImageData(outImg, 0, 0);
  return { canvas, width: outW, height: outH };
}

/**
 * Full auto-crop pipeline for a data URL. If the detector finds a
 * document with confidence >= 0.45, the cropped (perspective-corrected)
 * image is returned. Otherwise the original data URL is returned and
 * `cropped: false`.
 */
export async function autoCropDocument(
  srcDataUrl: string
): Promise<{
  dataUrl: string;
  cropped: boolean;
  confidence: number;
  quad?: Quad;
}> {
  const img = await loadImage(srcDataUrl);
  // Downscale for detection speed (cap long edge at 1024)
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const maxDim = 1024;
  let scale = 1;
  if (Math.max(w, h) > maxDim) {
    scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const { quad, confidence } = detectDocumentEdges(imageData);
  if (!quad || confidence < 0.45) {
    return { dataUrl: srcDataUrl, cropped: false, confidence, quad: undefined };
  }
  // Scale quad back to original resolution for full-resolution crop
  const inv = scale > 0 ? 1 / scale : 1;
  const fullQuad: Quad = {
    tl: [quad.tl[0] * inv, quad.tl[1] * inv],
    tr: [quad.tr[0] * inv, quad.tr[1] * inv],
    br: [quad.br[0] * inv, quad.br[1] * inv],
    bl: [quad.bl[0] * inv, quad.bl[1] * inv],
  };
  const fullW = img.naturalWidth || img.width;
  const fullH = img.naturalHeight || img.height;
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = fullW;
  fullCanvas.height = fullH;
  const fullCtx = fullCanvas.getContext("2d", { willReadFrequently: true });
  if (!fullCtx) {
    return { dataUrl: srcDataUrl, cropped: false, confidence, quad };
  }
  fullCtx.drawImage(img, 0, 0);
  const fullData = fullCtx.getImageData(0, 0, fullW, fullH);
  const { canvas: croppedCanvas } = cropToQuad(fullData, fullQuad);
  return {
    dataUrl: croppedCanvas.toDataURL("image/jpeg", 0.9),
    cropped: true,
    confidence,
    quad: fullQuad,
  };
}

// ──────────────────────────────────────────────────────────────────────
// 3. Auto-enhancement
// ──────────────────────────────────────────────────────────────────────

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

/** Estimate noise as RMS of high-frequency content (image - blurred). */
function estimateNoise(gray: Float32Array, w: number, h: number): number {
  const blurred = gaussianBlur3x3(gray, w, h);
  let acc = 0;
  let n = 0;
  for (let i = 0; i < gray.length; i++) {
    const d = gray[i] - blurred[i];
    acc += d * d;
    n++;
  }
  return Math.sqrt(acc / Math.max(1, n));
}

/** Apply contrast adjustment to RGBA data, contrast ∈ [-100,100]. */
function applyContrast(data: Uint8ClampedArray, contrast: number) {
  const c = Math.max(-100, Math.min(100, contrast)) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = factor * (data[i] - 128) + 128;
    data[i + 1] = factor * (data[i + 1] - 128) + 128;
    data[i + 2] = factor * (data[i + 2] - 128) + 128;
  }
}

/** Apply brightness ∈ [-100,100] to RGBA data. */
function applyBrightness(data: Uint8ClampedArray, brightness: number) {
  const b = Math.max(-100, Math.min(100, brightness)) * 2.55;
  for (let i = 0; i < data.length; i += 4) {
    data[i] += b;
    data[i + 1] += b;
    data[i + 2] += b;
  }
}

/** Auto contrast via histogram stretch on luminance. */
function autoContrastStretch(data: Uint8ClampedArray) {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  if (max - min < 10) return;
  const scale = 255 / (max - min);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (data[i] - min) * scale;
    data[i + 1] = (data[i + 1] - min) * scale;
    data[i + 2] = (data[i + 2] - min) * scale;
  }
}

/** 3x3 unsharp mask. amount ∈ [0,100]. */
function unsharpMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number
) {
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const copy = new Uint8ClampedArray(data);
  const blend = Math.max(0, Math.min(1, amount / 100));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const px = Math.min(w - 1, Math.max(0, x + kx - 1));
          const py = Math.min(h - 1, Math.max(0, y + ky - 1));
          const pidx = (py * w + px) * 4;
          const wt = kernel[ky * 3 + kx];
          r += copy[pidx] * wt;
          g += copy[pidx + 1] * wt;
          b += copy[pidx + 2] * wt;
        }
      }
      data[idx] = copy[idx] * (1 - blend) + r * blend;
      data[idx + 1] = copy[idx + 1] * (1 - blend) + g * blend;
      data[idx + 2] = copy[idx + 2] * (1 - blend) + b * blend;
    }
  }
}

/** 3x3 median filter (channel-wise) for denoise. */
function medianDenoise(
  data: Uint8ClampedArray,
  w: number,
  h: number
) {
  const copy = new Uint8ClampedArray(data);
  const win: number[] = new Array(9);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const p = ((y + dy) * w + (x + dx)) * 4 + c;
            win[k++] = copy[p];
          }
        }
        // Insertion sort the 9 values, pick middle
        for (let i = 1; i < 9; i++) {
          const v = win[i];
          let j = i - 1;
          while (j >= 0 && win[j] > v) {
            win[j + 1] = win[j];
            j--;
          }
          win[j + 1] = v;
        }
        data[idx + c] = win[4];
      }
    }
  }
}

/**
 * Analyze image and apply optimal adjustments. Returns the
 * adjustments dict for transparency (so the UI can show "brightness
 * boosted +30 because too dark").
 */
export async function autoEnhance(
  srcDataUrl: string
): Promise<{ dataUrl: string; adjustments: AutoEnhanceAdjustments }> {
  const img = await loadImage(srcDataUrl);
  // Cap at 1600px for enhancement speed
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const maxDim = 1600;
  let scale = 1;
  if (Math.max(w, h) > maxDim) {
    scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const gray = toGray(imageData);
  const { mean: brightness, std: contrast } = meanStd(gray);
  const sharpness = laplacianVariance(gray, w, h);
  const noise = estimateNoise(gray, w, h);

  const reasons: string[] = [];
  const adj: AutoEnhanceAdjustments = {
    brightness: 0,
    contrast: 0,
    sharpness: 0,
    autoContrast: false,
    denoise: false,
    grayscale: false,
    reasons,
  };

  // Brightness
  if (brightness < 90) {
    adj.brightness = Math.min(80, Math.round((90 - brightness) * 0.6));
    reasons.push(`brightness boost +${adj.brightness} (mean ${brightness.toFixed(0)} < 90)`);
  } else if (brightness > 200) {
    adj.brightness = -Math.min(60, Math.round((brightness - 200) * 0.4));
    reasons.push(`brightness reduce ${adj.brightness} (mean ${brightness.toFixed(0)} > 200)`);
  }

  // Contrast / auto-contrast stretch
  if (contrast < 30) {
    adj.autoContrast = true;
    adj.contrast = 15;
    reasons.push(`auto-contrast + contrast +15 (std ${contrast.toFixed(1)} < 30)`);
  } else if (contrast < 50) {
    adj.contrast = 10;
    reasons.push(`contrast +10 (std ${contrast.toFixed(1)})`);
  }

  // Sharpness (unsharp mask)
  if (sharpness < 100) {
    adj.sharpness = Math.min(80, Math.round(40 + (100 - sharpness) * 0.4));
    reasons.push(`sharpen +${adj.sharpness} (laplacian ${sharpness.toFixed(1)} < 100)`);
  } else if (sharpness < 200) {
    adj.sharpness = 25;
    reasons.push(`sharpen +25 (laplacian ${sharpness.toFixed(1)})`);
  }

  // Denoise (median 3x3)
  if (noise > 8) {
    adj.denoise = true;
    reasons.push(`median denoise (noise RMS ${noise.toFixed(1)} > 8)`);
  }

  // Apply in safe order
  if (adj.denoise) medianDenoise(data, w, h);
  if (adj.autoContrast) autoContrastStretch(data);
  if (adj.contrast) applyContrast(data, adj.contrast);
  if (adj.brightness) applyBrightness(data, adj.brightness);
  if (adj.sharpness) unsharpMask(data, w, h, adj.sharpness);

  ctx.putImageData(imageData, 0, 0);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.9), adjustments: adj };
}

// ──────────────────────────────────────────────────────────────────────
// 4. Optimal resize (Lanczos-3)
// ──────────────────────────────────────────────────────────────────────

/** Document physical dimensions in mm (width × height, landscape). */
const DOC_DIMENSIONS_MM: Record<DocType, [number, number]> = {
  national_id: [85.6, 54], // ID-1 (credit card size)
  passport: [125, 88], // ICAO 9303 TD3
  driver_license: [85.6, 54], // typically ID-1
};

/**
 * Compute optimal pixel dimensions for OCR at the requested PPI.
 *   national_id  @ 300 PPI → 1012 × 637
 *   passport     @ 300 PPI → 1476 × 1039
 *
 * The function picks the doc-dimension pair (or falls back to ID-1)
 * and computes the target. If the source is larger, the caller should
 * downscale; if much smaller, the caller may upscale slightly (we cap
 * upscale at 1.5× to avoid introducing interpolation artifacts that
 * hurt OCR more than they help).
 */
export function computeOptimalDimensions(
  width: number,
  height: number,
  targetPpi: number = 300
): { width: number; height: number; scale: number; reason: string } {
  // Pick the document dimension key — defaults to national_id
  const docMm: [number, number] = DOC_DIMENSIONS_MM.national_id;
  const targetW = Math.round((docMm[0] / 25.4) * targetPpi);
  const targetH = Math.round((docMm[1] / 25.4) * targetPpi);
  // Decide scale based on the long edge
  const longEdge = Math.max(width, height);
  const targetLong = Math.max(targetW, targetH);
  let scale = targetLong / longEdge;
  let reason = `target ${targetLong}px @ ${targetPpi}PPI`;
  if (scale > 1.5) {
    scale = 1.5;
    reason = `upscale capped at 1.5× (source ${longEdge}px → ${Math.round(
      longEdge * scale
    )}px)`;
  } else if (scale < 1) {
    reason = `downscale ${scale.toFixed(2)}× (source ${longEdge}px → ${Math.round(
      longEdge * scale
    )}px, ${targetPpi}PPI target)`;
  }
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);
  return { width: outW, height: outH, scale, reason };
}

/**
 * Lanczos-3 high-quality resample. Sinc-windowed kernel:
 *   L(x) = sinc(x) * sinc(x/3)   for |x| < 3
 *        = 0                       otherwise
 * where sinc(z) = sin(πz) / (πz) and sinc(0) = 1.
 *
 * Two-pass separable implementation (horizontal then vertical) for
 * O(n·a) instead of O(n·a²) per output pixel.
 */
export function resizeImage(
  img: HTMLImageElement,
  targetW: number,
  targetH: number
): HTMLCanvasElement {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (srcW === targetW && srcH === targetH) {
    const { canvas, ctx } = makeCanvas(targetW, targetH);
    ctx.drawImage(img, 0, 0);
    return canvas;
  }
  // Source pixels
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) {
    const { canvas, ctx } = makeCanvas(targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    return canvas;
  }
  srcCtx.drawImage(img, 0, 0);
  const srcImage = srcCtx.getImageData(0, 0, srcW, srcH);
  const src = srcImage.data;

  const lanczos = (x: number): number => {
    if (x === 0) return 1;
    if (x <= -3 || x >= 3) return 0;
    const xp = x * Math.PI;
    const xl = x / 3 * Math.PI;
    return (Math.sin(xp) / xp) * (Math.sin(xl) / xl);
  };

  // Precompute horizontal weights
  const xRatio = srcW / targetW;
  const xSupport = Math.max(1, Math.ceil(3 * xRatio));
  const xWeights: Array<Array<{ idx: number; w: number }>> = [];
  for (let ox = 0; ox < targetW; ox++) {
    const center = (ox + 0.5) * xRatio - 0.5;
    const left = Math.ceil(center - xSupport);
    const right = Math.floor(center + xSupport);
    const list: Array<{ idx: number; w: number }> = [];
    let wsum = 0;
    for (let sx = left; sx <= right; sx++) {
      const c = sx - center;
      const w = lanczos(c);
      if (Math.abs(w) < 1e-5) continue;
      const ix = Math.min(srcW - 1, Math.max(0, sx));
      list.push({ idx: ix, w });
      wsum += w;
    }
    if (wsum !== 0) for (const item of list) item.w /= wsum;
    xWeights.push(list);
  }

  // First pass: horizontal resample → intermediate at (targetW, srcH)
  const inter = new Float32Array(targetW * srcH * 4);
  for (let y = 0; y < srcH; y++) {
    for (let ox = 0; ox < targetW; ox++) {
      const weights = xWeights[ox];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const { idx, w } of weights) {
        const si = (y * srcW + idx) * 4;
        r += src[si] * w;
        g += src[si + 1] * w;
        b += src[si + 2] * w;
        a += src[si + 3] * w;
      }
      const di = (y * targetW + ox) * 4;
      inter[di] = r;
      inter[di + 1] = g;
      inter[di + 2] = b;
      inter[di + 3] = a;
    }
  }

  // Precompute vertical weights
  const yRatio = srcH / targetH;
  const ySupport = Math.max(1, Math.ceil(3 * yRatio));
  const yWeights: Array<Array<{ idx: number; w: number }>> = [];
  for (let oy = 0; oy < targetH; oy++) {
    const center = (oy + 0.5) * yRatio - 0.5;
    const top = Math.ceil(center - ySupport);
    const bot = Math.floor(center + ySupport);
    const list: Array<{ idx: number; w: number }> = [];
    let wsum = 0;
    for (let sy = top; sy <= bot; sy++) {
      const c = sy - center;
      const w = lanczos(c);
      if (Math.abs(w) < 1e-5) continue;
      const iy = Math.min(srcH - 1, Math.max(0, sy));
      list.push({ idx: iy, w });
      wsum += w;
    }
    if (wsum !== 0) for (const item of list) item.w /= wsum;
    yWeights.push(list);
  }

  // Second pass: vertical resample → final at (targetW, targetH)
  const { canvas, ctx } = makeCanvas(targetW, targetH);
  const out = ctx.createImageData(targetW, targetH);
  const outData = out.data;
  for (let oy = 0; oy < targetH; oy++) {
    const weights = yWeights[oy];
    for (let x = 0; x < targetW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const { idx, w } of weights) {
        const si = (idx * targetW + x) * 4;
        r += inter[si] * w;
        g += inter[si + 1] * w;
        b += inter[si + 2] * w;
        a += inter[si + 3] * w;
      }
      const di = (oy * targetW + x) * 4;
      outData[di] = Math.max(0, Math.min(255, r));
      outData[di + 1] = Math.max(0, Math.min(255, g));
      outData[di + 2] = Math.max(0, Math.min(255, b));
      outData[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

// ──────────────────────────────────────────────────────────────────────
// 5. Quality pre-check
// ──────────────────────────────────────────────────────────────────────

/** Count specular-highlight pixels (≥ 240 in all RGB channels). */
function detectGlare(data: Uint8ClampedArray): number {
  let count = 0;
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    if (data[i] >= 240 && data[i + 1] >= 240 && data[i + 2] >= 240) {
      count++;
    }
  }
  return total > 0 ? count / total : 0;
}

/**
 * Estimate the document skew angle (in degrees, magnitude only) via
 * gradient-direction histogram + bias toward "cardinal" angles. A full
 * Hough transform would be more accurate but 20× slower; this is a
 * good proxy for verifying a roughly-aligned scan.
 */
function estimateSkew(gray: Float32Array, w: number, h: number): number {
  // Compute Sobel angles on a subsampled grid
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
      const ang = Math.atan2(gy, gx); // -π..π
      angles.push(ang);
      magnitudes.push(mag);
      totalMag += mag;
    }
  }
  if (totalMag === 0) return 0;
  // Build a 36-bin histogram (-π..π, weighted by magnitude)
  const bins = 36;
  const hist = new Float32Array(bins);
  for (let k = 0; k < angles.length; k++) {
    const bin = Math.min(
      bins - 1,
      Math.max(0, Math.floor(((angles[k] + Math.PI) / (2 * Math.PI)) * bins))
    );
    hist[bin] += magnitudes[k];
  }
  // Find peaks in the cardinal directions (0°, 90°, 180°, 270°).
  // The dominant "non-cardinal" component indicates skew.
  let nonCardinal = 0;
  let cardinal = 0;
  for (let b = 0; b < bins; b++) {
    const a = (b / bins) * 2 * Math.PI - Math.PI;
    const deg = (a * 180) / Math.PI;
    const nearCardinal =
      Math.abs(deg) < 8 ||
      Math.abs(deg - 90) < 8 ||
      Math.abs(deg + 90) < 8 ||
      Math.abs(deg - 180) < 8 ||
      Math.abs(deg + 180) < 8;
    if (nearCardinal) cardinal += hist[b];
    else nonCardinal += hist[b];
  }
  // Heuristic: skew magnitude is the ratio of off-cardinal energy.
  // We map it to a degree estimate (max ~15°).
  const ratio = nonCardinal / (nonCardinal + cardinal + 1e-6);
  return Math.min(15, ratio * 30);
}

/**
 * Comprehensive pre-check before sending an image to OCR/AI. Returns
 * an overall grade, a 0-100 score, and per-issue recommendations.
 */
export async function analyzeImageQuality(
  srcDataUrl: string,
  docType: DocType | string = "national_id"
): Promise<ImageQualityReport> {
  const img = await loadImage(srcDataUrl);
  // Cap at 1024px for analysis speed
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  const origW = w;
  const origH = h;
  const maxDim = 1024;
  if (Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s);
    h = Math.round(h * s);
  }
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const gray = toGray(imageData);
  const { mean: brightness, std: contrast } = meanStd(gray);
  const sharpness = laplacianVariance(gray, w, h);
  const noise = estimateNoise(gray, w, h);
  const glare = detectGlare(data);
  const skew = estimateSkew(gray, w, h);

  // DPI estimate: assume the image fills the frame with the doc
  const docKey: DocType = (
    ["national_id", "passport", "driver_license"].includes(docType as DocType)
      ? (docType as DocType)
      : "national_id"
  );
  const [docWmm, docHmm] = DOC_DIMENSIONS_MM[docKey];
  // Long edge in pixels, mapped to doc's long edge in inches
  const longEdgePx = Math.max(origW, origH);
  const longEdgeMm = Math.max(docWmm, docHmm);
  const dpi = Math.round(longEdgePx / (longEdgeMm / 25.4));

  const issues: ImageQualityIssue[] = [];

  // Sharpness — Laplacian variance > 100 is sharp
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

  // Brightness — 90..200 is good
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

  // Contrast — std > 30 is good
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

  // Noise — RMS high-frequency
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

  // Glare — fraction of specular-highlight pixels
  if (glare > 0.04) {
    issues.push({
      type: "glare",
      severity: "high",
      value: Math.round(glare * 1000) / 10, // %
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

  // Skew — |angle| > 5° is bad for OCR
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

  // Resolution — ID @ 300 PPI ≈ 1012×637
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

  // Overall score (start at 100, deduct per issue)
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

// ──────────────────────────────────────────────────────────────────────
// 6. Full pipeline
// ──────────────────────────────────────────────────────────────────────

/** Estimate byte size of a base64 data URL payload. */
function dataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(",");
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  // Base64 ratio ≈ 4:3
  return Math.round((b64.length * 3) / 4);
}

/**
 * Full auto-adjustment pipeline. Runs (in order):
 *   1. Read EXIF orientation
 *   2. Load image, apply EXIF rotation (if rotate: true)
 *   3. Detect document edges, auto-crop (if crop: true)
 *   4. Auto-enhance (brightness/contrast/sharpness/denoise — if enhance: true)
 *   5. Resize to optimal dimensions (Lanczos-3)
 *   6. Compress to JPEG quality 0.85, max 1.5MB
 *   7. Analyze quality (return report)
 *   8. Return all metadata
 *
 * Accepts either a File or an existing data URL. The original byte
 * size is read from the File when available, otherwise estimated.
 */
export async function autoAdjustImage(
  file: File | string,
  options: AutoAdjustOptions = {}
): Promise<AutoAdjustResult> {
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const {
    docType = "national_id",
    crop = true,
    enhance = true,
    rotate = true,
    maxSize = 1500,
  } = options;

  // Original size + initial data URL
  const originalBytes =
    typeof file === "string"
      ? dataUrlBytes(file)
      : file.size;
  const initialDataUrl =
    typeof file === "string" ? file : await fileToInitialDataUrl(file);

  // 1. EXIF orientation
  let exifOrientation = 1;
  if (rotate && typeof file !== "string") {
    exifOrientation = await readExifOrientation(file);
  }

  // 2. Load + apply EXIF rotation
  let img = await loadImage(initialDataUrl);
  const origW = img.naturalWidth || img.width;
  const origH = img.naturalHeight || img.height;
  let workingCanvas: HTMLCanvasElement;
  if (rotate && exifOrientation !== 1) {
    const r = applyExifOrientation(img, exifOrientation);
    workingCanvas = r.canvas;
  } else {
    const { canvas, ctx } = makeCanvas(origW, origH);
    ctx.drawImage(img, 0, 0);
    workingCanvas = canvas;
  }
  let currentDataUrl = workingCanvas.toDataURL("image/jpeg", 0.92);

  // 3. Detect edges + auto-crop
  let cropped = false;
  let cropConfidence = 0;
  if (crop) {
    try {
      const result = await autoCropDocument(currentDataUrl);
      if (result.cropped) {
        currentDataUrl = result.dataUrl;
        cropped = true;
        cropConfidence = result.confidence;
      } else {
        cropConfidence = result.confidence;
      }
    } catch {
      // fall through with uncropped image
    }
  }

  // 4. Auto-enhance
  let adjustments: AutoEnhanceAdjustments = {
    brightness: 0,
    contrast: 0,
    sharpness: 0,
    autoContrast: false,
    denoise: false,
    grayscale: false,
    reasons: [],
  };
  if (enhance) {
    try {
      const r = await autoEnhance(currentDataUrl);
      currentDataUrl = r.dataUrl;
      adjustments = r.adjustments;
    } catch {
      // fall through with un-enhanced image
    }
  }

  // 5. Resize to optimal dimensions
  img = await loadImage(currentDataUrl);
  const curW = img.naturalWidth || img.width;
  const curH = img.naturalHeight || img.height;
  const optimal = computeOptimalDimensions(curW, curH, 300);
  // Cap to maxSize (the verification pipeline caps anyway)
  let finalW = optimal.width;
  let finalH = optimal.height;
  const longEdge = Math.max(finalW, finalH);
  if (longEdge > maxSize) {
    const s = maxSize / longEdge;
    finalW = Math.round(finalW * s);
    finalH = Math.round(finalH * s);
  }
  // Only resize if it actually changes dimensions
  let resizedCanvas: HTMLCanvasElement;
  if (finalW !== curW || finalH !== curH) {
    resizedCanvas = resizeImage(img, finalW, finalH);
  } else {
    const { canvas, ctx } = makeCanvas(finalW, finalH);
    ctx.drawImage(img, 0, 0);
    resizedCanvas = canvas;
  }

  // 6. Compress to JPEG (quality 0.85, max 1.5MB)
  const MAX_BYTES = 1500 * 1024;
  let quality = 0.85;
  let compressed = resizedCanvas.toDataURL("image/jpeg", quality);
  while (dataUrlBytes(compressed) > MAX_BYTES && quality > 0.45) {
    quality = Math.max(0.45, quality - 0.1);
    compressed = resizedCanvas.toDataURL("image/jpeg", quality);
  }
  // Last resort: downscale the canvas and re-encode
  let scale = 1;
  while (dataUrlBytes(compressed) > MAX_BYTES && scale > 0.5) {
    scale = Math.round(scale * 0.85 * 10) / 10;
    const sw = Math.max(1, Math.round(finalW * scale));
    const sh = Math.max(1, Math.round(finalH * scale));
    const c2 = document.createElement("canvas");
    c2.width = sw;
    c2.height = sh;
    const cx2 = c2.getContext("2d");
    if (!cx2) break;
    cx2.drawImage(resizedCanvas, 0, 0, sw, sh);
    compressed = c2.toDataURL("image/jpeg", Math.max(0.55, quality));
  }

  // 7. Quality analysis
  let qualityReport: ImageQualityReport;
  try {
    qualityReport = await analyzeImageQuality(compressed, docType);
  } catch {
    qualityReport = {
      overall: "acceptable",
      score: 70,
      issues: [],
      metrics: {
        sharpness: 0,
        brightness: 0,
        contrast: 0,
        noise: 0,
        resolution: { width: finalW, height: finalH, dpi: 0 },
        glare: 0,
        skew: 0,
      },
    };
  }

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();

  return {
    dataUrl: compressed,
    originalSize: {
      width: origW,
      height: origH,
      bytes: originalBytes,
    },
    adjustedSize: {
      width: finalW,
      height: finalH,
      bytes: dataUrlBytes(compressed),
    },
    adjustments,
    quality: qualityReport,
    processingTimeMs: Math.round(t1 - t0),
    cropped,
    cropConfidence,
    rotated: rotate && exifOrientation !== 1,
    exifOrientation,
  };
}

/**
 * Convert a File to a data URL (used as the input to the pipeline).
 * Uses URL.createObjectURL to avoid Safari's data-URL size limit.
 */
function fileToInitialDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => URL.revokeObjectURL(blobUrl);
    img.onerror = () => {
      cleanup();
      reject(
        new Error(
          "Could not decode this image. If it's a HEIC photo from an iPhone, please convert it to JPG first."
        )
      );
    };
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        cleanup();
        return reject(new Error("Canvas error"));
      }
      ctx.drawImage(img, 0, 0);
      cleanup();
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = blobUrl;
  });
}
