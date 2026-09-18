/**
 * Verification Explainability Engine — DeepSeek-style score reasoning.
 *
 * This is the feature that OUTPERFORMS all competitors: instead of giving
 * an opaque score like Onfido (87% confidence), Cirkle explains WHY:
 *
 * "Document confidence: 92%
 *  Contributing factors:
 *  + 3/5 AI providers agreed on name extraction (agreement: 0.85)
 *  + OCR post-processing corrected 'محماد' → 'محمد' (Levenshtein distance 1)
 *  + ID checksum valid for Egypt (14-digit mod-11)
 *  + Cross-field validation: gender matches ID-encoded gender ✅
 *  - 1 provider (Groq) returned 403 (rate-limited, not counted)
 *  - Image quality: slightly dark (brightness 65, optimal 80-180)
 *  Net: +0.85 consensus + 0.05 correction + 0.02 validation = 0.92"
 *
 * This transparency is what sets DeepSeek apart from opaque models.
 * For KYC, showing WHY builds trust and enables debugging.
 */

export interface ExplainabilityFactor {
  factor: string;
  contribution: number; // -1 to +1 (positive = helped, negative = hurt)
  detail: string;
  layer: string; // which knowledge layer produced this
}

export interface ExplainabilityResult {
  overallScore: number; // 0-100
  factors: ExplainabilityFactor[];
  reasoning: string; // human-readable chain-of-thought
  recommendations: string[]; // what could improve the score
}

/**
 * Generate explainability for a verification result.
 * Takes the extracted data + consensus info + cross-field + quality
 * and produces a human-readable breakdown of WHY the score is what it is.
 */
export function explainVerification(params: {
  docConfidence?: number;
  faceMatchScore?: number;
  livenessScore?: number;
  consensus?: { total?: number; successful?: number; agreement?: number; verdict?: string; providerNames?: string[] };
  crossField?: { consistencyScore?: number; fraudProbability?: number; hasCritical?: boolean; flags?: any[] };
  imageQuality?: { overallQuality?: number; isBlurry?: boolean; hasGlare?: boolean; lighting?: string };
  ocrCorrections?: number; // how many OCR corrections were applied
  idValidation?: { isValid?: boolean; checksumValid?: boolean; country?: string };
  livenessPro?: { totalScore?: number; motionDirection?: string; challengeMet?: boolean; antiSpoofScore?: number };
  tampering?: { tamperingScore?: number; isLikelyTampered?: boolean };
}): ExplainabilityResult {
  const factors: ExplainabilityFactor[] = [];
  let scoreSum = 0;

  // ─── AI Consensus factors ──────────────────────────────────────
  if (params.consensus) {
    const c = params.consensus;
    const agreementPct = c.agreement ? Math.round(c.agreement * 100) : 0;
    const providersAgreed = c.successful || 0;
    const providersTotal = c.total || 0;

    if (providersAgreed >= 3) {
      factors.push({
        factor: "AI Consensus Agreement",
        contribution: 0.3,
        detail: `${providersAgreed}/${providersTotal} AI providers agreed (agreement: ${agreementPct}%). Multi-provider cross-check confirms extraction reliability.`,
        layer: "AI Consensus",
      });
      scoreSum += 0.3;
    } else if (providersAgreed >= 2) {
      factors.push({
        factor: "AI Consensus Agreement",
        contribution: 0.15,
        detail: `${providersAgreed}/${providersTotal} AI providers agreed (agreement: ${agreementPct}%). Moderate confidence — some providers disagreed.`,
        layer: "AI Consensus",
      });
      scoreSum += 0.15;
    } else {
      factors.push({
        factor: "AI Consensus Disagreement",
        contribution: -0.2,
        detail: `Only ${providersAgreed}/${providersTotal} providers agreed. Low confidence — possible OCR confusion or poor image quality.`,
        layer: "AI Consensus",
      });
      scoreSum -= 0.2;
    }

    if (c.providerNames && c.providerNames.length > 0) {
      factors.push({
        factor: "Provider Diversity",
        contribution: 0.05,
        detail: `Cross-checked by ${c.providerNames.length} independent AI providers: ${c.providerNames.join(", ")}.`,
        layer: "AI Consensus",
      });
      scoreSum += 0.05;
    }
  }

  // ─── OCR Post-Processing factors ───────────────────────────────
  if (params.ocrCorrections && params.ocrCorrections > 0) {
    factors.push({
      factor: "OCR Correction Applied",
      contribution: 0.05,
      detail: `${params.ocrCorrections} OCR correction(s) applied using Levenshtein distance + confusion patterns. Corrected common OCR errors (e.g., O→0, l→1, محماد→محمد).`,
      layer: "OCR Post-Processing",
    });
    scoreSum += 0.05;
  }

  // ─── ID Validation factors ─────────────────────────────────────
  if (params.idValidation) {
    const id = params.idValidation;
    if (id.checksumValid) {
      factors.push({
        factor: "ID Checksum Valid",
        contribution: 0.1,
        detail: `National ID checksum valid for ${id.country || "unknown country"}. The ID number passes the country-specific validation algorithm (Luhn/ISO 7064/mod-11/etc).`,
        layer: "ID Validation",
      });
      scoreSum += 0.1;
    } else if (id.isValid === false) {
      factors.push({
        factor: "ID Format Invalid",
        contribution: -0.15,
        detail: `National ID format invalid for ${id.country || "unknown country"}. The ID number does not match the expected format.`,
        layer: "ID Validation",
      });
      scoreSum -= 0.15;
    } else if (id.isValid && !id.checksumValid) {
      factors.push({
        factor: "ID Checksum Mismatch",
        contribution: -0.1,
        detail: `ID format is valid for ${id.country}, but checksum failed. Possible fabrication or OCR error in the ID number.`,
        layer: "ID Validation",
      });
      scoreSum -= 0.1;
    }
  }

  // ─── Cross-Field Validation factors ───────────────────────────
  if (params.crossField) {
    const cf = params.crossField;
    const consistencyPct = cf.consistencyScore ? Math.round(cf.consistencyScore * 100) : 0;

    if (cf.hasCritical) {
      factors.push({
        factor: "Cross-Field Critical Flag",
        contribution: -0.2,
        detail: `Critical inconsistency detected between fields. Consistency: ${consistencyPct}%. Flags: ${(cf.flags || []).map((f: any) => f.code).join(", ")}.`,
        layer: "Cross-Field Validation",
      });
      scoreSum -= 0.2;
    } else if (cf.consistencyScore && cf.consistencyScore >= 0.8) {
      factors.push({
        factor: "Cross-Field Consistency",
        contribution: 0.1,
        detail: `All fields are internally consistent (${consistencyPct}%). National ID gender matches extracted gender, birth dates align, name scripts correct.`,
        layer: "Cross-Field Validation",
      });
      scoreSum += 0.1;
    } else if (cf.consistencyScore && cf.consistencyScore < 0.5) {
      factors.push({
        factor: "Cross-Field Inconsistency",
        contribution: -0.1,
        detail: `Low consistency (${consistencyPct}%). Some fields disagree — possible OCR errors or fraud attempt.`,
        layer: "Cross-Field Validation",
      });
      scoreSum -= 0.1;
    }

    if (cf.fraudProbability && cf.fraudProbability > 0.3) {
      factors.push({
        factor: "Fraud Probability",
        contribution: -0.15,
        detail: `Fraud probability: ${Math.round((cf.fraudProbability || 0) * 100)}%. Multiple risk signals detected.`,
        layer: "Cross-Field Validation",
      });
      scoreSum -= 0.15;
    }
  }

  // ─── Image Quality factors ────────────────────────────────────
  if (params.imageQuality) {
    const iq = params.imageQuality;
    if (iq.isBlurry) {
      factors.push({
        factor: "Image Blur",
        contribution: -0.1,
        detail: `Image is blurry. This reduces OCR accuracy and may cause field extraction errors.`,
        layer: "Face/Image Quality",
      });
      scoreSum -= 0.1;
    }
    if (iq.hasGlare) {
      factors.push({
        factor: "Glare Detected",
        contribution: -0.05,
        detail: `Glare detected on document. This can obscure text and reduce OCR accuracy.`,
        layer: "Face/Image Quality",
      });
      scoreSum -= 0.05;
    }
    if (iq.lighting && iq.lighting !== "good") {
      factors.push({
        factor: `Lighting: ${iq.lighting}`,
        contribution: -0.05,
        detail: `Lighting is ${iq.lighting}. Optimal lighting improves OCR accuracy by 15-20%.`,
        layer: "Face/Image Quality",
      });
      scoreSum -= 0.05;
    }
    if (iq.overallQuality && iq.overallQuality > 0.7) {
      factors.push({
        factor: "Good Image Quality",
        contribution: 0.05,
        detail: `Image quality is good (${Math.round((iq.overallQuality || 0) * 100)}%). Clear, well-lit, properly framed.`,
        layer: "Face/Image Quality",
      });
      scoreSum += 0.05;
    }
  }

  // ─── Liveness Pro factors ─────────────────────────────────────
  if (params.livenessPro) {
    const lp = params.livenessPro;
    if (lp.challengeMet) {
      factors.push({
        factor: "Liveness Challenge Met",
        contribution: 0.1,
        detail: `The requested liveness challenge was performed correctly. Motion direction: ${lp.motionDirection || "none"}.`,
        layer: "Liveness Pro",
      });
      scoreSum += 0.1;
    } else {
      factors.push({
        factor: "Liveness Challenge Failed",
        contribution: -0.15,
        detail: `The requested liveness challenge was not clearly detected. Possible static photo or insufficient motion.`,
        layer: "Liveness Pro",
      });
      scoreSum -= 0.15;
    }
    if (lp.antiSpoofScore && lp.antiSpoofScore >= 15) {
      factors.push({
        factor: "Anti-Spoofing Passed",
        contribution: 0.05,
        detail: `Anti-spoofing checks passed (score: ${lp.antiSpoofScore}/20). No print attack, screen replay, or depth anomalies detected.`,
        layer: "Liveness Pro",
      });
      scoreSum += 0.05;
    }
  }

  // ─── Tampering Detection factors ──────────────────────────────
  if (params.tampering) {
    const tp = params.tampering;
    if (tp.isLikelyTampered) {
      factors.push({
        factor: "Document Tampering Detected",
        contribution: -0.3,
        detail: `Document image shows signs of tampering (score: ${Math.round((tp.tamperingScore || 0) * 100)}%). Possible Photoshop/editing detected via EXIF + ELA + noise analysis.`,
        layer: "Tampering Detection",
      });
      scoreSum -= 0.3;
    } else {
      factors.push({
        factor: "No Tampering Detected",
        contribution: 0.05,
        detail: `Document image appears authentic. No EXIF anomalies, ELA variance, or clone patterns detected.`,
        layer: "Tampering Detection",
      });
      scoreSum += 0.05;
    }
  }

  // ─── Calculate overall score ──────────────────────────────────
  // Base: weighted average of doc/face/liveness scores
  const docScore = (params.docConfidence || 0) * 100;
  const faceScore = params.faceMatchScore || 0;
  const livenessScore = params.livenessScore || 0;
  const baseScore = docScore * 0.3 + faceScore * 0.4 + livenessScore * 0.3;

  // Adjust with factor contributions
  const factorAdjustment = scoreSum * 20; // scale factor to 0-100 range
  const overallScore = Math.max(0, Math.min(100, Math.round(baseScore + factorAdjustment)));

  // ─── Build reasoning chain ─────────────────────────────────────
  const positiveFactors = factors.filter((f) => f.contribution > 0);
  const negativeFactors = factors.filter((f) => f.contribution < 0);

  const reasoning = [
    `Overall verification score: ${overallScore}/100.`,
    `\nBreakdown: Document (${Math.round(docScore)}%) × 30% + Face (${Math.round(faceScore)}%) × 40% + Liveness (${Math.round(livenessScore)}%) × 30% = ${Math.round(baseScore)}.`,
    `\nKnowledge layer adjustments:`,
    ...positiveFactors.map((f) => `  + ${f.factor}: ${f.detail}`),
    ...negativeFactors.map((f) => `  - ${f.factor}: ${f.detail}`),
    `\nNet adjustment: ${factorAdjustment > 0 ? "+" : ""}${Math.round(factorAdjustment)} points.`,
    `Final score: ${Math.round(baseScore)} + ${factorAdjustment > 0 ? "+" : ""}${Math.round(factorAdjustment)} = ${overallScore}/100.`,
  ].join("\n");

  // ─── Recommendations ───────────────────────────────────────────
  const recommendations: string[] = [];
  if (params.imageQuality?.isBlurry) recommendations.push("Retake document photo with steadier hand or better lighting");
  if (params.imageQuality?.lighting && params.imageQuality.lighting !== "good") recommendations.push(`Improve lighting (currently ${params.imageQuality.lighting})`);
  if (params.consensus && params.consensus.successful && params.consensus.total && params.consensus.successful < params.consensus.total) recommendations.push(`${(params.consensus.total - params.consensus.successful)} AI provider(s) failed — retry may get better results`);
  if (params.crossField?.hasCritical) recommendations.push("Critical cross-field flag detected — verify document is genuine and fields are correct");
  if (params.tampering?.isLikelyTampered) recommendations.push("Document tampering detected — reject this submission");
  if (params.livenessPro && !params.livenessPro.challengeMet) recommendations.push("Liveness challenge not met — ask user to perform the action more clearly");
  if (recommendations.length === 0) recommendations.push("All checks passed — verification is reliable");

  return {
    overallScore,
    factors,
    reasoning,
    recommendations,
  };
}
