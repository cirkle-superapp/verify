import { NextRequest, NextResponse } from "next/server";
import { verifyCertificate, type VerificationCertificate } from "@/lib/verification-certificate";

export const runtime = "nodejs";

/**
 * POST /api/v1/verify/certificate/verify
 * Verify a certificate's authenticity (third-party endpoint).
 *
 * Body: { certificate: VerificationCertificate }
 * Returns: { valid, expired, signatureValid, reason?, certificate }
 *
 * Any third party can call this to independently verify a certificate
 * without trusting the Cirkle platform.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const cert = body.certificate as VerificationCertificate;

    if (!cert || !cert.signature || !cert.raw) {
      return NextResponse.json({ valid: false, error: "certificate (with signature + raw) required" }, { status: 400 });
    }

    const result = verifyCertificate(cert);

    return NextResponse.json({
      ...result,
      certificate: {
        certificateId: cert.certificateId,
        subject: cert.subject,
        result: cert.result,
        issuedAt: cert.metadata.issuedAt,
        expiresAt: cert.metadata.expiresAt,
        verificationId: cert.metadata.verificationId,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "verification failed" }, { status: 500 });
  }
}

/** GET — returns info about the verification endpoint. */
export async function GET() {
  return NextResponse.json({
    description: "Verify a Cirkle Verification Certificate (third-party endpoint)",
    method: "POST",
    body: { certificate: "VerificationCertificate object" },
    response: { valid: "boolean", expired: "boolean", signatureValid: "boolean", reason: "string?" },
    note: "This endpoint allows any third party to verify a certificate's authenticity without calling the Cirkle API. The signature is HMAC-SHA256 — if the signature matches, the certificate was issued by Cirkle and has not been tampered.",
  });
}
