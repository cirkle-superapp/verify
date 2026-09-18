import { NextRequest, NextResponse } from "next/server";
import { explainVerification } from "@/lib/explainability";

export const runtime = "nodejs";

/**
 * POST /api/v1/verify/explain
 *
 * DeepSeek-style verification explainability.
 * Breaks down WHY the verification score is what it is.
 *
 * Body: verification result data (consensus, crossField, quality, etc.)
 * Returns: ExplainabilityResult { overallScore, factors[], reasoning, recommendations[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = explainVerification(body);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "explanation failed" }, { status: 500 });
  }
}

/** GET — returns info about the explainability engine. */
export async function GET() {
  return NextResponse.json({
    description: "Verification Explainability Engine — DeepSeek-style score reasoning",
    competitiveAdvantage: "Onfido/Jumio give opaque scores. Cirkle explains WHY each point was scored.",
    factors: [
      "AI Consensus Agreement (how many providers agreed)",
      "Provider Diversity (how many independent AIs)",
      "OCR Corrections Applied (Levenshtein + confusion)",
      "ID Checksum Valid (country-specific algorithm)",
      "Cross-Field Consistency (17 checks)",
      "Fraud Probability (weighted risk signals)",
      "Image Quality (blur, glare, lighting)",
      "Liveness Challenge Met (directional motion)",
      "Anti-Spoofing Score (print, screen, depth)",
      "Document Tampering (EXIF, ELA, noise, clone)",
    ],
    output: "Chain-of-thought reasoning with +positive/-negative contributions per factor",
  });
}
