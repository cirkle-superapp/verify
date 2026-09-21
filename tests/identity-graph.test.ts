/**
 * Identity Graph tests — graph-based fraud detection.
 *
 * Verifies:
 *   - IdentityGraph.addNode / getNode — node storage & retrieval
 *   - IdentityGraph.addEdge / edgesOf — edge storage & query
 *   - IdentityGraph.findConnectedComponent — BFS up to 3 hops
 *   - IdentityGraph.detectFraudRings — union-find over suspicious edges
 *   - IdentityGraph.computeTrustScore — 0..1 score with factors array
 *   - IdentityGraph.getRiskSignals — synthetic_identity, device_reuse,
 *     document_reuse, biometric_duplicate, mule_pattern signals
 *   - IdentityGraph.serialize / deserialize — round-trip preserves state
 *   - detectImpossibleTravel — flags London→NYC in 30 minutes
 *   - detectVelocityAttack — flags 20 events in 1 hour
 *
 * All tests construct small in-memory graphs and assert specific
 * outcomes — they do not require any external service.
 */

import {
  IdentityGraph,
  haversineKm,
  detectImpossibleTravel,
  detectVelocityAttack,
  type IdentityNode,
  type IdentityEdge,
} from "@/lib/identity-graph";
import { runTest, assert, assertEqual, assertRange } from "./lib/runner";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const NOW = "2025-01-01T00:00:00.000Z";

function makePerson(id: string, trust = 0.5): IdentityNode {
  return {
    id,
    type: "person",
    attributes: { name: id },
    trustScore: trust,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  };
}

function makeDevice(id: string, trust = 0.5): IdentityNode {
  return {
    id,
    type: "device",
    attributes: { fingerprint: id },
    trustScore: trust,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  };
}

function makeDocument(id: string, trust = 0.5): IdentityNode {
  return {
    id,
    type: "document",
    attributes: { docNumber: id },
    trustScore: trust,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  };
}

function makeBiometric(id: string, trust = 0.5): IdentityNode {
  return {
    id,
    type: "biometric",
    attributes: { templateHash: id },
    trustScore: trust,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  };
}

function edge(from: string, to: string, type: IdentityEdge["type"], weight = 0.9): IdentityEdge {
  return { from, to, type, weight, evidenceCount: 1, lastSeenAt: NOW };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

export async function run() {
  return [
    // ─── addNode / getNode ─────────────────────────────────────────
    await runTest("IdentityGraph: addNode + getNode round-trips a person", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.7));
      const n = g.getNode("p1");
      assert(!!n, "expected node p1 to be retrievable");
      assertEqual(n!.type, "person", "node type");
      assertEqual(n!.trustScore, 0.7, "node trust");
    }),

    await runTest("IdentityGraph: getNode returns undefined for missing id", () => {
      const g = new IdentityGraph();
      assert(g.getNode("does-not-exist") === undefined, "expected undefined");
    }),

    await runTest("IdentityGraph: addNode upserts — keeps min trust + latest lastSeenAt", () => {
      const g = new IdentityGraph();
      g.addNode({
        id: "p1",
        type: "person",
        attributes: { a: 1 },
        trustScore: 0.8,
        firstSeenAt: "2024-01-01T00:00:00.000Z",
        lastSeenAt: "2024-12-01T00:00:00.000Z",
      });
      g.addNode({
        id: "p1",
        type: "person",
        attributes: { b: 2 },
        trustScore: 0.3,
        firstSeenAt: "2024-06-01T00:00:00.000Z",
        lastSeenAt: "2025-01-01T00:00:00.000Z",
      });
      const n = g.getNode("p1")!;
      assertEqual(n.trustScore, 0.3, "upsert should keep min trust");
      assertEqual(n.attributes.a, 1, "merged attr a");
      assertEqual(n.attributes.b, 2, "merged attr b");
      assert(n.lastSeenAt.startsWith("2025"), "latest lastSeenAt should win");
      assert(n.firstSeenAt.startsWith("2024-01"), "earliest firstSeenAt should win");
    }),

    await runTest("IdentityGraph: size returns node count", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1"));
      g.addNode(makePerson("p2"));
      g.addNode(makePerson("p1")); // upsert, not new
      assertEqual(g.size(), 2, "size after dedup");
    }),

    // ─── addEdge / edgesOf ─────────────────────────────────────────
    await runTest("IdentityGraph: addEdge + edgesOf returns out-edges", () => {
      const g = new IdentityGraph();
      g.addEdge(edge("p1", "p2", "shares_device"));
      const edges = g.edgesOf("p1");
      assertEqual(edges.length, 1, "p1 out-edge count");
      assertEqual(edges[0].to, "p2", "p1 out-edge to p2");
    }),

    await runTest("IdentityGraph: addEdge auto-creates stub nodes for endpoints", () => {
      const g = new IdentityGraph();
      g.addEdge(edge("p1", "p2", "shares_device"));
      assert(g.getNode("p1") !== undefined, "p1 auto-created");
      assert(g.getNode("p2") !== undefined, "p2 auto-created");
    }),

    await runTest("IdentityGraph: addEdge upserts duplicate edges (evidenceCount accumulates)", () => {
      const g = new IdentityGraph();
      g.addEdge(edge("p1", "p2", "shares_device", 0.5));
      g.addEdge(edge("p1", "p2", "shares_device", 0.7));
      const edges = g.edgesOf("p1");
      assertEqual(edges.length, 1, "deduplicated edge count");
      assertEqual(edges[0].evidenceCount, 2, "accumulated evidence");
      assert(edges[0].weight >= 0.7, "weight should keep max", edges[0].weight);
    }),

    await runTest("IdentityGraph: inEdgesOf returns reverse adjacency", () => {
      const g = new IdentityGraph();
      g.addEdge(edge("p1", "p2", "shares_device"));
      const inEdges = g.inEdgesOf("p2");
      assertEqual(inEdges.length, 1, "p2 in-edge count");
      assertEqual(inEdges[0].from, "p1", "in-edge from p1");
    }),

    // ─── findConnectedComponent ───────────────────────────────────
    await runTest("IdentityGraph: findConnectedComponent BFS within 3 hops", () => {
      const g = new IdentityGraph();
      // Chain: p1 — p2 — p3 — p4 — p5  (4 hops end-to-end)
      g.addEdge(edge("p1", "p2", "shares_device"));
      g.addEdge(edge("p2", "p3", "shares_device"));
      g.addEdge(edge("p3", "p4", "shares_device"));
      g.addEdge(edge("p4", "p5", "shares_device"));
      // Default maxDepth=3 → p1 can reach p2,p3,p4 but not p5
      const comp = g.findConnectedComponent("p1");
      const ids = new Set(comp.map((n) => n.id));
      assert(ids.has("p1"), "p1 included");
      assert(ids.has("p2"), "p2 reachable");
      assert(ids.has("p3"), "p3 reachable");
      assert(ids.has("p4"), "p4 reachable");
      assert(!ids.has("p5"), "p5 should be beyond maxDepth=3");
    }),

    await runTest("IdentityGraph: findConnectedComponent respects maxDepth=5", () => {
      const g = new IdentityGraph();
      g.addEdge(edge("p1", "p2", "shares_device"));
      g.addEdge(edge("p2", "p3", "shares_device"));
      g.addEdge(edge("p3", "p4", "shares_device"));
      g.addEdge(edge("p4", "p5", "shares_device"));
      const comp = g.findConnectedComponent("p1", 5);
      const ids = new Set(comp.map((n) => n.id));
      assert(ids.has("p5"), "p5 reachable at depth 5");
      assertEqual(comp.length, 5, "all 5 reachable");
    }),

    await runTest("IdentityGraph: findConnectedComponent treats edges as undirected", () => {
      const g = new IdentityGraph();
      g.addEdge(edge("p2", "p1", "shares_device")); // reverse direction
      const comp = g.findConnectedComponent("p1");
      const ids = new Set(comp.map((n) => n.id));
      assert(ids.has("p2"), "p2 reachable via reverse edge");
    }),

    await runTest("IdentityGraph: findConnectedComponent returns empty for missing node", () => {
      const g = new IdentityGraph();
      const comp = g.findConnectedComponent("nope");
      assertEqual(comp.length, 0, "no nodes for missing start");
    }),

    // ─── detectFraudRings ──────────────────────────────────────────
    await runTest("IdentityGraph: detectFraudRings finds 4-node ring (low-trust, shared device)", () => {
      const g = new IdentityGraph();
      // Four low-trust people all sharing the same device → ring of size 4.
      g.addNode(makePerson("p1", 0.2));
      g.addNode(makePerson("p2", 0.2));
      g.addNode(makePerson("p3", 0.2));
      g.addNode(makePerson("p4", 0.2));
      g.addNode(makeDevice("d1", 0.2));
      g.addEdge(edge("p1", "d1", "shares_device"));
      g.addEdge(edge("p2", "d1", "shares_device"));
      g.addEdge(edge("p3", "d1", "shares_device"));
      g.addEdge(edge("p4", "d1", "shares_device"));
      const rings = g.detectFraudRings(3);
      assert(rings.length >= 1, "expected at least one fraud ring");
      const totalNodesInRings = rings.reduce((s, r) => s + r.length, 0);
      assert(totalNodesInRings >= 4, "ring should cover all 4+ nodes", totalNodesInRings);
    }),

    await runTest("IdentityGraph: detectFraudRings ignores high-trust components", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.9)); // high-trust
      g.addNode(makePerson("p2", 0.9));
      g.addEdge(edge("p1", "p2", "shares_device"));
      const rings = g.detectFraudRings(3);
      // Either no rings, or any ring has avg trust >= 0.5 (filter)
      for (const r of rings) {
        const avg = r.reduce((s, n) => s + n.trustScore, 0) / r.length;
        assert(avg < 0.5, "no high-trust ring should be returned");
      }
      assert(true, "high-trust components excluded");
    }),

    await runTest("IdentityGraph: detectFraudRings returns empty when minSize not met", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.1));
      g.addNode(makePerson("p2", 0.1));
      g.addEdge(edge("p1", "p2", "shares_device"));
      // Only 2 nodes — below default minSize=3
      const rings = g.detectFraudRings(3);
      assertEqual(rings.length, 0, "no rings below minSize");
    }),

    // ─── computeTrustScore ─────────────────────────────────────────
    await runTest("IdentityGraph: computeTrustScore returns score in [0,1] with factors array", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.5));
      const r = g.computeTrustScore("p1");
      assertRange(r.score, 0, 1, "score range");
      assert(Array.isArray(r.factors), "factors is array");
      assert(typeof r.explanation === "string", "explanation is string");
      assert(r.explanation.length > 0, "explanation non-empty");
    }),

    await runTest("IdentityGraph: computeTrustScore returns 0 for missing node", () => {
      const g = new IdentityGraph();
      const r = g.computeTrustScore("missing");
      assertEqual(r.score, 0, "missing node score");
    }),

    await runTest("IdentityGraph: computeTrustScore penalizes shared PII with known-bad nodes", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.5));
      g.addNode(makePerson("bad1", 0.1)); // known-bad
      g.addEdge(edge("p1", "bad1", "shares_device"));
      const r = g.computeTrustScore("p1");
      // Suspicious connection penalty + shared PII penalty
      assert(r.score < 0.5, "trust should be below baseline 0.5", r.score);
      const factorNames = r.factors.map((f) => f.factor);
      assert(
        factorNames.some((n) => n.includes("suspicious_connections") || n.includes("shared_pii")),
        "should have suspicious connection or shared-PII factor",
        factorNames,
      );
    }),

    // ─── getRiskSignals ────────────────────────────────────────────
    await runTest("IdentityGraph: getRiskSignals flags synthetic_identity for isolated person", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.5));
      const signals = g.getRiskSignals("p1");
      const synth = signals.find((s) => s.signal === "synthetic_identity");
      assert(!!synth, "expected synthetic_identity signal", signals.map((s) => s.signal));
    }),

    await runTest("IdentityGraph: getRiskSignals flags device_reuse when device shared by 2+ persons", () => {
      const g = new IdentityGraph();
      g.addNode(makeDevice("d1", 0.5));
      g.addNode(makePerson("p1", 0.5));
      g.addNode(makePerson("p2", 0.5));
      g.addEdge(edge("d1", "p1", "shares_device"));
      g.addEdge(edge("d1", "p2", "shares_device"));
      const signals = g.getRiskSignals("d1");
      const reuse = signals.find((s) => s.signal === "device_reuse");
      assert(!!reuse, "expected device_reuse signal", signals.map((s) => s.signal));
    }),

    await runTest("IdentityGraph: getRiskSignals flags document_reuse when doc shared by 2+ persons", () => {
      const g = new IdentityGraph();
      g.addNode(makeDocument("doc1", 0.5));
      g.addNode(makePerson("p1", 0.5));
      g.addNode(makePerson("p2", 0.5));
      g.addEdge(edge("doc1", "p1", "document_reuse"));
      g.addEdge(edge("doc1", "p2", "document_reuse"));
      const signals = g.getRiskSignals("doc1");
      const reuse = signals.find((s) => s.signal === "document_reuse");
      assert(!!reuse, "expected document_reuse signal", signals.map((s) => s.signal));
    }),

    await runTest("IdentityGraph: getRiskSignals flags biometric_duplicate", () => {
      const g = new IdentityGraph();
      g.addNode(makeBiometric("bio1", 0.5));
      g.addNode(makePerson("p1", 0.5));
      g.addNode(makePerson("p2", 0.5));
      g.addEdge(edge("bio1", "p1", "biometric_match"));
      g.addEdge(edge("bio1", "p2", "biometric_match"));
      const signals = g.getRiskSignals("bio1");
      const dup = signals.find((s) => s.signal === "biometric_duplicate");
      assert(!!dup, "expected biometric_duplicate signal", signals.map((s) => s.signal));
    }),

    await runTest("IdentityGraph: getRiskSignals flags mule_pattern for device with 3+ low-trust persons", () => {
      const g = new IdentityGraph();
      g.addNode(makeDevice("d1", 0.5));
      g.addNode(makePerson("p1", 0.2)); // low-trust
      g.addNode(makePerson("p2", 0.2));
      g.addNode(makePerson("p3", 0.2));
      g.addEdge(edge("d1", "p1", "shares_device"));
      g.addEdge(edge("d1", "p2", "shares_device"));
      g.addEdge(edge("d1", "p3", "shares_device"));
      const signals = g.getRiskSignals("d1");
      const mule = signals.find((s) => s.signal === "mule_pattern");
      assert(!!mule, "expected mule_pattern signal", signals.map((s) => s.signal));
    }),

    await runTest("IdentityGraph: getRiskSignals returns empty for missing node", () => {
      const g = new IdentityGraph();
      assertEqual(g.getRiskSignals("nope").length, 0, "no signals for missing");
    }),

    // ─── serialize / deserialize ───────────────────────────────────
    await runTest("IdentityGraph: serialize + deserialize round-trip preserves structure", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.6));
      g.addNode(makePerson("p2", 0.4));
      g.addEdge(edge("p1", "p2", "shares_device"));
      const serialized = g.serialize();
      const g2 = new IdentityGraph();
      g2.deserialize(serialized);
      assertEqual(g2.size(), 2, "node count preserved");
      assertEqual(g2.edgesOf("p1").length, 1, "edges preserved");
      assertEqual(g2.getNode("p1")!.trustScore, 0.6, "p1 trust preserved");
    }),

    await runTest("IdentityGraph: serialize → JSON string → fromJSON rehydrates", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("p1", 0.5));
      g.addEdge(edge("p1", "p2", "shares_device"));
      const json = JSON.stringify(g.serialize());
      const g2 = IdentityGraph.fromJSON(json);
      assertEqual(g2.size(), 2, "rehydrated size");
      assert(g2.getNode("p2") !== undefined, "p2 present after rehydrate");
    }),

    await runTest("IdentityGraph: deserialize replaces existing state", () => {
      const g = new IdentityGraph();
      g.addNode(makePerson("old", 0.5));
      g.deserialize({
        nodes: [makePerson("new1", 0.5)],
        edges: [],
        version: 1,
      });
      assert(g.getNode("old") === undefined, "old state cleared");
      assert(g.getNode("new1") !== undefined, "new state loaded");
    }),

    // ─── haversineKm + detectImpossibleTravel ──────────────────────
    await runTest("haversineKm: London to NYC ≈ 5570 km", () => {
      const london = { lat: 51.5074, lon: -0.1278 };
      const nyc = { lat: 40.7128, lon: -74.006 };
      const d = haversineKm(london, nyc);
      assert(d > 5000 && d < 6000, "expected ~5500 km", d);
    }),

    await runTest("detectImpossibleTravel: London→NYC in 30 minutes flagged", () => {
      // 30 minutes between London and NYC = impossible (need ~8h flight)
      const t0 = Date.parse("2025-01-01T10:00:00.000Z");
      const t1 = t0 + 30 * 60 * 1000; // +30min
      const locations = [
        { timestamp: t0, lat: 51.5074, lon: -0.1278 }, // London
        { timestamp: t1, lat: 40.7128, lon: -74.006 }, // NYC
      ];
      assert(detectImpossibleTravel(locations), "London→NYC in 30 min should be impossible");
    }),

    await runTest("detectImpossibleTravel: London→NYC in 8 hours NOT flagged", () => {
      const t0 = Date.parse("2025-01-01T10:00:00.000Z");
      const t1 = t0 + 8 * 60 * 60 * 1000; // +8h — reasonable flight time
      const locations = [
        { timestamp: t0, lat: 51.5074, lon: -0.1278 },
        { timestamp: t1, lat: 40.7128, lon: -74.006 },
      ];
      assert(!detectImpossibleTravel(locations), "London→NYC in 8h is plausible");
    }),

    await runTest("detectImpossibleTravel: returns false for empty / single point", () => {
      assert(!detectImpossibleTravel([]), "empty → false");
      assert(!detectImpossibleTravel([{ timestamp: 1, lat: 0, lon: 0 }]), "single → false");
    }),

    await runTest("detectImpossibleTravel: skips sub-5km jitter", () => {
      const t0 = Date.parse("2025-01-01T10:00:00.000Z");
      const t1 = t0 + 1000; // 1 second
      const locations = [
        { timestamp: t0, lat: 51.5074, lon: -0.1278 },
        { timestamp: t1, lat: 51.5075, lon: -0.1279 }, // ~10m away
      ];
      assert(!detectImpossibleTravel(locations), "sub-5km jitter ignored");
    }),

    // ─── detectVelocityAttack ──────────────────────────────────────
    await runTest("detectVelocityAttack: 20 events in 1 hour flagged", () => {
      const now = Date.now();
      const events = Array.from({ length: 20 }, (_, i) => ({
        timestamp: now + i * 1000, // 1s apart, all within 20s
        type: "verify",
      }));
      assert(detectVelocityAttack(events), "20 events in <1h should be flagged");
    }),

    await runTest("detectVelocityAttack: 5 events in 1 hour NOT flagged", () => {
      const now = Date.now();
      const events = Array.from({ length: 5 }, (_, i) => ({
        timestamp: now + i * 60_000, // 1 minute apart
        type: "verify",
      }));
      assert(!detectVelocityAttack(events), "5 events is below threshold of 10");
    }),

    await runTest("detectVelocityAttack: 11 events spread across 10 hours NOT flagged", () => {
      const now = Date.now();
      const events = Array.from({ length: 11 }, (_, i) => ({
        timestamp: now + i * 60 * 60 * 1000, // 1h apart, 11h total span
        type: "verify",
      }));
      assert(!detectVelocityAttack(events), "spread events — no 10 in 1h window");
    }),

    await runTest("detectVelocityAttack: empty array not flagged", () => {
      assert(!detectVelocityAttack([]), "empty events → false");
    }),
  ];
}
