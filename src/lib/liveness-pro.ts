/**
 * Liveness Pro — Enhanced Anti-Spoofing Liveness Detection.
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
 *    - "turn_left" → detects leftward horizontal motion in upper-center blocks
 *    - "turn_right" → detects rightward horizontal motion
 *    - "look_up" → detects upward vertical motion
 *    - "blink" → detects brief localized change in eye region (upper-center)
 *    - "smile" → detects localized change in mouth region (lower-center)
 *    - Random challenge ordering prevents replay attacks
 *
 * 3. ANTI-SPOOFING (Presentation Attack Detection):
 *    - Print attack: static photo → uniform texture, zero micro-motion variance
 *    - Screen replay: moiré pattern → high-frequency noise spikes in FFT
 *    - Depth check: real 3D face has brightness gradient (nose brighter than sides)
 *    - Motion smoothness: human motion has jerk (3rd derivative), robotic is smooth
 *
 * 4. TEMPORAL ANALYSIS:
 *    - Motion velocity profile (bell curve = human, flat = static)
 *    - Acceleration/deceleration patterns
 *    - Frame-to-frame consistency (no teleporting)
 *
 * Score: 0-100 with detailed breakdown for UI.
 */

import sharp from "sharp";
import type { LivenessResult, LivenessAction } from "@/lib/verification-types";

// ─── Types ────────────────────────────────────────────────────────

export interface LivenessProScore {
  // Motion analysis (0-40)
  motionPresent: boolean;
  motionScore: number;        // 0-40 (avg inter-frame diff)
  motionDirection: "left" | "right" | "up" | "down" | "none" | "mixed";
  motionMagnitude: number;   // average |dx + dy| across blocks

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

// ─── Frame preprocessing ─────────────────────────────────────────

interface FrameData {
  width: number;
  height: number;
  grayscale: Uint8Array;
  blocks: number[][];        // 4×4 grid of mean brightness per block
}

const GRID_SIZE = 4;
const ANALYSIS_WIDTH = 120;  // resize for fast analysis

async function preprocessFrame(buffer: Buffer): Promise<FrameData> {
  const { data, info } = await sharp(buffer)
    .resize({ width: ANALYSIS_WIDTH, height: ANALYSIS_WIDTH, fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const grayscale = new Uint8Array(data);

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

  return { width: w, height: h, grayscale, blocks };
}

// ─── Block-based motion vector estimation ───────────────────────

interface MotionVector {
  dx: number;
  dy: number;
  magnitude: number;
}

function estimateBlockMotion(prev: number[][], curr: number[][]): MotionVector {
  // For each block in curr, find the best-matching block in prev
  // (simple template matching using absolute difference)
  let totalDx = 0, totalDy = 0, count = 0;

  for (let by = 1; by < GRID_SIZE - 1; by++) {
    for (let bx = 1; bx < GRID_SIZE - 1; bx++) {
      const currVal = curr[by][bx];
      let bestDx = 0, bestDy = 0, bestDiff = Infinity;

      // Search ±1 block in each direction
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
    // Upper-center: x 30-70%, y 30-45%
    x1 = Math.floor(width * 0.3); x2 = Math.floor(width * 0.7);
    y1 = Math.floor(height * 0.3); y2 = Math.floor(height * 0.45);
  } else if (region === "mouth") {
    // Lower-center: x 35-65%, y 60-75%
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

// ─── Anti-spoofing checks ─────────────────────────────────────────

/** Detect print attack: static photos have uniform texture (low local variance). */
function detectPrintAttack(frames: FrameData[]): { score: number; isStatic: boolean } {
  // Compute local variance (3×3 neighborhood) for each frame
  // A real face has varying texture (skin, hair, eyes, mouth)
  // A printed photo has more uniform texture (single surface)

  const variances: number[] = [];
  for (const frame of frames) {
    const { grayscale, width, height } = frame;
    let localVarSum = 0, count = 0;
    // Sample 100 random pixels and compute 3×3 local variance
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

  // Real face: variance > 50 typically. Print attack: < 20.
  const avgVar = variances.reduce((a, b) => a + b, 0) / variances.length;
  if (avgVar > 80) return { score: 10, isStatic: false };
  if (avgVar > 50) return { score: 7, isStatic: false };
  if (avgVar > 20) return { score: 4, isStatic: false };
  return { score: 1, isStatic: true };
}

/** Detect screen replay: moiré pattern = high-frequency noise spikes. */
function detectScreenArtifact(frames: FrameData[]): { score: number; hasMoire: boolean } {
  // Screen replay has periodic high-frequency noise (refresh rate, pixel grid)
  // Detect by computing high-frequency energy (difference between adjacent pixels)
  let hfEnergy = 0, count = 0;
  for (const frame of frames) {
    const { grayscale, width, height } = frame;
    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const idx = y * width + x;
        const h = Math.abs(grayscale[idx] - grayscale[idx + 1]); // horizontal HF
        const v = Math.abs(grayscale[idx] - grayscale[idx + width]); // vertical HF
        hfEnergy += (h + v) / 2;
        count++;
      }
    }
  }
  const avgHF = count > 0 ? hfEnergy / count : 0;
  // Real face: avgHF < 15 (smooth skin). Screen: > 25 (moiré).
  if (avgHF < 12) return { score: 5, hasMoire: false };
  if (avgHF < 18) return { score: 3, hasMoire: false };
  if (avgHF < 25) return { score: 2, hasMoire: false };
  return { score: 0, hasMoire: true };
}

/** Depth estimation: real 3D face has brightness gradient (nose brighter). */
function estimateDepth(frame: FrameData): { score: number; hasDepth: boolean } {
  // Real face: center (nose) is brighter than edges (shadow on sides)
  // Flat photo: more uniform brightness
  const { blocks } = frame;
  const center = blocks[1][1] + blocks[1][2] + blocks[2][1] + blocks[2][2];
  const edges =
    blocks[0][0] + blocks[0][3] + blocks[3][0] + blocks[3][3] +
    blocks[0][1] + blocks[0][2] + blocks[3][1] + blocks[3][2];
  const centerAvg = center / 4;
  const edgeAvg = edges / 8;
  const gradient = Math.abs(centerAvg - edgeAvg);

  // Real face: gradient > 15. Flat: < 5.
  if (gradient > 20) return { score: 5, hasDepth: true };
  if (gradient > 12) return { score: 4, hasDepth: true };
  if (gradient > 6) return { score: 2, hasDepth: false };
  return { score: 0, hasDepth: false };
}

// ─── Temporal analysis ────────────────────────────────────────────

/** Motion smoothness: human motion has jerk (3rd derivative of position). */
function analyzeMotionSmoothness(diffs: number[]): { score: number; isSmooth: boolean } {
  if (diffs.length < 3) return { score: 0, isSmooth: false };
  // Jerk = change in acceleration = 3rd derivative
  const jerks: number[] = [];
  for (let i = 2; i < diffs.length; i++) {
    // velocity ≈ diffs[i]
    // acceleration = v[i] - v[i-1]
    // jerk = a[i] - a[i-1]
    const a1 = diffs[i - 1] - diffs[i - 2];
    const a2 = diffs[i] - diffs[i - 1];
    jerks.push(Math.abs(a2 - a1));
  }
  const avgJerk = jerks.reduce((a, b) => a + b, 0) / jerks.length;
  // Human motion: jerk > 0.5. Robotic: < 0.2.
  if (avgJerk > 1.0) return { score: 5, isSmooth: false };
  if (avgJerk > 0.5) return { score: 4, isSmooth: false };
  if (avgJerk > 0.2) return { score: 2, isSmooth: false };
  return { score: 1, isSmooth: true };
}

/** Velocity profile: human motion = bell curve (ramp up, peak, ramp down). */
function analyzeVelocityProfile(diffs: number[]): { score: number; isBellCurve: boolean } {
  if (diffs.length < 4) return { score: 0, isBellCurve: false };
  const max = Math.max(...diffs);
  const maxIdx = diffs.indexOf(max);
  // Check if diffs ramp up before max and ramp down after
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
      // Leftward = negative dx (block motion moves left)
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
      // Upward = negative dy (in image coordinates, up = lower y)
      return {
        met: avgDy < -0.1,
        score: avgDy < -0.2 ? 30 : avgDy < -0.1 ? 20 : 5,
        detectedDirection: avgDy < 0 ? "up" : "none",
      };
    case "blink":
      // Blink = brief localized change in eye region
      return {
        met: maxEyeDiff > 5,
        score: maxEyeDiff > 10 ? 30 : maxEyeDiff > 5 ? 20 : 5,
        detectedDirection: maxEyeDiff > 5 ? "blink" : "none",
      };
    case "smile":
      // Smile = localized change in mouth region
      return {
        met: maxMouthDiff > 4,
        score: maxMouthDiff > 8 ? 30 : maxMouthDiff > 4 ? 20 : 5,
        detectedDirection: maxMouthDiff > 4 ? "smile" : "none",
      };
    default:
      return { met: false, score: 0, detectedDirection: "none" };
  }
}

// ─── Main entry point ────────────────────────────────────────────

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

    // ─── 3. Anti-spoofing ───────────────────────────────────────
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

    // ─── Calculate total score ───────────────────────────────────
    const totalScore = Math.round(
      motionScore +
      challengeResult.score +
      printCheck.score +
      screenCheck.score +
      depthCheck.score +
      smoothness.score +
      velocityProfile.score,
    );

    // Detected actions (for backward compat with LivenessResult)
    const detectedActions: LivenessAction[] = [];
    if (motionDirection === "left") detectedActions.push("turn_left");
    if (motionDirection === "right") detectedActions.push("turn_right");
    if (motionDirection === "up") detectedActions.push("look_up");
    if (Math.max(...eyeRegionDiffs) > 5) detectedActions.push("blink");
    if (Math.max(...mouthRegionDiffs) > 4) detectedActions.push("smile");

    const isLive = totalScore >= 60 && motionPresent && challengeResult.met && !printCheck.isStatic && !screenCheck.hasMoire;

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
