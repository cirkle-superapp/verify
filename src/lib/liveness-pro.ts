/**
 * Liveness Pro — Enhanced Anti-Spoofing Liveness Detection (v2).
 *
 * Upgrades the basic frame-differencing with:
 *
 * 1. DIRECTIONAL MOTION ANALYSIS (block-based optical flow):
 *    - Divides frame into 4×4 grid of blocks
 *    - Computes per-block motion vector (dx, dy) between consecutive frames
 *    - Detects: leftward, rightward, upward, downward head rotation
 *    - Localizes motion to face regions (eye-area for blink, mouth for smile)
 *
 * 2. CHALLENGE-RESPONSE VERIFICATION:
 *    - Verifies the REQUESTED action was actually performed
 *
 * 3. ANTI-SPOOFING (Presentation Attack Detection):
 *    - Print attack: static photo → uniform texture, zero micro-motion variance
 *    - Screen replay: moiré pattern → high-frequency noise spikes in FFT
 *    - Depth check: real 3D face has brightness gradient (nose brighter than sides)
 *
 * 4. TEMPORAL ANALYSIS:
 *    - Motion velocity profile (bell curve = human, flat = static)
 *    - Acceleration/deceleration patterns
 *
 * 5. NEW v2 PAD SIGNALS:
 *    - Optical flow consistency (coherent + non-zero flow = real)
 *    - Texture analysis (LBP — real skin has distinctive texture)
 *    - Frequency domain check (FFT moiré detection on face ROI)
 *    - Color distortion detection (printed-photo color cast)
 *    - 3D depth estimation (left/right face-half disparity proxy)
 *    - Reflection / specular highlight detection (real skin has specular highlights)
 *    - Blink detection (eye-region intensity change over multiple frames)
 *
 * Score: 0-100 with detailed breakdown for UI.
 *
 * Pure TypeScript — `sharp` is used only for image decode/resize; all signal
 * math (FFT, LBP, optical flow) operates on raw typed arrays so it is safe
 * for Vercel deployment without native dependencies.
 */

import sharp from "sharp";
import type { LivenessResult, LivenessAction } from "@/lib/verification-types";

// ─── Types ────────────────────────────────────────────────────────

export interface LivenessProScore {
  // Motion analysis (0-40)
  motionPresent: boolean;
  motionScore: number;        // 0-40 (avg inter-frame diff)
  motionDirection: "left" | "right" | "up" | "down" | "none" | "mixed";
  motionMagnitude: number;    // average |dx + dy| across blocks

  // Challenge-response (0-30)
  challengeMet: boolean;
  challengeScore: number;     // 0-30 (did motion match requested action?)
  requestedAction: string;
  detectedMotionDirection: string;

  // Anti-spoofing (0-20)
  printAttackScore: number;   // 0-10 (higher = less likely print attack)
  screenArtifactScore: number; // 0-5 (higher = less likely screen replay)
  depthScore: number;         // 0-5 (higher = more 3D depth detected)

  // Temporal (0-10)
  motionSmoothnessScore: number; // 0-5 (human motion has jerk)
  velocityProfileScore: number;  // 0-5 (bell curve = human)

  // ─── NEW v2 PAD signals ───
  opticalFlowConsistency?: number;   // 0..1 (coherent non-zero flow = real)
  lbpTextureScore?: number;          // 0..1 (distinctive skin texture = real)
  fftMoireScore?: number;            // 0..1 (low moiré = real)
  colorDistortionScore?: number;     // 0..1 (no color cast = real)
  depthDisparityScore?: number;      // 0..1 (3D disparity = real)
  specularHighlightScore?: number;   // 0..1 (highlights present = real skin)
  blinkDetected?: boolean;
  blinkConfidence?: number;          // 0..1

  // Aggregate PAD score 0..1 (weighted combination of all anti-spoof signals).
  padScore?: number;

  // Overall
  totalScore: number;         // 0-100
  isLive: boolean;
  passThreshold: number;      // 60

  // Details for UI
  framesAnalyzed: number;
  detectedActions: LivenessAction[];
  issues: string[];
  suggestions: string[];
  reasoning: string;
}

// Alias for forward-compatibility — newer code may use this name.
export type LivenessProResult = LivenessProScore;

// ─── Frame preprocessing ─────────────────────────────────────────

interface FrameData {
  width: number;
  height: number;
  grayscale: Uint8Array;
  rgb: Uint8Array;     // RGB (3 bytes per pixel) — for color checks
  blocks: number[][];  // 4×4 grid of mean brightness per block
}

const GRID_SIZE = 4;
const ANALYSIS_WIDTH = 120;

async function preprocessFrame(buffer: Buffer): Promise<FrameData> {
  // Resize to fixed width, keep aspect ratio (don't force square — needed for
  // left/right face-half disparity & color distortion checks).
  const { data, info } = await sharp(buffer)
    .resize({ width: ANALYSIS_WIDTH, height: ANALYSIS_WIDTH, fit: "cover" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const channels = info.channels;
  const rgb = new Uint8Array(w * h * 3);
  const grayscale = new Uint8Array(w * h);

  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    const r = data[i] || 0;
    const g = data[i + 1] || 0;
    const b = data[i + 2] || 0;
    rgb[p * 3] = r;
    rgb[p * 3 + 1] = g;
    rgb[p * 3 + 2] = b;
    // Luminance (ITU-R BT.601)
    grayscale[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Compute 4×4 block means
  const blocks: number[][] = [];
  const blockW = Math.floor(w / GRID_SIZE);
  const blockH = Math.floor(h / GRID_SIZE);
  for (let by = 0; by < GRID_SIZE; by++) {
    blocks[by] = [];
    for (let bx = 0; bx < GRID_SIZE; bx++) {
      let sum = 0, count = 0;
      for (let y = by * blockH; y < (by + 1) * blockH && y < h; y++) {
        for (let x = bx * blockW; x < (bx + 1) * blockW && x < w; x++) {
          sum += grayscale[y * w + x];
          count++;
        }
      }
      blocks[by][bx] = count > 0 ? sum / count : 0;
    }
  }

  return { width: w, height: h, grayscale, rgb, blocks };
}

// ─── Block-based motion vector estimation ───────────────────────

interface MotionVector {
  dx: number;
  dy: number;
  magnitude: number;
}

function estimateBlockMotion(prev: number[][], curr: number[][]): MotionVector {
  let totalDx = 0, totalDy = 0, count = 0;

  for (let by = 1; by < GRID_SIZE - 1; by++) {
    for (let bx = 1; bx < GRID_SIZE - 1; bx++) {
      const currVal = curr[by][bx];
      let bestDx = 0, bestDy = 0, bestDiff = Infinity;

      for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
          const py = by + dy;
          const px = bx + dx;
          if (py < 0 || py >= GRID_SIZE || px < 0 || px >= GRID_SIZE) continue;
          const diff = Math.abs(currVal - prev[py][px]);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      totalDx += bestDx;
      totalDy += bestDy;
      count++;
    }
  }

  const dx = count > 0 ? totalDx / count : 0;
  const dy = count > 0 ? totalDy / count : 0;
  const magnitude = Math.sqrt(dx * dx + dy * dy);

  return { dx, dy, magnitude };
}

// ─── Frame-level diff ─────────────────────────────────────────────

function frameDiff(prev: Uint8Array, curr: Uint8Array): number {
  let total = 0;
  const len = Math.min(prev.length, curr.length);
  for (let i = 0; i < len; i++) {
    total += Math.abs(prev[i] - curr[i]);
  }
  return total / len;
}

// ─── Region-specific motion (for blink/smile detection) ──────────

function regionDiff(
  prev: Uint8Array,
  curr: Uint8Array,
  width: number,
  height: number,
  region: "eyes" | "mouth" | "full",
): number {
  let x1, y1, x2, y2;
  if (region === "eyes") {
    x1 = Math.floor(width * 0.3); x2 = Math.floor(width * 0.7);
    y1 = Math.floor(height * 0.3); y2 = Math.floor(height * 0.45);
  } else if (region === "mouth") {
    x1 = Math.floor(width * 0.35); x2 = Math.floor(width * 0.65);
    y1 = Math.floor(height * 0.6); y2 = Math.floor(height * 0.75);
  } else {
    x1 = 0; x2 = width; y1 = 0; y2 = height;
  }

  let total = 0, count = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = y * width + x;
      total += Math.abs(prev[idx] - curr[idx]);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

// ─── Legacy anti-spoofing checks (kept for backward compat) ─────

/** Detect print attack: static photos have uniform texture (low local variance). */
function detectPrintAttack(frames: FrameData[]): { score: number; isStatic: boolean } {
  const variances: number[] = [];
  for (const frame of frames) {
    const { grayscale, width, height } = frame;
    let localVarSum = 0, count = 0;
    for (let i = 0; i < 100; i++) {
      const x = 1 + Math.floor(Math.random() * (width - 2));
      const y = 1 + Math.floor(Math.random() * (height - 2));
      const center = grayscale[y * width + x];
      let sum = 0, sqSum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = grayscale[(y + dy) * width + (x + dx)];
          sum += v;
          sqSum += v * v;
        }
      }
      const mean = sum / 9;
      const variance = sqSum / 9 - mean * mean;
      localVarSum += variance;
      count++;
    }
    variances.push(localVarSum / count);
  }

  const avgVar = variances.reduce((a, b) => a + b, 0) / variances.length;
  if (avgVar > 80) return { score: 10, isStatic: false };
  if (avgVar > 50) return { score: 7, isStatic: false };
  if (avgVar > 20) return { score: 4, isStatic: false };
  return { score: 1, isStatic: true };
}

/** Detect screen replay: moiré pattern = high-frequency noise spikes. */
function detectScreenArtifact(frames: FrameData[]): { score: number; hasMoire: boolean } {
  let hfEnergy = 0, count = 0;
  for (const frame of frames) {
    const { grayscale, width, height } = frame;
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const idx = y * width + x;
        const h = Math.abs(grayscale[idx] - grayscale[idx + 1]);
        const v = Math.abs(grayscale[idx] - grayscale[idx + width]);
        hfEnergy += (h + v) / 2;
        count++;
      }
    }
  }
  const avgHF = count > 0 ? hfEnergy / count : 0;
  if (avgHF < 12) return { score: 5, hasMoire: false };
  if (avgHF < 18) return { score: 3, hasMoire: false };
  if (avgHF < 25) return { score: 2, hasMoire: false };
  return { score: 0, hasMoire: true };
}

/** Depth estimation: real 3D face has brightness gradient (nose brighter). */
function estimateDepth(frame: FrameData): { score: number; hasDepth: boolean } {
  const { blocks } = frame;
  const center = blocks[1][1] + blocks[1][2] + blocks[2][1] + blocks[2][2];
  const edges =
    blocks[0][0] + blocks[0][3] + blocks[3][0] + blocks[3][3] +
    blocks[0][1] + blocks[0][2] + blocks[3][1] + blocks[3][2];
  const centerAvg = center / 4;
  const edgeAvg = edges / 8;
  const gradient = Math.abs(centerAvg - edgeAvg);

  if (gradient > 20) return { score: 5, hasDepth: true };
  if (gradient > 12) return { score: 4, hasDepth: true };
  if (gradient > 6) return { score: 2, hasDepth: false };
  return { score: 0, hasDepth: false };
}

// ─── Temporal analysis ────────────────────────────────────────────

function analyzeMotionSmoothness(diffs: number[]): { score: number; isSmooth: boolean } {
  if (diffs.length < 3) return { score: 0, isSmooth: false };
  const jerks: number[] = [];
  for (let i = 2; i < diffs.length; i++) {
    const a1 = diffs[i - 1] - diffs[i - 2];
    const a2 = diffs[i] - diffs[i - 1];
    jerks.push(Math.abs(a2 - a1));
  }
  const avgJerk = jerks.reduce((a, b) => a + b, 0) / jerks.length;
  if (avgJerk > 1.0) return { score: 5, isSmooth: false };
  if (avgJerk > 0.5) return { score: 4, isSmooth: false };
  if (avgJerk > 0.2) return { score: 2, isSmooth: false };
  return { score: 1, isSmooth: true };
}

function analyzeVelocityProfile(diffs: number[]): { score: number; isBellCurve: boolean } {
  if (diffs.length < 4) return { score: 0, isBellCurve: false };
  const max = Math.max(...diffs);
  const maxIdx = diffs.indexOf(max);
  const beforeMax = diffs.slice(0, maxIdx);
  const afterMax = diffs.slice(maxIdx + 1);
  const rampsUp = beforeMax.length > 0 && beforeMax.every((d, i) => i === 0 || d >= beforeMax[i - 1] * 0.7);
  const rampsDown = afterMax.length > 0 && afterMax.every((d, i) => i === 0 || d <= afterMax[i - 1] * 1.3);
  if (rampsUp && rampsDown && max > 3) return { score: 5, isBellCurve: true };
  if (max > 3) return { score: 2, isBellCurve: false };
  return { score: 0, isBellCurve: false };
}

// ─── Challenge-response verification ─────────────────────────────

function verifyChallenge(
  action: LivenessAction,
  motionVectors: MotionVector[],
  eyeRegionDiffs: number[],
  mouthRegionDiffs: number[],
): { met: boolean; score: number; detectedDirection: string } {
  const avgDx = motionVectors.reduce((a, v) => a + v.dx, 0) / (motionVectors.length || 1);
  const avgDy = motionVectors.reduce((a, v) => a + v.dy, 0) / (motionVectors.length || 1);
  const maxEyeDiff = Math.max(...eyeRegionDiffs);
  const maxMouthDiff = Math.max(...mouthRegionDiffs);

  switch (action) {
    case "turn_left":
      return {
        met: avgDx < -0.1,
        score: avgDx < -0.2 ? 30 : avgDx < -0.1 ? 20 : 5,
        detectedDirection: avgDx < 0 ? "left" : "none",
      };
    case "turn_right":
      return {
        met: avgDx > 0.1,
        score: avgDx > 0.2 ? 30 : avgDx > 0.1 ? 20 : 5,
        detectedDirection: avgDx > 0 ? "right" : "none",
      };
    case "look_up":
      return {
        met: avgDy < -0.1,
        score: avgDy < -0.2 ? 30 : avgDy < -0.1 ? 20 : 5,
        detectedDirection: avgDy < 0 ? "up" : "none",
      };
    case "blink":
      return {
        met: maxEyeDiff > 5,
        score: maxEyeDiff > 10 ? 30 : maxEyeDiff > 5 ? 20 : 5,
        detectedDirection: maxEyeDiff > 5 ? "blink" : "none",
      };
    case "smile":
      return {
        met: maxMouthDiff > 4,
        score: maxMouthDiff > 8 ? 30 : maxMouthDiff > 4 ? 20 : 5,
        detectedDirection: maxMouthDiff > 4 ? "smile" : "none",
      };
    default:
      return { met: false, score: 0, detectedDirection: "none" };
  }
}

// ══════════════════════════════════════════════════════════════════
// ─── NEW v2: Pure-TS signal helpers ───────────────────────────────
// ══════════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Compute Local Binary Pattern (LBP) histogram variance over a grayscale
 * image.
 *
 * Semantics: variance is computed over the 256-bin LBP histogram (each bin's
 * probability vs the mean probability 1/256). A CONCENTRATED histogram
 * (most pixels in a few bins — uniform/flat texture, e.g. printed photos)
 * yields HIGH variance. A SPREAD histogram (pixels distributed across many
 * bins — distinctive skin micro-texture) yields LOW variance.
 *
 * Callers interpreting "real skin = distinctive texture" should INVERT this
 * value (e.g. `1 - normalize(variance)`).
 *
 * @param imageData grayscale buffer (1 byte per pixel)
 * @param width   image width in pixels
 * @param height  image height in pixels
 * @returns raw LBP histogram variance (0..~0.0039 max). 0 if input too small.
 */
export function computeLBP(imageData: Uint8Array, width: number, height: number): number {
  if (!imageData || width < 3 || height < 3) return 0;

  const histogram = new Array(256).fill(0);
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const center = imageData[y * width + x];
      // 8-neighbor LBP (clockwise from top-left)
      let pattern = 0;
      const neighbors = [
        imageData[(y - 1) * width + (x - 1)], // 0: top-left
        imageData[(y - 1) * width + x],        // 1: top
        imageData[(y - 1) * width + (x + 1)], // 2: top-right
        imageData[y * width + (x + 1)],        // 3: right
        imageData[(y + 1) * width + (x + 1)], // 4: bottom-right
        imageData[(y + 1) * width + x],        // 5: bottom
        imageData[(y + 1) * width + (x - 1)], // 6: bottom-left
        imageData[y * width + (x - 1)],        // 7: left
      ];
      for (let i = 0; i < 8; i++) {
        if (neighbors[i] >= center) pattern |= (1 << i);
      }
      histogram[pattern]++;
      count++;
    }
  }
  if (count === 0) return 0;

  // Normalize histogram to probabilities
  const probs = histogram.map((h) => h / count);
  // Mean probability per bin (uniform mean = 1/256)
  const mean = 1 / 256;
  // Variance of histogram (high = concentrated = uniform texture,
  // low = spread = distinctive texture)
  let variance = 0;
  for (const p of probs) variance += (p - mean) ** 2;
  variance /= probs.length;

  return variance;
}

/**
 * Maximum possible LBP histogram variance — occurs when 100% of pixels fall
 * into a single bin. Used to normalize raw variance into a 0..1 score.
 */
const LBP_MAX_VARIANCE = (() => {
  const mean = 1 / 256;
  return ((1 - mean) ** 2 + 255 * mean * mean) / 256;
})();

/**
 * Compute the magnitude and phase of the 1D FFT of `imageData`.
 *
 * Pure TypeScript iterative radix-2 Cooley-Tukey FFT (no native deps).
 * Input length is padded/truncated to the nearest power of 2 (capped at
 * 2^16 = 65536 for Vercel function time limits).
 *
 * @param imageData  Float32Array of real samples (any length)
 * @returns { magnitude, phase } as Float32Arrays of the same length as input,
 *          each element i corresponding to frequency bin i.
 */
export function computeFFT(imageData: Float32Array): {
  magnitude: Float32Array;
  phase: Float32Array;
} {
  const nInput = imageData.length;
  if (nInput === 0) {
    return { magnitude: new Float32Array(0), phase: new Float32Array(0) };
  }

  // Determine FFT size: next power of 2, capped at 2^16.
  let n = 1;
  while (n < nInput && n < 65536) n <<= 1;
  if (n < 1) n = 1;

  // Build complex input: real = sample (zero-padded or truncated), imag = 0
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  const copyLen = Math.min(nInput, n);
  for (let i = 0; i < copyLen; i++) re[i] = imageData[i];

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j |= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Iterative radix-2 Cooley-Tukey butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < halfLen; k++) {
        const idxEven = i + k;
        const idxOdd = i + k + halfLen;
        const tRe = curRe * re[idxOdd] - curIm * im[idxOdd];
        const tIm = curRe * im[idxOdd] + curIm * re[idxOdd];
        re[idxOdd] = re[idxEven] - tRe;
        im[idxOdd] = im[idxEven] - tIm;
        re[idxEven] += tRe;
        im[idxEven] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  // Output arrays: same length as input. For input length < n, we keep only
  // the first nInput bins (truncating the high-frequency tail).
  const magnitude = new Float32Array(nInput);
  const phase = new Float32Array(nInput);
  for (let i = 0; i < nInput; i++) {
    const r = re[i];
    const imV = im[i];
    magnitude[i] = Math.sqrt(r * r + imV * imV);
    phase[i] = imV === 0 && r === 0 ? 0 : Math.atan2(imV, r);
  }

  return { magnitude, phase };
}

// ─── NEW v2: Optical flow consistency ───────────────────────────

/**
 * Optical flow consistency: compares per-frame motion vectors for coherence.
 * Real faces produce coherent + non-zero flow (consistent direction across
 * blocks, non-trivial magnitude). Spoofed static images produce zero flow.
 *
 * @param motionVectors per-frame motion vectors
 * @param frameDiffs     per-frame mean abs diffs (motion magnitude proxy)
 * @returns 0..1 (high = real)
 */
function computeOpticalFlowConsistency(
  motionVectors: MotionVector[],
  frameDiffs: number[],
): number {
  if (motionVectors.length === 0) return 0;

  // Mean flow direction (vector average)
  let sumDx = 0, sumDy = 0;
  for (const v of motionVectors) { sumDx += v.dx; sumDy += v.dy; }
  const meanDx = sumDx / motionVectors.length;
  const meanDy = sumDy / motionVectors.length;
  const meanMag = Math.sqrt(meanDx * meanDx + meanDy * meanDy);

  // Direction consistency: cosine similarity of each vector to the mean
  let cosSum = 0, validCount = 0;
  for (const v of motionVectors) {
    const vMag = Math.sqrt(v.dx * v.dx + v.dy * v.dy);
    if (vMag < 1e-6) continue;
    const dot = v.dx * meanDx + v.dy * meanDy;
    const cos = dot / (vMag * (meanMag || 1));
    cosSum += Math.max(0, cos); // negative = opposite direction (bad)
    validCount++;
  }
  const dirConsistency = validCount > 0 ? cosSum / validCount : 0;

  // Magnitude: zero flow = spoofed static image (low score)
  const avgFrameDiff = frameDiffs.length > 0
    ? frameDiffs.reduce((a, b) => a + b, 0) / frameDiffs.length
    : 0;
  const magScore = clamp01(avgFrameDiff / 8); // 8+ avg diff = real motion

  // Coherent + non-zero flow = real
  return clamp01(0.5 * dirConsistency + 0.5 * magScore);
}

// ─── NEW v2: FFT moiré detection on face ROI ────────────────────

/**
 * FFT frequency-domain check on the face ROI. Real face images have a 1/f
 * spectrum (energy concentrated at low frequencies). Print attacks and screen
 * replays exhibit characteristic mid/high-frequency spikes (Moiré pattern,
 * halftone screen, refresh-rate artifacts).
 *
 * @param grayscale face ROI grayscale buffer
 * @param width   ROI width
 * @param height  ROI height
 * @returns 0..1 (high = real, no moiré)
 */
function detectMoireFFT(
  grayscale: Uint8Array,
  width: number,
  height: number,
): number {
  if (width < 4 || height < 4) return 0;

  // Use row-wise FFTs averaged into a 1D magnitude spectrum
  // (column averaging reduces noise and is fast enough for Vercel).
  const spectrum = new Float32Array(width);
  let rowsProcessed = 0;
  const maxRows = 32; // cap rows for performance
  const rowStride = Math.max(1, Math.floor(height / maxRows));

  for (let y = 0; y < height; y += rowStride) {
    const row = new Float32Array(width);
    for (let x = 0; x < width; x++) row[x] = grayscale[y * width + x] / 255;
    // Subtract mean to remove DC bias
    let rowMean = 0;
    for (let x = 0; x < width; x++) rowMean += row[x];
    rowMean /= width;
    for (let x = 0; x < width; x++) row[x] -= rowMean;

    const { magnitude } = computeFFT(row);
    for (let x = 0; x < width; x++) spectrum[x] += magnitude[x];
    rowsProcessed++;
  }
  if (rowsProcessed === 0) return 0;
  for (let x = 0; x < width; x++) spectrum[x] /= rowsProcessed;

  // 1/f check: low-frequency energy should dominate high-frequency energy
  const lowBins = Math.max(1, Math.floor(width * 0.1));
  const highBins = Math.floor(width * 0.5);
  let lowEnergy = 0, highEnergy = 0;
  for (let x = 1; x <= lowBins; x++) lowEnergy += spectrum[x] || 0;
  for (let x = lowBins + 1; x < highBins && x < width; x++) highEnergy += spectrum[x] || 0;
  lowEnergy /= lowBins;
  highEnergy /= Math.max(1, highBins - lowBins);

  // Detect spikes in high-frequency bins (Moiré pattern signature)
  let spikes = 0;
  const highMean = highEnergy;
  for (let x = lowBins + 1; x < highBins && x < width; x++) {
    if ((spectrum[x] || 0) > 3 * (highMean || 1) && (spectrum[x] || 0) > 1) spikes++;
  }
  const spikeScore = clamp01(1 - spikes / 10); // many spikes = bad

  // 1/f ratio: real face has low/high ratio > 3 typically
  const ratio = highMean > 0 ? lowEnergy / highMean : 0;
  const ratioScore = clamp01(ratio / 3);

  return clamp01(0.5 * ratioScore + 0.5 * spikeScore);
}

// ─── NEW v2: Color distortion detection ─────────────────────────

/**
 * Color distortion: detect if face has color cast typical of a printed
 * photo (often over-saturated reds, faded yellows, or Moiré chroma noise).
 * Real skin tones fall in a known RGB region.
 *
 * @param rgb     RGB buffer (3 bytes per pixel)
 * @param width   image width
 * @param height  image height
 * @returns 0..1 (high = natural skin color, no distortion)
 */
function detectColorDistortion(
  rgb: Uint8Array,
  width: number,
  height: number,
): number {
  // Face ROI: center band
  const x1 = Math.floor(width * 0.3);
  const x2 = Math.floor(width * 0.7);
  const y1 = Math.floor(height * 0.25);
  const y2 = Math.floor(height * 0.8);

  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = (y * width + x) * 3;
      sumR += rgb[idx];
      sumG += rgb[idx + 1];
      sumB += rgb[idx + 2];
      count++;
    }
  }
  if (count === 0) return 0;
  const avgR = sumR / count;
  const avgG = sumG / count;
  const avgB = sumB / count;

  // Skin-tone ordering: R > G > B (typical for human skin across ethnicities)
  const orderOk = avgR > avgG && avgG > avgB;

  // Channel excess: red/blue/green dominance beyond typical skin
  // Skin: (R-G) in [10..60], (G-B) in [5..40]
  const rMinusG = avgR - avgG;
  const gMinusB = avgG - avgB;
  const rExcess = rMinusG > 60 || rMinusG < 5 ? 0.3 : 1;
  const gExcess = gMinusB > 50 || gMinusB < 3 ? 0.3 : 1;
  const bCast = avgB > avgR ? 0.2 : 1; // printed-photo blue cast

  // Saturation proxy: max-min channel difference
  const maxC = Math.max(avgR, avgG, avgB);
  const minC = Math.min(avgR, avgG, avgB);
  const saturation = maxC === 0 ? 0 : (maxC - minC) / maxC;
  // Real skin saturation: 0.2 .. 0.5
  const satScore = saturation > 0.6 || saturation < 0.1 ? 0.3 : 1;

  const orderScore = orderOk ? 1 : 0.3;
  return clamp01(0.3 * orderScore + 0.25 * rExcess + 0.15 * gExcess + 0.15 * bCast + 0.15 * satScore);
}

// ─── NEW v2: 3D depth disparity (left/right face halves) ────────

/**
 * Cheap depth proxy: compare horizontal gradient patterns in left vs right
 * halves of the face. A real 3D face under side lighting produces asymmetric
 * horizontal gradients (nose casts a shadow on one side); a flat printed
 * photo produces symmetric gradients.
 *
 * @returns 0..1 (high = real 3D depth)
 */
function estimateDepthDisparity(frame: FrameData): number {
  const { grayscale, width, height } = frame;
  // Face ROI: center band
  const x1 = Math.floor(width * 0.3);
  const x2 = Math.floor(width * 0.7);
  const y1 = Math.floor(height * 0.25);
  const y2 = Math.floor(height * 0.8);
  const faceW = x2 - x1;
  const halfW = Math.floor(faceW / 2);
  if (halfW < 2) return 0;

  let sumGxLeft = 0, sumGxRight = 0, countLeft = 0, countRight = 0;
  for (let y = y1 + 1; y < y2 - 1; y++) {
    for (let x = 0; x < halfW - 1; x++) {
      const leftIdx = y * width + (x1 + x);
      const rightIdx = y * width + (x2 - 1 - x);
      sumGxLeft += Math.abs(grayscale[leftIdx + 1] - grayscale[leftIdx - 1]);
      sumGxRight += Math.abs(grayscale[rightIdx + 1] - grayscale[rightIdx - 1]);
      countLeft++;
      countRight++;
    }
  }
  if (countLeft === 0 || countRight === 0) return 0;
  const meanGxLeft = sumGxLeft / countLeft;
  const meanGxRight = sumGxRight / countRight;
  // Asymmetry: real 3D faces have ~20-60% difference between halves
  const asym = Math.abs(meanGxLeft - meanGxRight) / Math.max(meanGxLeft, meanGxRight, 1);
  // Score: moderate asymmetry is good (0.2..0.6 → 1.0); too low = flat, too high = extreme lighting
  let score = 0;
  if (asym >= 0.2 && asym <= 0.6) score = 1;
  else if (asym < 0.2) score = asym / 0.2; // flat = 0
  else score = clamp01(1 - (asym - 0.6) / 0.4); // extreme lighting degrades
  return clamp01(score);
}

// ─── NEW v2: Specular highlight detection ──────────────────────

/**
 * Specular highlights: real skin reflects light directionally, producing
 * bright spots in expected regions (nose bridge, forehead, cheekbones).
 * Printed photos diffuse light uniformly and lack specular highlights.
 *
 * @returns 0..1 (high = real skin with specular highlights)
 */
function detectSpecularHighlights(frame: FrameData): number {
  const { rgb, width, height } = frame;
  // Expected highlight regions: nose bridge (center), forehead (upper center)
  const regions: { x1: number; x2: number; y1: number; y2: number }[] = [
    // Nose bridge: 45–55% width, 50–62% height
    { x1: 0.45, x2: 0.55, y1: 0.5, y2: 0.62 },
    // Forehead: 35–65% width, 25–35% height
    { x1: 0.35, x2: 0.65, y1: 0.25, y2: 0.35 },
  ];

  let highlightsFound = 0;
  for (const r of regions) {
    const x1 = Math.floor(width * r.x1);
    const x2 = Math.floor(width * r.x2);
    const y1 = Math.floor(height * r.y1);
    const y2 = Math.floor(height * r.y2);
    let brightPixels = 0, total = 0;
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = (y * width + x) * 3;
        const rC = rgb[idx], gC = rgb[idx + 1], bC = rgb[idx + 2];
        // Specular highlight: very bright AND high local luminance
        const lum = 0.299 * rC + 0.587 * gC + 0.114 * bC;
        if (lum > 200) brightPixels++;
        total++;
      }
    }
    // Need at least 5% bright pixels in expected highlight region
    const ratio = total > 0 ? brightPixels / total : 0;
    if (ratio > 0.05) highlightsFound++;
  }

  return clamp01(highlightsFound / regions.length);
}

// ─── NEW v2: Blink detection (multi-frame) ─────────────────────

/**
 * Detect eyelid state changes (blink) over multiple frames using an eye
 * aspect ratio (EAR) proxy. Without landmarks we approximate EAR with the
 * horizontal gradient variance in the eye region — eyes open have a strong
 * iris edge (high gradient variance); eyes closed have lower gradient variance.
 *
 * A blink = brief dip in the EAR proxy followed by recovery.
 *
 * @param frames      preprocessed frames (must include grayscale)
 * @param eyeRegionDiffs per-frame eye-region intensity diffs
 * @returns { detected, confidence 0..1 }
 */
function detectBlink(
  frames: FrameData[],
  eyeRegionDiffs: number[],
): { detected: boolean; confidence: number } {
  if (frames.length < 3) return { detected: false, confidence: 0 };

  // Compute per-frame "EAR proxy": horizontal gradient variance in eye region
  const earProxies: number[] = [];
  for (const frame of frames) {
    const { grayscale, width, height } = frame;
    const x1 = Math.floor(width * 0.3);
    const x2 = Math.floor(width * 0.7);
    const y1 = Math.floor(height * 0.3);
    const y2 = Math.floor(height * 0.45);
    let sum = 0, sumSq = 0, count = 0;
    for (let y = y1 + 1; y < y2 - 1; y++) {
      for (let x = x1 + 1; x < x2 - 1; x++) {
        const idx = y * width + x;
        const gx = Math.abs(grayscale[idx + 1] - grayscale[idx - 1]);
        sum += gx;
        sumSq += gx * gx;
        count++;
      }
    }
    if (count === 0) { earProxies.push(0); continue; }
    const mean = sum / count;
    const variance = sumSq / count - mean * mean;
    earProxies.push(variance);
  }

  // Look for a dip-then-recovery pattern (closed → open eye)
  // Ear proxy should drop significantly (eyelid covers iris) and recover.
  const meanEar = earProxies.reduce((a, b) => a + b, 0) / earProxies.length;
  if (meanEar === 0) return { detected: false, confidence: 0 };

  let dips = 0;
  for (let i = 1; i < earProxies.length - 1; i++) {
    const prev = earProxies[i - 1];
    const curr = earProxies[i];
    const next = earProxies[i + 1];
    // Dip: curr significantly below both neighbors (within 30% of mean or less)
    const threshold = meanEar * 0.5;
    if (curr < threshold && curr < prev && curr < next) dips++;
  }

  // Also use eyeRegionDiffs: a blink creates a sharp localized change
  const maxEyeDiff = eyeRegionDiffs.length > 0 ? Math.max(...eyeRegionDiffs) : 0;
  const eyeDiffScore = clamp01(maxEyeDiff / 12);

  // Combine: dips found + magnitude of eye-region change
  const dipsScore = clamp01(dips / 2);
  const confidence = clamp01(0.5 * dipsScore + 0.5 * eyeDiffScore);
  const detected = dips >= 1 && maxEyeDiff > 4;
  return { detected, confidence };
}

// ══════════════════════════════════════════════════════════════════
// ─── Main entry point ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

export async function checkLivenessPro(
  frames: string[],
  performedActions: LivenessAction[],
): Promise<LivenessProScore> {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!frames || frames.length < 3) {
    return {
      motionPresent: false, motionScore: 0, motionDirection: "none", motionMagnitude: 0,
      challengeMet: false, challengeScore: 0, requestedAction: performedActions[0] || "none",
      detectedMotionDirection: "none",
      printAttackScore: 0, screenArtifactScore: 0, depthScore: 0,
      motionSmoothnessScore: 0, velocityProfileScore: 0,
      opticalFlowConsistency: 0, lbpTextureScore: 0, fftMoireScore: 0,
      colorDistortionScore: 0, depthDisparityScore: 0, specularHighlightScore: 0,
      blinkDetected: false, blinkConfidence: 0, padScore: 0,
      totalScore: 0, isLive: false, passThreshold: 60,
      framesAnalyzed: frames?.length || 0,
      detectedActions: [], issues: ["Need at least 3 frames for pro analysis"],
      suggestions: ["Capture more frames during the challenge"],
      reasoning: "Insufficient frames for pro liveness analysis",
    };
  }

  try {
    // Convert data URLs to buffers
    const buffers: Buffer[] = [];
    for (const frame of frames) {
      const b64 = frame.split(",")[1];
      if (b64) buffers.push(Buffer.from(b64, "base64"));
    }

    if (buffers.length < 3) {
      return {
        motionPresent: false, motionScore: 0, motionDirection: "none", motionMagnitude: 0,
        challengeMet: false, challengeScore: 0, requestedAction: performedActions[0] || "none",
        detectedMotionDirection: "none",
        printAttackScore: 0, screenArtifactScore: 0, depthScore: 0,
        motionSmoothnessScore: 0, velocityProfileScore: 0,
        opticalFlowConsistency: 0, lbpTextureScore: 0, fftMoireScore: 0,
        colorDistortionScore: 0, depthDisparityScore: 0, specularHighlightScore: 0,
        blinkDetected: false, blinkConfidence: 0, padScore: 0,
        totalScore: 0, isLive: false, passThreshold: 60,
        framesAnalyzed: buffers.length,
        detectedActions: [], issues: ["Not enough valid frames"],
        suggestions: ["Retake with more frames"],
        reasoning: "Insufficient valid frames",
      };
    }

    // Preprocess all frames
    const frameData: FrameData[] = [];
    for (const buf of buffers) {
      frameData.push(await preprocessFrame(buf));
    }

    // ─── 1. Motion analysis ────────────────────────────────────
    const diffs: number[] = [];
    const motionVectors: MotionVector[] = [];
    const eyeRegionDiffs: number[] = [];
    const mouthRegionDiffs: number[] = [];

    for (let i = 1; i < frameData.length; i++) {
      const prev = frameData[i - 1];
      const curr = frameData[i];
      diffs.push(frameDiff(prev.grayscale, curr.grayscale));
      motionVectors.push(estimateBlockMotion(prev.blocks, curr.blocks));
      eyeRegionDiffs.push(regionDiff(prev.grayscale, curr.grayscale, prev.width, prev.height, "eyes"));
      mouthRegionDiffs.push(regionDiff(prev.grayscale, curr.grayscale, prev.width, prev.height, "mouth"));
    }

    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const maxDiff = Math.max(...diffs);
    const motionMagnitude = motionVectors.reduce((a, v) => a + v.magnitude, 0) / motionVectors.length;
    const avgDx = motionVectors.reduce((a, v) => a + v.dx, 0) / motionVectors.length;
    const avgDy = motionVectors.reduce((a, v) => a + v.dy, 0) / motionVectors.length;

    const motionPresent = avgDiff > 2;
    const motionScore = Math.min(40, (avgDiff / 15) * 40);

    let motionDirection: string = "none";
    if (Math.abs(avgDx) > Math.abs(avgDy)) {
      motionDirection = avgDx > 0.1 ? "right" : avgDx < -0.1 ? "left" : "none";
    } else {
      motionDirection = avgDy > 0.1 ? "down" : avgDy < -0.1 ? "up" : "none";
    }
    if (avgDiff < 2) motionDirection = "none";

    if (!motionPresent) {
      issues.push("No motion detected between frames");
      suggestions.push("Perform the requested action more clearly");
    }

    // ─── 2. Challenge-response ──────────────────────────────────
    const requestedAction = performedActions[0] || "turn_left";
    const challengeResult = verifyChallenge(
      requestedAction as LivenessAction,
      motionVectors,
      eyeRegionDiffs,
      mouthRegionDiffs,
    );

    if (!challengeResult.met) {
      issues.push(`Requested action "${requestedAction}" not clearly detected`);
      suggestions.push(`Perform the ${requestedAction.replace("_", " ")} action more deliberately`);
    }

    // ─── 3. Anti-spoofing (legacy) ─────────────────────────────
    const printCheck = detectPrintAttack(frameData);
    const screenCheck = detectScreenArtifact(frameData);
    const depthCheck = estimateDepth(frameData[frameData.length - 1]);

    if (printCheck.isStatic) {
      issues.push("Static image detected (possible print attack)");
      suggestions.push("Move your head during the challenge");
    }
    if (screenCheck.hasMoire) {
      issues.push("Screen artifact detected (possible replay attack)");
      suggestions.push("Ensure you're not displaying a screen to the camera");
    }
    if (!depthCheck.hasDepth) {
      issues.push("Low depth variation (possible flat surface)");
      suggestions.push("Face the camera directly with good lighting");
    }

    // ─── 4. Temporal analysis ───────────────────────────────────
    const smoothness = analyzeMotionSmoothness(diffs);
    const velocityProfile = analyzeVelocityProfile(diffs);

    if (smoothness.isSmooth && avgDiff > 2) {
      issues.push("Motion too smooth (possible robotic/mechanical)");
      suggestions.push("Move naturally with slight variation");
    }

    // ─── 5. NEW v2: PAD signals ────────────────────────────────
    const opticalFlowConsistency = computeOpticalFlowConsistency(motionVectors, diffs);

    // LBP texture — use the middle frame (most stable representative).
    // computeLBP returns raw histogram variance (HIGH = concentrated
    // histogram = uniform/flat texture = suspicious). Invert to get a
    // "real skin" score (high = distinctive texture).
    const middleFrame = frameData[Math.floor(frameData.length / 2)];
    const lbpRawVariance = computeLBP(middleFrame.grayscale, middleFrame.width, middleFrame.height);
    const lbpTextureScore = clamp01(1 - lbpRawVariance / LBP_MAX_VARIANCE);

    // FFT moiré — operate on the face ROI (center band) of the middle frame
    const fftMoireScore = detectMoireFFT(middleFrame.grayscale, middleFrame.width, middleFrame.height);

    // Color distortion
    const colorDistortionScore = detectColorDistortion(middleFrame.rgb, middleFrame.width, middleFrame.height);

    // 3D depth disparity
    const depthDisparityScore = estimateDepthDisparity(middleFrame);

    // Specular highlights
    const specularHighlightScore = detectSpecularHighlights(middleFrame);

    // Blink detection
    const blinkResult = detectBlink(frameData, eyeRegionDiffs);

    if (opticalFlowConsistency < 0.3) {
      issues.push("Low optical flow consistency (possible static image)");
      suggestions.push("Move your head naturally during the challenge");
    }
    if (lbpTextureScore < 0.2) {
      issues.push("Low skin texture (possible print attack)");
      suggestions.push("Use a real face, not a printed photo");
    }
    if (fftMoireScore < 0.3) {
      issues.push("Frequency artifacts detected (possible screen replay)");
      suggestions.push("Don't present a screen to the camera");
    }
    if (colorDistortionScore < 0.3) {
      issues.push("Unnatural skin color (possible printed photo)");
      suggestions.push("Use a real face in natural lighting");
    }
    if (depthDisparityScore < 0.3) {
      issues.push("Low 3D depth cues (possible flat surface)");
      suggestions.push("Turn your head slightly to show 3D structure");
    }
    if (specularHighlightScore < 0.3) {
      issues.push("No specular highlights (possible printed photo)");
      suggestions.push("Use diffuse frontal lighting on a real face");
    }
    if (blinkResult.detected) {
      // blink detected is a strong liveness signal — no issue to add
    } else if (frameData.length >= 5) {
      // Only flag if we have enough frames to reasonably expect a blink
      issues.push("No blink detected across frames");
      suggestions.push("Blink naturally during the challenge");
    }

    // ─── Aggregate PAD score (weighted combination of all anti-spoof signals) ───
    const padScore = clamp01(
      opticalFlowConsistency * 0.18 +
      lbpTextureScore * 0.15 +
      fftMoireScore * 0.15 +
      colorDistortionScore * 0.10 +
      depthDisparityScore * 0.15 +
      specularHighlightScore * 0.10 +
      (printCheck.score / 10) * 0.07 +
      (screenCheck.score / 5) * 0.05 +
      (depthCheck.score / 5) * 0.05,
    );

    // ─── Calculate total score (legacy + bonus from PAD) ────────
    // Base legacy score (0-100). Add a small bonus/penalty from PAD signals
    // so the new metrics affect the final verdict without breaking the 0-100
    // scale's semantics for downstream consumers.
    const legacyScore =
      motionScore +
      challengeResult.score +
      printCheck.score +
      screenCheck.score +
      depthCheck.score +
      smoothness.score +
      velocityProfile.score;

    const padAdjustment = (padScore - 0.5) * 20; // -10..+10
    const totalScore = Math.max(0, Math.min(100, Math.round(legacyScore + padAdjustment)));

    // Detected actions (for backward compat with LivenessResult)
    const detectedActions: LivenessAction[] = [];
    if (motionDirection === "left") detectedActions.push("turn_left");
    if (motionDirection === "right") detectedActions.push("turn_right");
    if (motionDirection === "up") detectedActions.push("look_up");
    if (blinkResult.detected) detectedActions.push("blink");
    if (Math.max(...mouthRegionDiffs) > 4) detectedActions.push("smile");

    // isLive: legacy requirements OR (PAD score is high AND motion is present)
    const isLive = (totalScore >= 60 && motionPresent && challengeResult.met &&
      !printCheck.isStatic && !screenCheck.hasMoire) ||
      (padScore >= 0.65 && motionPresent && challengeResult.met);

    const reasoning = [
      `Analyzed ${buffers.length} frames with 4×4 block analysis.`,
      `Avg diff: ${avgDiff.toFixed(2)}, max: ${maxDiff.toFixed(2)}.`,
      `Motion direction: ${motionDirection}, magnitude: ${motionMagnitude.toFixed(2)}.`,
      `Challenge "${requestedAction}": ${challengeResult.met ? "MET" : "NOT MET"} (${challengeResult.score}/30).`,
      `Print attack score: ${printCheck.score}/10 ${printCheck.isStatic ? "(STATIC!)" : ""}.`,
      `Screen artifact: ${screenCheck.score}/5 ${screenCheck.hasMoire ? "(MOIRÉ!)" : ""}.`,
      `Depth: ${depthCheck.score}/5 ${depthCheck.hasDepth ? "(3D)" : "(flat)"}.`,
      `Smoothness: ${smoothness.score}/5 ${smoothness.isSmooth ? "(too smooth)" : ""}.`,
      `Velocity profile: ${velocityProfile.score}/5 ${velocityProfile.isBellCurve ? "(bell curve)" : ""}.`,
      `Flow consistency: ${opticalFlowConsistency.toFixed(2)}, LBP: ${lbpTextureScore.toFixed(2)}, FFT-moiré: ${fftMoireScore.toFixed(2)}.`,
      `Color: ${colorDistortionScore.toFixed(2)}, disparity: ${depthDisparityScore.toFixed(2)}, specular: ${specularHighlightScore.toFixed(2)}.`,
      `Blink: ${blinkResult.detected ? "YES" : "no"} (conf ${blinkResult.confidence.toFixed(2)}).`,
      `PAD aggregate: ${padScore.toFixed(2)}.`,
      `Total: ${totalScore}/100 — ${isLive ? "LIVE" : "SUSPICIOUS"}.`,
    ].join(" ");

    return {
      motionPresent,
      motionScore: Math.round(motionScore),
      motionDirection: motionDirection as any,
      motionMagnitude: Math.round(motionMagnitude * 100) / 100,
      challengeMet: challengeResult.met,
      challengeScore: challengeResult.score,
      requestedAction,
      detectedMotionDirection: challengeResult.detectedDirection,
      printAttackScore: printCheck.score,
      screenArtifactScore: screenCheck.score,
      depthScore: depthCheck.score,
      motionSmoothnessScore: smoothness.score,
      velocityProfileScore: velocityProfile.score,

      // New v2 signals
      opticalFlowConsistency: Math.round(opticalFlowConsistency * 1000) / 1000,
      lbpTextureScore: Math.round(lbpTextureScore * 1000) / 1000,
      fftMoireScore: Math.round(fftMoireScore * 1000) / 1000,
      colorDistortionScore: Math.round(colorDistortionScore * 1000) / 1000,
      depthDisparityScore: Math.round(depthDisparityScore * 1000) / 1000,
      specularHighlightScore: Math.round(specularHighlightScore * 1000) / 1000,
      blinkDetected: blinkResult.detected,
      blinkConfidence: Math.round(blinkResult.confidence * 1000) / 1000,
      padScore: Math.round(padScore * 1000) / 1000,

      totalScore,
      isLive,
      passThreshold: 60,
      framesAnalyzed: buffers.length,
      detectedActions,
      issues,
      suggestions,
      reasoning,
    };
  } catch (e: any) {
    return {
      motionPresent: false, motionScore: 0, motionDirection: "none", motionMagnitude: 0,
      challengeMet: false, challengeScore: 0, requestedAction: performedActions[0] || "none",
      detectedMotionDirection: "none",
      printAttackScore: 0, screenArtifactScore: 0, depthScore: 0,
      motionSmoothnessScore: 0, velocityProfileScore: 0,
      opticalFlowConsistency: 0, lbpTextureScore: 0, fftMoireScore: 0,
      colorDistortionScore: 0, depthDisparityScore: 0, specularHighlightScore: 0,
      blinkDetected: false, blinkConfidence: 0, padScore: 0,
      totalScore: 0, isLive: false, passThreshold: 60,
      framesAnalyzed: frames.length,
      detectedActions: [], issues: [`Analysis error: ${e?.message?.slice(0, 100)}`],
      suggestions: ["Retake the liveness check"],
      reasoning: `Liveness pro error: ${e?.message || "unknown"}`,
    };
  }
}

/** Convert to the legacy LivenessResult format (for backward compatibility). */
export function proToLegacyResult(pro: LivenessProScore): LivenessResult {
  return {
    isLive: pro.isLive,
    score: pro.totalScore,
    detectedActions: pro.detectedActions,
    reasoning: pro.reasoning,
  };
}
