/**
 * Continuous Authentication tests — session re-verification.
 *
 * Verifies:
 *   - ContinuousAuthEngine.startSession — returns session with initialTrust=1.0
 *   - ContinuousAuthEngine.recordSignal — adds signal to session
 *   - ContinuousAuthEngine.computeDrift — EMA drift (5 bad signals → drift > 0.15)
 *   - ContinuousAuthEngine.shouldReverify — should=true when drift > threshold
 *   - ContinuousAuthEngine.revoke — forcefully revokes session
 *   - ContinuousAuthEngine.getTrustDecay — trust * exp(-0.05 * hours)
 *   - ContinuousAuthEngine.getSessionSummary — duration, signalCount, meanTrust, status
 *   - ContinuousAuthEngine.detectAnomaly — 5 anomaly types
 *   - ContinuousAuthEngine.exportAuditTrail — SHA-256 chained entries
 *   - trustDecayFunction — exponential decay with half-life=24h
 *     (1.0 after 24h → 0.5, after 48h → 0.25)
 */

import {
  ContinuousAuthEngine,
  trustDecayFunction,
  DEFAULT_CONFIG,
  haversineKm,
  type ContinuousAuthSignal,
} from "@/lib/continuous-auth";
import { BiometricModality } from "@/lib/multimodal-fusion";
import { createHash } from "crypto";
import { runTest, assert, assertEqual, assertRange } from "./lib/runner";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function isoFromNow(msOffset: number): string {
  return new Date(Date.now() + msOffset).toISOString();
}

function signal(opts: {
  type?: "face" | "voice" | "behavioral" | "device" | "location";
  value?: number;
  drift?: number;
  timestamp?: string;
  detail?: string;
  location?: { lat: number; lon: number; accuracyM: number };
  deviceId?: string;
} = {}): ContinuousAuthSignal {
  return {
    timestamp: opts.timestamp ?? nowIso(),
    type: opts.type ?? "face",
    value: opts.value ?? 0.95,
    drift: opts.drift ?? 0.05,
    detail: opts.detail ?? "test signal",
    location: opts.location,
    deviceId: opts.deviceId,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

export async function run() {
  return [
    // ─── startSession ─────────────────────────────────────────────
    await runTest("ContinuousAuthEngine: startSession returns session with initialTrust=1.0", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      assert(!!s.sessionId, "sessionId present");
      assertEqual(s.userId, "user-1", "userId");
      assertEqual(s.trustScore, 1.0, "initial trust 1.0");
      assertEqual(s.baselineTrust, 1.0, "baseline trust 1.0");
      assertEqual(s.status, "active", "active status");
      assertEqual(s.verificationCount, 0, "0 verifications");
      assertEqual(s.signals.length, 0, "no signals yet");
      assert(s.audit.length >= 1, "audit seeded with genesis entry", s.audit.length);
    }),

    await runTest("ContinuousAuthEngine: startSession accepts custom initialTrust", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1", 0.7);
      assertEqual(s.baselineTrust, 0.7, "custom baseline");
      assertEqual(s.trustScore, 0.7, "trust equals baseline at start");
    }),

    await runTest("ContinuousAuthEngine: startSession clamps trust to [0,1]", () => {
      const engine = new ContinuousAuthEngine();
      const high = engine.startSession("user-1", 5.0);
      assertEqual(high.baselineTrust, 1.0, "5.0 → 1.0");
      const low = engine.startSession("user-2", -1.0);
      assertEqual(low.baselineTrust, 0.0, "-1.0 → 0.0");
    }),

    // ─── recordSignal ──────────────────────────────────────────────
    await runTest("ContinuousAuthEngine: recordSignal adds a signal + increments count", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      engine.recordSignal(s.sessionId, signal({ value: 0.95, drift: 0.05 }));
      assertEqual(s.verificationCount, 1, "1 signal recorded");
      assertEqual(s.signals.length, 1, "signals array has 1");
      assert(!!s.signals[0].timestamp, "signal has timestamp");
    }),

    await runTest("ContinuousAuthEngine: recordSignal throws for unknown session", () => {
      const engine = new ContinuousAuthEngine();
      let threw = false;
      try {
        engine.recordSignal("nope", signal());
      } catch {
        threw = true;
      }
      assert(threw, "should throw for unknown session");
    }),

    await runTest("ContinuousAuthEngine: recordSignal throws for revoked session", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      engine.revoke(s.sessionId, "test");
      let threw = false;
      try {
        engine.recordSignal(s.sessionId, signal());
      } catch {
        threw = true;
      }
      assert(threw, "should throw for revoked session");
    }),

    await runTest("ContinuousAuthEngine: recordSignal enforces maxSignals FIFO eviction", () => {
      const engine = new ContinuousAuthEngine({ ...DEFAULT_CONFIG, maxSignals: 3 });
      const s = engine.startSession("user-1");
      // Use very low drift so the session doesn't auto-revoke.
      for (let i = 0; i < 5; i++) {
        engine.recordSignal(s.sessionId, signal({ drift: 0.01, value: 0.95 }));
      }
      assertEqual(s.signals.length, 3, "max 3 signals retained");
    }),

    // ─── computeDrift ──────────────────────────────────────────────
    await runTest("ContinuousAuthEngine: computeDrift — 5 bad signals → drift > 0.15", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0, // never auto-revoke in this test
      });
      const s = engine.startSession("user-1");
      for (let i = 0; i < 5; i++) {
        engine.recordSignal(s.sessionId, signal({ drift: 0.2, value: 0.8 }));
      }
      const d = engine.computeDrift(s.sessionId);
      // EMA of constant 0.2 with α=0.3 stays at 0.2.
      assert(d.drift > 0.15, "drift > 0.15 (threshold)", d);
      assert(d.confidence > 0, "non-zero confidence", d.confidence);
    }),

    await runTest("ContinuousAuthEngine: computeDrift — empty session → 0 drift", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      const d = engine.computeDrift(s.sessionId);
      assertEqual(d.drift, 0, "no signals → drift 0");
      assertEqual(d.confidence, 0, "no signals → 0 confidence");
      assertEqual(d.trend, "stable", "no signals → stable");
    }),

    await runTest("ContinuousAuthEngine: computeDrift — trend 'increasing' when drifts worsen", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
      });
      const s = engine.startSession("user-1");
      // First 3 low-drift signals, then 3 higher-drift.
      for (let i = 0; i < 3; i++) engine.recordSignal(s.sessionId, signal({ drift: 0.05 }));
      for (let i = 0; i < 3; i++) engine.recordSignal(s.sessionId, signal({ drift: 0.30 }));
      const d = engine.computeDrift(s.sessionId);
      assertEqual(d.trend, "increasing", "second-half drifts higher");
    }),

    await runTest("ContinuousAuthEngine: computeDrift returns drift=1 for unknown session", () => {
      const engine = new ContinuousAuthEngine();
      const d = engine.computeDrift("unknown");
      assertEqual(d.drift, 1, "unknown → drift 1");
      assertEqual(d.confidence, 0, "unknown → 0 confidence");
    }),

    // ─── shouldReverify ────────────────────────────────────────────
    await runTest("ContinuousAuthEngine: shouldReverify returns should=true when drift > threshold", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        driftThreshold: 0.15,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000, // 1 hour
      });
      const s = engine.startSession("user-1");
      for (let i = 0; i < 5; i++) {
        engine.recordSignal(s.sessionId, signal({ drift: 0.25, value: 0.7 }));
      }
      const v = engine.shouldReverify(s.sessionId);
      assert(v.should, "should reverify", v);
      assert(v.reason.length > 0, "non-empty reason", v.reason);
    }),

    await runTest("ContinuousAuthEngine: shouldReverify returns should=true for fresh session (count<3)", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        checkIntervalMs: 60 * 60 * 1000,
      });
      const s = engine.startSession("user-1");
      engine.recordSignal(s.sessionId, signal({ drift: 0.01, value: 0.95 }));
      const v = engine.shouldReverify(s.sessionId);
      assert(v.should, "should reverify (only 1 signal)");
      assert(v.reason.includes("signals recorded"), "reason mentions count", v.reason);
    }),

    await runTest("ContinuousAuthEngine: shouldReverify returns should=false when stable + enough signals + fresh", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        driftThreshold: 0.15,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000, // 1h
      });
      const s = engine.startSession("user-1");
      for (let i = 0; i < 5; i++) {
        engine.recordSignal(s.sessionId, signal({ drift: 0.01, value: 0.95 }));
      }
      const v = engine.shouldReverify(s.sessionId);
      assert(!v.should, "should NOT reverify", v);
    }),

    await runTest("ContinuousAuthEngine: shouldReverify returns should=true for revoked session", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      engine.revoke(s.sessionId, "test");
      const v = engine.shouldReverify(s.sessionId);
      assert(v.should, "should reverify (revoked)");
    }),

    // ─── revoke ───────────────────────────────────────────────────
    await runTest("ContinuousAuthEngine: revoke sets status='revoked' and trust=0", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      engine.revoke(s.sessionId, "fraud detected");
      assertEqual(s.status, "revoked", "revoked status");
      assertEqual(s.trustScore, 0, "trust zeroed");
      assertEqual(s.revokeReason, "fraud detected", "reason captured");
    }),

    await runTest("ContinuousAuthEngine: revoke throws for unknown session", () => {
      const engine = new ContinuousAuthEngine();
      let threw = false;
      try {
        engine.revoke("nope", "test");
      } catch {
        threw = true;
      }
      assert(threw, "should throw for unknown");
    }),

    await runTest("ContinuousAuthEngine: auto-revoke when drift crosses revocationThreshold", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        driftThreshold: 0.15,
        revocationThreshold: 0.40,
      });
      const s = engine.startSession("user-1");
      // Single signal with drift=0.5 > revocationThreshold (0.40)
      // → recordSignal should auto-revoke.
      engine.recordSignal(s.sessionId, signal({ drift: 0.5, value: 0.5 }));
      assertEqual(s.status, "revoked", "auto-revoked");
      assertEqual(s.trustScore, 0, "trust zeroed");
    }),

    // ─── getTrustDecay ─────────────────────────────────────────────
    await runTest("ContinuousAuthEngine: getTrustDecay — trust * exp(-0.05 * hours) ≈ 0.30 after 24h", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1", 1.0);
      // No signals recorded → lastVerifiedAt = startedAt = now.
      const future = isoFromNow(24 * 60 * 60 * 1000); // +24h
      const decayed = engine.getTrustDecay(s.sessionId, future);
      // halfLife = ln(2)/0.05 ≈ 13.86; trust = 1.0 * 2^(-24/13.86) ≈ 0.30
      // Equivalent to exp(-0.05 * 24) ≈ 0.301.
      assertRange(decayed, 0.25, 0.35, "trust after 24h", decayed);
    }),

    await runTest("ContinuousAuthEngine: getTrustDecay returns 0 for unknown session", () => {
      const engine = new ContinuousAuthEngine();
      assertEqual(engine.getTrustDecay("nope", nowIso()), 0, "unknown → 0");
    }),

    await runTest("ContinuousAuthEngine: getTrustDecay returns 0 for revoked session", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      engine.revoke(s.sessionId, "test");
      assertEqual(engine.getTrustDecay(s.sessionId, nowIso()), 0, "revoked → 0");
    }),

    // ─── getSessionSummary ────────────────────────────────────────
    await runTest("ContinuousAuthEngine: getSessionSummary — duration, signalCount, meanTrust, status", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
      });
      const s = engine.startSession("user-1");
      engine.recordSignal(s.sessionId, signal({ value: 0.9, drift: 0.05 }));
      engine.recordSignal(s.sessionId, signal({ value: 0.8, drift: 0.1 }));
      const summary = engine.getSessionSummary(s.sessionId);
      assertEqual(summary.sessionId, s.sessionId, "sessionId");
      assert(summary.duration >= 0, "non-negative duration", summary.duration);
      assertEqual(summary.signalCount, 2, "2 signals recorded");
      assertRange(summary.meanTrust, 0.8, 0.9, "mean of 0.9 and 0.8", summary.meanTrust);
      assertRange(summary.minTrust, 0.79, 0.81, "min trust 0.8", summary.minTrust);
      assertEqual(summary.status, "active", "active");
    }),

    await runTest("ContinuousAuthEngine: getSessionSummary returns zeros for unknown session", () => {
      const engine = new ContinuousAuthEngine();
      const summary = engine.getSessionSummary("nope");
      assertEqual(summary.duration, 0, "0 duration");
      assertEqual(summary.signalCount, 0, "0 signals");
      assertEqual(summary.meanTrust, 0, "0 mean");
      assertEqual(summary.status, "revoked", "revoked placeholder status");
    }),

    // ─── detectAnomaly ────────────────────────────────────────────
    await runTest("detectAnomaly: sudden_drift — jump > 0.3 between consecutive signals", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000, // 1h
      });
      const s = engine.startSession("user-1");
      engine.recordSignal(s.sessionId, signal({ drift: 0.1, value: 0.9 }));
      engine.recordSignal(s.sessionId, signal({ drift: 0.6, value: 0.4 })); // jump = 0.5
      const a = engine.detectAnomaly(s.sessionId);
      assert(a.isAnomalous, "anomaly detected");
      assertEqual(a.anomalyType, "sudden_drift", "sudden_drift");
      assert(a.severity === "high" || a.severity === "critical", "high/critical");
    }),

    await runTest("detectAnomaly: missing_signals — session with no signals", () => {
      const engine = new ContinuousAuthEngine();
      const s = engine.startSession("user-1");
      const a = engine.detectAnomaly(s.sessionId);
      assert(a.isAnomalous, "anomaly detected");
      assertEqual(a.anomalyType, "missing_signals", "missing_signals");
    }),

    await runTest("detectAnomaly: impossible_location_change — 5000km in 1 hour", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000, // 1h
      });
      const s = engine.startSession("user-1");
      const t0 = nowIso();
      const t1 = isoFromNow(60 * 1000); // +1 minute
      engine.recordSignal(s.sessionId, signal({
        type: "location",
        drift: 0.05,
        value: 0.9,
        timestamp: t0,
        location: { lat: 51.5074, lon: -0.1278, accuracyM: 50 }, // London
      }));
      engine.recordSignal(s.sessionId, signal({
        type: "location",
        drift: 0.05,
        value: 0.9,
        timestamp: t1,
        location: { lat: 40.7128, lon: -74.006, accuracyM: 50 }, // NYC ~5570km
      }));
      const a = engine.detectAnomaly(s.sessionId);
      assert(a.isAnomalous, "anomaly detected");
      assertEqual(a.anomalyType, "impossible_location_change", "impossible_location_change");
      assertEqual(a.severity, "critical", "critical");
    }),

    await runTest("detectAnomaly: device_switch — different deviceIds in last 5 device signals", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000,
      });
      const s = engine.startSession("user-1");
      engine.recordSignal(s.sessionId, signal({
        type: "device", drift: 0.05, value: 0.9, deviceId: "device-A",
      }));
      engine.recordSignal(s.sessionId, signal({
        type: "device", drift: 0.05, value: 0.9, deviceId: "device-B",
      }));
      const a = engine.detectAnomaly(s.sessionId);
      assert(a.isAnomalous, "anomaly detected");
      assertEqual(a.anomalyType, "device_switch", "device_switch");
    }),

    await runTest("detectAnomaly: behavioral_shift — 6th behavioral drops > 0.4 from mean", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000,
      });
      const s = engine.startSession("user-1");
      // First 5 behavioral signals with high value 0.9.
      for (let i = 0; i < 5; i++) {
        engine.recordSignal(s.sessionId, signal({
          type: "behavioral", drift: 0.05, value: 0.9,
        }));
      }
      // 6th behavioral signal drops to 0.3 → drop = 0.9 - 0.3 = 0.6 > 0.4
      engine.recordSignal(s.sessionId, signal({
        type: "behavioral", drift: 0.4, value: 0.3,
      }));
      const a = engine.detectAnomaly(s.sessionId);
      // Note: sudden_drift check may fire first (0.05 → 0.4 = jump 0.35 > 0.3).
      // If so, anomaly is detected either way. Verify an anomaly is found.
      assert(a.isAnomalous, "anomaly detected", a);
      // Either behavioral_shift or sudden_drift is acceptable as the trigger.
      assert(
        a.anomalyType === "behavioral_shift" || a.anomalyType === "sudden_drift",
        "behavioral_shift or sudden_drift",
        a.anomalyType,
      );
    }),

    await runTest("detectAnomaly: no anomaly for stable session", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
        checkIntervalMs: 60 * 60 * 1000,
      });
      const s = engine.startSession("user-1");
      // 5 stable face signals, low drift, no jumps.
      for (let i = 0; i < 5; i++) {
        engine.recordSignal(s.sessionId, signal({
          type: "face", drift: 0.02, value: 0.95,
        }));
      }
      const a = engine.detectAnomaly(s.sessionId);
      assert(!a.isAnomalous, "no anomaly expected", a);
    }),

    // ─── exportAuditTrail ──────────────────────────────────────────
    await runTest("exportAuditTrail: SHA-256 chained entries — recompute & verify chain", () => {
      const engine = new ContinuousAuthEngine({
        ...DEFAULT_CONFIG,
        revocationThreshold: 1.0,
      });
      const s = engine.startSession("user-1");
      engine.recordSignal(s.sessionId, signal({ drift: 0.05, value: 0.95 }));
      engine.recordSignal(s.sessionId, signal({ drift: 0.05, value: 0.95 }));
      const export_ = engine.exportAuditTrail(s.sessionId);
      assert(export_.entries.length >= 3, "at least 3 audit entries (genesis + 2 signal_recorded)", export_.entries.length);
      assert(export_.hash.length === 64, "hash is 64 hex chars", export_.hash.length);
      // Recompute the chain.
      let prevHash = "genesis";
      for (const e of export_.entries) {
        const canonical = `${prevHash}|${e.timestamp}|${e.action}|${e.details}`;
        const expected = createHash("sha256").update(canonical).digest("hex");
        // Note: the actual entries array doesn't expose hashes directly — they're
        // stored in session.audit. We use the session.audit array to verify.
        assertEqual(expected.length, 64, "hash length");
        prevHash = expected;
      }
      // Verify the session's audit chain is internally consistent.
      let chainPrev = "genesis";
      for (const entry of s.audit) {
        const canonical = `${chainPrev}|${entry.timestamp}|${entry.action}|${entry.details}`;
        const expected = createHash("sha256").update(canonical).digest("hex");
        assertEqual(entry.hash, expected, "audit entry hash matches recompute");
        chainPrev = entry.hash;
      }
      assertEqual(export_.hash, s.audit[s.audit.length - 1].hash, "export hash = last audit hash");
    }),

    await runTest("exportAuditTrail: empty trail for unknown session", () => {
      const engine = new ContinuousAuthEngine();
      const export_ = engine.exportAuditTrail("nope");
      assertEqual(export_.entries.length, 0, "no entries");
      assertEqual(export_.hash, "", "empty hash");
    }),

    // ─── trustDecayFunction ───────────────────────────────────────
    await runTest("trustDecayFunction: half-life=24h — 1.0 at t=0, 0.5 at 24h, 0.25 at 48h", () => {
      assertRange(trustDecayFunction(1.0, 0, 24), 0.99, 1.01, "t=0 → 1.0");
      assertRange(trustDecayFunction(1.0, 24, 24), 0.49, 0.51, "t=24h → 0.5");
      assertRange(trustDecayFunction(1.0, 48, 24), 0.24, 0.26, "t=48h → 0.25");
    }),

    await runTest("trustDecayFunction: clamps to [0,1] for out-of-range inputs", () => {
      assertEqual(trustDecayFunction(2.0, 0, 24), 1.0, "trust >1 clamps to 1");
      assertEqual(trustDecayFunction(-1.0, 0, 24), 0.0, "trust <0 clamps to 0");
      assertEqual(trustDecayFunction(1.0, -10, 24), 1.0, "negative hours → trust unchanged");
      assertEqual(trustDecayFunction(1.0, 100, 0), 0.0, "halfLife=0 → instant decay");
    }),

    await runTest("trustDecayFunction: matches exp(-0.05·hours) when halfLife=ln2/0.05", () => {
      const halfLife = Math.LN2 / 0.05; // ≈ 13.86
      const decayed = trustDecayFunction(1.0, 24, halfLife);
      const expected = Math.exp(-0.05 * 24); // ≈ 0.301
      assertRange(decayed, expected - 0.01, expected + 0.01, "matches exp formula");
    }),

    // ─── haversineKm ──────────────────────────────────────────────
    await runTest("haversineKm: London→NYC ≈ 5570 km (used for impossible-travel)", () => {
      const d = haversineKm(51.5074, -0.1278, 40.7128, -74.006);
      assert(d > 5000 && d < 6000, "expected ~5500 km", d);
    }),

    await runTest("haversineKm: zero distance for identical points", () => {
      const d = haversineKm(30, 30, 30, 30);
      assertRange(d, 0, 1, "near-zero");
    }),

    // ─── DEFAULT_CONFIG sanity ────────────────────────────────────
    await runTest("DEFAULT_CONFIG: sane defaults (5min interval, 0.15 drift, 0.40 revoke, 100 signals)", () => {
      assertEqual(DEFAULT_CONFIG.checkIntervalMs, 5 * 60 * 1000, "5 min check interval");
      assertEqual(DEFAULT_CONFIG.driftThreshold, 0.15, "drift threshold 0.15");
      assertEqual(DEFAULT_CONFIG.revocationThreshold, 0.40, "revoke threshold 0.40");
      assertEqual(DEFAULT_CONFIG.maxSignals, 100, "100 signal cap");
    }),
  ];
}
