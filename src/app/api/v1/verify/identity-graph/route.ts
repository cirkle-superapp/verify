import { NextRequest, NextResponse } from "next/server";
import {
  IdentityGraph,
  type IdentityNode,
  type IdentityEdge,
  type RiskSignal,
  type TrustScoreResult,
} from "@/lib/identity-graph";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — identity-graph endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/identity-graph
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Identity Graph API request payload.
 */
interface IdentityGraphRequest {
  /** Graph nodes — persons, documents, devices, locations, biometrics, emails, phones. */
  nodes: IdentityNode[];
  /** Graph edges — directed, weighted, evidenced relationships between nodes. */
  edges: IdentityEdge[];
  /** ID of the node to use as the query starting point. */
  query_node_id: string;
  /** Optional max BFS depth (default 3). */
  max_hops?: number;
  /** Optional minimum fraud ring size (default 3). */
  min_ring_size?: number;
}

/**
 * Identity Graph API response payload.
 */
interface IdentityGraphResponse {
  /** Nodes reachable from query_node_id within max_hops (BFS, undirected). */
  connectedComponent: IdentityNode[];
  /** Detected fraud rings (clusters of low-trust nodes connected by suspicious edges). */
  fraudRings: IdentityNode[][];
  /** Weighted trust score (0..1) for query_node_id with per-factor breakdown. */
  trustScore: TrustScoreResult;
  /** Concrete risk signals (synthetic_identity, fraud_ring_member, device_reuse, etc.). */
  riskSignals: RiskSignal[];
  /** Human-readable summary of findings. */
  summary: string;
  /** Number of nodes processed. */
  nodeCount: number;
  /** Number of edges processed. */
  edgeCount: number;
  /** ISO-8601 timestamp of computation. */
  computedAt: string;
}

/**
 * POST /api/v1/verify/identity-graph
 *
 * Graph-based fraud detection. Accepts an arbitrary identity graph (nodes +
 * edges + a query node) and returns:
 *   - The connected component reachable from the query node within 3 hops
 *   - All detected fraud rings (size >= 3) of low-trust nodes connected by
 *     suspicious edges (document_reuse, shares_device, shares_ip, shares_email,
 *     shares_phone, biometric_match)
 *   - A weighted trust score with per-factor explanation
 *   - Concrete risk signals (8 signal types)
 *   - A human-readable summary
 *
 * ## Why this exists
 *
 * Single-point identity verification (one selfie + one document) misses the
 * patterns that fraud rings leave behind. By treating every entity that
 * touches the verification pipeline as a node — person, document, device,
 * location, biometric, email, phone — and every shared attribute as a
 * weighted edge, we can surface rings of collusion that no single check
 * can detect.
 *
 * ## Competitor gap
 *
 * Onfido, Jumio, Veriff, and Sumsub ship only flat "duplicate detection"
 * or "device fingerprint" checks. None expose a queryable graph that
 * customers can use to ask "show me every identity connected to this
 * device". Cirkle does.
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/identity-graph \
 *   -H "Content-Type: application/json" \
 *   -d '{"nodes":[{"id":"u1","type":"person","attributes":{},"trustScore":0.5,"firstSeenAt":"2026-01-01T00:00:00Z","lastSeenAt":"2026-01-02T00:00:00Z"}],"edges":[],"query_node_id":"u1"}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IdentityGraphRequest;

    // ─── Input validation ──────────────────────────────────────────
    if (!body || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
      return NextResponse.json(
        {
          error: "nodes (array) and edges (array) are required",
          code: "INVALID_INPUT",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (typeof body.query_node_id !== "string" || body.query_node_id.length === 0) {
      return NextResponse.json(
        {
          error: "query_node_id (string) is required",
          code: "MISSING_QUERY_NODE",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    if (body.nodes.length > 50_000) {
      return NextResponse.json(
        { error: "Max 50,000 nodes per request", code: "GRAPH_TOO_LARGE" },
        { status: 413, headers: CORS_HEADERS },
      );
    }

    // ─── Build the graph ───────────────────────────────────────────
    const graph = new IdentityGraph();
    for (const node of body.nodes) {
      if (!node || typeof node.id !== "string") continue;
      graph.addNode(node);
    }
    for (const edge of body.edges) {
      if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string") continue;
      graph.addEdge(edge);
    }

    // ─── Connected component (BFS within max_hops, default 3) ───────
    const maxHops = typeof body.max_hops === "number" && body.max_hops > 0 ? body.max_hops : 3;
    const connected = graph.findConnectedComponent(body.query_node_id, maxHops);

    // ─── Fraud rings (default min size 3) ───────────────────────────
    const minRing = typeof body.min_ring_size === "number" && body.min_ring_size > 0
      ? body.min_ring_size
      : 3;
    const rings = graph.detectFraudRings(minRing);

    // ─── Trust score with explanation ──────────────────────────────
    const trust = graph.computeTrustScore(body.query_node_id);

    // ─── Risk signals ───────────────────────────────────────────────
    const signals = graph.getRiskSignals(body.query_node_id);

    // ─── Human-readable summary ────────────────────────────────────
    const summaryParts: string[] = [];
    summaryParts.push(`Query node ${body.query_node_id}: trust=${trust.score.toFixed(3)}.`);
    summaryParts.push(`Connected component (within ${maxHops} hops): ${connected.length} node(s).`);
    if (rings.length > 0) {
      const largest = Math.max(...rings.map(r => r.length));
      summaryParts.push(
        `Detected ${rings.length} fraud ring(s); largest ring has ${largest} node(s).`,
      );
    } else {
      summaryParts.push("No fraud rings detected (size threshold not met).");
    }
    if (signals.length > 0) {
      const critical = signals.filter(s => s.severity === "critical").length;
      const high = signals.filter(s => s.severity === "high").length;
      summaryParts.push(
        `${signals.length} risk signal(s): ${critical} critical, ${high} high.`,
      );
      const topSeverity = signals.find(s => s.severity === "critical") ?? signals[0];
      summaryParts.push(`Top signal: ${topSeverity.signal} — ${topSeverity.detail}`);
    } else {
      summaryParts.push("No risk signals detected for the query node.");
    }
    if (trust.factors.length > 0) {
      summaryParts.push(
        `Trust factors: ${trust.factors.map(f => `${f.factor} (${f.contribution >= 0 ? "+" : ""}${f.contribution.toFixed(2)})`).join(", ")}.`,
      );
    }

    const response: IdentityGraphResponse = {
      connectedComponent: connected,
      fraudRings: rings,
      trustScore: trust,
      riskSignals: signals,
      summary: summaryParts.join(" "),
      nodeCount: body.nodes.length,
      edgeCount: body.edges.length,
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "identity graph query failed",
        code: "IDENTITY_GRAPH_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/identity-graph
 *
 * Returns API documentation and an example payload demonstrating how to
 * construct an identity graph request.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "Identity Graph Network API",
      version: "1.0.0",
      description:
        "Graph-based fraud detection. Accepts an identity graph (nodes + edges + a query node) and returns the connected component, detected fraud rings, a weighted trust score, risk signals, and a human-readable summary.",
      competitiveAdvantage:
        "Onfido, Jumio, Veriff, Sumsub all ship only flat duplicate detection. None expose a queryable graph that customers can use to ask 'show me every identity connected to this device'. Cirkle does.",
      endpoints: {
        POST: "Submit a graph + query node, receive fraud ring detection + trust score + risk signals.",
        GET: "This documentation.",
        OPTIONS: "CORS preflight (204 No Content).",
      },
      nodeTypes: [
        "person",
        "document",
        "device",
        "location",
        "biometric",
        "email",
        "phone",
      ],
      edgeTypes: [
        "verified_same_person",
        "shares_device",
        "shares_ip",
        "shares_email",
        "shares_phone",
        "document_reuse",
        "biometric_match",
        "co-located",
      ],
      riskSignals: [
        "synthetic_identity",
        "fraud_ring_member",
        "device_reuse",
        "document_reuse",
        "biometric_duplicate",
        "impossible_travel",
        "velocity_attack",
        "mule_pattern",
      ],
      examplePayload: {
        nodes: [
          {
            id: "person-001",
            type: "person",
            attributes: { name: "Ahmed Ali", country: "EG" },
            trustScore: 0.5,
            firstSeenAt: "2026-01-01T00:00:00Z",
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
          {
            id: "device-abc",
            type: "device",
            attributes: { fingerprint: "abc123" },
            trustScore: 0.4,
            firstSeenAt: "2026-01-01T00:00:00Z",
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
          {
            id: "person-002",
            type: "person",
            attributes: { name: "Mohamed Saleh", country: "EG" },
            trustScore: 0.3,
            firstSeenAt: "2026-01-05T00:00:00Z",
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
          {
            id: "person-003",
            type: "person",
            attributes: { name: "Khaled Mostafa", country: "EG" },
            trustScore: 0.25,
            firstSeenAt: "2026-02-10T00:00:00Z",
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
        ],
        edges: [
          {
            from: "person-001",
            to: "device-abc",
            type: "shares_device",
            weight: 0.9,
            evidenceCount: 2,
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
          {
            from: "person-002",
            to: "device-abc",
            type: "shares_device",
            weight: 0.85,
            evidenceCount: 1,
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
          {
            from: "person-003",
            to: "device-abc",
            type: "shares_device",
            weight: 0.8,
            evidenceCount: 1,
            lastSeenAt: "2026-09-12T00:00:00Z",
          },
        ],
        query_node_id: "person-001",
        max_hops: 3,
        min_ring_size: 3,
      },
      limitations: [
        "In-memory graph per request — does not persist across cold starts. Persist the serialized graph in Turso/Neon between requests for cross-session detection.",
        "Max 50,000 nodes per request. Larger graphs should be queried in batches.",
        "Fraud ring detection uses union-find over suspicious edges; non-suspicious edges are not traversed for ring detection.",
      ],
    },
    { headers: CORS_HEADERS },
  );
}
