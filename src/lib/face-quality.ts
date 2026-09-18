/**
 * Face Image Quality Scorer (ISO/IEC 19794-5 inspired, extended).
 *
 * Evaluates face image quality on 13 dimensions:
 *
 *   Legacy (kept for backward compatibility):
 *     1. Brightness (not too dark, not too bright)
 *     2. Contrast (sufficient dynamic range)
 *     3. Sharpness (not blurry — Laplacian variance)
 *     4. Face size (face fills sufficient portion of frame)
 *     5. Background uniformity (no distracting background)
 *
 *   New (v2 — sophisticated quality dimensions):
 *     6.  Pose (yaw/pitch/roll from landmarks or gradient fallback)
 *     7.  Occlusion (eyes/nose/mouth visibility via variance + edge density)
 *     8.  Lighting uniformity (coefficient of variation of intensities across face)
 *     9.  Color naturalness (no unnatural red/blue/green cast)
 *     10. Background simplicity (edge density in background regions)
 *     11. Face symmetry (left/right half similarity)
 *     12. Defocus blur metric (Laplacian variance, normalized)
 *     13. Motion blur metric (directional gradient analysis)
 *
 * Each dimension scores 0-1. `overall` = legacy weighted average.
 * `compositeQuality` = full 13-dimension weighted average.
 *
 * Pure TypeScript (uses `sharp` only for image decode/resize, no native deps).
 * Runs in <80ms for a 640x480 image.
 */

export interface Landmark {
  x: number;
  y: number;
}

export interface PoseEstimate {
  /** Head yaw in degrees (-180..180). Positive = looking right. */
  yaw: number;
  /** Head pitch in degrees (-90..90). Positive = looking up. */
  pitch: number;
  /** Head roll in degrees (-180..180). Positive = head tilted right (CW). */
  roll: number;
}

export interface PoseScore {
  yaw: number;
  pitch: number;
  roll: number;
  /** 0..1 (1 = frontal pose within thresholds). */
  score: number;
  issue?: string;
}

export interface FaceQualityScore {
  // ─── Legacy 5 dimensions (backward compatibility) ───
  brightness: number;            // 0..1
  contrast: number;              // 0..1
  sharpness: number;             // 0..1
  faceSizeEstimate: number;      // 0..1
  backgroundUniformity: number;  // 0..1
  overall: number;               // 0..1 weighted average (legacy 5)

  // ─── New v2 dimensions (sophisticated quality metrics) ───
  pose?: PoseScore;              // head pose + 0..1 score
  occlusion?: number;            // 0..1 (1 = no occlusion)
  lightingUniformity?: number;   // 0..1 (1 = uniform lighting)
  colorNaturalness?: number;      // 0..1 (1 = natural skin tones)
  backgroundSimplicity?: number; // 0..1 (1 = simple background)
  faceSymmetry?: number;         // 0..1 (1 = symmetric)
  defocusBlur?: number;          // 0..1 (1 = no defocus blur)
  motionBlur?: number;          // 0..1 (1 = no motion blur)
  motionBlurDirection?: "horizontal" | "vertical" | "diagonal" | "none";

  // ─── Composite score combining all 13 dimensions ───
  compositeQuality?: number;     // 0..1 weighted average of all metrics

  // ─── Metadata ───
  issues: string[];
  suggestions: string[];
  pass: boolean;
}

// Alias for forward-compatibility — newer code may use this name.
export type FaceQualityResult = FaceQualityScore;

// ─── Image stats (using sharp for decode/resize only) ────────────

interface ImageStats {
  width: number;
  height: number;
  pixels: { r: number; g: number; b: number }[];
  brightnessHist: number[];     // 256 bins
  grayscale: Uint8Array;
}

async function getImageStats(dataUrl: string): Promise<ImageStats> {
  const sharp = (await import("sharp")).default;

  // Parse data URL
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  const buffer = Buffer.from(base64, "base64");

  // Resize to max 320px wide for fast analysis
  const meta = await sharp(buffer).metadata();
  const targetWidth = Math.min(320, meta.width || 320);
  const resized = await sharp(buffer)
    .resize(targetWidth)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  const pixels: { r: number; g: number; b: number }[] = [];
  const brightnessHist = new Array(256).fill(0);
  const grayscale = new Uint8Array(info.width * info.height);

  for (let i = 0, p = 0; i < data.length; i += info.channels, p++) {
    const r = data[i] || 0;
    const g = data[i + 1] || 0;
    const b = data[i + 2] || 0;
    pixels.push({ r, g, b });
    // Luminance (ITU-R BT.601)
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayscale[p] = lum;
    brightnessHist[lum]++;
  }

  return {
    width: info.width,
    height: info.height,
    pixels,
    brightnessHist,
    grayscale,
  };
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length === 0) return 0;
  const m = mean(arr);
  return Math.sqrt(mean(arr.map((x) => (x - m) ** 2)));
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

// ─── Legacy 5 quality checks ─────────────────────────────────────

function scoreBrightness(brightnessHist: number[]): { score: number; issue?: string } {
  const totalPixels = brightnessHist.reduce((a, b) => a + b, 0);
  if (totalPixels === 0) return { score: 0, issue: "No pixels" };

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * brightnessHist[i];
  const meanBrightness = sum / totalPixels;

  if (meanBrightness >= 80 && meanBrightness <= 180) return { score: 1 };
  if (meanBrightness < 40) return { score: 0.1, issue: "Too dark" };
  if (meanBrightness < 80) return { score: 0.5, issue: "Slightly dark" };
  if (meanBrightness > 220) return { score: 0.1, issue: "Too bright (overexposed)" };
  if (meanBrightness > 180) return { score: 0.5, issue: "Slightly bright" };
  return { score: 0.8 };
}

function scoreContrast(brightnessHist: number[]): { score: number; issue?: string } {
  const totalPixels = brightnessHist.reduce((a, b) => a + b, 0);
  if (totalPixels === 0) return { score: 0 };

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * brightnessHist[i];
  const m = sum / totalPixels;

  let variance = 0;
  for (let i = 0; i < 256; i++) {
    variance += brightnessHist[i] * (i - m) ** 2;
  }
  variance /= totalPixels;
  const stddev = Math.sqrt(variance);

  if (stddev >= 40 && stddev <= 80) return { score: 1 };
  if (stddev < 15) return { score: 0.2, issue: "Very low contrast (flat image)" };
  if (stddev < 30) return { score: 0.5, issue: "Low contrast" };
  if (stddev > 90) return { score: 0.7, issue: "High contrast (harsh lighting)" };
  return { score: 0.85 };
}

function scoreSharpness(grayscale: Uint8Array, width: number, height: number): { score: number; issue?: string } {
  // Laplacian variance as sharpness measure
  let laplacianSum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const center = grayscale[idx];
      const top = grayscale[idx - width];
      const bottom = grayscale[idx + width];
      const left = grayscale[idx - 1];
      const right = grayscale[idx + 1];
      const laplacian = Math.abs(-4 * center + top + bottom + left + right);
      laplacianSum += laplacian;
      count++;
    }
  }

  if (count === 0) return { score: 0 };
  const meanLaplacian = laplacianSum / count;

  if (meanLaplacian > 30) return { score: 1 };
  if (meanLaplacian > 15) return { score: 0.8 };
  if (meanLaplacian > 5) return { score: 0.5, issue: "Slightly blurry" };
  return { score: 0.2, issue: "Blurry (motion or focus blur)" };
}

function scoreFaceSizeEstimate(
  grayscale: Uint8Array,
  width: number,
  height: number,
  _brightnessHist: number[],
): { score: number; issue?: string } {
  // Estimate face size via central-region local variance
  const cx1 = Math.floor(width * 0.25);
  const cx2 = Math.floor(width * 0.75);
  const cy1 = Math.floor(height * 0.2);
  const cy2 = Math.floor(height * 0.8);

  let centerVariance = 0;
  let centerCount = 0;
  for (let y = cy1; y < cy2; y++) {
    for (let x = cx1; x < cx2; x++) {
      const idx = y * width + x;
      const c = grayscale[idx];
      const neighbors = [
        grayscale[idx - 1] || 0,
        grayscale[idx + 1] || 0,
        grayscale[idx - width] || 0,
        grayscale[idx + width] || 0,
      ];
      const localMean = (c + neighbors[0] + neighbors[1] + neighbors[2] + neighbors[3]) / 5;
      centerVariance += Math.abs(c - localMean);
      centerCount++;
    }
  }

  if (centerCount === 0) return { score: 0 };
  const meanLocalVar = centerVariance / centerCount;

  if (meanLocalVar > 15) return { score: 1 };
  if (meanLocalVar > 8) return { score: 0.7 };
  if (meanLocalVar > 3) return { score: 0.4, issue: "Face may be too small or absent" };
  return { score: 0.2, issue: "No face detected in center region" };
}

function scoreBackgroundUniformity(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; issue?: string } {
  const cornerSize = Math.floor(Math.min(width, height) * 0.15);
  const corners: number[][] = [[], [], [], []];

  for (let y = 0; y < cornerSize; y++) {
    for (let x = 0; x < cornerSize; x++) {
      corners[0].push(grayscale[y * width + x]);
      corners[1].push(grayscale[y * width + (width - 1 - x)]);
      corners[2].push(grayscale[(height - 1 - y) * width + x]);
      corners[3].push(grayscale[(height - 1 - y) * width + (width - 1 - x)]);
    }
  }

  const cornerStds = corners.map((c) => stdDev(c));
  const meanCornerStd = mean(cornerStds);

  if (meanCornerStd < 15) return { score: 1 };
  if (meanCornerStd < 30) return { score: 0.7 };
  if (meanCornerStd < 50) return { score: 0.4, issue: "Distracting background" };
  return { score: 0.2, issue: "Busy/cluttered background" };
}

// ─── NEW v2: Pose estimation ────────────────────────────────────

/**
 * Estimate head pose (yaw, pitch, roll) in degrees from facial landmarks.
 *
 * Supports:
 *   - 5-point format: [rightEye, leftEye, noseTip, rightMouthCorner, leftMouthCorner]
 *   - 68-point face-api format (auto-detected by array length)
 *   - 468-point MediaPipe FaceMesh (uses canonical indices)
 *
 * Geometric approach:
 *   - Roll = angle of eye line (right-eye → left-eye) relative to horizontal.
 *   - Yaw  = horizontal displacement of nose from eye-midpoint, normalized
 *            by inter-ocular distance. Positive = looking right.
 *   - Pitch = vertical position of nose relative to eye-midpoint, normalized
 *             by vertical eye-to-mouth distance. Positive = looking up.
 *
 * Pure TypeScript, no ML model required.
 */
export function estimatePoseFromLandmarks(landmarks: Landmark[]): PoseEstimate {
  if (!landmarks || landmarks.length < 5) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  // Pick key landmark indices based on array length (common formats).
  let rightEye: Landmark;
  let leftEye: Landmark;
  let noseTip: Landmark;
  let rightMouth: Landmark;
  let leftMouth: Landmark;

  if (landmarks.length >= 468) {
    // MediaPipe FaceMesh canonical indices
    rightEye = landmarks[33];   // outer right eye
    leftEye = landmarks[263];   // outer left eye
    noseTip = landmarks[1];     // nose tip
    rightMouth = landmarks[61]; // right mouth corner
    leftMouth = landmarks[291]; // left mouth corner
  } else if (landmarks.length >= 68) {
    // face-api / dlib 68-point
    rightEye = landmarks[36];  // outer corner of right eye
    leftEye = landmarks[45];   // outer corner of left eye
    noseTip = landmarks[30];
    rightMouth = landmarks[48];
    leftMouth = landmarks[54];
  } else {
    // Assume 5-point format: [rightEye, leftEye, nose, rightMouth, leftMouth]
    rightEye = landmarks[0];
    leftEye = landmarks[1];
    noseTip = landmarks[2];
    rightMouth = landmarks[3];
    leftMouth = landmarks[4];
  }

  // Roll: angle of line from right eye to left eye, relative to horizontal.
  // Note: in image coords, y grows downward. Positive roll (CW) = left eye lower than right eye.
  const eyeDx = leftEye.x - rightEye.x;
  const eyeDy = leftEye.y - rightEye.y;
  const roll = Math.atan2(eyeDy, eyeDx) * (180 / Math.PI);

  // Inter-ocular distance (reference scale)
  const iod = Math.sqrt(eyeDx * eyeDx + eyeDy * eyeDy) || 1;

  // Eye midpoint
  const eyeMidX = (rightEye.x + leftEye.x) / 2;
  const eyeMidY = (rightEye.y + leftEye.y) / 2;

  // Yaw: horizontal offset of nose from eye midpoint, normalized by IOD.
  // Positive offset (nose to the right of midpoint) = head turned to the right.
  const yawNorm = (noseTip.x - eyeMidX) / iod;
  // Empirical: yawNorm ≈ 0 frontal, ≈ ±1 for ~90° turn
  const yaw = Math.max(-90, Math.min(90, yawNorm * 90));

  // Mouth midpoint
  const mouthMidX = (rightMouth.x + leftMouth.x) / 2;
  const mouthMidY = (rightMouth.y + leftMouth.y) / 2;

  // Vertical eye-to-mouth distance (reference scale for vertical motion)
  const eyeMouthDy = mouthMidY - eyeMidY;
  const eyeMouthDist = Math.abs(eyeMouthDy) || 1;

  // Pitch: nose vertical position relative to the eye-mouth axis center,
  // normalized by eye-to-mouth distance. If nose sits high → looking up.
  const pitchNorm = (eyeMidY + eyeMouthDy / 2 - noseTip.y) / eyeMouthDist;
  // Empirical scaling: pitchNorm ≈ 0 frontal, ≈ ±1 for ~45° tilt
  const pitch = Math.max(-60, Math.min(60, pitchNorm * 45));

  return { yaw, pitch, roll };
}

/**
 * Gradient-based pose fallback when landmarks aren't available.
 * Estimates roll from the dominant horizontal-structure orientation in the
 * upper-center (eye-band) region using image-moment analysis.
 */
function estimatePoseFromGradient(
  grayscale: Uint8Array,
  width: number,
  height: number,
): PoseEstimate {
  // Sample the upper-center band (where eyes typically are): 30–45% of height
  const y1 = Math.floor(height * 0.3);
  const y2 = Math.floor(height * 0.45);
  const x1 = Math.floor(width * 0.2);
  const x2 = Math.floor(width * 0.8);

  // Compute image second-moments of the gradient magnitude to estimate
  // the dominant orientation of edges. Roll ≈ dominant edge orientation.
  let sumX2 = 0, sumY2 = 0, sumXY = 0;
  let total = 0;
  for (let y = y1 + 1; y < y2 - 1; y++) {
    for (let x = x1 + 1; x < x2 - 1; x++) {
      const idx = y * width + x;
      const gx = grayscale[idx + 1] - grayscale[idx - 1];
      const gy = grayscale[idx + width] - grayscale[idx - width];
      const mag = Math.sqrt(gx * gx + gy * gy);
      // Weight by gradient magnitude — strong edges dominate orientation
      sumX2 += gx * gx * mag;
      sumY2 += gy * gy * mag;
      sumXY += gx * gy * mag;
      total += mag;
    }
  }
  if (total === 0) return { yaw: 0, pitch: 0, roll: 0 };

  // Orientation of the principal axis (degrees). For a frontal face the
  // eye-line is roughly horizontal, so edges in the eye band are mostly
  // horizontal → roll ≈ 0.
  const roll = 0.5 * Math.atan2(2 * sumXY, sumX2 - sumY2) * (180 / Math.PI);

  // Without landmarks, yaw/pitch are unreliable — return 0 (frontal assumption).
  return { yaw: 0, pitch: 0, roll };
}

function scorePose(pose: PoseEstimate): PoseScore {
  const { yaw, pitch, roll } = pose;
  // Thresholds: |yaw| > 30°, |pitch| > 30°, |roll| > 15° → flag
  const yawOk = Math.abs(yaw) <= 30;
  const pitchOk = Math.abs(pitch) <= 30;
  const rollOk = Math.abs(roll) <= 15;

  // Score = falloff from thresholds
  const yawScore = clamp01(1 - (Math.abs(yaw) - 30) / 30);
  const pitchScore = clamp01(1 - (Math.abs(pitch) - 30) / 30);
  const rollScore = clamp01(1 - (Math.abs(roll) - 15) / 15);

  const score = (yawScore + pitchScore + rollScore) / 3;

  let issue: string | undefined;
  if (!yawOk) issue = `Head yaw ${yaw.toFixed(0)}° exceeds ±30°`;
  else if (!pitchOk) issue = `Head pitch ${pitch.toFixed(0)}° exceeds ±30°`;
  else if (!rollOk) issue = `Head roll ${roll.toFixed(0)}° exceeds ±15°`;

  return { yaw, pitch, roll, score, issue };
}

// ─── NEW v2: Occlusion detection ─────────────────────────────────

/**
 * Detect occlusion of eyes/nose/mouth via local variance + edge density
 * in expected face regions. Score 0..1 (1 = no occlusion).
 */
function scoreOcclusion(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; issue?: string } {
  // Expected face region: center band, 25–80% of height, 25–75% of width.
  // Sub-regions (relative to a centered face):
  //   eyes: y 35–45%, x 30–70%
  //   nose: y 50–65%, x 40–60%
  //   mouth: y 70–82%, x 35–65%
  const regions: { name: string; x1: number; x2: number; y1: number; y2: number }[] = [
    { name: "eyes", x1: 0.3, x2: 0.7, y1: 0.35, y2: 0.45 },
    { name: "nose", x1: 0.4, x2: 0.6, y1: 0.5, y2: 0.65 },
    { name: "mouth", x1: 0.35, x2: 0.65, y1: 0.7, y2: 0.82 },
  ];

  let occluded = 0;
  const issues: string[] = [];
  for (const r of regions) {
    const x1 = Math.floor(width * r.x1);
    const x2 = Math.floor(width * r.x2);
    const y1 = Math.floor(height * r.y1);
    const y2 = Math.floor(height * r.y2);
    const vals: number[] = [];
    let edgeCount = 0;
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const idx = y * width + x;
        vals.push(grayscale[idx]);
        // Sobel edge density
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const gx = Math.abs(grayscale[idx + 1] - grayscale[idx - 1]);
          const gy = Math.abs(grayscale[idx + width] - grayscale[idx - width]);
          if (gx + gy > 30) edgeCount++;
        }
      }
    }
    const variance = stdDev(vals);
    const edgeDensity = edgeCount / (vals.length || 1);
    // Real features have moderate-to-high variance (skin + iris + brow) AND
    // meaningful edge density. Occluded (covered by hair/hand/scarf) regions
    // tend to be very uniform AND have low edge density.
    const varianceScore = clamp01(variance / 30); // variance > 30 = OK
    const edgeScore = clamp01(edgeDensity / 0.15); // >15% edges = OK
    const regionScore = (varianceScore + edgeScore) / 2;
    if (regionScore < 0.3) {
      occluded++;
      issues.push(r.name);
    }
  }

  // Score = (3 - occluded) / 3
  const score = (3 - occluded) / 3;
  if (occluded > 0) {
    return { score, issue: `Possible occlusion: ${issues.join(", ")}` };
  }
  return { score };
}

// ─── NEW v2: Lighting uniformity ────────────────────────────────

/**
 * Lighting uniformity: coefficient of variation (CV = std/mean) of pixel
 * intensities across the face region. Lower CV = more uniform lighting.
 * Score 0..1 (1 = uniform).
 */
function scoreLightingUniformity(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; issue?: string } {
  // Face region: center band
  const x1 = Math.floor(width * 0.3);
  const x2 = Math.floor(width * 0.7);
  const y1 = Math.floor(height * 0.25);
  const y2 = Math.floor(height * 0.85);

  const vals: number[] = [];
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      vals.push(grayscale[y * width + x]);
    }
  }
  const m = mean(vals);
  if (m === 0) return { score: 0, issue: "Face too dark to evaluate lighting" };
  const sd = stdDev(vals);
  const cv = sd / m;

  // CV < 0.2 = uniform, CV > 0.5 = strongly non-uniform
  const score = clamp01(1 - (cv - 0.2) / 0.4);
  if (cv > 0.5) return { score, issue: "Strong non-uniform lighting (shadows)" };
  if (cv > 0.35) return { score, issue: "Slightly uneven lighting" };
  return { score };
}

// ─── NEW v2: Color naturalness ──────────────────────────────────

/**
 * Color naturalness: detect unnatural color casts (too red/blue/green).
 * Real skin tones fall in a known region of RGB space. Score 0..1.
 */
function scoreColorNaturalness(pixels: { r: number; g: number; b: number }[]): { score: number; issue?: string } {
  if (pixels.length === 0) return { score: 0 };

  // Sample center pixels (face region) — pixel array is row-major from top-left
  // We don't have width/height here, but the function is called with center samples
  // by the main entry; approximate by sampling every Nth pixel.
  const samples: { r: number; g: number; b: number }[] = [];
  const step = Math.max(1, Math.floor(pixels.length / 5000));
  for (let i = 0; i < pixels.length; i += step) samples.push(pixels[i]);

  let avgR = 0, avgG = 0, avgB = 0;
  for (const p of samples) {
    avgR += p.r; avgG += p.g; avgB += p.b;
  }
  avgR /= samples.length; avgG /= samples.length; avgB /= samples.length;

  // Skin tone heuristic (RGB): R > G > B, R in [95..230], (R-G) in [12..60], (G-B) in [5..50]
  const rMinusG = avgR - avgG;
  const gMinusB = avgG - avgB;
  const isSkinOrder = avgR > avgG && avgG > avgB;
  const skinOrderScore = isSkinOrder ? 1 : 0.3;

  // Distance from "ideal" skin chromaticity (R≈185, G≈140, B≈120 typical)
  const idealR = 185, idealG = 140, idealB = 120;
  const colorDist = Math.sqrt(
    (avgR - idealR) ** 2 + (avgG - idealG) ** 2 + (avgB - idealB) ** 2,
  );
  const closenessScore = clamp01(1 - colorDist / 100);

  // Red/blue cast check
  let castIssue: string | undefined;
  if (avgR > avgG + 50 && avgR > avgB + 80) castIssue = "Strong red cast";
  else if (avgB > avgR + 10) castIssue = "Blue cast";
  else if (avgG > avgR + 10 && avgG > avgB + 10) castIssue = "Green cast";

  // Combined score: weight order & closeness
  const score = clamp01(0.5 * skinOrderScore + 0.5 * closenessScore);
  return { score, issue: castIssue };
}

// ─── NEW v2: Background simplicity (edge density) ──────────────

/**
 * Background simplicity: edge density in corner (background) regions.
 * Simple backgrounds (plain wall) have low edge density → high score.
 * Score 0..1.
 */
function scoreBackgroundSimplicity(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; issue?: string } {
  const cornerSize = Math.floor(Math.min(width, height) * 0.2);
  let edgeCount = 0;
  let total = 0;

  // Sample 4 corners
  const corners: [number, number][] = [
    [0, 0],
    [0, width - cornerSize],
    [height - cornerSize, 0],
    [height - cornerSize, width - cornerSize],
  ];

  for (const [oy, ox] of corners) {
    for (let y = oy + 1; y < oy + cornerSize - 1 && y < height - 1; y++) {
      for (let x = ox + 1; x < ox + cornerSize - 1 && x < width - 1; x++) {
        const idx = y * width + x;
        const gx = Math.abs(grayscale[idx + 1] - grayscale[idx - 1]);
        const gy = Math.abs(grayscale[idx + width] - grayscale[idx - width]);
        if (gx + gy > 25) edgeCount++;
        total++;
      }
    }
  }

  if (total === 0) return { score: 0 };
  const density = edgeCount / total;
  // Density < 0.05 = simple, > 0.3 = busy
  const score = clamp01(1 - (density - 0.05) / 0.3);
  if (density > 0.3) return { score, issue: "Background has many edges (cluttered)" };
  if (density > 0.15) return { score, issue: "Background has some edges" };
  return { score };
}

// ─── NEW v2: Face symmetry ─────────────────────────────────────

/**
 * Face symmetry: compare left and right halves of the face via pixel
 * intensity correlation after mirroring. Score 0..1 (1 = symmetric).
 */
function scoreFaceSymmetry(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; issue?: string } {
  // Face region: center band
  const x1 = Math.floor(width * 0.25);
  const x2 = Math.floor(width * 0.75);
  const y1 = Math.floor(height * 0.2);
  const y2 = Math.floor(height * 0.85);
  const faceW = x2 - x1;
  if (faceW < 4) return { score: 0 };

  // For each row, compare left half (mirrored) vs right half
  let sumAbsDiff = 0;
  let count = 0;
  const halfW = Math.floor(faceW / 2);
  for (let y = y1; y < y2; y++) {
    for (let x = 0; x < halfW; x++) {
      const left = grayscale[y * width + (x1 + x)];
      const right = grayscale[y * width + (x2 - 1 - x)];
      sumAbsDiff += Math.abs(left - right);
      count++;
    }
  }
  if (count === 0) return { score: 0 };
  const avgDiff = sumAbsDiff / count;
  // avgDiff < 15 = symmetric, > 50 = strongly asymmetric
  const score = clamp01(1 - (avgDiff - 15) / 35);
  if (avgDiff > 50) return { score, issue: "Strong facial asymmetry (lighting or pose)" };
  if (avgDiff > 30) return { score, issue: "Slight facial asymmetry" };
  return { score };
}

// ─── NEW v2: Defocus blur (Laplacian variance) ──────────────────

/**
 * Defocus blur: Laplacian variance over the face ROI. Low variance = out of
 * focus. Score 0..1 (1 = no defocus blur).
 */
function scoreDefocusBlur(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; issue?: string } {
  // Face ROI: center band
  const x1 = Math.floor(width * 0.25);
  const x2 = Math.floor(width * 0.75);
  const y1 = Math.floor(height * 0.2);
  const y2 = Math.floor(height * 0.85);

  let lapSum = 0, lapSqSum = 0, count = 0;
  for (let y = y1 + 1; y < y2 - 1; y++) {
    for (let x = x1 + 1; x < x2 - 1; x++) {
      const idx = y * width + x;
      const lap = -4 * grayscale[idx] +
        grayscale[idx - 1] + grayscale[idx + 1] +
        grayscale[idx - width] + grayscale[idx + width];
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }
  if (count === 0) return { score: 0 };
  const meanLap = lapSum / count;
  const variance = lapSqSum / count - meanLap * meanLap;
  // Variance > 200 = sharp, < 50 = heavily defocused
  const score = clamp01((variance - 50) / 150);
  if (variance < 50) return { score, issue: "Image is out of focus (defocus blur)" };
  if (variance < 100) return { score, issue: "Slight focus blur" };
  return { score };
}

// ─── NEW v2: Motion blur (directional gradient analysis) ───────

/**
 * Motion blur: directional gradient analysis. Compare horizontal vs vertical
 * gradient magnitudes — motion blur in one direction suppresses gradients
 * orthogonal to motion direction. Score 0..1 (1 = no motion blur).
 */
function scoreMotionBlur(
  grayscale: Uint8Array,
  width: number,
  height: number,
): { score: number; direction: "horizontal" | "vertical" | "diagonal" | "none"; issue?: string } {
  // Face ROI: center band
  const x1 = Math.floor(width * 0.25);
  const x2 = Math.floor(width * 0.75);
  const y1 = Math.floor(height * 0.2);
  const y2 = Math.floor(height * 0.85);

  let gxSum = 0, gySum = 0, count = 0;
  for (let y = y1 + 1; y < y2 - 1; y++) {
    for (let x = x1 + 1; x < x2 - 1; x++) {
      const idx = y * width + x;
      gxSum += Math.abs(grayscale[idx + 1] - grayscale[idx - 1]);
      gySum += Math.abs(grayscale[idx + width] - grayscale[idx - width]);
      count++;
    }
  }
  if (count === 0) return { score: 0, direction: "none" };
  const avgGx = gxSum / count;
  const avgGy = gySum / count;
  const total = avgGx + avgGy;
  if (total === 0) return { score: 0, direction: "none", issue: "No gradients (severe blur)" };

  // Direction imbalance: if one direction's gradient is much smaller than the
  // other, motion blur suppressed gradients in the orthogonal direction.
  //   - Small gx + large gy → horizontal motion blur (camera moved sideways)
  //   - Small gy + large gx → vertical motion blur (camera moved up/down)
  const ratio = Math.min(avgGx, avgGy) / Math.max(avgGx, avgGy);
  // ratio ≈ 1 = no directional blur, ratio < 0.4 = strong directional blur

  let direction: "horizontal" | "vertical" | "diagonal" | "none" = "none";
  let issue: string | undefined;
  if (ratio < 0.4) {
    if (avgGx < avgGy) {
      direction = "horizontal";
      issue = "Horizontal motion blur detected";
    } else {
      direction = "vertical";
      issue = "Vertical motion blur detected";
    }
  } else if (ratio < 0.6) {
    direction = "diagonal";
    issue = "Slight directional blur";
  }

  // Score: high when ratio ≈ 1 (balanced gradients)
  const score = clamp01(ratio);
  return { score, direction, issue };
}

// ─── Main entry point ────────────────────────────────────────────

/**
 * Score face image quality. Returns 5 legacy sub-scores + overall + 8 new
 * v2 sub-scores + compositeQuality + issues + suggestions.
 *
 * @param imageDataUrl data URL or base64-encoded image
 * @param landmarks   Optional facial landmarks. If provided, pose estimation
 *                    uses them; otherwise a gradient-based fallback is used.
 */
export async function scoreFaceImageQuality(
  imageDataUrl: string,
  landmarks?: Landmark[],
): Promise<FaceQualityScore> {
  try {
    const stats = await getImageStats(imageDataUrl);
    const { brightnessHist, grayscale, width, height, pixels } = stats;

    // ─── Legacy 5 dimensions ────────────────────────────────────
    const brightnessResult = scoreBrightness(brightnessHist);
    const contrastResult = scoreContrast(brightnessHist);
    const sharpnessResult = scoreSharpness(grayscale, width, height);
    const faceSizeResult = scoreFaceSizeEstimate(grayscale, width, height, brightnessHist);
    const backgroundResult = scoreBackgroundUniformity(grayscale, width, height);

    const overall =
      brightnessResult.score * 0.15 +
      contrastResult.score * 0.15 +
      sharpnessResult.score * 0.30 +
      faceSizeResult.score * 0.25 +
      backgroundResult.score * 0.15;

    // ─── New v2 dimensions ──────────────────────────────────────
    // Pose
    const poseEstimate = landmarks && landmarks.length >= 5
      ? estimatePoseFromLandmarks(landmarks)
      : estimatePoseFromGradient(grayscale, width, height);
    const poseScore = scorePose(poseEstimate);

    // Occlusion
    const occlusionResult = scoreOcclusion(grayscale, width, height);

    // Lighting uniformity
    const lightingUniformityResult = scoreLightingUniformity(grayscale, width, height);

    // Color naturalness
    const colorNaturalnessResult = scoreColorNaturalness(pixels);

    // Background simplicity
    const backgroundSimplicityResult = scoreBackgroundSimplicity(grayscale, width, height);

    // Face symmetry
    const faceSymmetryResult = scoreFaceSymmetry(grayscale, width, height);

    // Defocus blur
    const defocusBlurResult = scoreDefocusBlur(grayscale, width, height);

    // Motion blur
    const motionBlurResult = scoreMotionBlur(grayscale, width, height);

    // ─── Composite quality score (13-dim weighted average) ───────
    // Legacy 5 carry the most weight; new dims contribute progressively.
    const compositeQuality = clamp01(
      brightnessResult.score * 0.08 +
      contrastResult.score * 0.08 +
      sharpnessResult.score * 0.18 +
      faceSizeResult.score * 0.15 +
      backgroundResult.score * 0.08 +
      poseScore.score * 0.12 +
      occlusionResult.score * 0.10 +
      lightingUniformityResult.score * 0.05 +
      colorNaturalnessResult.score * 0.05 +
      backgroundSimplicityResult.score * 0.03 +
      faceSymmetryResult.score * 0.03 +
      defocusBlurResult.score * 0.03 +
      motionBlurResult.score * 0.02,
    );

    // ─── Issues & suggestions ───────────────────────────────────
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (brightnessResult.issue) {
      issues.push(brightnessResult.issue);
      if (brightnessResult.issue.includes("dark")) suggestions.push("Move to a brighter location or face a window");
      if (brightnessResult.issue.includes("bright")) suggestions.push("Avoid direct sunlight or bright lights behind you");
    }
    if (contrastResult.issue) {
      issues.push(contrastResult.issue);
      suggestions.push("Ensure even lighting on your face");
    }
    if (sharpnessResult.issue) {
      issues.push(sharpnessResult.issue);
      suggestions.push("Hold steady and ensure the camera is in focus");
    }
    if (faceSizeResult.issue) {
      issues.push(faceSizeResult.issue);
      suggestions.push("Move closer so your face fills more of the frame");
    }
    if (backgroundResult.issue) {
      issues.push(backgroundResult.issue);
      suggestions.push("Use a plain wall as background");
    }
    if (poseScore.issue) {
      issues.push(poseScore.issue);
      suggestions.push("Face the camera directly (frontal pose)");
    }
    if (occlusionResult.issue) {
      issues.push(occlusionResult.issue);
      suggestions.push("Remove glasses, hair, or accessories covering your face");
    }
    if (lightingUniformityResult.issue) {
      issues.push(lightingUniformityResult.issue);
      suggestions.push("Use frontal, diffuse lighting to avoid shadows");
    }
    if (colorNaturalnessResult.issue) {
      issues.push(colorNaturalnessResult.issue);
      suggestions.push("Use natural white lighting (avoid colored or fluorescent sources)");
    }
    if (backgroundSimplicityResult.issue) {
      issues.push(backgroundSimplicityResult.issue);
      suggestions.push("Stand against a plain, untextured wall");
    }
    if (faceSymmetryResult.issue) {
      issues.push(faceSymmetryResult.issue);
      suggestions.push("Center your face and use symmetric lighting");
    }
    if (defocusBlurResult.issue) {
      issues.push(defocusBlurResult.issue);
      suggestions.push("Tap to focus the camera before capturing");
    }
    if (motionBlurResult.issue) {
      issues.push(motionBlurResult.issue);
      suggestions.push("Hold still or brace the device while capturing");
    }

    const pass = compositeQuality >= 0.5;

    return {
      // Legacy 5
      brightness: brightnessResult.score,
      contrast: contrastResult.score,
      sharpness: sharpnessResult.score,
      faceSizeEstimate: faceSizeResult.score,
      backgroundUniformity: backgroundResult.score,
      overall: Math.round(overall * 1000) / 1000,

      // New v2
      pose: poseScore,
      occlusion: Math.round(occlusionResult.score * 1000) / 1000,
      lightingUniformity: Math.round(lightingUniformityResult.score * 1000) / 1000,
      colorNaturalness: Math.round(colorNaturalnessResult.score * 1000) / 1000,
      backgroundSimplicity: Math.round(backgroundSimplicityResult.score * 1000) / 1000,
      faceSymmetry: Math.round(faceSymmetryResult.score * 1000) / 1000,
      defocusBlur: Math.round(defocusBlurResult.score * 1000) / 1000,
      motionBlur: Math.round(motionBlurResult.score * 1000) / 1000,
      motionBlurDirection: motionBlurResult.direction,

      // Composite
      compositeQuality: Math.round(compositeQuality * 1000) / 1000,

      issues,
      suggestions,
      pass,
    };
  } catch (e: any) {
    return {
      brightness: 0, contrast: 0, sharpness: 0, faceSizeEstimate: 0,
      backgroundUniformity: 0, overall: 0,
      compositeQuality: 0,
      issues: ["Image analysis failed: " + (e?.message || "unknown").slice(0, 100)],
      suggestions: ["Retake the photo"],
      pass: false,
    };
  }
}
