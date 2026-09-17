import { NextRequest, NextResponse } from "next/server";
import { issueCertificate, verifyCertificate, type VerificationCertificate } from "@/lib/verification-certificate";
import { getEpoch } from "@/lib/platform/epoch";

export const runtime = "nodejs";

/**
 * POST /api/v1/verify/certificate
 * Issue a verification certificate after successful verification.
 *
 * Body: {
 *   verificationId, subject, result, layers
 * }
 *
 * Returns: VerificationCertificate (signed, with raw + signature)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { verificationId, subject, result, layers } = body;

    if (!verificationId || !result || !subject) {
      return NextResponse.json({ error: "verificationId, subject, result required" }, { status: 400 });
    }

    const epoch = getEpoch();
    const cert = issueCertificate({
      verificationId,
      subject,
      result,
      layers: layers || {},
      epoch: epoch.epoch,
    });

    return NextResponse.json({
      certificate: cert,
      verifyUrl: `${process.env.VERCEL_URL || "https://cirkle-verify.vercel.app"}/api/v1/verify/certificate/verify`,
      message: "Certificate issued. Share this with any third party for independent verification.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "certificate issuance failed" }, { status: 500 });
  }
}

/**
 * GET /api/v1/verify/certificate?id=cv_xxx
 * Get a certificate by ID (would normally query DB).
 */
export async function GET(req: NextRequest) {
  return NextResponse.json({
    description: "Verification Certificate System",
    howItWorks: "After verification, POST to this endpoint to issue a cryptographic certificate.",
    features: [
      "HMAC-SHA256 digital signature (tamper-evident)",
      "90-day validity period",
      "8 knowledge layers documented",
      "Third parties can verify independently (no API call to Cirkle needed)",
      "No competitor offers this — Onfido/Jumio give opaque 'verified' status",
    ],
    example: {
      verificationId: "cmu...",
      subject: { fullNameEn: "Mohamed Salah", nationalId: "29501010123456", docType: "national_id" },
      result: { status: "verified", overallScore: 92, docConfidence: 0.9, faceMatchScore: 88, livenessScore: 95 },
      layers: { aiConsensus: { providers: 5, agreement: 0.85, verdict: "unanimous" } },
    },
  });
}
