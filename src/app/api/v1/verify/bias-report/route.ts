import { NextRequest, NextResponse } from "next/server";
import {
  computeDemographicParity,
  computeEqualOpportunity,
  computeDisparateImpact,
  computeEqualizedOdds,
  computeSkinToneBias,
  computeAgeGroupBias,
  computeRegionalBias,
  generateBiasReport,
  fairnessAuditTrail,
  type Outcome,
  type LabeledOutcome,
  type BiasMetric,
  type BiasReport,
  type SkinToneRecord,
  type AgeGroupOutcome,
  type RegionalOutcome,
  type FairnessAuditResult,
} from "@/lib/bias-detection";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — bias-report endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/bias-report
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Bias Report API request payload.
 *
 * Outcomes must be per-decision records with a protected-attribute value
 * (gender, age_group, nationality, skin_tone, or region) and a decision
 * (approve / reject / review). Optional ground-truth labels enable
 * equal-opportunity and equalized-odds metrics; optional skin-tone,
 * age-group, and regional record arrays enable those specific metrics.
 */
interface BiasReportRequest {
  /** Per-decision outcome records with group value + decision. */
  outcomes: Outcome[];
  /** Optional parallel array of legitimate/fraudulent labels (for TPR/FPR metrics). */
  ground_truth_labels?: LabeledOutcome[];
  /** Optional skin-tone records (enables skin_tone_bias metric). */
  skin_tone_records?: SkinToneRecord[];
  /** Optional age-group outcomes (enables age_group_bias metric). */
  age_group_outcomes?: AgeGroupOutcome[];
  /** Optional regional outcomes (enables regional_bias metric). */
  regional_outcomes?: RegionalOutcome[];
}

/**
 * Bias Report API response payload.
 */
interface BiasReportResponse {
  demographicParity: BiasMetric;
  equalOpportunity: BiasMetric;
  disparateImpact: BiasMetric;
  equalizedOdds: BiasMetric;
  skinToneBias?: BiasMetric;
  ageGroupBias?: BiasMetric;
  regionalBias?: BiasMetric;
  report: BiasReport;
  auditTrail: FairnessAuditResult;
  /** ISO-8601 timestamp of computation. */
  computedAt: string;
}

/**
 * POST /api/v1/verify/bias-report
 *
 * Runtime fairness & bias detection. Accepts per-decision outcomes with
 * protected-attribute values (gender, age group, nationality, skin tone,
 * region) and optional ground-truth labels, then computes:
 *
 *   - **Demographic parity** — P(approve|A) vs P(approve|B) ratio (4/5ths rule)
 *   - **Equal opportunity** — TPR parity across groups
 *   - **Disparate impact** — EEOC 4/5ths rule, two-sided 0.8..1.25 band
 *   - **Equalized odds** — TPR + FPR parity (ΔTPR/ΔFPR <= 0.1)
 *   - **Skin tone bias** — Fitzpatrick scale accuracy disparity (the exact
 *     metric Onfido was investigated for in 2020)
 *   - **Age group bias** — P(approve) across age brackets
 *   - **Regional bias** — P(approve) across regions/countries
 *
 * Plus an aggregated BiasReport (overallStatus + recommendations) and an
 * SHA-256 chained audit trail for regulatory attestation under the EU AI
 * Act (2024), NYC Local Law 144, and NIST AI RMF.
 *
 * ## Competitor gap
 *
 * Onfido, Jumio, Veriff, and Sumsub do not ship runtime fairness telemetry.
 * In 2020 Onfido was formally investigated for racial bias in its face
 * matcher — there was no way for customers to detect or audit the bias.
 * Cirkle exposes a real-time fairness API that produces regulator-grade
 * audit trails on demand.
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/bias-report \
 *   -H "Content-Type: application/json" \
 *   -d '{"outcomes":[{"attr":"gender","value":"male","decision":"approve"},{"attr":"gender","value":"female","decision":"approve"}]}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as BiasReportRequest;

    if (!body || !Array.isArray(body.outcomes)) {
      return NextResponse.json(
        { error: "outcomes (array) is required", code: "INVALID_INPUT" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (body.outcomes.length > 100_000) {
      return NextResponse.json(
        { error: "Max 100,000 outcomes per request", code: "TOO_MANY_OUTCOMES" },
        { status: 413, headers: CORS_HEADERS },
      );
    }

    const metrics: BiasMetric[] = [];

    // ─── Core metrics (always computed) ─────────────────────────────
    const demographicParity = computeDemographicParity(body.outcomes);
    const disparateImpact = computeDisparateImpact(body.outcomes);
    metrics.push(demographicParity, disparateImpact);

    // Equal opportunity + equalized odds require ground-truth labels.
    let equalOpportunity: BiasMetric;
    let equalizedOdds: BiasMetric;
    if (
      Array.isArray(body.ground_truth_labels) &&
      body.ground_truth_labels.length === body.outcomes.length
    ) {
      equalOpportunity = computeEqualOpportunity(body.outcomes, body.ground_truth_labels);
      equalizedOdds = computeEqualizedOdds(body.outcomes, body.ground_truth_labels);
    } else {
      equalOpportunity = {
        name: "equal_opportunity",
        value: 0,
        threshold: 0.8,
        status: "fail",
        detail:
          "Ground-truth labels missing or mismatched length — cannot compute TPR parity.",
        recommendation:
          "Provide a parallel ground_truth_labels array (one label per outcome) to enable equal-opportunity measurement.",
      };
      equalizedOdds = {
        name: "equalized_odds",
        value: 0,
        threshold: 0.1,
        status: "fail",
        detail:
          "Ground-truth labels missing or mismatched length — cannot compute TPR/FPR parity.",
        recommendation:
          "Provide a parallel ground_truth_labels array (one label per outcome) to enable equalized-odds measurement.",
      };
    }
    metrics.push(equalOpportunity, equalizedOdds);

    // ─── Optional metrics ────────────────────────────────────────────
    let skinToneBias: BiasMetric | undefined;
    if (Array.isArray(body.skin_tone_records) && body.skin_tone_records.length > 0) {
      skinToneBias = computeSkinToneBias(body.skin_tone_records);
      metrics.push(skinToneBias);
    }

    let ageGroupBias: BiasMetric | undefined;
    if (Array.isArray(body.age_group_outcomes) && body.age_group_outcomes.length > 0) {
      ageGroupBias = computeAgeGroupBias(body.age_group_outcomes);
      metrics.push(ageGroupBias);
    }

    let regionalBias: BiasMetric | undefined;
    if (Array.isArray(body.regional_outcomes) && body.regional_outcomes.length > 0) {
      regionalBias = computeRegionalBias(body.regional_outcomes);
      metrics.push(regionalBias);
    }

    // ─── Aggregated report ──────────────────────────────────────────
    const report = generateBiasReport(metrics);

    // ─── SHA-256 chained audit trail ───────────────────────────────
    const auditTrail = fairnessAuditTrail(
      body.outcomes,
      new Date().toISOString(),
    );

    const response: BiasReportResponse = {
      demographicParity,
      equalOpportunity,
      disparateImpact,
      equalizedOdds,
      skinToneBias,
      ageGroupBias,
      regionalBias,
      report,
      auditTrail,
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "bias report computation failed",
        code: "BIAS_REPORT_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/bias-report
 *
 * Returns API documentation and the fairness-criteria thresholds used
 * by every metric.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "Bias Detection & Fairness Metrics API",
      version: "1.0.0",
      description:
        "Runtime fairness telemetry for identity verification. Computes demographic parity, equal opportunity, disparate impact, equalized odds, skin-tone bias (Fitzpatrick scale), age-group bias, and regional bias. Emits an aggregated report and an SHA-256 chained audit trail for regulatory attestation under the EU AI Act (2024), NYC Local Law 144, and NIST AI RMF.",
      competitiveAdvantage:
        "Onfido, Jumio, Veriff, Sumsub do not ship runtime fairness telemetry. In 2020 Onfido was formally investigated for racial bias in its face matcher; there was no way for customers to detect or audit the bias. Cirkle exposes a real-time fairness API producing regulator-grade audit trails on demand.",
      endpoints: {
        POST: "Submit outcomes + optional ground-truth labels, receive all bias metrics + audit trail.",
        GET: "This documentation + fairness thresholds.",
        OPTIONS: "CORS preflight (204 No Content).",
      },
      fairnessCriteria: {
        demographic_parity: {
          threshold: "ratio >= 0.80 (4/5ths rule)",
          pass: ">= 0.80",
          review: "0.70 - 0.80",
          fail: "< 0.70",
        },
        equal_opportunity: {
          threshold: "TPR ratio across groups >= 0.80",
          pass: ">= 0.80",
          review: "0.70 - 0.80",
          fail: "< 0.70",
        },
        disparate_impact: {
          threshold: "0.80 <= DI <= 1.25 (EEOC 4/5ths rule, two-sided)",
          pass: "0.80 - 1.25",
          review: "0.70 - 0.80 or 1.25 - 1.43",
          fail: "< 0.70 or > 1.43",
        },
        equalized_odds: {
          threshold: "max(ΔTPR, ΔFPR) <= 0.10",
          pass: "<= 0.10",
          review: "0.10 - 0.20",
          fail: "> 0.20",
        },
        skin_tone_bias: {
          threshold: "max - min accuracy across Fitzpatrick tones <= 0.05",
          pass: "<= 0.05",
          review: "0.05 - 0.10",
          fail: "> 0.10",
        },
        age_group_bias: {
          threshold: "ratio >= 0.80 (4/5ths rule)",
          pass: ">= 0.80",
          review: "0.70 - 0.80",
          fail: "< 0.70",
        },
        regional_bias: {
          threshold: "ratio >= 0.80 (4/5ths rule)",
          pass: ">= 0.80",
          review: "0.70 - 0.80",
          fail: "< 0.70",
        },
      },
      protectedAttributes: ["gender", "age_group", "nationality", "skin_tone", "region"],
      decisions: ["approve", "reject", "review"],
      auditTrail: {
        algorithm: "SHA-256(prev_hash || canonical_payload) — chained, append-only",
        regulatorySupport: ["EU AI Act (2024)", "NYC Local Law 144", "NIST AI RMF", "SOC 2 Type II"],
      },
      examplePayload: {
        outcomes: [
          { attr: "gender", value: "male", decision: "approve" },
          { attr: "gender", value: "male", decision: "approve" },
          { attr: "gender", value: "female", decision: "approve" },
          { attr: "gender", value: "female", decision: "reject" },
        ],
        ground_truth_labels: [
          { attr: "gender", value: "male", decision: "approve", legitimate: true },
          { attr: "gender", value: "male", decision: "approve", legitimate: true },
          { attr: "gender", value: "female", decision: "approve", legitimate: true },
          { attr: "gender", value: "female", decision: "reject", legitimate: false },
        ],
        skin_tone_records: [
          { skinTone: "light", matched: true, accuracy: 0.95 },
          { skinTone: "dark", matched: false, accuracy: 0.78 },
        ],
        age_group_outcomes: [
          { ageGroup: "18-25", decision: "approve" },
          { ageGroup: "65+", decision: "reject" },
        ],
        regional_outcomes: [
          { region: "MENA", decision: "approve" },
          { region: "SSA", decision: "reject" },
        ],
      },
    },
    { headers: CORS_HEADERS },
  );
}
