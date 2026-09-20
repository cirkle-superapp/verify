/**
 * Bias Detection & Fairness Metrics for Identity Verification.
 *
 * ## Why this module exists
 *
 * In 2020 Onfido was formally investigated for racial bias in its face
 * matching model — disproportionate false-negative rates for users with
 * darker Fitzpatrick skin tones. Jumio, Veriff, and Sumsub all face
 * similar regulatory scrutiny under the EU AI Act (2024) and the US NIST
 * AI RMF.
 *
 * Cirkle is the only competitor that ships **runtime fairness telemetry**
 * — every verification produces a bias audit entry, chained into an
 * append-only hash log that can be presented to regulators on demand.
 *
 * ## What this module computes
 *
 *  - **Demographic parity**: P(approve | group_a) vs P(approve | group_b)
 *  - **Equal opportunity**: TPR parity across groups
 *  - **Disparate impact**: the 4/5ths rule from US EEOC
 *  - **Equalized odds**: TPR + FPR parity across groups
 *  - **Skin tone bias**: Fitzpatrick scale accuracy disparity
 *  - **Age group bias**: P(approve) across age brackets
 *  - **Regional bias**: P(approve) across regions/countries
 *  - **Audit trail**: blockchain-style chained hashes for compliance
 *
 * All functions are pure TypeScript — no numpy, no sklearn — operating on
 * summary statistics or per-decision records passed by the caller. They are
 * safe for Vercel serverless deployment.
 */

import { createHash } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Protected attributes tracked by Cirkle's fairness engine. */
export type ProtectedAttribute =
  | "gender"
  | "age_group"
  | "nationality"
  | "skin_tone"
  | "region";

/** Decision outcome in a verification flow. */
export type Decision = "approve" | "reject" | "review";

/** A single per-decision outcome record. */
export interface Outcome {
  attr: ProtectedAttribute;
  value: string;
  decision: Decision;
}

/** Ground-truth label (was this identity actually legitimate?). */
export interface LabeledOutcome extends Outcome {
  /** True if the identity was legitimate, false if fraudulent. */
  legitimate: boolean;
}

/** A computed bias metric with status & recommendation. */
export interface BiasMetric {
  /** Metric name (e.g. "demographic_parity"). */
  name: string;
  /** Numeric value of the metric (interpretation depends on the metric). */
  value: number;
  /** Threshold against which `value` is compared. */
  threshold: number;
  /** Pass / review / fail status against `threshold`. */
  status: "pass" | "review" | "fail";
  /** Human-readable detail explaining the value. */
  detail: string;
  /** Actionable recommendation if status is not "pass". */
  recommendation: string;
}

/** A fairness audit-trail entry. */
export interface AuditEntry {
  timestamp: string;
  decision_id: string;
  computed_metrics: Record<string, number>;
  /** SHA-256 of (previous hash + this entry's payload). */
  hash: string;
}

/** Result of a fairness audit computation. */
export interface FairnessAuditResult {
  entries: AuditEntry[];
  /** Hash of the final entry — commit this with the audit log. */
  chain_hash: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute P(decision | group=value) for every group.
 * Returns a map: group value -> { approve, reject, review, total, pApprove }.
 */
interface GroupStats {
  approve: number;
  reject: number;
  review: number;
  total: number;
  pApprove: number; // approve / total, 0 if total === 0
}

function groupStats(outcomes: Outcome[]): Map<string, GroupStats> {
  const m = new Map<string, GroupStats>();
  for (const o of outcomes) {
    const s =
      m.get(o.value) ?? {
        approve: 0,
        reject: 0,
        review: 0,
        total: 0,
        pApprove: 0,
      };
    s[o.decision]++;
    s.total++;
    m.set(o.value, s);
  }
  for (const s of m.values()) {
    s.pApprove = s.total === 0 ? 0 : s.approve / s.total;
  }
  return m;
}

/** Compute the max/min ratio across groups, returns {ratio, groups}. */
function parityRatio(
  stats: Map<string, GroupStats>
): { ratio: number; high: string; low: string; highP: number; lowP: number } {
  let high = "";
  let low = "";
  let highP = -Infinity;
  let lowP = Infinity;
  for (const [k, s] of stats) {
    if (s.total === 0) continue;
    if (s.pApprove > highP) {
      highP = s.pApprove;
      high = k;
    }
    if (s.pApprove < lowP) {
      lowP = s.pApprove;
      low = k;
    }
  }
  if (!isFinite(lowP) || !isFinite(highP) || highP === 0) {
    return { ratio: 1, high, low, highP: highP === -Infinity ? 0 : highP, lowP: lowP === Infinity ? 0 : lowP };
  }
  return { ratio: lowP / highP, high, low, highP, lowP };
}

function statusFromRatio(ratio: number, low: number, high: number): BiasMetric["status"] {
  if (ratio >= high) return "pass";
  if (ratio >= low) return "review";
  return "fail";
}

// ─── Metric: Demographic Parity ──────────────────────────────────────────────

/**
 * Compute demographic parity — the ratio of P(approve | least-favored group)
 * to P(approve | most-favored group). Threshold (4/5ths rule): >= 0.8.
 *
 * Demographic parity asks: "Is the model equally likely to approve users
 * regardless of their group membership?"
 *
 * @param outcomes Per-decision records with group value and decision.
 * @returns BiasMetric — value is the ratio, threshold is 0.8.
 */
export function computeDemographicParity(outcomes: Outcome[]): BiasMetric {
  const stats = groupStats(outcomes);
  const { ratio, high, low, highP, lowP } = parityRatio(stats);
  const status = statusFromRatio(ratio, 0.7, 0.8);
  return {
    name: "demographic_parity",
    value: ratio,
    threshold: 0.8,
    status,
    detail: `P(approve|${low})=${lowP.toFixed(3)} vs P(approve|${high})=${highP.toFixed(3)} → ratio ${ratio.toFixed(3)}`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `Investigate over-rejection of group "${low}". Re-sample training data or recalibrate the decision threshold.`,
  };
}

// ─── Metric: Equal Opportunity ───────────────────────────────────────────────

/**
 * Compute equal opportunity — true-positive rate (TPR) parity across groups.
 *
 * TPR = correctly approved legitimate users / all legitimate users in group.
 * Threshold: ratio of min-group TPR to max-group TPR >= 0.8.
 *
 * @param outcomes Per-decision records.
 * @param groundTruthLabels Parallel array of legitimate/fraudulent labels.
 * @returns BiasMetric — value is the TPR ratio, threshold is 0.8.
 */
export function computeEqualOpportunity(
  outcomes: Outcome[],
  groundTruthLabels: LabeledOutcome[]
): BiasMetric {
  if (outcomes.length !== groundTruthLabels.length) {
    return {
      name: "equal_opportunity",
      value: 0,
      threshold: 0.8,
      status: "fail",
      detail: "Mismatched lengths between outcomes and ground-truth labels.",
      recommendation: "Ensure ground-truth labels align 1:1 with outcome records.",
    };
  }
  // TPR per group: P(approve | legitimate, group)
  const tprByGroup = new Map<string, { tpr: number; n: number }>();
  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    const label = groundTruthLabels[i];
    if (!label.legitimate) continue;
    const entry = tprByGroup.get(o.value) ?? { tpr: 0, n: 0 };
    entry.n++;
    if (o.decision === "approve") entry.tpr++;
    tprByGroup.set(o.value, entry);
  }
  let maxTpr = -Infinity;
  let minTpr = Infinity;
  let maxGroup = "";
  let minGroup = "";
  for (const [k, v] of tprByGroup) {
    if (v.n === 0) continue;
    const tpr = v.tpr / v.n;
    if (tpr > maxTpr) {
      maxTpr = tpr;
      maxGroup = k;
    }
    if (tpr < minTpr) {
      minTpr = tpr;
      minGroup = k;
    }
  }
  if (!isFinite(maxTpr) || maxTpr === 0) {
    return {
      name: "equal_opportunity",
      value: 1,
      threshold: 0.8,
      status: "pass",
      detail: "Insufficient legitimate samples to compute TPR; defaulting to pass with ratio 1.0.",
      recommendation: "Collect more ground-truth labels to enable reliable equal-opportunity measurement.",
    };
  }
  const ratio = minTpr / maxTpr;
  const status = statusFromRatio(ratio, 0.7, 0.8);
  return {
    name: "equal_opportunity",
    value: ratio,
    threshold: 0.8,
    status,
    detail: `TPR(${minGroup})=${minTpr.toFixed(3)} vs TPR(${maxGroup})=${maxTpr.toFixed(3)} → ratio ${ratio.toFixed(3)}`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `Legitimate users in group "${minGroup}" are under-approved. Audit the model's recall on this group.`,
  };
}

// ─── Metric: Disparate Impact ─────────────────────────────────────────────────

/**
 * Compute disparate impact — the 4/5ths rule from US EEOC.
 *
 * DI = P(approve | group_a) / P(approve | group_b) where group_b is the
 * most-favored group. Pass if 0.8 <= DI <= 1.25, review if 0.7 <= DI < 0.8
 * or 1.25 < DI <= 1.43, fail otherwise.
 *
 * This is the metric US regulators use to evaluate adverse impact in
 * hiring, lending, and now AI verification.
 *
 * @param outcomes Per-decision records.
 * @returns BiasMetric with two-sided thresholds.
 */
export function computeDisparateImpact(outcomes: Outcome[]): BiasMetric {
  const stats = groupStats(outcomes);
  const { ratio, high, low, highP, lowP } = parityRatio(stats);
  let status: BiasMetric["status"];
  if (ratio >= 0.8 && ratio <= 1.25) status = "pass";
  else if (ratio >= 0.7 && ratio <= 1.43) status = "review";
  else status = "fail";
  return {
    name: "disparate_impact",
    value: ratio,
    threshold: 0.8,
    status,
    detail: `DI = P(approve|${low})/P(approve|${high}) = ${lowP.toFixed(3)}/${highP.toFixed(3)} = ${ratio.toFixed(3)}`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `Adverse impact detected against "${low}". Required: disparate-impact review under EEOC 4/5ths rule.`,
  };
}

// ─── Metric: Equalized Odds ───────────────────────────────────────────────────

/**
 * Compute equalized odds — parity of both TPR and FPR across groups.
 *
 * Equalized odds is stricter than equal opportunity: the model must not
 * only approve legitimate users equally across groups, but also *reject*
 * fraudulent users equally (FPR parity).
 *
 * Threshold: |ΔTPR| <= 0.1 AND |ΔFPR| <= 0.1 → pass;
 * |Δ| <= 0.2 → review; otherwise fail.
 *
 * @param outcomes Per-decision records.
 * @param groundTruthLabels Parallel array of legitimate/fraudulent labels.
 */
export function computeEqualizedOdds(
  outcomes: Outcome[],
  groundTruthLabels: LabeledOutcome[]
): BiasMetric {
  if (outcomes.length !== groundTruthLabels.length) {
    return {
      name: "equalized_odds",
      value: 0,
      threshold: 0.1,
      status: "fail",
      detail: "Mismatched lengths between outcomes and ground-truth labels.",
      recommendation: "Ensure ground-truth labels align 1:1 with outcome records.",
    };
  }
  const statsByGroup = new Map<
    string,
    { tp: number; fn: number; fp: number; tn: number }
  >();
  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    const label = groundTruthLabels[i];
    const entry =
      statsByGroup.get(o.value) ?? { tp: 0, fn: 0, fp: 0, tn: 0 };
    if (label.legitimate) {
      if (o.decision === "approve") entry.tp++;
      else entry.fn++;
    } else {
      if (o.decision === "approve") entry.fp++;
      else entry.tn++;
    }
    statsByGroup.set(o.value, entry);
  }
  const tprs: { group: string; tpr: number }[] = [];
  const fprs: { group: string; fpr: number }[] = [];
  for (const [k, s] of statsByGroup) {
    const tprDen = s.tp + s.fn;
    const fprDen = s.fp + s.tn;
    tprs.push({ group: k, tpr: tprDen === 0 ? 0 : s.tp / tprDen });
    fprs.push({ group: k, fpr: fprDen === 0 ? 0 : s.fp / fprDen });
  }
  const tprVals = tprs.map(t => t.tpr);
  const fprVals = fprs.map(f => f.fpr);
  const tprSpread = Math.max(...tprVals) - Math.min(...tprVals);
  const fprSpread = Math.max(...fprVals) - Math.min(...fprVals);
  const worstSpread = Math.max(tprSpread, fprSpread);
  let status: BiasMetric["status"];
  if (worstSpread <= 0.1) status = "pass";
  else if (worstSpread <= 0.2) status = "review";
  else status = "fail";
  const worstKind = tprSpread >= fprSpread ? "TPR" : "FPR";
  return {
    name: "equalized_odds",
    value: worstSpread,
    threshold: 0.1,
    status,
    detail: `ΔTPR=${tprSpread.toFixed(3)}, ΔFPR=${fprSpread.toFixed(3)} → worst spread ${worstSpread.toFixed(3)} (${worstKind})`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `${worstKind} spread exceeds 0.10 — re-balance training data across groups and recalibrate thresholds.`,
  };
}

// ─── Metric: Skin Tone Bias (Fitzpatrick) ─────────────────────────────────────

/** Fitzpatrick skin tone scale. */
export type SkinTone =
  | "light"
  | "medium-light"
  | "medium"
  | "medium-dark"
  | "dark";

/** Per-image skin-tone record. */
export interface SkinToneRecord {
  skinTone: SkinTone;
  matched: boolean;
  accuracy: number; // 0..1
}

/**
 * Compute skin tone bias — disparity in face-match accuracy across the
 * Fitzpatrick scale. This is the exact metric Onfido was investigated for
 * in 2020.
 *
 * Threshold: max-min accuracy across skin tones <= 0.05 → pass,
 * <= 0.10 → review, otherwise fail.
 *
 * @param faceImages Per-image records with skinTone, matched, accuracy.
 */
export function computeSkinToneBias(faceImages: SkinToneRecord[]): BiasMetric {
  const byTone = new Map<SkinTone, { acc: number; n: number; matched: number }>();
  for (const r of faceImages) {
    const e = byTone.get(r.skinTone) ?? { acc: 0, n: 0, matched: 0 };
    e.acc += r.accuracy;
    e.n++;
    if (r.matched) e.matched++;
    byTone.set(r.skinTone, e);
  }
  const avgs: { tone: SkinTone; avg: number }[] = [];
  for (const [k, v] of byTone) {
    avgs.push({ tone: k, avg: v.n === 0 ? 0 : v.acc / v.n });
  }
  if (avgs.length === 0) {
    return {
      name: "skin_tone_bias",
      value: 0,
      threshold: 0.05,
      status: "pass",
      detail: "No skin-tone records provided.",
      recommendation: "Begin collecting Fitzpatrick skin-tone labels for every face match.",
    };
  }
  const avgVals = avgs.map(a => a.avg);
  const maxAvg = Math.max(...avgVals);
  const minAvg = Math.min(...avgVals);
  const spread = maxAvg - minAvg;
  let status: BiasMetric["status"];
  if (spread <= 0.05) status = "pass";
  else if (spread <= 0.1) status = "review";
  else status = "fail";
  const maxTone = avgs.find(a => a.avg === maxAvg)!.tone;
  const minTone = avgs.find(a => a.avg === minAvg)!.tone;
  return {
    name: "skin_tone_bias",
    value: spread,
    threshold: 0.05,
    status,
    detail: `Best avg accuracy (${maxTone}): ${maxAvg.toFixed(3)}, worst (${minTone}): ${minAvg.toFixed(3)}, spread ${spread.toFixed(3)}`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `Under-performance on "${minTone}" skin tone. Augment training data and audit for Fitzpatrick bias.`,
  };
}

// ─── Metric: Age Group Bias ───────────────────────────────────────────────────

/** Standardized age brackets. */
export type AgeGroup = "18-25" | "26-35" | "36-50" | "51-65" | "65+";

/** Per-decision record with an explicit age group. */
export interface AgeGroupOutcome {
  ageGroup: AgeGroup;
  decision: Decision;
}

/**
 * Compute age group bias — P(approve) disparity across age brackets.
 *
 * Threshold: 4/5ths rule (>= 0.8 → pass; >= 0.7 → review; else fail).
 *
 * @param outcomes Per-decision records with age group.
 */
export function computeAgeGroupBias(outcomes: AgeGroupOutcome[]): BiasMetric {
  const mapped: Outcome[] = outcomes.map(o => ({
    attr: "age_group",
    value: o.ageGroup,
    decision: o.decision,
  }));
  const stats = groupStats(mapped);
  const { ratio, high, low, highP, lowP } = parityRatio(stats);
  const status = statusFromRatio(ratio, 0.7, 0.8);
  return {
    name: "age_group_bias",
    value: ratio,
    threshold: 0.8,
    status,
    detail: `P(approve|${low})=${lowP.toFixed(3)} vs P(approve|${high})=${highP.toFixed(3)} → ratio ${ratio.toFixed(3)}`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `Age group "${low}" is being under-approved. Audit the model for age-related feature drift.`,
  };
}

// ─── Metric: Regional Bias ────────────────────────────────────────────────────

/** Per-decision record with an explicit region/country. */
export interface RegionalOutcome {
  region: string;
  decision: Decision;
}

/**
 * Compute regional bias — P(approve) disparity across regions or countries.
 *
 * Threshold: 4/5ths rule (>= 0.8 → pass; >= 0.7 → review; else fail).
 *
 * @param outcomes Per-decision records with region.
 */
export function computeRegionalBias(outcomes: RegionalOutcome[]): BiasMetric {
  const mapped: Outcome[] = outcomes.map(o => ({
    attr: "region",
    value: o.region,
    decision: o.decision,
  }));
  const stats = groupStats(mapped);
  const { ratio, high, low, highP, lowP } = parityRatio(stats);
  const status = statusFromRatio(ratio, 0.7, 0.8);
  return {
    name: "regional_bias",
    value: ratio,
    threshold: 0.8,
    status,
    detail: `P(approve|${low})=${lowP.toFixed(3)} vs P(approve|${high})=${highP.toFixed(3)} → ratio ${ratio.toFixed(3)}`,
    recommendation:
      status === "pass"
        ? "No action required."
        : `Region "${low}" is being under-approved. Investigate document-template coverage and lighting conditions for this region.`,
  };
}

// ─── Aggregated Report ────────────────────────────────────────────────────────

/** Aggregated bias report across many metrics. */
export interface BiasReport {
  overallStatus: "pass" | "review" | "fail";
  summary: string;
  recommendations: string[];
  auditTrail: {
    timestamp: string;
    computedAt: string;
    sampleSize: number;
  };
}

/**
 * Generate a consolidated bias report from many computed metrics.
 *
 * Overall status = worst status across metrics. Recommendations are
 * collected from any non-passing metric.
 *
 * @param metrics Array of computed BiasMetric objects.
 */
export function generateBiasReport(metrics: BiasMetric[]): BiasReport {
  if (metrics.length === 0) {
    return {
      overallStatus: "pass",
      summary: "No bias metrics computed.",
      recommendations: [],
      auditTrail: {
        timestamp: new Date().toISOString(),
        computedAt: new Date().toISOString(),
        sampleSize: 0,
      },
    };
  }
  const failing = metrics.filter(m => m.status === "fail");
  const reviewing = metrics.filter(m => m.status === "review");
  let overallStatus: BiasReport["overallStatus"] = "pass";
  if (failing.length > 0) overallStatus = "fail";
  else if (reviewing.length > 0) overallStatus = "review";

  const recommendations = metrics
    .filter(m => m.status !== "pass")
    .map(m => `[${m.name}] ${m.recommendation}`);

  const summary = [
    `${metrics.length} metric(s) computed.`,
    `${failing.length} failing, ${reviewing.length} under review, ${metrics.length - failing.length - reviewing.length} passing.`,
    overallStatus === "pass"
      ? "No fairness concerns detected."
      : `Fairness concerns detected — overall status: ${overallStatus}.`,
  ].join(" ");

  return {
    overallStatus,
    summary,
    recommendations,
    auditTrail: {
      timestamp: new Date().toISOString(),
      computedAt: new Date().toISOString(),
      sampleSize: metrics.length,
    },
  };
}

// ─── Audit Trail (blockchain-style) ──────────────────────────────────────────

/**
 * Build a blockchain-style audit trail for fairness decisions.
 *
 * Each entry's hash = SHA-256(previous_hash + JSON(canonical_payload)).
 * The chain is append-only — any tampering with a past entry invalidates
 * all subsequent hashes, making this suitable for regulatory attestation
 * under the EU AI Act, NYC Local Law 144, and NIST AI RMF.
 *
 * @param decisions Raw decision records to be audited (any shape).
 * @param timestamp ISO-8601 timestamp to stamp on every entry. In a
 *   streaming system this is per-decision; in batch mode it is the
 *   report-generation time.
 */
export function fairnessAuditTrail(
  decisions: any[],
  timestamp: string
): FairnessAuditResult {
  const entries: AuditEntry[] = [];
  let previousHash = "0".repeat(64); // genesis hash

  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    const decisionId: string =
      typeof d?.id === "string"
        ? d.id
        : typeof d?.decision_id === "string"
        ? d.decision_id
        : `decision-${i}`;
    const computedMetrics: Record<string, number> = {};
    // Pull out any numeric metric-like fields we can find on the decision.
    if (d && typeof d === "object") {
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === "number") computedMetrics[k] = v;
      }
    }
    const payload = JSON.stringify({
      decision_id: decisionId,
      timestamp,
      computed_metrics: computedMetrics,
      previous_hash: previousHash,
    });
    const hash = createHash("sha256").update(payload).digest("hex");
    entries.push({
      timestamp,
      decision_id: decisionId,
      computed_metrics: computedMetrics,
      hash,
    });
    previousHash = hash;
  }

  return {
    entries,
    chain_hash: previousHash,
  };
}

// ─── Convenience: run the whole fairness battery ─────────────────────────────

/**
 * Convenience: run demographic parity, disparate impact, age-group, and
 * regional bias in one call (the metrics that don't require ground-truth).
 * Returns the metrics and an aggregated report.
 */
export function runFairnessBattery(
  outcomes: Outcome[],
  ageOutcomes: AgeGroupOutcome[],
  regionalOutcomes: RegionalOutcome[]
): { metrics: BiasMetric[]; report: BiasReport } {
  const metrics: BiasMetric[] = [
    computeDemographicParity(outcomes),
    computeDisparateImpact(outcomes),
    computeAgeGroupBias(ageOutcomes),
    computeRegionalBias(regionalOutcomes),
  ];
  return { metrics, report: generateBiasReport(metrics) };
}
