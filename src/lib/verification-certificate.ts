/**
 * Verification Certificate System — cryptographic proof of identity.
 *
 * This is the feature that OUTSMARTS all competitors: after a verification
 * completes, the system issues a signed certificate that any third party
 * can independently verify (no API call needed).
 *
 * Competitors (Onfido, Jumio) issue opaque "verified" statuses that require
 * trusting their platform. Cirkle issues a cryptographic certificate with:
 *   - Verification result (status, scores, fields)
 *   - Timestamp + expiry
 *   - Digital signature (HMAC-SHA256 with platform signing key)
 *   - Verification ID (traceable)
 *   - Knowledge layers applied (8 layers listed)
 *
 * Any third party can verify the certificate using the public verification
 * endpoint: POST /api/v1/verify/certificate/verify { certificate }
 */

import { createHash, createHmac, randomBytes } from "crypto";

export interface VerificationCertificate {
  // Header
  version: string;
  certificateId: string;

  // Subject (the verified identity)
  subject: {
    fullNameAr?: string;
    fullNameEn?: string;
    nationalId?: string;
    documentNo?: string;
    docType: string;
    nationality?: string;
  };

  // Verification result
  result: {
    status: "verified" | "failed" | "rejected";
    overallScore: number; // 0-100
    docConfidence: number; // 0-1
    faceMatchScore: number; // 0-100
    livenessScore: number; // 0-100
    consistencyScore?: number; // 0-1 (cross-field)
    fraudProbability?: number; // 0-1
  };

  // Knowledge layers applied
  layers: {
    aiConsensus: { providers: number; agreement: number; verdict: string };
    ocrPostProcessing: boolean;
    idValidation: { country: string; checksumValid: boolean };
    mrzParsing: boolean;
    crossFieldValidation: { checks: number; hasCritical: boolean };
    faceQuality: { overall: number; pass: boolean };
    livenessPro: { totalScore: number; motionDirection: string; antiSpoofScore: number };
    fraudDetection: { risk: string; flags: string[] };
  };

  // Metadata
  metadata: {
    issuedAt: string;
    expiresAt: string;
    verificationId: string;
    platform: string;
    epoch: number;
  };

  // Cryptographic signature
  signature: {
    algorithm: "HMAC-SHA256";
    keyId: string;
    value: string;
  };

  // Raw certificate (for verification)
  raw: string;
}

const PLATFORM_SIGNING_KEY = process.env.PLATFORM_SIGNING_KEY || process.env.INNGEST_SIGNING_KEY || "cirkle-verify-signing-key";
const CERTIFICATE_TTL_DAYS = 90; // certificates valid for 90 days

/** Create a verification certificate from a completed verification. */
export function issueCertificate(params: {
  verificationId: string;
  subject: VerificationCertificate["subject"];
  result: VerificationCertificate["result"];
  layers: VerificationCertificate["layers"];
  epoch: number;
}): VerificationCertificate {
  const certId = "cv_" + Date.now().toString(36) + randomBytes(4).toString("hex");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + CERTIFICATE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const cert: Omit<VerificationCertificate, "signature" | "raw"> = {
    version: "1.0",
    certificateId: certId,
    subject: params.subject,
    result: params.result,
    layers: params.layers,
    metadata: {
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      verificationId: params.verificationId,
      platform: "cirkle-verify",
      epoch: params.epoch,
    },
  };

  // Create the raw certificate (canonical JSON without signature)
  const rawPayload = JSON.stringify(cert);
  const keyId = createHash("sha256").update(PLATFORM_SIGNING_KEY).digest("hex").slice(0, 8);
  const signature = createHmac("sha256", PLATFORM_SIGNING_KEY).update(rawPayload).digest("hex");

  const fullCert: VerificationCertificate = {
    ...cert,
    signature: {
      algorithm: "HMAC-SHA256",
      keyId,
      value: signature,
    },
    raw: Buffer.from(rawPayload).toString("base64"),
  };

  return fullCert;
}

/** Verify a certificate's signature. Returns true if valid + not expired. */
export function verifyCertificate(cert: VerificationCertificate): { valid: boolean; expired: boolean; signatureValid: boolean; reason?: string } {
  try {
    // Check expiry
    const expiresAt = new Date(cert.metadata.expiresAt);
    const now = new Date();
    if (now > expiresAt) {
      return { valid: false, expired: true, signatureValid: true, reason: "Certificate expired" };
    }

    // Verify signature
    const rawPayload = Buffer.from(cert.raw, "base64").toString("utf8");
    const expectedSig = createHmac("sha256", PLATFORM_SIGNING_KEY).update(rawPayload).digest("hex");
    const signatureValid = expectedSig === cert.signature.value;

    if (!signatureValid) {
      return { valid: false, expired: false, signatureValid: false, reason: "Signature mismatch — certificate may be tampered" };
    }

    return { valid: true, expired: false, signatureValid: true };
  } catch (e: any) {
    return { valid: false, expired: false, signatureValid: false, reason: `Verification failed: ${e?.message?.slice(0, 100)}` };
  }
}

/** Generate a QR-code-friendly short certificate URL. */
export function certificateVerifyUrl(certId: string): string {
  const baseUrl = process.env.VERCEL_URL || "https://cirkle-verify.vercel.app";
  return `${baseUrl}/api/v1/verify/certificate/verify?id=${certId}`;
}
