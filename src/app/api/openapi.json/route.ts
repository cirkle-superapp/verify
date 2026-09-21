import { NextResponse } from "next/server";

/**
 * GET /api/openapi.json
 *
 * Returns the complete OpenAPI 3.1.0 specification for the Cirkle
 * Identity Verification API. The spec covers 50+ endpoints across
 * the Health/Platform, Verification, V1 API, Chatbot, Docs, and
 * Inngest surfaces. Swagger UI (hosted at petstore.swagger.io) can
 * consume this URL directly to render an interactive API explorer:
 *
 *   https://petstore.swagger.io/?url=https://cirkle-verify.vercel.app/api/openapi.json
 *
 * The spec is generated as a static object literal — no DB lookups,
 * no AI calls — so it has constant ~5ms latency and a tiny cold-start
 * footprint. It is cache-friendly (immutable between deployments).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Shared component schemas ────────────────────────────────────────
// Reused across many operations to keep the spec compact.

const SCHEMAS = {
  ImageBase64: {
    type: "string",
    description:
      "Base64-encoded image (data URL). Accepted formats: data:image/jpeg;base64,..., data:image/png;base64,..., or data:image/webp;base64,...",
    example:
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgK...",
  },
  DocType: {
    type: "string",
    enum: [
      "national_id",
      "passport",
      "driver_license",
      "residence",
      "vehicle_license",
      "health_card",
      "student_id",
    ],
    description: "Document type identifier",
  },
  DocumentExtractionRequest: {
    type: "object",
    required: ["frontImage"],
    properties: {
      frontImage: { $ref: "#/components/schemas/ImageBase64" },
      backImage: { $ref: "#/components/schemas/ImageBase64" },
      docType: { $ref: "#/components/schemas/DocType" },
      country: {
        type: "string",
        description: "ISO 3166-1 alpha-2 country code (e.g. EG, SA, AE)",
        example: "EG",
      },
      useConsensus: {
        type: "boolean",
        description: "Whether to invoke AI consensus (5-provider vote). Default true.",
      },
    },
  },
  FaceMatchRequest: {
    type: "object",
    required: ["selfie", "docImage"],
    properties: {
      selfie: { $ref: "#/components/schemas/ImageBase64" },
      docImage: { $ref: "#/components/schemas/ImageBase64" },
      threshold: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Similarity threshold above which the faces match. Default 60.",
        example: 60,
      },
    },
  },
  LivenessRequest: {
    type: "object",
    required: ["frames"],
    properties: {
      frames: {
        type: "array",
        items: { $ref: "#/components/schemas/ImageBase64" },
        description: "Ordered sequence of webcam frames (≥3 recommended).",
      },
      actions: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "turn_left",
            "turn_right",
            "smile",
            "blink",
            "nod",
            "raise_eyebrows",
          ],
        },
        description: "Challenge-response actions the user was asked to perform.",
      },
    },
  },
  ValidateIdRequest: {
    type: "object",
    required: ["country", "id"],
    properties: {
      country: {
        type: "string",
        description: "ISO 3166-1 alpha-2 country code",
        example: "EG",
      },
      id: {
        type: "string",
        description: "National ID number to validate",
        example: "29608010101234",
      },
    },
  },
  ParseMrzRequest: {
    type: "object",
    required: ["text"],
    properties: {
      text: {
        type: "string",
        description:
          "Raw MRZ text (1-3 lines). Whitespace and newlines are normalized automatically.",
        example:
          "I<EGY29608010101234<<<<<<<<<<<<<\n8001010F3001019EGY<<<<<<<<<<<<<<\nMOHAMED<<AHMED<<<<<<<<<<<<<<<<<<",
      },
    },
  },
  CrossCheckRequest: {
    type: "object",
    required: ["fields"],
    properties: {
      fields: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Extracted fields keyed by field name (nationalId, fullNameAr, birthDate, etc.).",
      },
      country: { type: "string", example: "EG" },
      docType: { $ref: "#/components/schemas/DocType" },
    },
  },
  OcrCorrectRequest: {
    type: "object",
    required: ["text"],
    properties: {
      text: { type: "string", description: "OCR text to post-process (Arabic, English, or mixed).", example: "محمد أحمد" },
      field: {
        type: "string",
        description: "Field name (fullNameAr, nationalId, etc.) for context-aware correction.",
        example: "fullNameAr",
      },
    },
  },
  TamperingRequest: {
    type: "object",
    required: ["image"],
    properties: {
      image: { $ref: "#/components/schemas/ImageBase64" },
      docType: { $ref: "#/components/schemas/DocType" },
    },
  },
  ChatRequest: {
    type: "object",
    required: ["messages"],
    properties: {
      messages: {
        type: "array",
        items: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: { type: "string", enum: ["user", "assistant"] },
            content: { type: "string" },
          },
        },
      },
      sessionId: { type: "string", description: "Optional conversation session ID." },
    },
  },
  GenericError: {
    type: "object",
    properties: {
      error: { type: "string" },
      code: { type: "string", description: "Stable error code (e.g. INVALID_BODY)." },
    },
  },
  HealthResponse: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["healthy", "degraded", "down"] },
      timestamp: { type: "string", format: "date-time" },
      version: { type: "string" },
      checks: { type: "object", additionalProperties: true },
    },
  },
  VerificationRecord: {
    type: "object",
    properties: {
      id: { type: "string" },
      docType: { $ref: "#/components/schemas/DocType" },
      status: { type: "string", enum: ["verified", "rejected", "needs_review", "pending"] },
      score: { type: "number", minimum: 0, maximum: 100 },
      createdAt: { type: "string", format: "date-time" },
    },
  },
} as const;

// ─── Shared response blocks ─────────────────────────────────────────

const RESP = {
  BadRequest: {
    description: "Bad request — missing or invalid parameters/body.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/GenericError" } },
    },
  },
  Unauthorized: {
    description: "Unauthorized — missing or invalid X-API-Key.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/GenericError" } },
    },
  },
  ServerError: {
    description: "Internal server error.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/GenericError" } },
    },
  },
  Ok: (schemaRef: string, description = "OK") => ({
    description,
    content: {
      "application/json": { schema: { $ref: schemaRef } },
    },
  }),
} as const;

// ─── Helpers to build operations concisely ──────────────────────────

function standardResponses() {
  return {
    "200": { description: "Successful response." },
    "400": RESP.BadRequest,
    "401": RESP.Unauthorized,
    "500": RESP.ServerError,
  };
}

function postOp(
  tag: string,
  summary: string,
  description: string,
  bodyRef: string,
  opts: { okSchema?: string; okDescription?: string } = {},
) {
  return {
    post: {
      tags: [tag],
      summary,
      description,
      security: [{ ApiKeyAuth: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: bodyRef } } },
      },
      responses: {
        ...(opts.okSchema
          ? { "200": RESP.Ok(opts.okSchema, opts.okDescription || "OK") }
          : { "200": { description: "Successful response." } }),
        "400": RESP.BadRequest,
        "401": RESP.Unauthorized,
        "500": RESP.ServerError,
      },
    },
  };
}

function getOp(
  tag: string,
  summary: string,
  description: string,
  opts: {
    params?: any[];
    okSchema?: string;
    okDescription?: string;
    noSecurity?: boolean;
  } = {},
) {
  return {
    get: {
      tags: [tag],
      summary,
      description,
      ...(opts.noSecurity ? {} : { security: [{ ApiKeyAuth: [] }] }),
      ...(opts.params ? { parameters: opts.params } : {}),
      responses: opts.okSchema
        ? {
            "200": RESP.Ok(opts.okSchema, opts.okDescription || "OK"),
            "400": RESP.BadRequest,
            "401": RESP.Unauthorized,
            "500": RESP.ServerError,
          }
        : standardResponses(),
    },
  };
}

function pathParam(name: string, description: string, example: string) {
  return {
    name,
    in: "path",
    required: true,
    description,
    schema: { type: "string" },
    example,
  };
}

function queryParam(name: string, description: string, example: any) {
  return {
    name,
    in: "query",
    required: false,
    description,
    schema: { type: typeof example === "number" ? "number" : "string" },
    example,
  };
}

// ─── The OpenAPI 3.1.0 spec ──────────────────────────────────────────

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Cirkle Identity Verification API",
    version: "3.2.0",
    description:
      "Self-hosted, zero-cost, state-of-the-art KYC platform. AI consensus across 5 vision LLMs, self-hosted OCR + face-api + liveness, ICAO 9303 MRZ parser, 73-country document security specs, 54 national ID validators, HMAC-signed verification certificates, fraud-ring detection, bias monitoring, adversarial-attack detection, multimodal fusion, and continuous authentication. All processing is fail-closed and zero-cost by default.",
    contact: { email: "ops@cirkle.dev" },
    license: {
      name: "MIT",
      url: "https://github.com/cirkle-superapp/verify/blob/main/LICENSE",
    },
  },
  servers: [
    { url: "https://cirkle-verify.vercel.app", description: "Production" },
    { url: "http://localhost:3000", description: "Local dev" },
  ],
  tags: [
    { name: "Health & Platform", description: "Liveness probes + platform orchestration." },
    { name: "Verification", description: "Document extraction, face match, liveness, MRZ, cross-field validation, tampering, and records." },
    { name: "V1 API", description: "Public, stable V1 surface for partner integrations." },
    { name: "Chatbot", description: "RAG-powered assistant for KYC questions." },
    { name: "Docs & Inngest", description: "API docs + Inngest webhook." },
  ],
  paths: {
    // ─── Health & Platform ────────────────────────────────────────────
    "/api/health": {
      ...getOp(
        "Health & Platform",
        "Comprehensive health check",
        "Checks Turso (authoritative DB), Neon (recovery DB), AI consensus providers, circuit breakers, and the current database epoch. Returns 200 if Turso is healthy, 503 otherwise.",
        { okSchema: "#/components/schemas/HealthResponse", okDescription: "Current health snapshot.", noSecurity: true },
      ),
    },
    "/api/platform/status": {
      ...getOp(
        "Health & Platform",
        "Unified platform status",
        "Returns epoch, database health/replication, storage/email/SMS quotas, workflow health, circuit-breaker states, and the cost-model classification (zero-cost / over-quota / fail-closed).",
        { noSecurity: true },
      ),
    },
    "/api/platform/harmony": {
      ...getOp(
        "Health & Platform",
        "Platform harmony score",
        "Computes a 0-100 harmony score across Vercel, Turso, Neon, Inngest, epoch fencing, circuit breakers, AI consensus, and data presence. Verdict: PERFECT HARMONY / GOOD / DEGRADED / CRITICAL.",
        { noSecurity: true },
      ),
    },
    "/api/platform/epoch": {
      ...getOp(
        "Health & Platform",
        "Get current epoch",
        "Returns the current database epoch (fencing token) and which platform (turso or neon) is currently authoritative/writable.",
        { noSecurity: true },
      ),
    },
    "/api/platform/outbox/drain": {
      ...postOp(
        "Health & Platform",
        "Drain outbox events",
        "Drains pending outbox events from Turso and relays them to Inngest + Neon. Normally called by Inngest cron or a Cloudflare Worker. Requires the INNGEST_SIGNING_KEY bearer token.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "Number of events drained/applied/failed." },
      ),
    },

    // ─── Verification ─────────────────────────────────────────────────
    "/api/verify/document": {
      ...postOp(
        "Verification",
        "Extract document fields",
        "Runs self-hosted Tesseract OCR + AI consensus (Gemini + OpenRouter + NVIDIA vision in parallel with per-field majority vote) to extract structured fields from an ID document. Merges self-hosted baseline with consensus results.",
        "#/components/schemas/DocumentExtractionRequest",
        { okDescription: "ExtractedDocumentData with confidence + consensus metadata." },
      ),
    },
    "/api/verify/face-match": {
      ...postOp(
        "Verification",
        "Face match",
        "Compares a selfie to a document photo using self-hosted face-api (128-d descriptor + cosine) + AI consensus (3 vision providers cross-check). Final verdict = selfHosted.isMatch AND consensus.isMatch.",
        "#/components/schemas/FaceMatchRequest",
        { okDescription: "FaceMatchResult { isMatch, similarity, reasoning }." },
      ),
    },
    "/api/verify/face-quality": {
      ...postOp(
        "Verification",
        "Face image quality",
        "Scores a face image across 13 ISO/IEC 19794-5 dimensions: blur, illumination, expression, occlusion, head-pose, eyes-open, mouth-open, glare, shadow, background, contrast, resolution, pose-angle.",
        "#/components/schemas/FaceMatchRequest",
        { okDescription: "FaceQualityReport { overall, score, dimensions, issues }." },
      ),
    },
    "/api/verify/liveness": {
      ...postOp(
        "Verification",
        "Liveness detection",
        "Combines self-hosted motion analysis + Liveness Pro directional/anti-spoofing + AI consensus to detect presentation attacks (print, screen, 3D mask).",
        "#/components/schemas/LivenessRequest",
        { okDescription: "LivenessResult { isLive, score, proBreakdown }." },
      ),
    },
    "/api/verify/liveness-pro": {
      ...postOp(
        "Verification",
        "Liveness Pro v2 standalone",
        "9 PAD signals: optical-flow consistency, LBP texture, FFT moiré, color distortion, 3D depth disparity, specular highlights, blink, plus directional motion + challenge-response.",
        "#/components/schemas/LivenessRequest",
        { okDescription: "LivenessProScore with 9 PAD sub-scores + aggregate." },
      ),
    },
    "/api/verify/validate-id": {
      ...postOp(
        "Verification",
        "Validate national ID checksum",
        "Validates a national ID number against the country-specific checksum algorithm (Egypt 14-digit mod-11, Saudi Hijri, IBAN MOD-97, Luhn, ISO 7064, etc.).",
        "#/components/schemas/ValidateIdRequest",
        { okDescription: "IdValidation { isValid, checksumValid, extractedFields, reasoning }." },
      ),
    },
    "/api/verify/parse-mrz": {
      ...postOp(
        "Verification",
        "Parse ICAO 9303 MRZ",
        "Parses TD1, TD2, or TD3 machine-readable zone text and validates all check digits (document number, birth date, expiry date, composite). Returns structured fields.",
        "#/components/schemas/ParseMrzRequest",
        { okDescription: "MrzResult { format, documentNumber, birthDate, sex, expiryDate, name, checkDigitValid, valid, errors }." },
      ),
    },
    "/api/verify/cross-check": {
      ...postOp(
        "Verification",
        "Cross-field validation",
        "Runs 30 cross-field consistency checks: birthDate vs nationalId century/year/month/day, gender vs sequence parity, MRZ vs OCR-merged fields, expiry not in past, document number length per country spec, etc.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "CrossFieldResult { passed, failed, warnings, score }." },
      ),
    },
    "/api/verify/ocr-correct": {
      ...postOp(
        "Verification",
        "OCR post-processing correction",
        "Applies OCR confusion maps + a 990-name Arabic/Western dictionary + field-specific patterns to clean common OCR errors (0↔O, 1↔I, ll↔I, ة↔ه, etc.).",
        "#/components/schemas/OcrCorrectRequest",
        { okDescription: "OcrCorrectResult { corrected, applied, dictionaryHit }." },
      ),
    },
    "/api/verify/tampering": {
      ...postOp(
        "Verification",
        "Tampering detection",
        "Detects image tampering: ELA (error-level analysis), noise inconsistency, copy-move (DCT block matching), seam-carving artifacts, JPEG ghosting, clone detection.",
        "#/components/schemas/TamperingRequest",
        { okDescription: "TamperingReport { tampered, signals, score }." },
      ),
    },
    "/api/verify/specs": {
      ...getOp(
        "Verification",
        "Document specs catalog",
        "Returns the full 132-doc-spec catalog across 73 countries. Filter by ?country=EG&docType=national_id. ?stats=1 returns only summary stats.",
        {
          params: [
            queryParam("country", "ISO 3166-1 alpha-2 country code.", "EG"),
            queryParam("docType", "Document type filter.", "national_id"),
            queryParam("stats", "1 = return only summary stats (no spec list).", "1"),
          ],
          noSecurity: true,
        },
      ),
    },
    "/api/verify/records": {
      ...getOp("Verification", "List verification records", "Returns the most recent 200 verification records from the authoritative Turso database.", { noSecurity: true, okSchema: "#/components/schemas/VerificationRecord" }),
    },
    "/api/verify/records/{id}": {
      parameters: [pathParam("id", "Verification record ID (UUID).", "550e8400-e29b-41d4-a716-446655440000")],
      ...getOp("Verification", "Get verification record by ID", "Fetches a single verification record by its UUID.", { noSecurity: true, okSchema: "#/components/schemas/VerificationRecord" }),
    },
    "/api/verify/samples": {
      ...getOp(
        "Verification",
        "Document sample images",
        "Returns metadata for synthetic document samples (front/back images + ground-truth fields) used as test fixtures.",
        {
          params: [queryParam("country", "Filter by country.", "EG"), queryParam("docType", "Filter by document type.", "national_id")],
          noSecurity: true,
        },
      ),
    },
    "/api/verify/consensus-status": {
      ...getOp(
        "Verification",
        "AI consensus status",
        "Returns whether AI consensus mode is active, the configured providers (Gemini, Groq, OpenRouter, NVIDIA, HuggingFace), and the per-provider agreement threshold (≥0.85).",
        { noSecurity: true },
      ),
    },
    "/api/verify/evaluate": {
      ...postOp(
        "Verification",
        "Run evaluation suite",
        "Submits a labeled evaluation set (predictions vs ground truth) and computes precision, recall, F1, ACER (Average Classification Error Rate), and per-class confusion matrix. Persists to the eval-lab table.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "EvaluationResult { precision, recall, f1, acer, confusionMatrix }." },
      ),
    },

    // ─── V1 API ───────────────────────────────────────────────────────
    "/api/v1/verify/document": {
      ...postOp(
        "V1 API",
        "V1 document extraction",
        "Stable V1 surface for document extraction. Identical behavior to /api/verify/document but versioned and rate-limited per API key.",
        "#/components/schemas/DocumentExtractionRequest",
        { okDescription: "ExtractedDocumentData with consensus metadata." },
      ),
    },
    "/api/v1/verify/face-match": {
      ...postOp(
        "V1 API",
        "V1 face match",
        "Stable V1 surface for face matching. Returns isMatch (bool), similarity (0-100), and reasoning.",
        "#/components/schemas/FaceMatchRequest",
        { okDescription: "FaceMatchResult." },
      ),
    },
    "/api/v1/verify/liveness": {
      ...postOp(
        "V1 API",
        "V1 liveness",
        "Stable V1 surface for liveness detection. Returns isLive (bool), score (0-100), and detected actions.",
        "#/components/schemas/LivenessRequest",
        { okDescription: "LivenessResult." },
      ),
    },
    "/api/v1/verify/fraud-check": {
      ...postOp(
        "V1 API",
        "Fraud ring + image hash check",
        "Computes pHash + aHash + dHash of the submitted image, checks the fraud-ring graph (identity-graph) for known bad nodes, and returns a risk verdict.",
        "#/components/schemas/TamperingRequest",
        { okDescription: "FraudReport { risk, matchedRings, imageHash }." },
      ),
    },
    "/api/v1/verify/risk-assessment": {
      ...postOp(
        "V1 API",
        "Risk-adaptive assessment",
        "Computes a 0-100 risk score from velocity, IP reputation, device fingerprint, document confidence, face similarity, and liveness. Returns strictness level (low/medium/high) + recommended next steps.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "RiskAssessment { score, level, factors }." },
      ),
    },
    "/api/v1/verify/certificate": {
      ...postOp(
        "V1 API",
        "Issue verification certificate",
        "Issues an HMAC-SHA256-signed verification certificate for a completed verification record. Includes the canonical payload hash, algorithm, keyId, and short signature.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "VerificationCertificate { id, signature, algorithm, keyId, short, payloadHash }." },
      ),
    },
    "/api/v1/verify/explain": {
      ...getOp(
        "V1 API",
        "Explain verification decision",
        "Returns LIME/SHAP-style local feature contributions for a verification decision (which fields weighted most for/against the verdict).",
        { params: [queryParam("id", "Verification ID.", "550e8400-e29b-41d4-a716-446655440000")] },
      ),
    },
    "/api/v1/verify/session/{id}": {
      parameters: [pathParam("id", "Session ID (UUID).", "sess_abc123")],
      ...getOp(
        "V1 API",
        "Get verification session",
        "Returns the state, current step, and metadata for a verification session by ID.",
        { okDescription: "VerificationSession { id, state, step, details, createdAt, updatedAt }." },
      ),
    },
    "/api/v1/verify/batch": {
      ...postOp(
        "V1 API",
        "Batch verification",
        "Processes up to 50 documents in parallel. Each item accepts frontImage + optional selfieImage + docType + country. Returns per-item results + summary counts.",
        "#/components/schemas/DocumentExtractionRequest",
        { okDescription: "BatchResult { status, succeeded, failed, results[] }." },
      ),
    },
    "/api/v1/verify/analytics": {
      ...getOp(
        "V1 API",
        "Verification analytics",
        "Returns aggregated analytics: total verifications, pass rate, average score, top failure reasons, country breakdown, daily volume, p50/p95 latency.",
        {
          params: [
            queryParam("from", "Start date (ISO 8601).", "2026-01-01T00:00:00Z"),
            queryParam("to", "End date (ISO 8601).", "2026-12-31T23:59:59Z"),
            queryParam("groupBy", "Aggregation bucket (day, country, docType).", "day"),
          ],
        },
      ),
    },
    "/api/v1/verify/webhook": {
      ...postOp(
        "V1 API",
        "Register webhook",
        "Registers a webhook URL + secret for a partner. Cirkle will POST verification lifecycle events (verification.completed, verification.rejected) to this URL with an HMAC-SHA256 signature header.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "WebhookRegistration { id, url, events, secretHash }." },
      ),
    },
    "/api/v1/verify/gdpr": {
      ...getOp(
        "V1 API",
        "GDPR data inventory",
        "Returns a GDPR Art. 30 data inventory: what PII Cirkle stores, where (Turso/Neon/Blob), retention policy, lawful basis, and data-subject rights endpoints.",
        {},
      ),
    },
    "/api/v1/verify/forensics": {
      ...postOp(
        "V1 API",
        "Forensic analysis",
        "Deep forensic analysis: full ELA heatmap, JPEG ghost map, noise residual, DCT coefficients, CFA interpolation check, EXIF sanity, and copy-move clone heatmap.",
        "#/components/schemas/TamperingRequest",
        { okDescription: "ForensicsReport { tampered, signals[], heatmaps[] }." },
      ),
    },
    "/api/v1/verify/audit-chain": {
      ...getOp(
        "V1 API",
        "Audit chain",
        "Returns the hash-chained audit log entries (each entry's hash chains to the previous, providing tamper-evidence for SOC 2 / ISO 27001 auditors).",
        {
          params: [
            queryParam("limit", "Max entries to return (default 100).", 100),
            queryParam("since", "ISO 8601 timestamp to start from.", "2026-01-01T00:00:00Z"),
          ],
        },
      ),
    },
    "/api/v1/verify/model-card": {
      ...getOp(
        "V1 API",
        "AI model card",
        "Returns the model card for each AI provider Cirkle uses (Gemini, Groq, OpenRouter, NVIDIA, HuggingFace): intended use, training data summary, evaluation metrics, biases known, limitations, contact.",
        {},
      ),
    },
    "/api/v1/verify/sbom": {
      ...getOp(
        "V1 API",
        "Software Bill of Materials (SBOM)",
        "Returns the full SBOM (CycloneDX 1.5 format) listing all 90+ dependencies with versions, licenses, and known CVEs.",
        {},
      ),
    },
    "/api/v1/verify/metrics": {
      ...getOp(
        "V1 API",
        "Prometheus metrics",
        "Returns Prometheus-format metrics: request count, latency histogram, error rate, AI provider latency, OCR confidence distribution, face similarity distribution.",
        {},
      ),
    },
    "/api/v1/verify/health/deep": {
      ...getOp(
        "V1 API",
        "Deep health probe",
        "Probes every platform subsystem (Turso, Neon, Inngest, 5 AI providers, Vercel Blob, Brevo, circuit breakers) in parallel and returns per-component status + latency. Used by ops dashboards.",
        { noSecurity: true, okDescription: "DeepHealth { overall, components[], summary }." },
      ),
    },
    "/api/v1/verify/benchmark": {
      ...postOp(
        "V1 API",
        "Run benchmark suite",
        "Runs the curated benchmark suite (LFW face match, iQIYI liveness, MIDV-500 document OCR, MRZ synthetic 100K) against the current model stack and returns accuracy + latency.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "BenchmarkReport { suites[], summary }." },
      ),
    },
    "/api/v1/verify/provenance": {
      ...getOp(
        "V1 API",
        "Model + data provenance",
        "Returns the provenance chain for the current model stack: training data source, generation date, model weights hash, evaluation hash, deployment commit SHA, deployer identity.",
        {},
      ),
    },
    "/api/v1/verify/identity-graph": {
      ...postOp(
        "V1 API",
        "Identity graph query",
        "Builds/queries the identity graph: nodes are identities (name, DOB, ID hash, face hash), edges are shared attributes (same device, same IP, same face). Detects fraud rings via community detection.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "IdentityGraph { nodes[], edges[], communities[], riskRings[] }." },
      ),
    },
    "/api/v1/verify/bias-report": {
      ...postOp(
        "V1 API",
        "Bias monitoring report",
        "Computes fairness metrics across protected attributes (gender, age band, country, skin tone proxy): demographic parity, equalized odds, disparate impact ratio. Flags any group with >20% adverse impact.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "BiasReport { groups[], disparateImpactRatio, flagged }." },
      ),
    },
    "/api/v1/verify/adversarial-detection": {
      ...postOp(
        "V1 API",
        "Adversarial attack detection",
        "Detects adversarial perturbations (FGSM, PGD, DeepFool, Carlini-Wagner) against the document/face/liveness classifiers. Returns attack probability + perturbation magnitude.",
        "#/components/schemas/TamperingRequest",
        { okDescription: "AdversarialReport { attacked, attackType, magnitude, confidence }." },
      ),
    },
    "/api/v1/verify/multimodal-fusion": {
      ...postOp(
        "V1 API",
        "Multimodal fusion",
        "Fuses the document, face, liveness, MRZ, cross-field, tampering, and risk signals into a single calibrated verification score using a late-fusion stacking classifier.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "FusionResult { score, verdict, contributions{} }." },
      ),
    },
    "/api/v1/verify/continuous-auth": {
      ...postOp(
        "V1 API",
        "Continuous authentication",
        "Issues a rotating session token + behavioral biometric signature (keystroke dynamics, mouse cadence, gyro on mobile). Validates against the prior window's signature.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "ContinuousAuthResult { token, signature, drift, valid }." },
      ),
    },
    "/api/v1/verify/synthetic-data": {
      ...postOp(
        "V1 API",
        "Generate synthetic data",
        "Generates synthetic verification samples (privacy-preserving, no real PII) for testing/benchmarking. Supports identity, face, fraud_rings, mrz, adversarial.",
        "#/components/schemas/CrossCheckRequest",
        { okDescription: "SyntheticDataResult { count, samples[], generatorVersion }." },
      ),
    },
    "/api/v1/verify/image-analysis": {
      ...postOp(
        "V1 API",
        "Image quality analysis",
        "Server-side image quality analysis: sharpness (Laplacian variance), brightness, contrast, noise RMS, glare fraction, skew angle, DPI estimate. Returns ImageQualityReport with per-issue recommendations.",
        "#/components/schemas/TamperingRequest",
        { okDescription: "ImageQualityReport { overall, score, issues[], metrics{} }." },
      ),
    },
    "/api/v1/verify/image-enhance": {
      ...postOp(
        "V1 API",
        "Image enhancement",
        "Applies server-side image enhancement (brightness, contrast, sharpness, denoise, auto-crop, resize) using sharp. Returns enhanced image (data URL) + adjustments dict + quality report.",
        "#/components/schemas/TamperingRequest",
        { okDescription: "EnhanceResult { image, adjustments{}, quality{} }." },
      ),
    },
    "/api/v1/verify/report": {
      ...getOp(
        "V1 API",
        "Verification PDF report",
        "Returns the HTML verification report with embedded HMAC-SHA256 signature. ?format=json returns metadata only. ?signature=Y verifies a third-party-supplied signature.",
        {
          params: [
            queryParam("verification_id", "Verification ID to render.", "550e8400-e29b-41d4-a716-446655440000"),
            queryParam("format", "html (default), or json for metadata only.", "html"),
            queryParam("signature", "Optional: signature to verify against the record.", "abc123"),
          ],
          noSecurity: true,
        },
      ),
    },

    // ─── Chatbot ──────────────────────────────────────────────────────
    "/api/chat": {
      ...postOp(
        "Chatbot",
        "Chat with Cirkle Assistant",
        "RAG-powered chatbot for KYC, document security features, MRZ, liveness, and the Cirkle platform. Retrieves top-k knowledge chunks (132 doc specs, 54 ID validators, 30 cross-field checks, 990-name dictionary) and feeds them as context to glm-4-plus. Falls back to direct knowledge-base answers if the LLM is unreachable.",
        "#/components/schemas/ChatRequest",
        { okDescription: "ChatResponse { reply, sessionId, sources[] }." },
      ),
    },
    "/api/chat/health": {
      ...getOp(
        "Chatbot",
        "Chatbot service health",
        "Returns the chatbot service status + live knowledge-base stats (countries, docSpecs, idValidators, mrzFormats, crossFieldChecks, faceQualityDims, livenessSignals, aiProviders).",
        { noSecurity: true, okDescription: "ChatHealth { status, knowledgeBase, llmProvider, model, rateLimit }." },
      ),
    },

    // ─── Docs & Inngest ───────────────────────────────────────────────
    "/api/docs": {
      ...getOp(
        "Docs & Inngest",
        "Endpoint inventory",
        "Returns the legacy endpoint inventory JSON (35+ endpoints with descriptions, bodies, and example responses). The OpenAPI spec at /api/openapi.json supersedes this for machine consumption.",
        { noSecurity: true },
      ),
    },
    "/api/inngest": {
      get: {
        tags: ["Docs & Inngest"],
        summary: "Inngest SDK probe",
        description:
          "Inngest SDK route. GET is a probe / health check used by Inngest to verify the endpoint is up.",
        responses: { "200": { description: "Inngest SDK probe response." }, "500": RESP.ServerError },
      },
      post: {
        tags: ["Docs & Inngest"],
        summary: "Inngest function invoke",
        description: "POST invokes a registered Inngest durable workflow. Used by Inngest to trigger functions on event.",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
        },
        responses: { "200": { description: "Function output." }, "400": RESP.BadRequest, "500": RESP.ServerError },
      },
      put: {
        tags: ["Docs & Inngest"],
        summary: "Inngest function register",
        description: "PUT registers all Cirkle durable workflows with Inngest on deployment. Called by Inngest polling.",
        security: [],
        responses: { "200": { description: "Registration acknowledged." }, "500": RESP.ServerError },
      },
    },
  },
  components: {
    schemas: SCHEMAS,
    responses: RESP,
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description:
          "API key issued via /api/v1/api-keys (admin only). Required for all V1 endpoints. Health endpoints and the chatbot do NOT require a key.",
      },
    },
  },
} as const;

/**
 * GET /api/openapi.json — returns the OpenAPI 3.1.0 spec.
 *
 * The spec is built once at module load and cached for the lifetime of
 * the serverless instance. CORS is permissive (the spec is public).
 */
export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "X-Spec-Endpoint-Count": String(
        Object.keys(spec.paths).length,
      ),
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
