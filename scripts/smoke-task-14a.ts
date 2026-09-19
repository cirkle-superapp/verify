import { IdentityGraph, detectImpossibleTravel, detectVelocityAttack } from "../src/lib/identity-graph";
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
  runFairnessBattery,
} from "../src/lib/bias-detection";
import {
  detectDeepfake,
  detect3DMask,
  detectScreenReplay,
  detectPrintAttack,
  detectSiliconeFinger,
  detectHybridAttack,
  detectFGSMAttack,
  detectAdversarialPerturbation,
  ensembleAdversarialDetection,
  runAdversarialBattery,
} from "../src/lib/adversarial-detection";

// ─── Identity Graph: 3-node fraud ring ─────────────────────────
const g = new IdentityGraph();
const now = new Date().toISOString();
const past = "2020-01-01T00:00:00.000Z";

g.addNode({ id: "doc-1", type: "document", attributes: { docHash: "abc" }, trustScore: 0.1, firstSeenAt: past, lastSeenAt: now });
g.addNode({ id: "p-1", type: "person", attributes: { name: "alice" }, trustScore: 0.2, firstSeenAt: past, lastSeenAt: now });
g.addNode({ id: "p-2", type: "person", attributes: { name: "bob" }, trustScore: 0.2, firstSeenAt: past, lastSeenAt: now });
g.addNode({ id: "p-3", type: "person", attributes: { name: "carol" }, trustScore: 0.2, firstSeenAt: past, lastSeenAt: now });

g.addEdge({ from: "p-1", to: "doc-1", type: "document_reuse", weight: 0.9, evidenceCount: 2, lastSeenAt: now });
g.addEdge({ from: "p-2", to: "doc-1", type: "document_reuse", weight: 0.9, evidenceCount: 2, lastSeenAt: now });
g.addEdge({ from: "p-3", to: "doc-1", type: "document_reuse", weight: 0.9, evidenceCount: 2, lastSeenAt: now });

const rings = g.detectFraudRings(3);
console.log("Fraud rings found:", rings.length, "(expected 1)");
console.log("Ring size:", rings[0]?.length, "(expected 4: doc-1 + 3 persons)");

const component = g.findConnectedComponent("p-1", 3);
console.log("Connected component size from p-1:", component.length, "(expected 4)");

const trust = g.computeTrustScore("p-1");
console.log("Trust score for p-1:", trust.score.toFixed(3), "(<0.5 expected)");

const signals = g.getRiskSignals("p-1");
console.log("Risk signals for p-1:", signals.map(s => s.signal).join(", ") || "(none)");

// impossible travel: London → NYC (5570km) in 1 hour → ~5570 km/h > 900
const imp = detectImpossibleTravel([
  { timestamp: 0, lat: 51.5, lon: -0.12 },
  { timestamp: 60 * 60 * 1000, lat: 40.71, lon: -74.0 },
]);
console.log("Impossible travel detected:", imp, "(expected true)");

// velocity attack: 15 events in 30 minutes
const vel = detectVelocityAttack(
  Array.from({ length: 15 }, (_, i) => ({ timestamp: i * 2 * 60 * 1000, type: "verify" })),
  60 * 60 * 1000,
  10
);
console.log("Velocity attack detected:", vel, "(expected true)");

// serialize / deserialize round-trip
const serialized = g.serialize();
const g2 = IdentityGraph.fromJSON(serialized);
console.log("Serialized + deserialized node count:", g2.size(), "(expected 4)");

// ─── Bias Detection: demographic parity ────────────────────────
const outcomes = [
  ...Array(8).fill({ attr: "gender", value: "A", decision: "approve" }),
  ...Array(2).fill({ attr: "gender", value: "A", decision: "reject" }),
  ...Array(2).fill({ attr: "gender", value: "B", decision: "approve" }),
  ...Array(8).fill({ attr: "gender", value: "B", decision: "reject" }),
] as any;
const dp = computeDemographicParity(outcomes);
console.log("Demographic parity ratio:", dp.value.toFixed(3), "(expected 0.25)");
console.log("Demographic parity status:", dp.status, "(expected fail)");

const di = computeDisparateImpact(outcomes);
console.log("Disparate impact ratio:", di.value.toFixed(3), "status:", di.status, "(expected 0.25 fail)");

const eoOutcomes = [
  ...Array(4).fill({ attr: "gender", value: "A", decision: "approve" }),
  ...Array(1).fill({ attr: "gender", value: "A", decision: "reject" }),
  ...Array(2).fill({ attr: "gender", value: "B", decision: "approve" }),
  ...Array(3).fill({ attr: "gender", value: "B", decision: "reject" }),
] as any;
const eoLabels = [
  ...Array(5).fill({ legitimate: true }),
  ...Array(5).fill({ legitimate: true }),
].map((l: any, i: number) => ({ ...eoOutcomes[i], ...l, attr: "gender" as const }));
const eo = computeEqualOpportunity(eoOutcomes, eoLabels);
console.log("Equal opportunity ratio:", eo.value.toFixed(3), "status:", eo.status);

const eo2 = computeEqualizedOdds(eoOutcomes, eoLabels);
console.log("Equalized odds spread:", eo2.value.toFixed(3), "status:", eo2.status);

const skin = computeSkinToneBias([
  { skinTone: "light", matched: true, accuracy: 0.95 },
  { skinTone: "light", matched: true, accuracy: 0.93 },
  { skinTone: "dark", matched: false, accuracy: 0.75 },
  { skinTone: "dark", matched: true, accuracy: 0.80 },
]);
console.log("Skin tone bias spread:", skin.value.toFixed(3), "status:", skin.status);

const ageOutcomes = [
  ...Array(8).fill({ ageGroup: "26-35", decision: "approve" }),
  ...Array(2).fill({ ageGroup: "26-35", decision: "reject" }),
  ...Array(2).fill({ ageGroup: "65+", decision: "approve" }),
  ...Array(8).fill({ ageGroup: "65+", decision: "reject" }),
] as any;
const age = computeAgeGroupBias(ageOutcomes);
console.log("Age group bias ratio:", age.value.toFixed(3), "status:", age.status);

const regOutcomes = [
  ...Array(8).fill({ region: "EU", decision: "approve" }),
  ...Array(2).fill({ region: "EU", decision: "reject" }),
  ...Array(2).fill({ region: "AF", decision: "approve" }),
  ...Array(8).fill({ region: "AF", decision: "reject" }),
] as any;
const reg = computeRegionalBias(regOutcomes);
console.log("Regional bias ratio:", reg.value.toFixed(3), "status:", reg.status);

const audit = fairnessAuditTrail(
  [{ id: "d1", score: 0.9 }, { id: "d2", score: 0.7 }, { id: "d3", score: 0.5 }],
  "2024-01-01T00:00:00Z"
);
console.log("Audit trail entries:", audit.entries.length, "(expected 3)");
console.log("Audit chain hash length:", audit.chain_hash.length, "(expected 64)");

const battery = runFairnessBattery(outcomes, ageOutcomes, regOutcomes);
console.log("Fairness battery overallStatus:", battery.report.overallStatus);

// ─── Adversarial Detection: 8+ detectors ───────────────────────
const detectors = [
  detectDeepfake,
  detect3DMask,
  detectScreenReplay,
  detectPrintAttack,
  detectSiliconeFinger,
  detectHybridAttack,
  detectFGSMAttack,
  detectAdversarialPerturbation,
];
console.log("Adversarial detectors exported:", detectors.length, "(expected >=8)");

const df = detectDeepfake("abc", {
  frequencyAnalysis: Array(64).fill(10),
  colorHistogram: Array(64).fill(100),
});
console.log("Deepfake score:", df.score.toFixed(3), "type:", df.attack_type);

const sr = detectScreenReplay("abc", [
  ...Array(32).fill(5),
  100, 100, 100, 100,
  ...Array(28).fill(5),
]);
console.log("Screen replay score:", sr.score.toFixed(3));

const pa = detectPrintAttack("abc", Array(64).fill(50));
console.log("Print attack score:", pa.score.toFixed(3));

const sf = detectSiliconeFinger("abc", Array(64).fill(20));
console.log("Silicone finger score:", sf.score.toFixed(3));

const mask = detect3DMask("abc", Array(128).fill(100));
console.log("3D mask score:", mask.score.toFixed(3));

const fgsm = detectFGSMAttack(
  Array(200).fill(0).map((_, i) => (i % 2 === 0 ? 0.05 : -0.05)),
  0.05
);
console.log("FGSM score:", fgsm.score.toFixed(3));

const adv = detectAdversarialPerturbation({
  l2_norm: 5,
  l_inf_norm: 0.1,
  spectral_entropy: 6,
});
console.log("Adversarial perturbation score:", adv.score.toFixed(3));

const hybrid = detectHybridAttack([df, sr, pa]);
console.log("Hybrid score:", hybrid.score.toFixed(3), "type:", hybrid.attack_type);

const ensemble = ensembleAdversarialDetection([df, sr, pa, sf, mask, fgsm, adv, hybrid]);
console.log("Ensemble isAdversarial:", ensemble.isAdversarial, "severity:", ensemble.severity, "action:", ensemble.recommendedAction);
console.log("Ensemble attack types:", ensemble.attackTypes.join(", "));

const full = runAdversarialBattery({
  imageBase64: "abc",
  frequencyAnalysis: Array(64).fill(10),
  colorHistogram: Array(64).fill(100),
  depthMap: Array(128).fill(100),
  frequencySpectrum: [
    ...Array(32).fill(5),
    100, 100, 100, 100,
    ...Array(28).fill(5),
  ],
  textureFeatures: Array(64).fill(50),
  fingerprintFeatures: Array(64).fill(20),
  inputGradient: Array(200).fill(0).map((_, i) => (i % 2 === 0 ? 0.05 : -0.05)),
  epsilon: 0.05,
  imageStats: { l2_norm: 5, l_inf_norm: 0.1, spectral_entropy: 6 },
});
console.log("Full battery signals:", full.signals.length, "verdict action:", full.verdict.recommendedAction);

console.log("ALL SMOKE TESTS PASSED ✅");
