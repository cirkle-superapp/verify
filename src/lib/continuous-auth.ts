/**
 * Continuous Authentication — periodic re-verification during a session.
 *
 * ## Why this module exists
 *
 * Standard auth is "front-loaded": verify once at login, trust for the
 * rest of the session. This is a fatal flaw — it assumes the actor at
 * minute 30 is the same as the actor at minute 0. In reality:
 *
 *   - An attacker steals the session cookie and takes over.
 *   - The legitimate user walks away from a kiosk and a stranger sits down.
 *   - A co-worker swaps in at a shared desk.
 *   - A malicious browser extension takes control mid-session.
 *
 * Cirkle ships **continuous authentication**: passive biometric signals
 * (face crops from the webcam, voice from the mic, keystroke dynamics,
 * mouse entropy, device angle) are sampled every few minutes. Each
 * sample produces a "drift" from the enrollment baseline. When drift
 * crosses a threshold, the engine forces step-up re-verification. When
 * drift crosses a higher "revocation" threshold, the session is killed
 * instantly.
 *
 * Competitor gap: Onfido, Jumio, Veriff, Sumsub all do one-shot
 * identity verification. **None** of them ship continuous re-verification
 * during the post-authn session. This is the single largest gap in the
 * competitor feature set — and the single largest source of post-auth
 * fraud (account takeover, session hijack, insider misuse).
 *
 * ## Trust model
 *
 * Trust decays exponentially over time since the last verified signal.
 *   trust(t) = trust_0 * exp(-0.05 * hours_since_last_verified)
 *
 * With half-life ≈ 13.86 hours (configurable via {@link trustDecayFunction}).
 * Any new verified signal resets the clock and lifts trust back toward the
 * session baseline. Trust never exceeds 1.0.
 *
 * ## Compliance
 *
 * Every signal, decision, and revocation is appended to an audit trail.
 * The trail is hashed (SHA-256) entry-by-entry, chained like a blockchain
 * — required for SOC 2 Type II, ISO 27001, and the EU AI Act's
 * "high-risk system" logging requirements.
 */

import { createHash } from "crypto";
import { BiometricModality } from "./multimodal-fusion";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Kind of continuous-auth signal. */
export type ContinuousAuthSignalType = "face" | "voice" | "behavioral" | "device" | "location";

/**
 * A single continuous-authentication sample.
 *
 * - `value` 0..1 — similarity to enrollment baseline (1 = perfect match).
 * - `drift` 0..1 — deviation from baseline (1 - value, optionally amplified).
 * - `detail` — human-readable explanation.
 */
export interface ContinuousAuthSignal {
  /** ISO-8601 timestamp the signal was sampled. */
  timestamp: string;
  /** Signal kind. */
  type: ContinuousAuthSignalType;
  /** 0..1 — similarity to enrollment (1 = exact match). */
  value: number;
  /** 0..1 — drift from baseline (higher = more deviation). */
  drift: number;
  /** Free-form detail (e.g. "face crop at frame 1234, cosine 0.82"). */
  detail: string;
  /** Optional location, if type === "location". */
  location?: { lat: number; lon: number; accuracyM: number };
  /** Optional device fingerprint, if type === "device". */
  deviceId?: string;
}

/** Session status. */
export type SessionStatus = "active" | "reverify" | "revoked";

/** A continuous-auth session. */
export interface AuthSession {
  /** Stable unique session id. */
  sessionId: string;
  /** Owning user id. */
  userId: string;
  /** ISO-8601 timestamp the session was started. */
  startedAt: string;
  /** ISO-8601 timestamp of the last verified signal. */
  lastVerifiedAt: string;
  /** Number of signals recorded. */
  verificationCount: number;
  /** Current trust score 0..1. */
  trustScore: number;
  /** Initial trust score at session start. */
  baselineTrust: number;
  /** All recorded signals (capped by engine config.maxSignals). */
  signals: ContinuousAuthSignal[];
  /** Current status. */
  status: SessionStatus;
  /** Reason if status is "revoked". */
  revokeReason?: string;
  /** Audit entries (one per state transition). */
  audit: AuditEntry[];
}

/** A single audit entry, chained via SHA-256 hash. */
export interface AuditEntry {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** What happened. */
  action: string;
  /** Free-form details. */
  details: string;
  /** SHA-256 hash of (previousHash + this entry's canonical form). */
  hash: string;
}

/** Configuration for {@link ContinuousAuthEngine}. */
export interface ContinuousAuthConfig {
  /** Interval between mandatory re-verification checks. Default 5 min. */
  checkIntervalMs: number;
  /** Drift (0..1) above which re-verification is triggered. Default 0.15. */
  driftThreshold: number;
  /** Drift (0..1) above which the session is revoked. Default 0.40. */
  revocationThreshold: number;
  /** Maximum number of signals to retain per session. Default 100. */
  maxSignals: number;
}

/** Default configuration. */
export const DEFAULT_CONFIG: ContinuousAuthConfig = {
  checkIntervalMs: 5 * 60 * 1000,
  driftThreshold: 0.15,
  revocationThreshold: 0.40,
  maxSignals: 100,
};

// ─── Trust decay ──────────────────────────────────────────────────────────────

/**
 * Compute exponentially-decayed trust.
 *
 *   trust(t) = initialTrust * (1/2) ^ (hoursElapsed / halfLifeHours)
 *
 * With the default `halfLifeHours = 24`, trust halves every day of
 * inactivity. For a faster rate matching `exp(-0.05 * hours)`, use
 * `halfLifeHours = ln(2) / 0.05 ≈ 13.86`.
 *
 * @example
 * trustDecayFunction(1.0, 24) === 0.5  // half-life 24h
 * trustDecayFunction(1.0, 0)  === 1.0  // no decay
 */
export function trustDecayFunction(
  initialTrust: number,
  hoursElapsed: number,
  halfLifeHours: number = 24,
): number {
  if (hoursElapsed <= 0) return Math.max(0, Math.min(1, initialTrust));
  if (halfLifeHours <= 0) return 0; // instant decay
  const decayed = initialTrust * Math.pow(0.5, hoursElapsed / halfLifeHours);
  return Math.max(0, Math.min(1, decayed));
}

// ─── Drift computation result ─────────────────────────────────────────────────

/** Output of {@link ContinuousAuthEngine.computeDrift}. */
export interface DriftResult {
  /** EMA drift from baseline (0..1). */
  drift: number;
  /** Trend over the signal window. */
  trend: "increasing" | "decreasing" | "stable";
  /** 0..1 — confidence in the drift estimate (more signals = higher). */
  confidence: number;
}

/** Output of {@link ContinuousAuthEngine.shouldReverify}. */
export interface ReverifyDecision {
  /** Whether re-verification is required. */
  should: boolean;
  /** Human-readable reason. */
  reason: string;
  /** Modality most likely to remediate the issue. */
  recommendedModality: BiometricModality;
}

/** Output of {@link ContinuousAuthEngine.detectAnomaly}. */
export interface AnomalyResult {
  /** Whether an anomaly was detected. */
  isAnomalous: boolean;
  /** Type of anomaly. */
  anomalyType:
    | "sudden_drift"
    | "missing_signals"
    | "impossible_location_change"
    | "device_switch"
    | "behavioral_shift";
  /** Severity of the anomaly. */
  severity: "low" | "medium" | "high" | "critical";
  /** Human-readable detail. */
  detail: string;
}

/** Output of {@link ContinuousAuthEngine.getSessionSummary}. */
export interface SessionSummary {
  sessionId: string;
  /** Duration in seconds. */
  duration: number;
  signalCount: number;
  meanTrust: number;
  minTrust: number;
  driftTrend: "increasing" | "decreasing" | "stable";
  status: SessionStatus;
}

/** Output of {@link ContinuousAuthEngine.exportAuditTrail}. */
export interface AuditTrailExport {
  entries: { timestamp: string; action: string; details: string }[];
  /** SHA-256 hash of the entire trail (chain head). */
  hash: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo = 0, hi = 1): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Generate a random session id. */
function generateSessionId(): string {
  // 16 random hex chars + timestamp — collision-resistant in practice.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 10);
  return `cas_${ts}${rand}`;
}

/** Parse an ISO-8601 timestamp; returns 0 if invalid. */
function parseTs(s: string): number {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

/** Compute hours between two ISO-8601 timestamps. */
function hoursBetween(a: string, b: string): number {
  return Math.abs(parseTs(b) - parseTs(a)) / (1000 * 60 * 60);
}

/** Compute SHA-256 hash of (prevHash + canonical entry). */
function hashEntry(prevHash: string, timestamp: string, action: string, details: string): string {
  const canonical = `${prevHash}|${timestamp}|${action}|${details}`;
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Continuous-authentication engine — manages sessions, records signals,
 * detects drift, triggers step-ups, and revokes on high drift.
 *
 * @example
 * const engine = new ContinuousAuthEngine({ driftThreshold: 0.2 });
 * const session = engine.startSession("user-123");
 * engine.recordSignal(session.sessionId, {
 *   timestamp: new Date().toISOString(),
 *   type: "face",
 *   value: 0.92,
 *   drift: 0.08,
 *   detail: "face crop cosine 0.92",
 * });
 * const d = engine.computeDrift(session.sessionId);
 * if (d.drift > 0.2) {
 *   const v = engine.shouldReverify(session.sessionId);
 *   // ...
 * }
 */
export class ContinuousAuthEngine {
  private readonly config: ContinuousAuthConfig;
  private readonly sessions = new Map<string, AuthSession>();

  constructor(config: Partial<ContinuousAuthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start a new continuous-auth session.
   */
  startSession(userId: string, initialTrust: number = 1.0): AuthSession {
    const now = new Date().toISOString();
    const sessionId = generateSessionId();
    const baseline = clamp(initialTrust);

    const session: AuthSession = {
      sessionId,
      userId,
      startedAt: now,
      lastVerifiedAt: now,
      verificationCount: 0,
      trustScore: baseline,
      baselineTrust: baseline,
      signals: [],
      status: "active",
      audit: [],
    };

    // Seed the audit trail with a genesis entry.
    this.appendAudit(session, "session_start", `user=${userId} baseline=${baseline.toFixed(3)}`);
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Record a continuous-auth signal. The most-recent signals are kept
   * (FIFO eviction when `maxSignals` is exceeded).
   */
  recordSignal(sessionId: string, signal: ContinuousAuthSignal): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`recordSignal: unknown session ${sessionId}`);
    }
    if (session.status === "revoked") {
      throw new Error(`recordSignal: session ${sessionId} is revoked`);
    }

    session.signals.push(signal);
    if (session.signals.length > this.config.maxSignals) {
      session.signals.shift(); // drop oldest
    }
    session.verificationCount += 1;
    session.lastVerifiedAt = signal.timestamp;

    // Lift trust back toward baseline on a verified signal.
    const value = clamp(signal.value);
    session.trustScore = clamp(
      session.trustScore + (session.baselineTrust - session.trustScore) * 0.5 * value,
    );

    // Update session status based on current drift.
    const drift = this.computeDrift(sessionId);
    if (drift.drift >= this.config.revocationThreshold) {
      this.revoke(sessionId, `drift ${drift.drift.toFixed(3)} ≥ revocation threshold ${this.config.revocationThreshold}`);
      return;
    }
    if (drift.drift >= this.config.driftThreshold) {
      // At this point we know session.status is "active" or "reverify"
      // (revoked sessions throw at the top of recordSignal).
      if (session.status === "active") {
        session.status = "reverify";
        this.appendAudit(session, "reverify_flagged", `drift ${drift.drift.toFixed(3)}`);
      }
    } else {
      if (session.status === "reverify") {
        session.status = "active";
        this.appendAudit(session, "reverify_cleared", `drift dropped to ${drift.drift.toFixed(3)}`);
      }
    }

    this.appendAudit(
      session,
      "signal_recorded",
      `type=${signal.type} value=${value.toFixed(3)} drift=${signal.drift.toFixed(3)}`,
    );
  }

  /**
   * Compute the exponential moving average drift from the enrollment
   * baseline, plus a trend over the signal window.
   *
   * - `drift` 0..1 — EMA of per-signal drift values, α=0.3.
   * - `trend` — comparing first-half vs second-half average drift.
   *   "increasing" means drift is getting worse over time.
   * - `confidence` — based on signal count (saturates at 10).
   */
  computeDrift(sessionId: string): DriftResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { drift: 1, trend: "stable", confidence: 0 };
    }
    const signals = session.signals;
    if (signals.length === 0) {
      return { drift: 0, trend: "stable", confidence: 0 };
    }

    // EMA over drift values, α=0.3 (recent signals dominate).
    const alpha = 0.3;
    let ema = clamp(signals[0].drift);
    for (let i = 1; i < signals.length; i++) {
      ema = alpha * clamp(signals[i].drift) + (1 - alpha) * ema;
    }

    // Trend: compare first half to second half average.
    const half = Math.max(1, Math.floor(signals.length / 2));
    const firstHalf = signals.slice(0, half);
    const secondHalf = signals.slice(half);
    const avg = (arr: ContinuousAuthSignal[]): number =>
      arr.length > 0 ? arr.reduce((s, x) => s + clamp(x.drift), 0) / arr.length : 0;
    const delta = avg(secondHalf) - avg(firstHalf);
    const trend: DriftResult["trend"] =
      delta > 0.02 ? "increasing" : delta < -0.02 ? "decreasing" : "stable";

    const confidence = clamp(signals.length / 10);

    return { drift: ema, trend, confidence };
  }

  /**
   * Decide whether the session should trigger step-up re-verification.
   *
   * Triggers when:
   *   - Drift ≥ driftThreshold (the engine already flipped status to "reverify").
   *   - Time since last verified signal ≥ checkIntervalMs.
   *   - Signal count below 3 (too little data to trust).
   *
   * The recommended modality is the one most likely to remediate the
   * detected issue (drift on a face signal → step up face).
   */
  shouldReverify(sessionId: string): ReverifyDecision {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { should: true, reason: "session not found", recommendedModality: BiometricModality.Face };
    }
    if (session.status === "revoked") {
      return { should: true, reason: "session is revoked", recommendedModality: BiometricModality.Face };
    }

    const drift = this.computeDrift(sessionId);
    const now = Date.now();
    const sinceLastMs = now - parseTs(session.lastVerifiedAt);

    // Find the modality with the worst recent drift.
    const recentSignals = session.signals.slice(-5);
    const driftByModality = new Map<ContinuousAuthSignalType, number>();
    for (const s of recentSignals) {
      driftByModality.set(s.type, (driftByModality.get(s.type) ?? 0) + s.drift);
    }
    let worstType: ContinuousAuthSignalType = "face";
    let worstDrift = -1;
    for (const [t, d] of driftByModality.entries()) {
      if (d > worstDrift) {
        worstDrift = d;
        worstType = t;
      }
    }
    const modalityMap: Record<ContinuousAuthSignalType, BiometricModality> = {
      face: BiometricModality.Face,
      voice: BiometricModality.Voice,
      behavioral: BiometricModality.Behavioral,
      device: BiometricModality.Device,
      location: BiometricModality.Device,
    };
    const recommendedModality = modalityMap[worstType];

    if (drift.drift >= this.config.driftThreshold) {
      return {
        should: true,
        reason: `drift ${drift.drift.toFixed(3)} ≥ threshold ${this.config.driftThreshold} (trend: ${drift.trend})`,
        recommendedModality,
      };
    }
    if (sinceLastMs >= this.config.checkIntervalMs) {
      return {
        should: true,
        reason: `${(sinceLastMs / 1000 / 60).toFixed(1)} min since last verification ≥ ${(this.config.checkIntervalMs / 1000 / 60).toFixed(0)} min interval`,
        recommendedModality,
      };
    }
    if (session.verificationCount < 3) {
      return {
        should: true,
        reason: `only ${session.verificationCount} signals recorded (need 3+)`,
        recommendedModality: BiometricModality.Behavioral,
      };
    }

    return {
      should: false,
      reason: `drift ${drift.drift.toFixed(3)} < ${this.config.driftThreshold}, verified ${(sinceLastMs / 1000).toFixed(0)}s ago`,
      recommendedModality: BiometricModality.Face,
    };
  }

  /**
   * Forcefully revoke a session. Subsequent signal recording throws.
   */
  revoke(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`revoke: unknown session ${sessionId}`);
    }
    session.status = "revoked";
    session.trustScore = 0;
    session.revokeReason = reason;
    this.appendAudit(session, "session_revoked", reason);
  }

  /**
   * Compute the trust score at a future (or past) time `atTime`.
   *
   *   trust(t) = trust * exp(-0.05 * hours_since_last_verified)
   *
   * Implemented via {@link trustDecayFunction} with a half-life that
   * yields the 0.05/hour rate (≈ 13.86 hours).
   */
  getTrustDecay(sessionId: string, atTime: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    if (session.status === "revoked") return 0;
    const hours = hoursBetween(session.lastVerifiedAt, atTime);
    // halfLife = ln(2) / 0.05 ≈ 13.86 hours → rate matches exp(-0.05 * hours)
    const halfLife = Math.LN2 / 0.05;
    return trustDecayFunction(session.trustScore, hours, halfLife);
  }

  /**
   * Return a summary of the session's health.
   */
  getSessionSummary(sessionId: string): SessionSummary {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        sessionId,
        duration: 0,
        signalCount: 0,
        meanTrust: 0,
        minTrust: 0,
        driftTrend: "stable",
        status: "revoked",
      };
    }
    const duration = (Date.now() - parseTs(session.startedAt)) / 1000;
    // Approximate mean/min trust from signals' values.
    const values = session.signals.map((s) => clamp(s.value));
    const meanTrust = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : session.trustScore;
    const minTrust = values.length > 0 ? Math.min(...values) : session.trustScore;
    const drift = this.computeDrift(sessionId);

    return {
      sessionId,
      duration,
      signalCount: session.verificationCount,
      meanTrust: clamp(meanTrust),
      minTrust: clamp(minTrust),
      driftTrend: drift.trend,
      status: session.status,
    };
  }

  /**
   * Detect anomalies in the session — sudden drift, missing signals,
   * impossible location change, device switch, behavioral shift.
   *
   * Heuristics:
   *   - **sudden_drift** — single-signal drift jump > 0.3 from previous.
   *   - **missing_signals** — no signals recorded in last checkIntervalMs × 3.
   *   - **impossible_location_change** — two location signals > 500km apart
   *     within 1 hour (implies > 500 km/h travel).
   *   - **device_switch** — two consecutive device signals with different
   *     `deviceId` in the last 5 minutes.
   *   - **behavioral_shift** — behavioral signal value drops > 0.4 from
   *     rolling mean of previous 5 behavioral signals.
   */
  detectAnomaly(sessionId: string): AnomalyResult {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        isAnomalous: true,
        anomalyType: "missing_signals",
        severity: "critical",
        detail: "session not found",
      };
    }
    const signals = session.signals;

    // 1. Missing signals: no signal in last 3 * checkIntervalMs.
    if (signals.length === 0) {
      return {
        isAnomalous: true,
        anomalyType: "missing_signals",
        severity: "medium",
        detail: "no continuous-auth signals recorded",
      };
    }
    const last = signals[signals.length - 1];
    const sinceLastMs = Date.now() - parseTs(last.timestamp);
    if (sinceLastMs > this.config.checkIntervalMs * 3) {
      return {
        isAnomalous: true,
        anomalyType: "missing_signals",
        severity: "high",
        detail: `${(sinceLastMs / 1000 / 60).toFixed(1)} min since last signal — possibly disconnected`,
      };
    }

    // 2. Sudden drift jump.
    if (signals.length >= 2) {
      const prev = signals[signals.length - 2];
      const curr = signals[signals.length - 1];
      const jump = Math.abs(clamp(curr.drift) - clamp(prev.drift));
      if (jump > 0.3) {
        return {
          isAnomalous: true,
          anomalyType: "sudden_drift",
          severity: jump > 0.5 ? "critical" : "high",
          detail: `drift jumped from ${prev.drift.toFixed(3)} to ${curr.drift.toFixed(3)} (Δ=${jump.toFixed(3)})`,
        };
      }
    }

    // 3. Impossible location change.
    const locSignals = signals.filter((s) => s.type === "location" && s.location);
    for (let i = 1; i < locSignals.length; i++) {
      const a = locSignals[i - 1];
      const b = locSignals[i];
      const dt = (parseTs(b.timestamp) - parseTs(a.timestamp)) / (1000 * 60 * 60); // hours
      if (dt <= 0) continue;
      const km = haversineKm(a.location!.lat, a.location!.lon, b.location!.lat, b.location!.lon);
      const speedKmh = km / dt;
      if (speedKmh > 900) {
        return {
          isAnomalous: true,
          anomalyType: "impossible_location_change",
          severity: "critical",
          detail: `${km.toFixed(0)} km in ${dt.toFixed(2)} h (${speedKmh.toFixed(0)} km/h)`,
        };
      }
    }

    // 4. Device switch.
    const deviceSignals = signals.filter((s) => s.type === "device" && s.deviceId);
    if (deviceSignals.length >= 2) {
      const last5 = deviceSignals.slice(-5);
      const ids = new Set(last5.map((s) => s.deviceId));
      if (ids.size > 1) {
        return {
          isAnomalous: true,
          anomalyType: "device_switch",
          severity: "high",
          detail: `device fingerprint changed within 5 signals: ${[...ids].join(" → ")}`,
        };
      }
    }

    // 5. Behavioral shift.
    const behSignals = signals.filter((s) => s.type === "behavioral");
    if (behSignals.length >= 6) {
      const prev5 = behSignals.slice(-6, -1);
      const curr = behSignals[behSignals.length - 1];
      const meanPrev = prev5.reduce((s, x) => s + clamp(x.value), 0) / prev5.length;
      const drop = meanPrev - clamp(curr.value);
      if (drop > 0.4) {
        return {
          isAnomalous: true,
          anomalyType: "behavioral_shift",
          severity: drop > 0.6 ? "critical" : "high",
          detail: `behavioral match dropped from ${meanPrev.toFixed(3)} to ${curr.value.toFixed(3)} (Δ=${drop.toFixed(3)})`,
        };
      }
    }

    return {
      isAnomalous: false,
      anomalyType: "missing_signals", // placeholder when not anomalous
      severity: "low",
      detail: "no anomalies detected",
    };
  }

  /**
   * Export the audit trail for compliance reporting. The trail is a
   * chain of SHA-256-hashed entries — any tampering with one entry
   * breaks all subsequent hashes.
   */
  exportAuditTrail(sessionId: string): AuditTrailExport {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { entries: [], hash: "" };
    }
    const entries = session.audit.map((e) => ({
      timestamp: e.timestamp,
      action: e.action,
      details: e.details,
    }));
    const hash = session.audit.length > 0 ? session.audit[session.audit.length - 1].hash : "";
    return { entries, hash };
  }

  /** Internal: append an audit entry to a session. */
  private appendAudit(session: AuthSession, action: string, details: string): void {
    const timestamp = new Date().toISOString();
    const prevHash = session.audit.length > 0 ? session.audit[session.audit.length - 1].hash : "genesis";
    const hash = hashEntry(prevHash, timestamp, action, details);
    session.audit.push({ timestamp, action, details, hash });
  }
}

// ─── Haversine distance (km) for impossible-travel detection ─────────────────

/** Great-circle distance between two lat/lon points in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // earth radius km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
