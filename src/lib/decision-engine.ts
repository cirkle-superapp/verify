/**
 * Verification Decision Engine
 *
 * Returns structured results with evidence, transparent decision states,
 * and field-level findings. Never reduces evidence to a single opaque
 * "AI confidence" score.
 *
 * Decision states (per the spec):
 *   VERIFIED_WITH_SUPPORTED_EVIDENCE     — all checks passed
 *   STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED — format valid, no chip/issuer check
 *   ISSUER_CHECK_CONFIRMED              — official registry returned a match
 *   ELECTRONIC_AUTHENTICATION_PASSED    — chip crypto verified
 *   EXPIRED                             — document is past expiry date
 *   INVALID_STRUCTURE                   — MRZ/format/check-digit failure
 *   DOCUMENT_MISMATCH                   — front/back or cross-field mismatch
 *   LIVENESS_INCONCLUSIVE               — liveness check couldn't determine
 *   MANUAL_REVIEW_REQUIRED              — confidence below threshold
 *   UNSUPPORTED_DOCUMENT                — document type/country not supported
 *   VERIFICATION_SERVICE_UNAVAILABLE    — external service timeout/failure
 */

export type VerificationStatus =
  | "VERIFIED_WITH_SUPPORTED_EVIDENCE"
  | "STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED"
  | "ISSUER_CHECK_CONFIRMED"
  | "ELECTRONIC_AUTHENTICATION_PASSED"
  | "EXPIRED"
  | "INVALID_STRUCTURE"
  | "DOCUMENT_MISMATCH"
  | "LIVENESS_INCONCLUSIVE"
  | "MANUAL_REVIEW_REQUIRED"
  | "UNSUPPORTED_DOCUMENT"
  | "VERIFICATION_SERVICE_UNAVAILABLE";

export interface EvidenceItem {
  check: string;
  method: string;
  result: "pass" | "fail" | "inconclusive" | "not_performed";
  detail: string;
  confidence?: number; // 0-1, only for checks that produce one
  limitations?: string[];
}

export interface FieldFinding {
  field: string;
  extractedValue?: string;
  normalizedValue?: string;
  ocrConfidence?: number;
  validationStatus: "valid" | "invalid" | "missing" | "inconclusive";
  source: "ocr" | "mrz" | "barcode" | "visual" | "chip" | "issuer_check";
  notes?: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  timestamp: string;
  documentType?: string;
  country?: string;
  overallConfidence: number; // 0-1
  confidenceBreakdown: {
    ocr: number;
    structural: number;
    crossField: number;
    authenticity: number;
    liveness?: number;
    faceMatch?: number;
  };
  evidence: EvidenceItem[];
  fieldFindings: FieldFinding[];
  methodsPerformed: string[];
  sourcesConsulted: string[];
  unresolvedLimitations: string[];
  recommendation: string;
  humanReviewRequired: boolean;
}

/**
 * Evaluate all evidence and produce a verification decision.
 *
 * Decision rules (transparent, auditable, configurable):
 *   1. If any critical check FAILS → INVALID_STRUCTURE or DOCUMENT_MISMATCH
 *   2. If document is expired → EXPIRED
 *   3. If document type/country not supported → UNSUPPORTED_DOCUMENT
 *   4. If liveness inconclusive → LIVENESS_INCONCLUSIVE
 *   5. If chip authentication passed → ELECTRONIC_AUTHENTICATION_PASSED
 *   6. If issuer check confirmed → ISSUER_CHECK_CONFIRMED
 *   7. If all structural checks pass but no chip/issuer → STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED
 *   8. If all checks pass (OCR + structural + liveness + face match) → VERIFIED_WITH_SUPPORTED_EVIDENCE
 *   9. If confidence below threshold → MANUAL_REVIEW_REQUIRED
 *  10. If external service unavailable → VERIFICATION_SERVICE_UNAVAILABLE
 */
export function evaluateDecision(input: {
  evidence: EvidenceItem[];
  fieldFindings: FieldFinding[];
  documentType?: string;
  country?: string;
  isExpired?: boolean;
  isUnsupported?: boolean;
  livenessScore?: number;
  livenessThreshold?: number;
  faceMatchScore?: number;
  faceMatchThreshold?: number;
  overallConfidence?: number;
  manualReviewThreshold?: number;
  methodsPerformed: string[];
  sourcesConsulted: string[];
  unresolvedLimitations: string[];
}): VerificationResult {
  const {
    evidence,
    fieldFindings,
    documentType,
    country,
    isExpired,
    isUnsupported,
    livenessScore,
    livenessThreshold = 0.6,
    faceMatchScore,
    faceMatchThreshold = 0.7,
    overallConfidence = 0,
    manualReviewThreshold = 0.65,
    methodsPerformed,
    sourcesConsulted,
    unresolvedLimitations,
  } = input;

  // Evaluate evidence
  const criticalFailures = evidence.filter(
    (e) => e.result === "fail" && (e.check.includes("MRZ") || e.check.includes("structure") || e.check.includes("cross_field")),
  );
  const livenessCheck = evidence.find((e) => e.check.includes("liveness"));
  const chipCheck = evidence.find((e) => e.check.includes("chip") || e.check.includes("electronic"));
  const issuerCheck = evidence.find((e) => e.check.includes("issuer") || e.check.includes("registry"));
  const structuralChecks = evidence.filter((e) => e.check.includes("structure") || e.check.includes("MRZ") || e.check.includes("cross_field"));
  const allStructuralPassed = structuralChecks.length > 0 && structuralChecks.every((e) => e.result === "pass");
  const allChecksPassed = evidence.length > 0 && evidence.every((e) => e.result === "pass" || e.result === "not_performed");

  // Confidence breakdown
  const confidenceBreakdown = {
    ocr: fieldFindings.filter((f) => f.source === "ocr").reduce((sum, f) => sum + (f.ocrConfidence || 0.5), 0) / Math.max(1, fieldFindings.filter((f) => f.source === "ocr").length),
    structural: structuralChecks.length > 0 ? structuralChecks.filter((e) => e.result === "pass").length / structuralChecks.length : 0,
    crossField: evidence.filter((e) => e.check.includes("cross_field")).filter((e) => e.result === "pass").length / Math.max(1, evidence.filter((e) => e.check.includes("cross_field")).length),
    authenticity: (chipCheck?.result === "pass" ? 1 : 0) + (issuerCheck?.result === "pass" ? 1 : 0) / 2,
    liveness: livenessScore,
    faceMatch: faceMatchScore,
  };

  // Determine status (in priority order)
  let status: VerificationStatus;
  let recommendation: string;
  let humanReviewRequired = false;

  if (isUnsupported) {
    status = "UNSUPPORTED_DOCUMENT";
    recommendation = "This document type or country is not currently supported. Manual verification recommended.";
    humanReviewRequired = true;
  } else if (criticalFailures.length > 0) {
    status = criticalFailures.some((f) => f.check.includes("cross_field")) ? "DOCUMENT_MISMATCH" : "INVALID_STRUCTURE";
    recommendation = `Critical validation failed: ${criticalFailures.map((f) => f.check).join(", ")}. The document structure is invalid.`;
    humanReviewRequired = true;
  } else if (isExpired) {
    status = "EXPIRED";
    recommendation = "The document has passed its expiry date. Reject or request a current document.";
  } else if (livenessScore !== undefined && livenessScore < livenessThreshold) {
    status = "LIVENESS_INCONCLUSIVE";
    recommendation = `Liveness score ${livenessScore.toFixed(2)} is below threshold ${livenessThreshold}. Request recapture or manual review.`;
    humanReviewRequired = true;
  } else if (chipCheck?.result === "pass") {
    status = "ELECTRONIC_AUTHENTICATION_PASSED";
    recommendation = "Electronic chip authentication succeeded. This is the strongest available evidence of document authenticity.";
  } else if (issuerCheck?.result === "pass") {
    status = "ISSUER_CHECK_CONFIRMED";
    recommendation = "The issuing authority's registry confirmed the document. This provides authoritative verification.";
  } else if (allChecksPassed) {
    status = "VERIFIED_WITH_SUPPORTED_EVIDENCE";
    recommendation = "All performed checks passed. The document is verified with the available evidence.";
  } else if (allStructuralPassed) {
    status = "STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED";
    recommendation = "Document structure is valid (MRZ, cross-field checks passed). However, authenticity is not confirmed — no chip authentication or issuer check was performed.";
    humanReviewRequired = overallConfidence < manualReviewThreshold;
  } else if (overallConfidence < manualReviewThreshold) {
    status = "MANUAL_REVIEW_REQUIRED";
    recommendation = `Overall confidence ${overallConfidence.toFixed(2)} is below review threshold ${manualReviewThreshold}. Manual verification recommended.`;
    humanReviewRequired = true;
  } else {
    status = "MANUAL_REVIEW_REQUIRED";
    recommendation = "Insufficient evidence for automated decision. Manual review required.";
    humanReviewRequired = true;
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    documentType,
    country,
    overallConfidence,
    confidenceBreakdown,
    evidence,
    fieldFindings,
    methodsPerformed,
    sourcesConsulted,
    unresolvedLimitations,
    recommendation,
    humanReviewRequired,
  };
}

/**
 * Get the human-readable description of a verification status.
 */
export function getStatusDescription(status: VerificationStatus): string {
  const descriptions: Record<VerificationStatus, string> = {
    VERIFIED_WITH_SUPPORTED_EVIDENCE: "All performed checks passed. The document is verified with the available evidence.",
    STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED: "Document format and structure are valid. Authenticity is not confirmed (no chip or issuer check performed).",
    ISSUER_CHECK_CONFIRMED: "The issuing authority's registry confirmed the document record.",
    ELECTRONIC_AUTHENTICATION_PASSED: "Electronic chip cryptographic authentication succeeded.",
    EXPIRED: "The document has passed its expiry date.",
    INVALID_STRUCTURE: "The document structure (MRZ, check digits, or field format) is invalid.",
    DOCUMENT_MISMATCH: "Cross-field validation detected inconsistencies (e.g., front/back mismatch, MRZ vs printed data mismatch).",
    LIVENESS_INCONCLUSIVE: "The liveness/presentation-attack detection could not confirm a live person.",
    MANUAL_REVIEW_REQUIRED: "Insufficient evidence for automated decision. Manual review required.",
    UNSUPPORTED_DOCUMENT: "This document type or country is not currently supported.",
    VERIFICATION_SERVICE_UNAVAILABLE: "A required external verification service is unavailable. The result is inconclusive.",
  };
  return descriptions[status] || "Unknown status.";
}

/**
 * Check if a status represents a positive outcome.
 */
export function isPositiveStatus(status: VerificationStatus): boolean {
  return [
    "VERIFIED_WITH_SUPPORTED_EVIDENCE",
    "ISSUER_CHECK_CONFIRMED",
    "ELECTRONIC_AUTHENTICATION_PASSED",
  ].includes(status);
}

/**
 * Check if a status requires manual human review.
 */
export function requiresManualReview(status: VerificationStatus): boolean {
  return [
    "MANUAL_REVIEW_REQUIRED",
    "LIVENESS_INCONCLUSIVE",
    "STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED",
    "UNSUPPORTED_DOCUMENT",
    "VERIFICATION_SERVICE_UNAVAILABLE",
  ].includes(status);
}
