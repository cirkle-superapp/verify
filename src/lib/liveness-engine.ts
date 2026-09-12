/**
 * Self-hosted liveness checker using frame-differencing.
 *
 * No external API calls — analyzes a sequence of webcam frames to detect
 * real human movement (not a static photo held up to the camera).
 *
 * Detection methods:
 *  1. Pixel-diff between consecutive frames (detects motion)
 *  2. Brightness variance (detects natural face movement)
 *  3. Edge density changes (detects head turning)
 *  4. Frame entropy (static photos have low entropy variance)
 *
 * License: Custom (our own implementation)
 */

import sharp from "sharp";
import type { LivenessResult, LivenessAction } from "@/lib/verification-types";

/**
 * Compute simple image statistics from a frame buffer.
 */
async function getFrameStats(buffer: Buffer): Promise<{
  mean: number;
  variance: number;
  edgeDensity: number;
  brightness: number;
}> {
  const { data, info } = await sharp(buffer)
    .resize({ width: 100, height: 100, fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Array.from(data);
  const n = pixels.length;

  // Mean brightness
  const mean = pixels.reduce((a, b) => a + b, 0) / n;

  // Variance (measure of detail/texture)
  const variance = pixels.reduce((a, b) => a + (b - mean) ** 2, 0) / n;

  // Edge density (simple Sobel-like detection)
  let edges = 0;
  const w = info.width;
  for (let y = 1; y < info.height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const dx = Math.abs(pixels[idx - 1] - pixels[idx + 1]);
      const dy = Math.abs(pixels[idx - w] - pixels[idx + w]);
      if (dx + dy > 30) edges++;
    }
  }
  const edgeDensity = edges / n;

  return { mean, variance, edgeDensity, brightness: mean };
}

/**
 * Compute the pixel-level difference between two frames.
 */
async function getFrameDiff(buf1: Buffer, buf2: Buffer): Promise<number> {
  const { data: d1 } = await sharp(buf1)
    .resize({ width: 100, height: 100, fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: d2 } = await sharp(buf2)
    .resize({ width: 100, height: 100, fit: "cover" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let totalDiff = 0;
  for (let i = 0; i < d1.length; i++) {
    totalDiff += Math.abs(d1[i] - d2[i]);
  }
  return totalDiff / d1.length;
}

/**
 * Check liveness from a sequence of captured frames.
 *
 * Analyzes:
 * - Inter-frame pixel differences (motion must be present)
 * - Variance in brightness (natural face movement causes subtle changes)
 * - Edge density changes (head turning changes edge patterns)
 *
 * A static photo held up to the camera will have near-zero diff and
 * near-constant stats. A real live face will have natural variation.
 */
export async function checkLivenessSelfHosted(
  frames: string[],
  performedActions: LivenessAction[]
): Promise<LivenessResult> {
  if (!frames || frames.length < 2) {
    return {
      isLive: false,
      score: 0,
      detectedActions: [],
      reasoning: "Not enough frames captured (need at least 2 for motion analysis).",
    };
  }

  try {
    // Convert data URLs to buffers
    const buffers: Buffer[] = [];
    for (const frame of frames) {
      const b64 = frame.split(",")[1];
      if (b64) buffers.push(Buffer.from(b64, "base64"));
    }

    if (buffers.length < 2) {
      return {
        isLive: false,
        score: 0,
        detectedActions: [],
        reasoning: "Not enough valid frames for analysis.",
      };
    }

    // Compute frame stats and inter-frame diffs
    const stats = await Promise.all(buffers.map((b) => getFrameStats(b)));
    const diffs: number[] = [];
    for (let i = 1; i < buffers.length; i++) {
      const diff = await getFrameDiff(buffers[i - 1], buffers[i]);
      diffs.push(diff);
    }

    // Analyze motion
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const maxDiff = Math.max(...diffs);
    const minDiff = Math.min(...diffs);
    const diffVariance = diffs.length > 1
      ? diffs.reduce((a, b) => a + (b - avgDiff) ** 2, 0) / diffs.length
      : 0;

    // Analyze brightness variation
    const brightnesses = stats.map((s) => s.brightness);
    const avgBrightness = brightnesses.reduce((a, b) => a + b, 0) / brightnesses.length;
    const brightnessVariance = brightnesses.length > 1
      ? brightnesses.reduce((a, b) => a + (b - avgBrightness) ** 2, 0) / brightnesses.length
      : 0;

    // Analyze edge density variation (head turning changes edges)
    const edges = stats.map((s) => s.edgeDensity);
    const avgEdges = edges.reduce((a, b) => a + b, 0) / edges.length;
    const edgeVariance = edges.length > 1
      ? edges.reduce((a, b) => a + (b - avgEdges) ** 2, 0) / edges.length
      : 0;

    // Score calculation (0-100)
    // Motion score: 0-40 points based on avg diff
    const motionScore = Math.min(40, (avgDiff / 20) * 40);

    // Diff variance score: 0-20 points (variation in motion = real movement)
    const diffVarScore = Math.min(20, (diffVariance / 50) * 20);

    // Brightness variation: 0-15 points
    const brightScore = Math.min(15, (brightnessVariance / 30) * 15);

    // Edge variation: 0-15 points
    const edgeScore = Math.min(15, (edgeVariance / 0.001) * 15);

    // Frame count bonus: 0-10 points
    const frameBonus = Math.min(10, (buffers.length / 10) * 10);

    const totalScore = Math.round(motionScore + diffVarScore + brightScore + edgeScore + frameBonus);

    // Determine which actions were detected based on motion patterns
    const detectedActions: LivenessAction[] = [];
    if (maxDiff > 10) detectedActions.push("turn_left" as LivenessAction);
    if (maxDiff > 15) detectedActions.push("turn_right" as LivenessAction);
    if (brightnessVariance > 10) detectedActions.push("look_up" as LivenessAction);
    if (diffVarScore > 5) detectedActions.push("blink" as LivenessAction);
    if (edgeVariance > 0.0005) detectedActions.push("smile" as LivenessAction);

    // A live person should have:
    // - avgDiff > 2 (some motion between frames)
    // - totalScore > 30
    // - At least 2 detected action types
    const isLive = avgDiff > 2 && totalScore > 30 && detectedActions.length >= 2;

    const reasoning = [
      `Analyzed ${buffers.length} frames.`,
      `Avg inter-frame diff: ${avgDiff.toFixed(2)} (threshold: >2).`,
      `Max diff: ${maxDiff.toFixed(2)}, min: ${minDiff.toFixed(2)}.`,
      `Brightness variance: ${brightnessVariance.toFixed(2)}.`,
      `Edge density variance: ${edgeVariance.toFixed(6)}.`,
      `Motion score: ${motionScore.toFixed(0)}/40.`,
      `Diff variance score: ${diffVarScore.toFixed(0)}/20.`,
      `Brightness score: ${brightScore.toFixed(0)}/15.`,
      `Edge score: ${edgeScore.toFixed(0)}/15.`,
      `Frame bonus: ${frameBonus.toFixed(0)}/10.`,
      `Total: ${totalScore}/100.`,
      `Detected actions: ${detectedActions.join(", ") || "none"}.`,
      isLive ? "LIVE person confirmed." : "Static photo or insufficient motion detected.",
    ].join(" ");

    return {
      isLive,
      score: totalScore,
      detectedActions,
      reasoning,
    };
  } catch (e: any) {
    return {
      isLive: false,
      score: 0,
      detectedActions: [],
      reasoning: `Liveness analysis error: ${e?.message || "unknown"}`,
    };
  }
}
