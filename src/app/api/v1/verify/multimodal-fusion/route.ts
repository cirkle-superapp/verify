import { NextRequest, NextResponse } from "next/server";
import {
  fuseBiometrics,
  detectModalityDisagreement,
  multimodalRiskScore,
  stepUpAuthentication,
  BiometricModality,
  ALL_MODALITIES,
  type FusionInputs,
  type FusionResult,
  type ModalityScore,
  type DisagreementResult,
  type MultimodalRiskAssessment,
  type ModalityWeightContext,
} from "@/lib/multimodal-fusion";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — multimodal-fusion endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/multimodal-fusion
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Multimodal Fusion API request payload.
 *
 * Provide any non-empty combination of the 5 modality signal bundles. The
 * engine builds per-modality scores, then combines them via Dempster-Shafer
 * evidence theory to produce a single fused score + conflict mass + decision.
 */
interface MultimodalFusionRequest extends FusionInputs {
  /** Optional per-modality weight overrides (0..1 each). */
  weights?: Partial<Record<BiometricModality, number>>;
  /** Optional context used for default weight computation. */
  context?: ModalityWeightContext;
}

/**
 * Multimodal Fusion API response payload.
 */
interface MultimodalFusionResponse {
  /** 0..1 — Dempster-Shafer combined mass on the "real" hypothesis. */
  fusedScore: number;
  /** Per-modality score breakdown (only modalities that were supplied). */
  modalityBreakdown: ModalityScore[];
  /** Final decision: approve (fusedScore ≥ 0.70 AND conflict < 0.30), reject, or review. */
  decision: "approve" | "review" | "reject";
  /** Modality disagreement result (face says real, voice says spoof → high disagreement). */
  disagreement: DisagreementResult;
  /** 0..1 — Dempster-Shafer conflict mass (high = modalities disagree). */
  conflict: number;
  /** 0..1 — risk score = (1 - fusedScore) + 0.5 * conflict, clamped. */
  riskScore: number;
  /** Risk bucket: low / medium / high / critical. */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** Additional modalities to verify (step-up recommendation). */
  stepUpRecommendations: BiometricModality[];
  /** Human-readable reasoning chain. */
  reasoning: string;
  /** ISO-8601 timestamp of computation. */
  computedAt: string;
}

/**
 * POST /api/v1/verify/multimodal-fusion
 *
 * 5-modality biometric fusion via Dempster-Shafer evidence theory. Accepts
 * any combination of face, voice, behavioral, document, and device
 * biometric signal bundles, plus optional per-modality weights and
 * session context. Returns:
 *
 *   - The fused 0..1 score (D-S combined mass on "real")
 *   - Per-modality breakdown (score, confidence, weight, signals)
 *   - The final decision (approve / review / reject)
 *   - The D-S conflict mass (high = modalities disagree → coordinated attack)
 *   - Modality disagreement detection (which modalities are pulling in
 *     opposite directions)
 *   - A risk score + risk level
 *   - Step-up recommendations (additional modalities to verify)
 *   - Human-readable reasoning chain
 *
 * ## Why Dempster-Shafer (not weighted average)
 *
 * Weighted averaging assumes each modality is independent and additive.
 * Dempster-Shafer explicitly models uncertainty (mass on "I don't know")
 * and conflict (mass on contradictory hypotheses). When two modalities
 * strongly disagree, D-S reports high conflict — surfacing the attack
 * instead of averaging it away.
 *
 * ## Competitor gap
 *
 * Onfido, Jumio, Veriff, Sumsub ship either face-only or face+document
 * flows. None ship 5-modality fusion with explicit Dempster-Shafer
 * conflict tracking — meaning the system can *tell you* when the
 * modalities disagree (face says real, voice says spoof), a strong
 * signal of a coordinated attack.
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/multimodal-fusion \
 *   -H "Content-Type: application/json" \
 *   -d '{"face":{"faceMatchScore":0.95,"livenessScore":0.92,"faceQualityScore":0.9,"landmarkConsistency":0.95,"eyeAspectRatio":0.3,"blinkDetected":1,"headPoseStability":0.9,"expressionNaturalness":0.85}}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MultimodalFusionRequest;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "request body required", code: "INVALID_INPUT" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Validate at least one modality is supplied.
    const inputs: FusionInputs = {
      face: body.face,
      voice: body.voice,
      behavior: body.behavior,
      document: body.document,
      device: body.device,
    };
    const suppliedCount = ALL_MODALITIES.filter(m => inputs[m as BiometricModality.Face | BiometricModality.Voice | BiometricModality.Behavioral | BiometricModality.Document | BiometricModality.Device] !== undefined).length;
    if (suppliedCount === 0) {
      return NextResponse.json(
        {
          error:
            "At least one modality (face, voice, behavior, document, or device) is required",
          code: "NO_MODALITIES",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // ─── Fuse via Dempster-Shafer ────────────────────────────────────
    const fusion: FusionResult = fuseBiometrics(inputs, body.weights);

    // ─── Disagreement detection ──────────────────────────────────────
    const disagreement = detectModalityDisagreement(fusion.modalityBreakdown);

    // ─── Risk classification ──────────────────────────────────────────
    const risk: MultimodalRiskAssessment = multimodalRiskScore({
      fusedScore: fusion.fusedScore,
      modalityBreakdown: fusion.modalityBreakdown,
      conflict: fusion.conflict,
    });

    // ─── Step-up recommendation ──────────────────────────────────────
    const currentModalities = fusion.modalityBreakdown.map(s => s.modality);
    const failedModalities = fusion.modalityBreakdown
      .filter(s => s.score < 0.4)
      .map(s => s.modality);
    const stepUp = stepUpAuthentication(
      currentModalities,
      failedModalities,
      risk.riskLevel,
    );

    // ─── Augment reasoning ───────────────────────────────────────────
    const reasoningParts: string[] = [fusion.reasoning];
    reasoningParts.push(
      `Disagreement score ${disagreement.disagreement.toFixed(3)} (${disagreement.explanation}).`,
    );
    reasoningParts.push(
      `Risk: ${risk.riskLevel} (score ${risk.riskScore.toFixed(3)}) — recommendation: ${risk.recommendation}.`,
    );
    if (stepUp.length > 0) {
      reasoningParts.push(
        `Step-up: verify ${stepUp.join(", ")}.`,
      );
    }

    const response: MultimodalFusionResponse = {
      fusedScore: fusion.fusedScore,
      modalityBreakdown: fusion.modalityBreakdown,
      decision: fusion.decision,
      disagreement,
      conflict: fusion.conflict,
      riskScore: risk.riskScore,
      riskLevel: risk.riskLevel,
      stepUpRecommendations: stepUp,
      reasoning: reasoningParts.join(" "),
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "multimodal fusion failed",
        code: "MULTIMODAL_FUSION_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/multimodal-fusion
 *
 * Returns API documentation, the 5 modality signal bundles, and the
 * decision / risk thresholds.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "Multimodal Biometric Fusion API",
      version: "1.0.0",
      description:
        "5-modality biometric fusion via Dempster-Shafer evidence theory. Combines face + voice + behavioral + document + device signals into a single fused score with explicit conflict tracking. When modalities disagree, D-S surfaces the conflict instead of averaging it away.",
      competitiveAdvantage:
        "Onfido, Jumio, Veriff, Sumsub ship either face-only or face+document flows. None ship 5-modality fusion with explicit Dempster-Shafer conflict tracking — meaning the system can tell you when modalities disagree (face says real, voice says spoof), a strong signal of a coordinated attack.",
      endpoints: {
        POST: "Submit any combination of 5 modality bundles, receive fused score + decision + risk + step-up recommendations.",
        GET: "This documentation + thresholds.",
        OPTIONS: "CORS preflight (204 No Content).",
      },
      modalities: [
        {
          name: "face",
          signals: [
            "faceMatchScore",
            "livenessScore",
            "faceQualityScore",
            "landmarkConsistency",
            "eyeAspectRatio",
            "blinkDetected",
            "headPoseStability",
            "expressionNaturalness",
          ],
          defaultWeight: 0.35,
        },
        {
          name: "voice",
          signals: [
            "pitchMean",
            "pitchStd",
            "formantF1F2",
            "voiceEmbeddingSimilarity",
            "speechRate",
            "pausePattern",
            "snr",
            "emotionConsistency",
          ],
          defaultWeight: 0.20,
        },
        {
          name: "behavioral",
          signals: [
            "keystrokeDynamics",
            "mouseMovementEntropy",
            "scrollPattern",
            "touchPressure",
            "deviceAngleStability",
            "sessionDuration",
          ],
          defaultWeight: 0.15,
        },
        {
          name: "document",
          signals: [
            "ocrConfidence",
            "mrzValid",
            "crossFieldPassRate",
            "tamperingScore",
            "securityFeatureCount",
            "documentAge",
            "fontConsistency",
          ],
          defaultWeight: 0.25,
        },
        {
          name: "device",
          signals: ["attestationScore", "environmentIntegrity", "reputationScore"],
          defaultWeight: 0.05,
        },
      ],
      decisionThresholds: {
        approve: "fusedScore ≥ 0.70 AND conflict < 0.30",
        review: "0.40 ≤ fusedScore < 0.70 OR 0.30 ≤ conflict ≤ 0.60",
        reject: "fusedScore < 0.40 OR conflict > 0.60",
      },
      riskThresholds: {
        low: "riskScore < 0.20 → approve",
        medium: "0.20 ≤ riskScore < 0.45 → review",
        high: "0.45 ≤ riskScore < 0.70 → step_up",
        critical: "riskScore ≥ 0.70 → reject",
      },
      examplePayload: {
        face: {
          faceMatchScore: 0.95,
          livenessScore: 0.92,
          faceQualityScore: 0.9,
          landmarkConsistency: 0.95,
          eyeAspectRatio: 0.3,
          blinkDetected: 1,
          headPoseStability: 0.9,
          expressionNaturalness: 0.85,
        },
        voice: {
          pitchMean: 150,
          pitchStd: 35,
          formantF1F2: { f1: 500, f2: 1500 },
          voiceEmbeddingSimilarity: 0.85,
          speechRate: 150,
          pausePattern: 0.7,
          snr: 25,
          emotionConsistency: 0.8,
        },
        document: {
          ocrConfidence: 0.92,
          mrzValid: 1,
          crossFieldPassRate: 0.95,
          tamperingScore: 0.9,
          securityFeatureCount: 4,
          documentAge: 365,
          fontConsistency: 0.95,
        },
        weights: { face: 0.4, voice: 0.25, document: 0.35 },
        context: { riskLevel: "medium", deviceType: "mobile", sessionAge: 60 },
      },
    },
    { headers: CORS_HEADERS },
  );
}
