import { NextRequest, NextResponse } from "next/server";
import { assessRisk } from "@/lib/risk-adaptive";

export const runtime = "nodejs";

/**
 * POST /api/v1/verify/risk-assessment
 * Assess risk level for a verification request and get adaptive recommendations.
 *
 * Body: RiskInput { ip, nationalId, fullNameAr, fullNameEn, country, knownIds, ... }
 * Returns: RiskAssessment { level, score, factors, recommendedActions, ... }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const assessment = assessRisk({
      ip: body.ip,
      nationalId: body.nationalId,
      fullNameAr: body.fullNameAr,
      fullNameEn: body.fullNameEn,
      country: body.country,
      knownIds: body.knownIds ? new Set(body.knownIds) : undefined,
      knownHashes: body.knownHashes ? new Set(body.knownHashes) : undefined,
      imageHash: body.imageHash,
      deviceFingerprint: body.deviceFingerprint,
      userAgent: body.userAgent || req.headers.get("user-agent") || undefined,
    });

    return NextResponse.json(assessment);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "risk assessment failed" }, { status: 500 });
  }
}

/** GET — returns info. */
export async function GET() {
  return NextResponse.json({
    description: "Risk-Adaptive Verification — dynamically adjusts strictness",
    riskLevels: {
      low: { score: "0-9", actions: 1, checks: "basic" },
      medium: { score: "10-29", actions: 2, checks: "+ cross-field" },
      high: { score: "30+", actions: 3, checks: "+ tampering + cross-field + face quality" },
    },
    factors: ["DUPLICATE_ID", "IMAGE_REUSE", "GEO_MISMATCH", "REPEAT_DEVICE", "NAME_SCRIPT_MISMATCH"],
    competitiveAdvantage: "Competitors charge more for high-risk checks. Cirkle adapts for free.",
  });
}
