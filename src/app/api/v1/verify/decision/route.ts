import { NextRequest, NextResponse } from "next/server";
import { evaluateDecision, getStatusDescription, isPositiveStatus, requiresManualReview, type EvidenceItem, type FieldFinding } from "@/lib/decision-engine";

export const runtime = "nodejs";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET() {
  return NextResponse.json({
    statuses: ["VERIFIED_WITH_SUPPORTED_EVIDENCE", "STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED", "ISSUER_CHECK_CONFIRMED", "ELECTRONIC_AUTHENTICATION_PASSED", "EXPIRED", "INVALID_STRUCTURE", "DOCUMENT_MISMATCH", "LIVENESS_INCONCLUSIVE", "MANUAL_REVIEW_REQUIRED", "UNSUPPORTED_DOCUMENT", "VERIFICATION_SERVICE_UNAVAILABLE"],
    description: "POST evidence + field findings to get a structured verification decision",
  }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = evaluateDecision({
      evidence: body.evidence || [] as EvidenceItem[],
      fieldFindings: body.fieldFindings || [] as FieldFinding[],
      documentType: body.documentType,
      country: body.country,
      isExpired: body.isExpired,
      isUnsupported: body.isUnsupported,
      livenessScore: body.livenessScore,
      faceMatchScore: body.faceMatchScore,
      overallConfidence: body.overallConfidence || 0,
      methodsPerformed: body.methodsPerformed || [],
      sourcesConsulted: body.sourcesConsulted || [],
      unresolvedLimitations: body.unresolvedLimitations || [],
    });
    return NextResponse.json({
      ...result,
      statusDescription: getStatusDescription(result.status),
      isPositive: isPositiveStatus(result.status),
      requiresReview: requiresManualReview(result.status),
    }, { headers: CORS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500, headers: CORS });
  }
}
