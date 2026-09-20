import { NextRequest, NextResponse } from "next/server";
import {
  detectDeepfake,
  detectScreenReplay,
  detectPrintAttack,
  detectSiliconeFinger,
  detectFGSMAttack,
  detectAdversarialPerturbation,
  detectHybridAttack,
  ensembleAdversarialDetection,
  type AdversarialSignal,
  type EnsembleVerdict,
  type ImageStats,
} from "@/lib/adversarial-detection";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — adversarial-detection endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/adversarial-detection
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Adversarial Detection API request payload.
 *
 * `image` is a base64-encoded image (the surface being tested). All other
 * fields are optional numeric feature arrays produced by upstream feature
 * extractors (FFT, color histogram, LBP, ridge stats, gradient norms).
 */
interface AdversarialDetectionRequest {
  /** Base64-encoded image under test (data URL or raw base64). */
  image: string;
  /** Optional face feature vector (kept for forward-compat; not currently consumed). */
  face_features?: number[];
  /** Optional FFT frequency spectrum (used by deepfake + screen-replay detectors). */
  frequency_spectrum?: number[];
  /** Optional color histogram (used by deepfake detector). */
  color_histogram?: number[];
  /** Optional texture feature vector (used by print-attack detector). */
  texture_features?: number[];
  /** Optional fingerprint ridge feature vector (used by silicone-finger detector). */
  fingerprint_features?: number[];
  /** Optional input-gradient vector (used by FGSM + adversarial-perturbation detectors). */
  input_gradient?: number[];
  /** Optional FGSM epsilon (default 0.03). */
  epsilon?: number;
}

/**
 * Adversarial Detection API response payload.
 */
interface AdversarialDetectionResponse {
  /** One signal per detector that ran (detectors with no input data are skipped). */
  signals: AdversarialSignal[];
  /** Weighted ensemble verdict across all signals. */
  ensemble: EnsembleVerdict;
  /** Final action recommendation derived from the ensemble score. */
  recommendedAction: "allow" | "review" | "reject";
  /** Unique attack types fingerprinted by the top-3 signals. */
  attackTypes: string[];
  /** 0..1 — overall confidence in the verdict (boosted if detectors agree). */
  confidence: number;
  /** Human-readable summary. */
  summary: string;
  /** ISO-8601 timestamp of computation. */
  computedAt: string;
}

/**
 * Derive basic ImageStats (L2 norm, L∞ norm, spectral entropy) from a
 * raw gradient vector. Used to drive the adversarial-perturbation detector
 * when the caller provides only `input_gradient` and no precomputed stats.
 */
function deriveImageStats(inputGradient: number[]): ImageStats {
  if (inputGradient.length === 0) {
    return { l2_norm: 0, l_inf_norm: 0, spectral_entropy: 0 };
  }
  let sumSq = 0;
  let maxAbs = 0;
  for (const v of inputGradient) {
    const av = Math.abs(v);
    sumSq += v * v;
    if (av > maxAbs) maxAbs = av;
  }
  const l2_norm = Math.sqrt(sumSq);
  const l_inf_norm = maxAbs;

  // Spectral entropy ≈ Shannon entropy of a 10-bucket histogram of values.
  // Shift negative values into [0, ∞) by taking absolute value, then bin.
  const buckets = new Array(10).fill(0);
  for (const v of inputGradient) {
    const av = Math.abs(v);
    const idx = Math.min(9, Math.max(0, Math.floor(av * 10)));
    buckets[idx]++;
  }
  const total = inputGradient.length;
  let entropy = 0;
  for (const b of buckets) {
    if (b === 0) continue;
    const p = b / total;
    entropy -= p * Math.log2(p);
  }

  return { l2_norm, l_inf_norm, spectral_entropy: entropy };
}

/**
 * POST /api/v1/verify/adversarial-detection
 *
 * Adversarial attack detection — beyond basic liveness. Accepts a base64
 * image plus optional numeric feature arrays (FFT spectrum, color
 * histogram, texture features, fingerprint ridge stats, input gradient),
 * then runs 8 specialised detectors in parallel:
 *
 *   1. **Deepfake** — GAN artifacts, frequency noise, color anomalies
 *   2. **Screen replay** — moiré patterns, pixel grid artifacts
 *   3. **Print attack** — paper texture, lighting flatness
 *   4. **Silicone finger** — ridge uniformity, missing sweat pores
 *   5. **FGSM attack** — Fast Gradient Sign Method perturbations on the matcher
 *   6. **Adversarial perturbation** — general L2/L∞/spectral anomalies
 *   7. **Hybrid attack** — meta-detector that fuses multiple low-confidence
 *      signals into a high-confidence "blended attack" verdict
 *   8. **Ensemble** — weighted single verdict + recommended action
 *
 * Each detector that has its required input runs; detectors without input
 * are skipped (not reported as zero-score signals).
 *
 * ## Competitor gap
 *
 * Onfido, Jumio, Veriff, and Sumsub all ship liveness + basic PAD. None
 * ship adversarial-ML-attack detection (FGSM/PGD on the matcher itself),
 * and none ship a hybrid attack detector that fuses multiple low-confidence
 * signals into a high-confidence "blended attack" verdict.
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/adversarial-detection \
 *   -H "Content-Type: application/json" \
 *   -d '{"image":"data:image/jpeg;base64,...","frequency_spectrum":[12,8,5,3,2,1,1,0.5],"color_histogram":[200,150,80,20,5,1,1,0.5]}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AdversarialDetectionRequest;

    if (!body || typeof body.image !== "string" || body.image.length === 0) {
      return NextResponse.json(
        { error: "image (base64 string) is required", code: "INVALID_INPUT" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const image = body.image;
    const signals: AdversarialSignal[] = [];

    // ─── Detector 1: Deepfake ─────────────────────────────────────────
    // detectDeepfake consumes both frequencyAnalysis (FFT spectrum — used
    // to spot periodic GAN fingerprints) and colorHistogram (used to spot
    // synthetic-palette anomalies). We reuse `frequency_spectrum` as the
    // frequencyAnalysis input since both represent FFT magnitude data.
    if (
      (Array.isArray(body.frequency_spectrum) && body.frequency_spectrum.length > 0) ||
      (Array.isArray(body.color_histogram) && body.color_histogram.length > 0)
    ) {
      signals.push(
        detectDeepfake(image, {
          frequencyAnalysis: body.frequency_spectrum,
          colorHistogram: body.color_histogram,
        }),
      );
    }

    // ─── Detector 2: Screen replay ────────────────────────────────────
    if (Array.isArray(body.frequency_spectrum) && body.frequency_spectrum.length > 0) {
      signals.push(detectScreenReplay(image, body.frequency_spectrum));
    }

    // ─── Detector 3: Print attack ──────────────────────────────────────
    if (Array.isArray(body.texture_features) && body.texture_features.length > 0) {
      signals.push(detectPrintAttack(image, body.texture_features));
    }

    // ─── Detector 4: Silicone finger ───────────────────────────────────
    if (Array.isArray(body.fingerprint_features) && body.fingerprint_features.length > 0) {
      signals.push(detectSiliconeFinger(image, body.fingerprint_features));
    }

    // ─── Detector 5: FGSM attack on the matcher ───────────────────────
    if (Array.isArray(body.input_gradient) && body.input_gradient.length > 0) {
      const epsilon = typeof body.epsilon === "number" && body.epsilon > 0
        ? body.epsilon
        : 0.03;
      signals.push(detectFGSMAttack(body.input_gradient, epsilon));
    }

    // ─── Detector 6: General adversarial perturbation ─────────────────
    if (Array.isArray(body.input_gradient) && body.input_gradient.length > 0) {
      const imageStats = deriveImageStats(body.input_gradient);
      signals.push(detectAdversarialPerturbation(imageStats));
    }

    // ─── Detector 7: Hybrid attack (meta-detector over the others) ────
    if (signals.length > 0) {
      signals.push(detectHybridAttack(signals));
    }

    // ─── Ensemble verdict ──────────────────────────────────────────────
    const ensemble = ensembleAdversarialDetection(signals);

    // ─── Summary ───────────────────────────────────────────────────────
    const summaryParts: string[] = [];
    summaryParts.push(
      `${signals.length} detector(s) ran → ensemble score ${ensemble.confidence.toFixed(3)}; isAdversarial=${ensemble.isAdversarial}.`,
    );
    if (ensemble.attackTypes.length > 0) {
      summaryParts.push(`Attack types: ${ensemble.attackTypes.join(", ")}.`);
    }
    summaryParts.push(`Severity: ${ensemble.severity}; recommended action: ${ensemble.recommendedAction}.`);
    const topSignal = [...signals]
      .sort((a, b) => b.score * b.confidence - a.score * a.confidence)[0];
    if (topSignal) {
      summaryParts.push(`Top signal: ${topSignal.name} (score ${topSignal.score.toFixed(3)}, confidence ${topSignal.confidence.toFixed(3)}).`);
    }

    const response: AdversarialDetectionResponse = {
      signals,
      ensemble,
      recommendedAction: ensemble.recommendedAction,
      attackTypes: ensemble.attackTypes,
      confidence: ensemble.confidence,
      summary: summaryParts.join(" "),
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "adversarial detection failed",
        code: "ADVERSARIAL_DETECTION_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/adversarial-detection
 *
 * Returns API documentation and the list of detectors + attack types.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "Adversarial Attack Detection API",
      version: "1.0.0",
      description:
        "Adversarial attack detection beyond basic liveness. Runs up to 7 specialised detectors (deepfake, screen-replay, print-attack, silicone-finger, FGSM, adversarial perturbation, hybrid) over a base64 image plus optional feature arrays, then produces a weighted ensemble verdict + recommended action.",
      competitiveAdvantage:
        "Onfido, Jumio, Veriff, Sumsub all ship liveness + basic PAD. None ship adversarial-ML-attack detection (FGSM/PGD on the matcher itself) or a hybrid attack detector that fuses multiple low-confidence signals into a high-confidence 'blended attack' verdict.",
      endpoints: {
        POST: "Submit image + feature arrays, receive per-detector signals + ensemble verdict + recommended action.",
        GET: "This documentation + detector list.",
        OPTIONS: "CORS preflight (204 No Content).",
      },
      detectors: [
        { name: "deepfake", attack_type: "deepfake", inputs: ["frequency_spectrum", "color_histogram"] },
        { name: "screen_replay", attack_type: "screen_replay", inputs: ["frequency_spectrum"] },
        { name: "print_attack", attack_type: "print_attack", inputs: ["texture_features"] },
        { name: "silicone_finger", attack_type: "silicone_finger", inputs: ["fingerprint_features"] },
        { name: "fgsm", attack_type: "fgsm", inputs: ["input_gradient", "epsilon"] },
        { name: "adversarial_perturbation", attack_type: "perturbation", inputs: ["input_gradient"] },
        { name: "hybrid", attack_type: "hybrid", inputs: ["(meta-detector over others)"] },
      ],
      attackTypes: [
        "deepfake",
        "3d_mask",
        "silicone_finger",
        "screen_replay",
        "print_attack",
        "hybrid",
        "fgsm",
        "perturbation",
      ],
      severityBuckets: {
        low: "ensemble < 0.30",
        medium: "0.30 ≤ ensemble < 0.50",
        high: "0.50 ≤ ensemble < 0.70",
        critical: "ensemble ≥ 0.70",
      },
      actionThresholds: {
        allow: "ensemble < 0.30",
        review: "0.30 ≤ ensemble < 0.70",
        reject: "ensemble ≥ 0.70",
      },
      examplePayload: {
        image: "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
        frequency_spectrum: [12, 8, 5, 3, 2, 1, 1, 0.5],
        color_histogram: [200, 150, 80, 20, 5, 1, 1, 0.5],
        texture_features: [0.4, 0.7, 0.2, 0.9, 0.3],
        fingerprint_features: [0.8, 0.6, 0.5, 0.9, 0.2, 0.1, 0.4],
        input_gradient: [0.02, -0.03, 0.01, 0.04, -0.02, 0.03, -0.01],
        epsilon: 0.03,
      },
    },
    { headers: CORS_HEADERS },
  );
}
