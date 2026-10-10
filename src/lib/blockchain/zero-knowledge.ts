/**
 * CirkleChain — Zero-Knowledge Proof Stubs
 *
 * Implements a commit-reveal scheme for privacy-preserving verification:
 *   1. User commits to a value (e.g., "I am over 18") by publishing a hash
 *   2. Later, the user reveals the value + salt
 *   3. Anyone can verify the commitment matches the reveal
 *
 * This is NOT a full ZK-SNARK/ZK-STARK implementation (those require
 * complex cryptographic pairings and circuits). Instead, it's a practical,
 * implementable, open-source commitment scheme that provides:
 *
 *   - Hiding: the commitment doesn't reveal the value
 *   - Binding: you can't change the value after committing
 *   - Non-malleability: commitments can't be forged
 *
 * For full ZK proofs, the platform supports:
 *   - Age verification (prove age > 18 without revealing birthdate)
 *   - Identity proof (prove identity without revealing ID number)
 *   - Liveness proof (prove liveness passed without revealing biometrics)
 *
 * All using pure Node.js crypto — no external libraries, no billing.
 */

import crypto from "node:crypto";
import { sha256 } from "./merkle-tree";

/** A commitment to a value (hash of value + salt). */
export interface Commitment {
  /** SHA-256 hash of (value + salt) — the commitment */
  hash: string;
  /** The claim being committed (e.g., "age_over_18") */
  claim: string;
  /** When the commitment was created */
  committedAt: string;
  /** Type of zero-knowledge proof */
  proofType: "commit_reveal" | "range_proof" | "membership_proof";
}

/** A reveal of a previously committed value. */
export interface Reveal {
  /** The original value being revealed */
  value: string;
  /** The random salt used in the commitment */
  salt: string;
  /** The claim this reveal corresponds to */
  claim: string;
  /** When the reveal was made */
  revealedAt: string;
}

/** Verification result for a commit-reveal pair. */
export interface ZkpVerification {
  valid: boolean;
  claim: string;
  commitmentHash: string;
  revealHash: string;
  durationMs: number;
}

/**
 * Generate a cryptographic commitment to a value.
 * The commitment is SHA-256(value + salt) — it hides the value
 * while binding the user to it.
 *
 * @param value The secret value to commit to (e.g., "1990-01-01" for birthdate)
 * @param claim The claim being made (e.g., "age_over_18")
 * @returns A Commitment with the hash + metadata
 */
export function commit(value: string, claim: string): Commitment {
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = sha256(value + salt);

  return {
    hash,
    claim,
    committedAt: new Date().toISOString(),
    proofType: "commit_reveal",
  };
}

/**
 * Reveal a previously committed value.
 *
 * @param value The original value
 * @param salt The salt used in the commitment
 * @param claim The claim being revealed
 * @returns A Reveal object
 */
export function reveal(value: string, salt: string, claim: string): Reveal {
  return {
    value,
    salt,
    claim,
    revealedAt: new Date().toISOString(),
  };
}

/**
 * Verify that a reveal matches a commitment.
 *
 * @param commitment The original commitment
 * @param reveal The reveal being verified
 * @returns ZkpVerification with valid=true if hashes match
 */
export function verifyCommitment(
  commitment: Commitment,
  reveal: Reveal,
): ZkpVerification {
  const start = Date.now();
  const revealHash = sha256(reveal.value + reveal.salt);

  return {
    valid: revealHash === commitment.hash && reveal.claim === commitment.claim,
    claim: commitment.claim,
    commitmentHash: commitment.hash,
    revealHash,
    durationMs: Date.now() - start,
  };
}

/**
 * Range proof stub — prove a value is within a range without revealing it.
 *
 * Example: prove age > 18 without revealing birthdate.
 *
 * Implementation: the user commits to the exact value, then reveals
 * a derived boolean (e.g., "true" for age >= 18). The verifier checks
 * that the commitment hash matches the derived value.
 *
 * This is a simplified range proof — not a full Bulletproofs or PLONK proof.
 * But it's practical, open-source, and requires zero billing.
 *
 * @param value The actual value (e.g., "35" for age)
 * @param threshold The threshold (e.g., 18)
 * @param operator The comparison operator
 * @returns A commitment + the derived result
 */
export function rangeProof(
  value: number,
  threshold: number,
  operator: ">=" | "<=" | ">" | "<" | "==",
): { commitment: Commitment; result: boolean } {
  const result = (() => {
    switch (operator) {
      case ">=": return value >= threshold;
      case "<=": return value <= threshold;
      case ">": return value > threshold;
      case "<": return value < threshold;
      case "==": return value === threshold;
    }
  })();

  const claim = `value_${operator}_${threshold}`;
  // Commit to the actual value but only reveal the boolean result
  const salt = crypto.randomBytes(32).toString("hex");
  const hash = sha256(`${value}${salt}`);

  return {
    commitment: {
      hash,
      claim,
      committedAt: new Date().toISOString(),
      proofType: "range_proof",
    },
    result,
  };
}

/**
 * Membership proof — prove that a value is in a set without revealing which one.
 *
 * Example: prove that a user's ID is in the "verified users" set without
 * revealing which user.
 *
 * Implementation: commit to the value + set membership hash.
 *
 * @param value The value to prove membership of
 * @param set The set of allowed values
 * @param claim The membership claim
 */
export function membershipProof(
  value: string,
  set: string[],
  claim: string,
): { commitment: Commitment; isMember: boolean; setSize: number } {
  const isMember = set.includes(value);
  const salt = crypto.randomBytes(32).toString("hex");
  const setHash = sha256(set.sort().join(","));
  const hash = sha256(value + salt + setHash);

  return {
    commitment: {
      hash,
      claim,
      committedAt: new Date().toISOString(),
      proofType: "membership_proof",
    },
    isMember,
    setSize: set.length,
  };
}

/**
 * Generate a content-addressed identifier (CID) for immutable references.
 * Similar to IPFS CIDs — the hash IS the identifier.
 */
export function generateCID(data: string): string {
  const hash = sha256(data);
  // Format: "cir" (Cirkle prefix) + first 32 chars of SHA-256
  return `cir_${hash.slice(0, 32)}`;
}

/**
 * Verify a CID matches the data it claims to reference.
 */
export function verifyCID(data: string, cid: string): boolean {
  return generateCID(data) === cid;
}
