/**
 * Smoke test for Task 14-d endpoints.
 *
 * Verifies that:
 *   1. Each new route file exports POST, GET, OPTIONS handlers.
 *   2. The model-card endpoint returns version "3.0.0-outstanding".
 *   3. Each route handler accepts a properly-shaped request and returns
 *      a valid response.
 *
 * Run with: bun scripts/smoke-task-14d.ts
 */

import { IdentityGraph, type IdentityNode } from "@/lib/identity-graph";
import {
  computeDemographicParity,
  computeSkinToneBias,
  generateBiasReport,
  fairnessAuditTrail,
} from "@/lib/bias-detection";
import {
  detectDeepfake,
  detectScreenReplay,
  ensembleAdversarialDetection,
} from "@/lib/adversarial-detection";
import { fuseBiometrics, multimodalRiskScore } from "@/lib/multimodal-fusion";
import { ContinuousAuthEngine, DEFAULT_CONFIG } from "@/lib/continuous-auth";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Task 14-d Smoke Test ===\n");

// ─── 1. Identity Graph ───────────────────────────────────────────────
console.log("1. Identity Graph (src/lib/identity-graph.ts)");
{
  const graph = new IdentityGraph();
  const now = new Date().toISOString();
  const nodes: IdentityNode[] = [
    { id: "p1", type: "person", attributes: { name: "A" }, trustScore: 0.5, firstSeenAt: now, lastSeenAt: now },
    { id: "d1", type: "device", attributes: { fp: "x" }, trustScore: 0.4, firstSeenAt: now, lastSeenAt: now },
    { id: "p2", type: "person", attributes: { name: "B" }, trustScore: 0.3, firstSeenAt: now, lastSeenAt: now },
    { id: "p3", type: "person", attributes: { name: "C" }, trustScore: 0.25, firstSeenAt: now, lastSeenAt: now },
  ];
  for (const n of nodes) graph.addNode(n);
  graph.addEdge({ from: "p1", to: "d1", type: "shares_device", weight: 0.9, evidenceCount: 1, lastSeenAt: now });
  graph.addEdge({ from: "p2", to: "d1", type: "shares_device", weight: 0.85, evidenceCount: 1, lastSeenAt: now });
  graph.addEdge({ from: "p3", to: "d1", type: "shares_device", weight: 0.8, evidenceCount: 1, lastSeenAt: now });

  const cc = graph.findConnectedComponent("p1", 3);
  check("connected component includes p1/d1/p2/p3", cc.length === 4, `got ${cc.length}`);

  const rings = graph.detectFraudRings(3);
  check("fraud ring detected (size >= 3)", rings.length > 0 && rings[0].length >= 3, `rings=${rings.length}`);

  const trust = graph.computeTrustScore("p1");
  check("trust score has explanation", trust.explanation.length > 0);
  check("trust score in [0,1]", trust.score >= 0 && trust.score <= 1);

  const signals = graph.getRiskSignals("d1");
  check("risk signals include device_reuse", signals.some(s => s.signal === "device_reuse"));
}

// ─── 2. Bias Detection ───────────────────────────────────────────────
console.log("\n2. Bias Detection (src/lib/bias-detection.ts)");
{
  const outcomes = [
    { attr: "gender" as const, value: "male", decision: "approve" as const },
    { attr: "gender" as const, value: "male", decision: "approve" as const },
    { attr: "gender" as const, value: "female", decision: "approve" as const },
    { attr: "gender" as const, value: "female", decision: "reject" as const },
  ];
  const dp = computeDemographicParity(outcomes);
  check("demographic parity computed", dp.value >= 0 && dp.value <= 1);
  check("demographic parity has status", ["pass", "review", "fail"].includes(dp.status));

  const face = [
    { skinTone: "light" as const, matched: true, accuracy: 0.95 },
    { skinTone: "dark" as const, matched: false, accuracy: 0.78 },
  ];
  const stb = computeSkinToneBias(face);
  check("skin tone bias computed", stb.value >= 0 && stb.value <= 1);

  const report = generateBiasReport([dp, stb]);
  check("bias report has overallStatus", ["pass", "review", "fail"].includes(report.overallStatus));

  const trail = fairnessAuditTrail(outcomes, new Date().toISOString());
  check("audit trail has entries", trail.entries.length === 4);
  check("audit trail has chain_hash", trail.chain_hash.length === 64);
}

// ─── 3. Adversarial Detection ────────────────────────────────────────
console.log("\n3. Adversarial Detection (src/lib/adversarial-detection.ts)");
{
  const sig1 = detectDeepfake("data:image/jpeg;base64,abc", {
    frequencyAnalysis: [12, 8, 5, 3, 2, 1, 1, 0.5],
    colorHistogram: [200, 150, 80, 20, 5, 1, 1, 0.5],
  });
  check("detectDeepfake returns AdversarialSignal", sig1.attack_type === "deepfake");

  const sig2 = detectScreenReplay("data:image/jpeg;base64,abc", [12, 8, 5, 3, 2, 1, 1, 0.5]);
  check("detectScreenReplay returns signal", sig2.attack_type === "screen_replay");

  const verdict = ensembleAdversarialDetection([sig1, sig2]);
  check("ensemble verdict has recommendedAction", ["allow", "review", "reject"].includes(verdict.recommendedAction));
  check("ensemble verdict confidence in [0,1]", verdict.confidence >= 0 && verdict.confidence <= 1);
}

// ─── 4. Multimodal Fusion ─────────────────────────────────────────────
console.log("\n4. Multimodal Fusion (src/lib/multimodal-fusion.ts)");
{
  const result = fuseBiometrics({
    face: {
      faceMatchScore: 0.95,
      livenessScore: 0.92,
      faceQualityScore: 0.9,
      landmarkConsistency: 0.95,
      eyeAspectRatio: 0.3,
      blinkDetected: 1,
      headPoseStability: 0.9,
      expressionNaturalness: 0.85,
    },
    document: {
      ocrConfidence: 0.92,
      mrzValid: 1,
      crossFieldPassRate: 0.95,
      tamperingScore: 0.9,
      securityFeatureCount: 4,
      documentAge: 365,
      fontConsistency: 0.95,
    },
  });
  check("fuseBiometrics returns fusedScore in [0,1]", result.fusedScore >= 0 && result.fusedScore <= 1);
  check("fuseBiometrics returns decision", ["approve", "review", "reject"].includes(result.decision));
  check("fuseBiometrics returns reasoning string", result.reasoning.length > 0);

  const risk = multimodalRiskScore({
    fusedScore: result.fusedScore,
    modalityBreakdown: result.modalityBreakdown,
    conflict: result.conflict,
  });
  check("multimodalRiskScore returns riskLevel", ["low", "medium", "high", "critical"].includes(risk.riskLevel));
}

// ─── 5. Continuous Auth ────────────────────────────────────────────────
console.log("\n5. Continuous Auth (src/lib/continuous-auth.ts)");
{
  const engine = new ContinuousAuthEngine(DEFAULT_CONFIG);
  const session = engine.startSession("user-123", 0.95);
  check("startSession returns sessionId", session.sessionId.startsWith("cas_"));
  check("startSession returns startedAt (ISO)", !Number.isNaN(Date.parse(session.startedAt)));

  // Record 5 bad signals (drift 0.35 each) → should trigger reverify.
  for (let i = 0; i < 5; i++) {
    engine.recordSignal(session.sessionId, {
      timestamp: new Date(Date.now() + i * 1000).toISOString(),
      type: "face",
      value: 0.6,
      drift: 0.35,
      detail: `face crop ${i}`,
    });
  }
  const drift = engine.computeDrift(session.sessionId);
  check("computeDrift returns EMA drift in [0,1]", drift.drift >= 0 && drift.drift <= 1);
  check("drift crosses threshold (>=0.15)", drift.drift >= 0.15, `drift=${drift.drift.toFixed(3)}`);

  const decision = engine.shouldReverify(session.sessionId);
  check("shouldReverify says should=true", decision.should === true);

  const trail = engine.exportAuditTrail(session.sessionId);
  check("exportAuditTrail has entries", trail.entries.length > 0);
  check("exportAuditTrail has SHA-256 hash", trail.hash.length === 64);
}

// ─── 6. Synthetic Data endpoint (in-process call) ────────────────────
console.log("\n6. Synthetic Data (route handlers in-process)");
{
  // We can't run Next.js routes directly, but we can sanity-check the
  // route module is exported by importing it.
  const mod = await import("../src/app/api/v1/verify/synthetic-data/route.ts");
  check("synthetic-data route exports POST", typeof mod.POST === "function");
  check("synthetic-data route exports GET", typeof mod.GET === "function");
  check("synthetic-data route exports OPTIONS", typeof mod.OPTIONS === "function");
}

// ─── 7. Model Card v3 (route module exports) ──────────────────────────
console.log("\n7. Model Card v3 (route module exports + version field)");
{
  const mod = await import("../src/app/api/v1/verify/model-card/route.ts");
  check("model-card route exports GET", typeof mod.GET === "function");
  check("model-card route exports OPTIONS", typeof mod.OPTIONS === "function");
  check("model-card route exports runtime='nodejs'", mod.runtime === "nodejs");

  // Invoke the GET handler — it returns a NextResponse.
  const res = await mod.GET();
  const json = await res.json();
  check("model-card returns version '3.0.0-outstanding'", json.version === "3.0.0-outstanding", `got '${json.version}'`);
  check("model-card has differentiators[]", Array.isArray(json.differentiators) && json.differentiators.length >= 10);
  check("model-card has competitor_comparison", typeof json.competitor_comparison === "object");
  check("competitor_comparison includes cirkle+onfido+jumio+veriff+sumsub",
    ["cirkle", "onfido", "jumio", "veriff", "sumsub"].every(k => k in json.competitor_comparison));
  check("model-card capabilities has identityGraph", typeof json.capabilities.identityGraph === "object");
  check("model-card capabilities has biasDetection", typeof json.capabilities.biasDetection === "object");
  check("model-card capabilities has adversarialDetection", typeof json.capabilities.adversarialDetection === "object");
  check("model-card capabilities has multimodalFusion", typeof json.capabilities.multimodalFusion === "object");
  check("model-card capabilities has continuousAuthentication", typeof json.capabilities.continuousAuthentication === "object");
  check("model-card capabilities has syntheticData", typeof json.capabilities.syntheticData === "object");
  check("model-card training_data_summary.total_datasets === 92", json.training_data_summary.total_datasets === 92, `got ${json.training_data_summary.total_datasets}`);
  check("model-card training_data_summary has 9 categories", Array.isArray(json.training_data_summary.categories) && json.training_data_summary.categories.length === 9);
  check("model-card training_data_summary.total_size_gb === 656", json.training_data_summary.total_size_gb === 656);
  check("model-card knowledgeBase has 132 doc specs", json.knowledgeBase.documentSpecs.includes("132 specs"));
  check("model-card knowledgeBase has 54 ID validators", json.knowledgeBase.idValidators.includes("54 countries"));
  check("model-card knowledgeBase nameDictionary total = 990", json.knowledgeBase.nameDictionary.total === 990);
  check("model-card evaluation_results has identity_graph_fraud_detection_rate", typeof json.evaluation_results.identity_graph_fraud_detection_rate === "number");
  check("model-card evaluation_results has adversarial_detection_accuracy", typeof json.evaluation_results.adversarial_detection_accuracy === "number");
  check("model-card evaluation_results has multimodal_fusion_accuracy", typeof json.evaluation_results.multimodal_fusion_accuracy === "number");
  check("model-card evaluation_results has continuous_auth_attack_detection_rate", typeof json.evaluation_results.continuous_auth_attack_detection_rate === "number");
  check("model-card components has identityGraph", typeof json.components.identityGraph === "object");
  check("model-card components has syntheticData", typeof json.components.syntheticData === "object");
}

// ─── 8. Route module exports for all 6 new endpoints ─────────────────
console.log("\n8. All 6 new endpoints export POST + GET + OPTIONS");
{
  const routes = [
    "../src/app/api/v1/verify/identity-graph/route.ts",
    "../src/app/api/v1/verify/bias-report/route.ts",
    "../src/app/api/v1/verify/adversarial-detection/route.ts",
    "../src/app/api/v1/verify/multimodal-fusion/route.ts",
    "../src/app/api/v1/verify/continuous-auth/route.ts",
    "../src/app/api/v1/verify/synthetic-data/route.ts",
  ];
  for (const path of routes) {
    const mod = await import(path);
    const name = path.split("/").slice(-2, -1)[0];
    check(`${name}/route.ts exports POST`, typeof mod.POST === "function");
    check(`${name}/route.ts exports GET`, typeof mod.GET === "function");
    check(`${name}/route.ts exports OPTIONS`, typeof mod.OPTIONS === "function");
    check(`${name}/route.ts has runtime='nodejs'`, mod.runtime === "nodejs");
    check(`${name}/route.ts has maxDuration=30`, mod.maxDuration === 30);
  }
}

// ─── 9. OPTIONS handlers return 204 ──────────────────────────────────
console.log("\n9. OPTIONS handlers return 204 No Content");
{
  const routes = [
    "../src/app/api/v1/verify/identity-graph/route.ts",
    "../src/app/api/v1/verify/bias-report/route.ts",
    "../src/app/api/v1/verify/adversarial-detection/route.ts",
    "../src/app/api/v1/verify/multimodal-fusion/route.ts",
    "../src/app/api/v1/verify/continuous-auth/route.ts",
    "../src/app/api/v1/verify/synthetic-data/route.ts",
    "../src/app/api/v1/verify/model-card/route.ts",
  ];
  for (const path of routes) {
    const mod = await import(path);
    const name = path.split("/").slice(-2, -1)[0];
    const res = await mod.OPTIONS();
    check(`${name} OPTIONS returns 204`, res.status === 204, `got ${res.status}`);
    check(`${name} OPTIONS has CORS Allow-Origin *`, res.headers.get("access-control-allow-origin") === "*");
  }
}

// ─── 10. Synthetic-data endpoint actually generates records ──────────
console.log("\n10. Synthetic-data endpoint POST actually generates records");
{
  const mod = await import("../src/app/api/v1/verify/synthetic-data/route.ts");
  // Build a minimal NextRequest-like object.
  const payload = { type: "identity", count: 5, seed: 42 };
  const req = new Request("https://test.local/api/v1/verify/synthetic-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  // Bun's Request is compatible with Next.js NextRequest for our handlers.
  const res = await mod.POST(req as any);
  check("synthetic-data POST returns 200", res.status === 200, `got ${res.status}`);
  const json = await res.json();
  check("synthetic-data returns count=5", json.count === 5);
  check("synthetic-data records array has 5 entries", Array.isArray(json.records) && json.records.length === 5);
  check("synthetic-data records[0] has national_id", typeof json.records[0].national_id === "string");
  check("synthetic-data records[0] has name_latin", typeof json.records[0].name_latin === "string");
  check("synthetic-data records[0] has country_alpha3", typeof json.records[0].country_alpha3 === "string");
}

console.log(`\n=== Summary: ${pass} pass, ${fail} fail ===`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
