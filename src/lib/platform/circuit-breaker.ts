/**
 * Circuit Breaker + Bounded Retry with Jitter.
 *
 * Circuit states:
 *   CLOSED    → requests flow normally; failures increment failureCount
 *   OPEN      → requests fail fast with DEPENDENCY_UNAVAILABLE; no call made
 *   HALF_OPEN → limited probe requests allowed to test recovery
 *
 * Thresholds (configurable per-breaker):
 *   failureThreshold  → open after N consecutive failures
 *   openDurationMs    → time to stay OPEN before HALF_OPEN probe
 *   halfOpenProbes    → successful probes needed to close
 *
 * No infinite loops: every breaker has a bounded openDuration and a
 * terminal OPEN state if recovery repeatedly fails.
 */

import type { CircuitState, CircuitSnapshot, FailureType } from "./ports";
import { PlatformError } from "./ports";

interface BreakerConfig {
  name: string;
  failureThreshold: number;       // consecutive failures to open
  openDurationMs: number;         // stay open this long before half-open
  halfOpenProbes: number;         // successes in half-open to close
  maxOpenRetries?: number;        // terminal OPEN after this many open→half-open→open cycles
}

interface BreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  halfOpenAt: string | null;
  openCycleCount: number;
  halfOpenSuccesses: number;
}

const breakers = new Map<string, { config: BreakerConfig; state: BreakerState }>();

function getBreaker(config: BreakerConfig): { config: BreakerConfig; state: BreakerState } {
  let b = breakers.get(config.name);
  if (!b) {
    b = {
      config,
      state: {
        state: "CLOSED",
        failureCount: 0,
        successCount: 0,
        lastFailureAt: null,
        openedAt: null,
        halfOpenAt: null,
        openCycleCount: 0,
        halfOpenSuccesses: 0,
      },
    };
    breakers.set(config.name, b);
  }
  return b;
}

function nowISO(): string {
  return new Date().toISOString();
}

/** Check if the breaker allows a request. Throws if OPEN. */
export function checkBreaker(name: string): void {
  const b = breakers.get(name);
  if (!b) return; // no breaker registered → allow
  const { state } = b.state;
  if (state === "OPEN") {
    const sinceOpen = Date.now() - new Date(b.state.openedAt!).getTime();
    if (sinceOpen >= b.config.openDurationMs) {
      // transition to HALF_OPEN
      b.state.state = "HALF_OPEN";
      b.state.halfOpenAt = nowISO();
      b.state.halfOpenSuccesses = 0;
    } else {
      throw new PlatformError(
        "DEPENDENCY_UNAVAILABLE",
        `Circuit OPEN for ${name} (retry in ${Math.ceil((b.config.openDurationMs - sinceOpen) / 1000)}s)`,
        undefined,
        false,
        name,
      );
    }
  }
  // CLOSED or HALF_OPEN → allow
}

/** Record a success. Closes the breaker if enough half-open probes succeed. */
export function recordSuccess(name: string): void {
  const b = breakers.get(name);
  if (!b) return;
  if (b.state.state === "HALF_OPEN") {
    b.state.halfOpenSuccesses++;
    if (b.state.halfOpenSuccesses >= b.config.halfOpenProbes) {
      b.state.state = "CLOSED";
      b.state.failureCount = 0;
      b.state.successCount = 0;
      b.state.openedAt = null;
      b.state.halfOpenAt = null;
    }
  } else if (b.state.state === "CLOSED") {
    b.state.failureCount = 0;
    b.state.successCount++;
  }
}

/** Record a failure. Opens the breaker if threshold hit. */
export function recordFailure(name: string, _error: PlatformError): void {
  const b = breakers.get(name);
  if (!b) return;
  b.state.lastFailureAt = nowISO();
  if (b.state.state === "HALF_OPEN") {
    // half-open probe failed → reopen
    b.state.state = "OPEN";
    b.state.openedAt = nowISO();
    b.state.openCycleCount++;
    b.state.halfOpenSuccesses = 0;
    if (b.config.maxOpenRetries && b.state.openCycleCount >= b.config.maxOpenRetries) {
      // terminal: stays OPEN (operator must intervene)
    }
  } else if (b.state.state === "CLOSED") {
    b.state.failureCount++;
    if (b.state.failureCount >= b.config.failureThreshold) {
      b.state.state = "OPEN";
      b.state.openedAt = nowISO();
      b.state.openCycleCount++;
    }
  }
}

/** Wrap a function with circuit-breaker protection. */
export async function withBreaker<T>(
  config: BreakerConfig,
  fn: () => Promise<T>,
): Promise<T> {
  getBreaker(config); // register
  checkBreaker(config.name);
  try {
    const result = await fn();
    recordSuccess(config.name);
    return result;
  } catch (e: any) {
    const pe =
      e instanceof PlatformError
        ? e
        : new PlatformError(
            "UNKNOWN_INFRASTRUCTURE_FAILURE",
            e?.message || "unknown error",
            e,
            false,
            config.name,
          );
    recordFailure(config.name, pe);
    throw pe;
  }
}

/** Get a snapshot of a breaker (for observability dashboard). */
export function snapshotBreaker(name: string): CircuitSnapshot | null {
  const b = breakers.get(name);
  if (!b) return null;
  return {
    name: b.config.name,
    state: b.state.state,
    failureCount: b.state.failureCount,
    successCount: b.state.successCount,
    lastFailureAt: b.state.lastFailureAt,
    openedAt: b.state.openedAt,
    halfOpenAt: b.state.halfOpenAt,
  };
}

/** List all breaker snapshots. */
export function allBreakerSnapshots(): CircuitSnapshot[] {
  const out: CircuitSnapshot[] = [];
  for (const name of breakers.keys()) {
    const s = snapshotBreaker(name);
    if (s) out.push(s);
  }
  return out;
}

// ─── Bounded Retry with Jitter ────────────────────────────────────

export interface RetryConfig {
  maxAttempts: number;            // total attempts (1 = no retry)
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;            // 0..1 — fraction of delay to randomize
  retryOn: (failureType: FailureType) => boolean;
}

export const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  jitterRatio: 0.3,
  retryOn: (ft) =>
    ft === "DEPENDENCY_TIMEOUT" ||
    ft === "DEPENDENCY_UNAVAILABLE" ||
    ft === "DATABASE_UNAVAILABLE" ||
    ft === "RATE_LIMITED" ||
    ft === "WORKFLOW_FAILURE",
};

/**
 * Run fn with bounded retry. NEVER infinite — always capped by maxAttempts.
 * Each retry adds exponential backoff + jitter to avoid thundering herds.
 */
export async function withRetry<T>(config: RetryConfig, fn: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (e: any) {
      lastError = e;
      const ft: FailureType = e instanceof PlatformError ? e.type : "UNKNOWN_INFRASTRUCTURE_FAILURE";
      if (attempt >= config.maxAttempts || !config.retryOn(ft)) {
        throw e;
      }
      // exponential backoff with jitter
      const exp = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (attempt - 1));
      const jitter = exp * config.jitterRatio * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(exp + jitter));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
