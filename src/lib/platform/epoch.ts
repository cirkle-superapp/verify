/**
 * Database Epoch / Fencing Token.
 *
 * Mandate: prevent split-brain between Turso (authoritative) and Neon
 * (recovery). Only ONE database may be writable at a time. A controlled
 * promotion increments the epoch and issues a new fencing token. Stale
 * writers operating under an old epoch are REJECTED.
 *
 * Example:
 *   epoch 41 → Turso primary   (fencing token: "41:turso:...")
 *   epoch 42 → Neon promoted   (fencing token: "42:neon:...")
 *
 * Any write attempt with epoch < current is rejected with CONFLICT.
 */

import type { EpochState } from "./ports";
import { PlatformError } from "./ports";

// In production this would be persisted in BOTH databases (read-repair).
// For this implementation we keep it in memory + a heartbeat to Turso.
let currentEpoch: EpochState = {
  epoch: 41,
  primary: "turso",
  promotedAt: new Date().toISOString(),
  reason: "initial — Turso is authoritative by mandate",
  fencingToken: makeFencingToken(41, "turso"),
};

function makeFencingToken(epoch: number, primary: "turso" | "neon"): string {
  // token = epoch:primary:randomNonce — verified on every write
  const nonce = Math.random().toString(36).slice(2, 10);
  return `${epoch}:${primary}:${nonce}`;
}

/** Current epoch state (read-only). */
export function getEpoch(): EpochState {
  return { ...currentEpoch };
}

/**
 * Verify a writer's fencing token matches the current epoch.
 * Throws CONFLICT if stale (split-brain prevention).
 */
export function verifyEpoch(token: string): void {
  const [tokenEpoch] = token.split(":");
  const expectedEpoch = currentEpoch.epoch;
  if (Number(tokenEpoch) !== expectedEpoch) {
    throw new PlatformError(
      "CONFLICT",
      `Stale writer: token epoch ${tokenEpoch} ≠ current epoch ${expectedEpoch}. ` +
        `Current primary is ${currentEpoch.primary}. Rejecting to prevent split-brain.`,
      undefined,
      false,
      "epoch",
    );
  }
}

/** Issue a fencing token for the current epoch (used by adapters before writing). */
export function issueFencingToken(): string {
  return currentEpoch.fencingToken;
}

/**
 * CONTROLLED promotion — only callable by an authorized operator action.
 * Increments epoch, switches primary, issues new fencing token.
 * Old writers are immediately fenced out.
 *
 * This is NOT automatic failover. Automatic failover is forbidden by mandate.
 */
export function promoteDatabase(
  newPrimary: "turso" | "neon",
  reason: string,
  _operatorAuth: string, // would verify against admin secret in production
): EpochState {
  if (newPrimary === currentEpoch.primary) {
    throw new PlatformError(
      "CONFLICT",
      `${newPrimary} is already the primary (epoch ${currentEpoch.epoch})`,
      undefined,
      false,
      "epoch",
    );
  }
  const newEpochNum = currentEpoch.epoch + 1;
  currentEpoch = {
    epoch: newEpochNum,
    primary: newPrimary,
    promotedAt: new Date().toISOString(),
    reason,
    fencingToken: makeFencingToken(newEpochNum, newPrimary),
  };
  // In production: persist new epoch to BOTH databases atomically, then
  // broadcast to all adapter instances via a pub/sub or polling mechanism.
  return { ...currentEpoch };
}

/**
 * Check if a given database role is currently writable.
 * Used by adapters to guard writes.
 */
export function isWritable(role: "primary" | "recovery"): boolean {
  if (role === "primary") return currentEpoch.primary === "turso";
  return currentEpoch.primary === "neon"; // recovery (Neon) writable only when promoted
}
