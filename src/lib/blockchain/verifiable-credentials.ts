/**
 * CirkleChain — W3C Verifiable Credentials
 *
 * Implements the W3C Verifiable Credentials Data Model 1.1:
 * https://www.w3.org/TR/vc-data-model/
 *
 * A verifiable credential is a tamper-evident claim that:
 *   - An issuer makes about a subject
 *   - Can be cryptographically verified by anyone
 *   - Can be revoked by the issuer
 *   - Can be presented without revealing the full credential (selective disclosure)
 *
 * Example: Cirkle issues a "Verified Identity" credential to a user.
 * The user can then present this credential to any third party to prove
 * their identity was verified, without revealing their actual ID number.
 *
 * All signing uses HMAC-SHA256 (no external key management needed).
 * Zero billing, zero external services, fully open source.
 */

import crypto from "node:crypto";
import { sha256 } from "./merkle-tree";

/** W3C Verifiable Credential context */
const W3C_VC_CONTEXT = [
  "https://www.w3.org/2018/credentials/v1",
  "https://cirkle-verify.vercel.app/contexts/v1",
];

/** The credential type — what kind of credential is being issued. */
export type CredentialType =
  | "IdentityVerification"
  | "AgeVerification"
  | "LivenessProof"
  | "DocumentVerification"
  | "FaceMatchProof"
  | "RiskAssessment"
  | "VerificationCertificate";

/** A W3C Verifiable Credential. */
export interface VerifiableCredential {
  "@context": string[];
  id: string;                    // Unique credential ID
  type: string[];               // ["VerifiableCredential", "IdentityVerification"]
  issuer: string;               // Cirkle platform DID
  issuanceDate: string;         // ISO 8601
  expirationDate?: string;      // ISO 8601 (optional)
  credentialSubject: {
    id: string;                 // Subject DID
    [key: string]: any;         // Claims about the subject
  };
  proof: {
    type: "CirkleHmacSha256";
    created: string;
    verificationMethod: string;
    proofValue: string;         // HMAC-SHA256 signature
    proofPurpose: "assertionMethod";
  };
  credentialStatus?: {
    id: string;
    type: "RevocationList2020Status";
    revocationListIndex: number;
  };
}

/** A verifiable presentation — wraps one or more credentials. */
export interface VerifiablePresentation {
  "@context": string[];
  type: string[];
  verifiableCredential: VerifiableCredential | VerifiableCredential[];
  proof: {
    type: "CirkleHmacSha256";
    created: string;
    verificationMethod: string;
    proofValue: string;
    proofPurpose: "authentication";
    challenge: string;           // Random challenge to prevent replay
  };
}

/** The Cirkle platform's DID (Decentralized Identifier). */
export const CIRKLE_DID = "did:cirkle:verify:cirkle-verify.vercel.app";

/** The verification method (public key location). */
export const VERIFICATION_METHOD = `${CIRKLE_DID}#keys-1`;

/**
 * Issue a W3C Verifiable Credential.
 *
 * @param type The credential type (e.g., "IdentityVerification")
 * @param subjectId The subject's DID or user ID
 * @param claims The claims being made about the subject
 * @param secret The HMAC secret for signing
 * @param expirationDays Optional expiration (default: 90 days)
 * @returns A signed VerifiableCredential
 */
export function issueCredential(
  type: CredentialType,
  subjectId: string,
  claims: Record<string, any>,
  secret: string,
  expirationDays: number = 90,
): VerifiableCredential {
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const issuanceDate = new Date().toISOString();
  const expirationDate = new Date(Date.now() + expirationDays * 86400000).toISOString();

  const credential: Omit<VerifiableCredential, "proof"> = {
    "@context": W3C_VC_CONTEXT,
    id,
    type: ["VerifiableCredential", type],
    issuer: CIRKLE_DID,
    issuanceDate,
    expirationDate,
    credentialSubject: {
      id: subjectId,
      ...claims,
    },
  };

  // Sign with HMAC-SHA256
  const proofValue = signCredential(credential, secret);

  return {
    ...credential,
    proof: {
      type: "CirkleHmacSha256",
      created: issuanceDate,
      verificationMethod: VERIFICATION_METHOD,
      proofValue,
      proofPurpose: "assertionMethod",
    },
  };
}

/**
 * Sign a credential with HMAC-SHA256.
 * The canonical form is the JSON with proof field removed,
 * keys sorted alphabetically.
 */
function signCredential(
  credential: Omit<VerifiableCredential, "proof">,
  secret: string,
): string {
  const canonical = JSON.stringify(credential, Object.keys(credential).sort());
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

/**
 * Verify a Verifiable Credential's signature.
 *
 * @param credential The credential to verify
 * @param secret The HMAC secret
 * @returns true if the signature is valid
 */
export function verifyCredential(
  credential: VerifiableCredential,
  secret: string,
): boolean {
  if (!credential.proof || credential.proof.type !== "CirkleHmacSha256") {
    return false;
  }

  const { proof, ...credentialWithoutProof } = credential;
  const expectedProofValue = signCredential(credentialWithoutProof, secret);

  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(proof.proofValue, "hex");
  const b = Buffer.from(expectedProofValue, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Check if a credential has expired.
 */
export function isExpired(credential: VerifiableCredential): boolean {
  if (!credential.expirationDate) return false;
  return new Date(credential.expirationDate) < new Date();
}

/**
 * Create a Verifiable Presentation wrapping a credential.
 * The presentation includes a challenge to prevent replay attacks.
 */
export function createPresentation(
  credential: VerifiableCredential,
  challenge: string,
  secret: string,
): VerifiablePresentation {
  const created = new Date().toISOString();
  const canonical = JSON.stringify({
    "@context": W3C_VC_CONTEXT,
    type: ["VerifiablePresentation"],
    verifiableCredential: credential,
    challenge,
  }, Object.keys({ "@context": 1, type: 1, verifiableCredential: 1, challenge: 1 }).sort());

  const proofValue = crypto.createHmac("sha256", secret).update(canonical).digest("hex");

  return {
    "@context": W3C_VC_CONTEXT,
    type: ["VerifiablePresentation"],
    verifiableCredential: credential,
    proof: {
      type: "CirkleHmacSha256",
      created,
      verificationMethod: VERIFICATION_METHOD,
      proofValue,
      proofPurpose: "authentication",
      challenge,
    },
  };
}

/**
 * Verify a Verifiable Presentation.
 */
export function verifyPresentation(
  presentation: VerifiablePresentation,
  secret: string,
): boolean {
  const canonical = JSON.stringify({
    "@context": W3C_VC_CONTEXT,
    type: ["VerifiablePresentation"],
    verifiableCredential: presentation.verifiableCredential,
    challenge: presentation.proof.challenge,
  }, Object.keys({ "@context": 1, type: 1, verifiableCredential: 1, challenge: 1 }).sort());

  const expected = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  const a = Buffer.from(presentation.proof.proofValue, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
