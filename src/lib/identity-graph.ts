/**
 * Identity Graph Network — graph-based fraud detection.
 *
 * Single-point identity verification (one selfie + one document) misses the
 * patterns that fraud rings leave behind. By treating every entity that
 * touches the verification pipeline as a node — person, document, device,
 * location, biometric, email, phone — and every shared attribute as a weighted
 * edge, we can surface *rings* of collusion that no single check can detect:
 *
 *   - Three "different" people who all reused the same document image
 *   - One device submitting verifications for five synthetic identities
 *   - A cluster of accounts that all logged in from the same IP within 5 min
 *   - A biometric template that "matched" two different national IDs
 *
 * This module is pure TypeScript (no Neo4j, no PostGIS). It is designed for
 * in-process use inside the verification API: each verification adds nodes &
 * edges to a graph; the graph is queried for fraud rings, risk signals, and
 * trust scores; the serialized graph can be persisted to Turso/Neon between
 * requests.
 *
 * Competitors (Onfido, Jumio, Veriff, Sumsub) ship only flat "duplicate
 * detection" or "device fingerprint" checks. None expose a queryable graph
 * that customers can use to ask "show me every identity connected to this
 * device". Cirkle does.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Entity type for a node in the identity graph. */
export type IdentityNodeType =
  | "person"
  | "document"
  | "device"
  | "location"
  | "biometric"
  | "email"
  | "phone";

/** Edge type describing how two nodes are related. */
export type IdentityEdgeType =
  | "verified_same_person"
  | "shares_device"
  | "shares_ip"
  | "shares_email"
  | "shares_phone"
  | "document_reuse"
  | "biometric_match"
  | "co-located";

/** A node in the identity graph — a person, document, device, etc. */
export interface IdentityNode {
  /** Stable unique identifier (e.g. UUID, hash of PII). */
  id: string;
  /** What kind of entity this node represents. */
  type: IdentityNodeType;
  /** Free-form attributes — e.g. { ip: "1.2.3.4", country: "EG" } for a location. */
  attributes: Record<string, any>;
  /** Prior trust score 0..1 (can be re-computed via {@link IdentityGraph.computeTrustScore}). */
  trustScore: number;
  /** ISO-8601 timestamp of first appearance in the graph. */
  firstSeenAt: string;
  /** ISO-8601 timestamp of most recent appearance. */
  lastSeenAt: string;
}

/** A directed, weighted, evidenced relationship between two nodes. */
export interface IdentityEdge {
  /** Source node id. */
  from: string;
  /** Destination node id. */
  to: string;
  /** Kind of relationship. */
  type: IdentityEdgeType;
  /** Weight 0..1 — higher = stronger evidence of a real link. */
  weight: number;
  /** How many independent observations support this edge. */
  evidenceCount: number;
  /** ISO-8601 timestamp this edge was last observed. */
  lastSeenAt: string;
}

/** Risk signal emitted by {@link IdentityGraph.getRiskSignals}. */
export interface RiskSignal {
  signal:
    | "synthetic_identity"
    | "fraud_ring_member"
    | "device_reuse"
    | "document_reuse"
    | "biometric_duplicate"
    | "impossible_travel"
    | "velocity_attack"
    | "mule_pattern";
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
}

/** Trust-score explanation returned by {@link IdentityGraph.computeTrustScore}. */
export interface TrustScoreResult {
  /** 0..1 trust score (higher = more trusted). */
  score: number;
  /** Per-factor contributions to the final score. */
  factors: { factor: string; contribution: number; detail: string }[];
  /** Human-readable explanation. */
  explanation: string;
}

/** Serialized form of {@link IdentityGraph}. */
export interface SerializedIdentityGraph {
  nodes: IdentityNode[];
  edges: IdentityEdge[];
  version: 1;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Haversine distance (km) between two lat/lon points.
 * Used for impossible-travel detection.
 */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Detect impossible travel — flag if a user appears to travel faster than a
 * commercial flight between two consecutive geolocated events.
 *
 * @param locations Chronologically-ordered list of { timestamp, lat, lon }.
 * @param minKmh Speed (km/h) above which travel is flagged. Default 900 km/h
 *   (slightly above the cruising speed of a 787, leaves headroom for clock
 *   skew and timestamp rounding).
 * @returns true if any consecutive pair implies travel faster than minKmh.
 */
export function detectImpossibleTravel(
  locations: { timestamp: number; lat: number; lon: number }[],
  minKmh: number = 900
): boolean {
  if (locations.length < 2) return false;
  const sorted = [...locations].sort((a, b) => a.timestamp - b.timestamp);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const dtMs = b.timestamp - a.timestamp;
    if (dtMs <= 0) continue;
    const km = haversineKm(a, b);
    // Skip negligible distances (GPS jitter) under 5 km.
    if (km < 5) continue;
    const hours = dtMs / (1000 * 60 * 60);
    const kmh = km / hours;
    if (kmh > minKmh) return true;
  }
  return false;
}

/**
 * Detect velocity attacks — too many verification events in a short window.
 *
 * A single user (or, more tellingly, a single device) submitting many
 * verifications in an hour is a strong signal of either bot activity or a
 * fraudster probing the system for the weakest challenge combination.
 *
 * @param events List of { timestamp, type } events. Order does not matter.
 * @param windowMs Sliding window size. Default 1 hour.
 * @param maxEvents Maximum legitimate events inside the window. Default 10.
 */
export function detectVelocityAttack(
  events: { timestamp: number; type: string }[],
  windowMs: number = 60 * 60 * 1000,
  maxEvents: number = 10
): boolean {
  if (events.length < maxEvents) return false;
  const sorted = events.map(e => e.timestamp).sort((a, b) => a - b);
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] > windowMs) lo++;
    const countInWindow = hi - lo + 1;
    if (countInWindow > maxEvents) return true;
  }
  return false;
}

// ─── IdentityGraph ────────────────────────────────────────────────────────────

/**
 * In-memory directed graph of identity entities.
 *
 * Use {@link addNode} / {@link addEdge} to build the graph incrementally as
 * verifications arrive. Use {@link findConnectedComponent} to traverse,
 * {@link detectFraudRings} to find clusters of low-trust connected nodes,
 * {@link computeTrustScore} for a weighted trust score with explanation, and
 * {@link getRiskSignals} to enumerate specific risk signals.
 */
export class IdentityGraph {
  private nodes = new Map<string, IdentityNode>();
  private edges = new Map<string, IdentityEdge[]>();
  /** Reverse adjacency for efficient traversal in both directions. */
  private reverseEdges = new Map<string, IdentityEdge[]>();

  /** Add (or upsert) a node to the graph. */
  addNode(node: IdentityNode): void {
    const existing = this.nodes.get(node.id);
    if (existing) {
      // Merge — keep the latest lastSeenAt and the lower trustScore
      // (more conservative when collisions happen).
      this.nodes.set(node.id, {
        ...existing,
        attributes: { ...existing.attributes, ...node.attributes },
        trustScore: Math.min(existing.trustScore, node.trustScore),
        lastSeenAt:
          node.lastSeenAt > existing.lastSeenAt
            ? node.lastSeenAt
            : existing.lastSeenAt,
        firstSeenAt:
          existing.firstSeenAt < node.firstSeenAt
            ? existing.firstSeenAt
            : node.firstSeenAt,
      });
    } else {
      this.nodes.set(node.id, { ...node });
    }
    if (!this.edges.has(node.id)) this.edges.set(node.id, []);
    if (!this.reverseEdges.has(node.id)) this.reverseEdges.set(node.id, []);
  }

  /** Add (or upsert) an edge between two nodes. */
  addEdge(edge: IdentityEdge): void {
    // Ensure both endpoints exist; auto-create stub nodes if missing.
    if (!this.nodes.has(edge.from)) {
      this.addNode({
        id: edge.from,
        type: "person",
        attributes: {},
        trustScore: 0.5,
        firstSeenAt: edge.lastSeenAt,
        lastSeenAt: edge.lastSeenAt,
      });
    }
    if (!this.nodes.has(edge.to)) {
      this.addNode({
        id: edge.to,
        type: "person",
        attributes: {},
        trustScore: 0.5,
        firstSeenAt: edge.lastSeenAt,
        lastSeenAt: edge.lastSeenAt,
      });
    }
    const list = this.edges.get(edge.from) ?? [];
    const existing = list.find(e => e.to === edge.to && e.type === edge.type);
    if (existing) {
      existing.weight = Math.max(existing.weight, edge.weight);
      existing.evidenceCount += edge.evidenceCount;
      existing.lastSeenAt =
        edge.lastSeenAt > existing.lastSeenAt
          ? edge.lastSeenAt
          : existing.lastSeenAt;
    } else {
      list.push({ ...edge });
      this.edges.set(edge.from, list);
      const rev = this.reverseEdges.get(edge.to) ?? [];
      rev.push({ ...edge });
      this.reverseEdges.set(edge.to, rev);
    }
  }

  /** Get a node by id (returns undefined if absent). */
  getNode(id: string): IdentityNode | undefined {
    return this.nodes.get(id);
  }

  /** Get all edges out of a node. */
  edgesOf(id: string): IdentityEdge[] {
    return this.edges.get(id) ?? [];
  }

  /** Get all edges into a node. */
  inEdgesOf(id: string): IdentityEdge[] {
    return this.reverseEdges.get(id) ?? [];
  }

  /** Total node count (mainly for diagnostics / tests). */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Find the connected component reachable from `nodeId` using BFS up to a
   * maximum depth. Edges are treated as undirected for traversal purposes
   * (a shared attribute implies a bidirectional relationship).
   *
   * @param nodeId Starting node id.
   * @param maxDepth Maximum hop distance. Default 3.
   * @returns Array of reachable {@link IdentityNode}s (excluding the start
   *   node if no neighbors are present, including it otherwise).
   */
  findConnectedComponent(nodeId: string, maxDepth: number = 3): IdentityNode[] {
    const visited = new Set<string>();
    const result: IdentityNode[] = [];
    if (!this.nodes.has(nodeId)) return result;
    const queue: { id: string; depth: number }[] = [{ id: nodeId, depth: 0 }];
    visited.add(nodeId);
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const node = this.nodes.get(id);
      if (node) result.push(node);
      if (depth >= maxDepth) continue;
      // Out-edges
      for (const e of this.edges.get(id) ?? []) {
        if (!visited.has(e.to)) {
          visited.add(e.to);
          queue.push({ id: e.to, depth: depth + 1 });
        }
      }
      // In-edges (treat as undirected for component detection)
      for (const e of this.reverseEdges.get(id) ?? []) {
        if (!visited.has(e.from)) {
          visited.add(e.from);
          queue.push({ id: e.from, depth: depth + 1 });
        }
      }
    }
    return result;
  }

  /**
   * Detect fraud rings — strongly connected clusters of low-trust nodes
   * connected by suspicious edges (document_reuse, shares_device,
   * shares_ip, shares_email, shares_phone, biometric_match).
   *
   * Algorithm: union-find over suspicious edges, then filter components by:
   *   - size >= minSize
   *   - average trustScore below 0.5
   *   - at least one suspicious edge type in the component
   *
   * @param minSize Minimum ring size. Default 3.
   * @returns Array of node arrays — each inner array is one fraud ring.
   */
  detectFraudRings(minSize: number = 3): IdentityNode[][] {
    const suspiciousTypes: IdentityEdgeType[] = [
      "document_reuse",
      "shares_device",
      "shares_ip",
      "shares_email",
      "shares_phone",
      "biometric_match",
    ];

    // Union-find
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      // Path compression
      let cur = x;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    // Initialize every node as its own component.
    for (const id of this.nodes.keys()) find(id);

    // Union across suspicious edges (both directions).
    for (const list of this.edges.values()) {
      for (const e of list) {
        if (suspiciousTypes.includes(e.type)) union(e.from, e.to);
      }
    }

    // Group nodes by root.
    const groups = new Map<string, string[]>();
    for (const id of this.nodes.keys()) {
      const root = find(id);
      const arr = groups.get(root) ?? [];
      arr.push(id);
      groups.set(root, arr);
    }

    // Filter to suspicious, low-trust components of minSize+.
    const rings: IdentityNode[][] = [];
    for (const ids of groups.values()) {
      if (ids.length < minSize) continue;
      const nodes = ids
        .map(id => this.nodes.get(id)!)
        .filter(Boolean);
      if (nodes.length < minSize) continue;
      const avgTrust =
        nodes.reduce((s, n) => s + n.trustScore, 0) / nodes.length;
      if (avgTrust >= 0.5) continue;
      // Ensure the component actually has a suspicious edge.
      const hasSuspiciousEdge = nodes.some(n =>
        (this.edges.get(n.id) ?? []).some(e =>
          suspiciousTypes.includes(e.type)
        )
      );
      if (!hasSuspiciousEdge) continue;
      rings.push(nodes);
    }
    return rings;
  }

  /**
   * Compute a weighted trust score 0..1 for a node.
   *
   * Factors:
   *   - Node age (older = trustier), capped at +0.20
   *   - Edge count (more suspicious connections = lower trust), -0.10 each
   *     up to -0.30
   *   - Shared PII with known-bad nodes — -0.20 per shared attribute
   *   - Document reuse count — -0.10 per reuse, up to -0.30
   *   - Biometric match count — +0.05 for verified matches (real
   *     corroboration), -0.10 for ambiguous cross-person matches
   *
   * The score is clamped to [0, 1] and includes a human-readable
   * explanation and per-factor breakdown for auditability.
   */
  computeTrustScore(nodeId: string): TrustScoreResult {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return {
        score: 0,
        factors: [],
        explanation: `Node ${nodeId} not found in graph.`,
      };
    }

    const factors: { factor: string; contribution: number; detail: string }[] = [];
    let score = 0.5; // neutral prior

    // ─── Node age ─────────────────────────────────────────────────
    try {
      const firstSeen = new Date(node.firstSeenAt).getTime();
      const lastSeen = new Date(node.lastSeenAt).getTime();
      const ageDays = (lastSeen - firstSeen) / (1000 * 60 * 60 * 24);
      const ageContribution = Math.min(0.2, ageDays / 365 * 0.2);
      if (ageContribution > 0) {
        score += ageContribution;
        factors.push({
          factor: "node_age",
          contribution: ageContribution,
          detail: `Node first seen ${ageDays.toFixed(0)} days ago — older entities are more trusted.`,
        });
      }
    } catch {
      // ignore malformed dates
    }

    // ─── Edge count & suspicious connections ──────────────────────
    const outEdges = this.edges.get(nodeId) ?? [];
    const inEdges = this.reverseEdges.get(nodeId) ?? [];
    const suspiciousTypes: IdentityEdgeType[] = [
      "document_reuse",
      "shares_device",
      "shares_ip",
      "shares_email",
      "shares_phone",
      "biometric_match",
    ];
    const suspiciousEdges = [
      ...outEdges,
      ...inEdges,
    ].filter(e => suspiciousTypes.includes(e.type));
    const suspiciousPenalty = Math.min(0.3, suspiciousEdges.length * 0.1);
    if (suspiciousPenalty > 0) {
      score -= suspiciousPenalty;
      factors.push({
        factor: "suspicious_connections",
        contribution: -suspiciousPenalty,
        detail: `${suspiciousEdges.length} suspicious edge(s): ${[...new Set(suspiciousEdges.map(e => e.type))].join(", ")}`,
      });
    }

    // ─── Shared PII with low-trust nodes ─────────────────────────
    let sharedPiiPenalty = 0;
    for (const e of suspiciousEdges) {
      const otherId = e.from === nodeId ? e.to : e.from;
      const other = this.nodes.get(otherId);
      if (other && other.trustScore < 0.3) {
        sharedPiiPenalty += 0.2;
      }
    }
    sharedPiiPenalty = Math.min(sharedPiiPenalty, 0.4);
    if (sharedPiiPenalty > 0) {
      score -= sharedPiiPenalty;
      factors.push({
        factor: "shared_pii_with_known_bad",
        contribution: -sharedPiiPenalty,
        detail: `${(sharedPiiPenalty / 0.2) | 0} attribute(s) shared with known-bad (trust<0.3) nodes.`,
      });
    }

    // ─── Document reuse count ─────────────────────────────────────
    const docReuseCount = outEdges.filter(e => e.type === "document_reuse").length +
      inEdges.filter(e => e.type === "document_reuse").length;
    const docReusePenalty = Math.min(0.3, docReuseCount * 0.1);
    if (docReusePenalty > 0) {
      score -= docReusePenalty;
      factors.push({
        factor: "document_reuse_count",
        contribution: -docReusePenalty,
        detail: `Document reused ${docReuseCount} time(s) across identities.`,
      });
    }

    // ─── Biometric match count ────────────────────────────────────
    const biometricMatches = [
      ...outEdges.filter(e => e.type === "biometric_match"),
      ...inEdges.filter(e => e.type === "biometric_match"),
    ];
    // If the node is a person with a single biometric_match to a biometric
    // template, that is *corroboration* (a real human). If it has multiple
    // biometric_match edges to *different person* nodes, it is ambiguous.
    const personBiometricMatches = biometricMatches.filter(e => {
      const otherId = e.from === nodeId ? e.to : e.from;
      const other = this.nodes.get(otherId);
      return other && other.type === "person";
    });
    if (personBiometricMatches.length === 1) {
      score += 0.05;
      factors.push({
        factor: "biometric_corroboration",
        contribution: 0.05,
        detail: "Single biometric match with a verified person template.",
      });
    } else if (personBiometricMatches.length > 1) {
      const penalty = Math.min(0.2, personBiometricMatches.length * 0.1);
      score -= penalty;
      factors.push({
        factor: "biometric_duplicate",
        contribution: -penalty,
        detail: `${personBiometricMatches.length} different persons share this biometric — duplicate.`,
      });
    }

    // Clamp & store
    score = Math.max(0, Math.min(1, score));
    // Persist back to the node so subsequent reads see the recomputed value.
    node.trustScore = score;

    const explanation = [
      `Trust score for ${node.type} ${node.id.slice(0, 8)}: ${score.toFixed(3)}.`,
      factors.length > 0
        ? `Factors: ${factors.map(f => `${f.factor} (${f.contribution >= 0 ? "+" : ""}${f.contribution.toFixed(2)})`).join(", ")}.`
        : "No risk factors detected; trust based on neutral prior (0.50).",
    ].join(" ");

    return { score, factors, explanation };
  }

  /**
   * Enumerate concrete risk signals for a node.
   *
   * Signals:
   *   - synthetic_identity — person node with no verified edges, low trust
   *   - fraud_ring_member — node appears in a detected fraud ring
   *   - device_reuse — device node shared across multiple persons
   *   - document_reuse — document node reused across multiple persons
   *   - biometric_duplicate — biometric matches multiple persons
   *   - impossible_travel — co-located edges imply impossible travel
   *   - velocity_attack — many recent events from this node
   *   - mule_pattern — one device funding multiple distinct identities
   *
   * @returns Array of risk signals (may be empty).
   */
  getRiskSignals(nodeId: string): RiskSignal[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    const signals: RiskSignal[] = [];

    const outEdges = this.edges.get(nodeId) ?? [];
    const inEdges = this.reverseEdges.get(nodeId) ?? [];
    const allEdges = [...outEdges, ...inEdges];

    // ─── synthetic_identity ────────────────────────────────────────
    if (node.type === "person") {
      const verifiedEdges = allEdges.filter(
        e => e.type === "verified_same_person"
      );
      const suspiciousEdges = allEdges.filter(e =>
        [
          "document_reuse",
          "shares_device",
          "shares_ip",
          "biometric_match",
        ].includes(e.type)
      );
      if (verifiedEdges.length === 0 && suspiciousEdges.length === 0) {
        signals.push({
          signal: "synthetic_identity",
          severity: "medium",
          detail: "Person has no verified edges and no corroborating signals — possibly synthetic.",
        });
      }
    }

    // ─── fraud_ring_member ──────────────────────────────────────────
    const rings = this.detectFraudRings(3);
    const inRing = rings.find(r => r.some(n => n.id === nodeId));
    if (inRing) {
      signals.push({
        signal: "fraud_ring_member",
        severity: "critical",
        detail: `Node is a member of a ${inRing.length}-node fraud ring.`,
      });
    }

    // ─── device_reuse ───────────────────────────────────────────────
    if (node.type === "device") {
      const persons = new Set<string>();
      for (const e of allEdges) {
        if (e.type !== "shares_device") continue;
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = this.nodes.get(otherId);
        if (other && other.type === "person") persons.add(otherId);
      }
      if (persons.size >= 2) {
        signals.push({
          signal: "device_reuse",
          severity: persons.size >= 5 ? "critical" : "high",
          detail: `Device shared across ${persons.size} distinct persons.`,
        });
      }
    }

    // ─── document_reuse ─────────────────────────────────────────────
    if (node.type === "document") {
      const persons = new Set<string>();
      for (const e of allEdges) {
        if (e.type !== "document_reuse") continue;
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = this.nodes.get(otherId);
        if (other && other.type === "person") persons.add(otherId);
      }
      if (persons.size >= 2) {
        signals.push({
          signal: "document_reuse",
          severity: persons.size >= 3 ? "critical" : "high",
          detail: `Document reused across ${persons.size} persons.`,
        });
      }
    }

    // ─── biometric_duplicate ────────────────────────────────────────
    if (node.type === "biometric") {
      const persons = new Set<string>();
      for (const e of allEdges) {
        if (e.type !== "biometric_match") continue;
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = this.nodes.get(otherId);
        if (other && other.type === "person") persons.add(otherId);
      }
      if (persons.size >= 2) {
        signals.push({
          signal: "biometric_duplicate",
          severity: persons.size >= 3 ? "critical" : "high",
          detail: `Biometric template matched ${persons.size} distinct persons — duplicate.`,
        });
      }
    }

    // ─── impossible_travel ──────────────────────────────────────────
    if (node.type === "person") {
      const locationEdges = allEdges.filter(e => e.type === "co-located");
      if (locationEdges.length >= 2) {
        const locations: { timestamp: number; lat: number; lon: number }[] = [];
        for (const e of locationEdges) {
          const locId = e.from === nodeId ? e.to : e.from;
          const loc = this.nodes.get(locId);
          if (!loc) continue;
          const lat = Number(loc.attributes.lat);
          const lon = Number(loc.attributes.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const ts = Date.parse(e.lastSeenAt);
          if (Number.isNaN(ts)) continue;
          locations.push({ timestamp: ts, lat, lon });
        }
        if (detectImpossibleTravel(locations)) {
          signals.push({
            signal: "impossible_travel",
            severity: "critical",
            detail: `Co-location events imply travel faster than commercial flights across ${locations.length} locations.`,
          });
        }
      }
    }

    // ─── velocity_attack ────────────────────────────────────────────
    const events = allEdges.map(e => ({
      timestamp: Date.parse(e.lastSeenAt),
      type: e.type,
    })).filter(e => !Number.isNaN(e.timestamp));
    if (detectVelocityAttack(events)) {
      signals.push({
        signal: "velocity_attack",
        severity: "high",
        detail: "More than 10 edges with lastSeenAt timestamps clustered within a 1-hour window.",
      });
    }

    // ─── mule_pattern ───────────────────────────────────────────────
    if (node.type === "device") {
      const fundedPersons = new Set<string>();
      for (const e of allEdges) {
        if (e.type !== "shares_device" && e.type !== "shares_ip") continue;
        const otherId = e.from === nodeId ? e.to : e.from;
        const other = this.nodes.get(otherId);
        if (other && other.type === "person" && other.trustScore < 0.4) {
          fundedPersons.add(otherId);
        }
      }
      if (fundedPersons.size >= 3) {
        signals.push({
          signal: "mule_pattern",
          severity: "critical",
          detail: `Device linked to ${fundedPersons.size} low-trust persons — possible money mule coordination.`,
        });
      }
    }

    return signals;
  }

  /**
   * Serialize the graph to a JSON-serializable object. Persist this between
   * requests so the graph survives serverless cold-starts.
   */
  serialize(): SerializedIdentityGraph {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()).flat(),
      version: 1,
    };
  }

  /**
   * Rehydrate a graph from its serialized form. Replaces any existing state.
   */
  deserialize(json: SerializedIdentityGraph | string): void {
    let data: SerializedIdentityGraph;
    if (typeof json === "string") {
      data = JSON.parse(json) as SerializedIdentityGraph;
    } else {
      data = json;
    }
    this.nodes.clear();
    this.edges.clear();
    this.reverseEdges.clear();
    for (const n of data.nodes ?? []) this.addNode(n);
    for (const e of data.edges ?? []) this.addEdge(e);
  }

  /**
   * Create a new IdentityGraph from a serialized payload (factory).
   */
  static fromJSON(json: SerializedIdentityGraph | string): IdentityGraph {
    const g = new IdentityGraph();
    g.deserialize(json);
    return g;
  }
}
