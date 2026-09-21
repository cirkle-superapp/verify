import { NextRequest, NextResponse } from "next/server";
import {
  DOCUMENT_TEMPLATES,
  getTemplate,
  getAllTemplates,
  getTemplateCount,
  matchDocumentToTemplate,
  type DocumentTemplate,
  type DetectedField,
  type BoundingBox,
  type TemplateMatchResult,
} from "@/lib/document-templates";

export const runtime = "nodejs";

/**
 * CORS headers — the document-template endpoint is cross-origin
 * accessible so external OCR / KYC pipelines can call it.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/document-template
 *
 * Cross-origin preflight — responds 204 No Content. Must be defined
 * explicitly so the endpoint participates in CORS handshakes for
 * browser-based OCR tooling that POSTs detected-field arrays.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Coerce an unknown value into a `BoundingBox` ({x, y, w, h} with each
 * component in [0, 1]). Returns `null` if the shape is wrong.
 *
 * Accepts:
 *   - { x, y, w, h }            (canonical)
 *   - { x, y, width, height }   (CSS-style)
 *   - [x, y, w, h]              (array form)
 *
 * Each component is clamped to [0, 1] — values outside that range
 * indicate either a buggy OCR caller or a pixel-coordinate input that
 * wasn't normalized to relative coords.
 */
function coerceBoundingBox(raw: unknown): BoundingBox | null {
  if (raw == null) return null;

  // Array form: [x, y, w, h]
  if (Array.isArray(raw)) {
    if (raw.length < 4) return null;
    const [x, y, w, h] = raw.map((v) => Number(v));
    if ([x, y, w, h].some((v) => !Number.isFinite(v))) return null;
    return {
      x: clamp01(x),
      y: clamp01(y),
      w: clamp01(w),
      h: clamp01(h),
    };
  }

  // Object form: support both {x,y,w,h} and {x,y,width,height}
  if (typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    const x = Number(r.x ?? r.left);
    const y = Number(r.y ?? r.top);
    const w = Number(r.w ?? r.width);
    const h = Number(r.h ?? r.height);
    if (![x, y, w, h].every((v) => Number.isFinite(v))) return null;
    return {
      x: clamp01(x),
      y: clamp01(y),
      w: clamp01(w),
      h: clamp01(h),
    };
  }
  return null;
}

/** Clamp a number to [0, 1]. */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

// ─── GET — list all templates ─────────────────────────────────────

/**
 * GET /api/v1/verify/document-template
 *
 * Returns the full catalog of document templates (30+ countries) with
 * country + docType for each. The full template bodies (fields, layout,
 * colors) are included so callers can render the expected layout for
 * visual verification in their own UI.
 *
 * Response shape:
 *   {
 *     "count": 36,
 *     "templates": [
 *       { "country": "EG", "docType": "national_id", ...fullTemplate },
 *       ...
 *     ]
 *   }
 */
export async function GET() {
  const templates: DocumentTemplate[] = getAllTemplates();
  const summary = templates.map((t) => ({
    country: t.country,
    docType: t.docType,
    fieldCount: t.fields.length,
    hasLogo: !!t.layout.logoPosition,
    hasPhoto: !!t.layout.photoPosition,
    hasMrz: !!t.layout.mrzPosition,
    hasWatermark: !!t.layout.watermarkPosition,
    notes: t.notes,
  }));
  return NextResponse.json(
    {
      count: getTemplateCount(),
      templates: summary,
      fullTemplates: templates,
    },
    { headers: CORS_HEADERS },
  );
}

// ─── POST — match detected fields to template ────────────────────

interface MatchRequestBody {
  image_width?: number;
  imageHeight?: number;
  image_height?: number;
  detected_fields?: Array<{
    name?: string;
    position?: unknown; // BoundingBox | array | CSS-style object
    box?: unknown; // alias for "position"
  }>;
  country?: string;
  doc_type?: string;
  docType?: string;
}

/**
 * POST /api/v1/verify/document-template
 *
 * Match a set of OCR-detected fields (with bounding boxes) against the
 * expected field positions of a specific country+docType template.
 *
 * Request body:
 *   {
 *     "image_width": 1920,
 *     "image_height": 1080,
 *     "detected_fields": [
 *       { "name": "fullName", "position": { "x": 0.06, "y": 0.07, "w": 0.60, "h": 0.08 } },
 *       { "name": "nationalId", "position": { "x": 0.04, "y": 0.51, "w": 0.65, "h": 0.09 } }
 *     ],
 *     "country": "EG",
 *     "doc_type": "national_id"
 *   }
 *
 * Response:
 *   {
 *     "matchScore": 0.85,
 *     "matchedFields": ["fullName", "nationalId", ...],
 *     "mismatchedFields": ["address (missing)", ...],
 *     "explanation": "strong match (85.0%) for EG national_id template: ...",
 *     "template": { ...fullTemplateForReference }
 *   }
 *
 * Status codes:
 *   200 — successful match (regardless of score; even a 0.0 score is
 *          a valid match result — the caller asked "does this match?")
 *   400 — missing required fields (no country/doc_type, or
 *          detected_fields not an array)
 *   404 — no template exists for the requested country+doc_type
 *   500 — unexpected error
 */
export async function POST(req: NextRequest) {
  let body: MatchRequestBody;
  try {
    body = (await req.json()) as MatchRequestBody;
  } catch {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Normalize field name aliases — the spec uses snake_case but
  // callers may pass camelCase. Accept both.
  const imageWidth = Number(body.image_width ?? 0) || 0;
  const imageHeight = Number(body.image_height ?? body.imageHeight ?? 0) || 0;
  const country = body.country;
  const docType = body.doc_type ?? body.docType;
  const detectedFieldsRaw = body.detected_fields;

  // ── Validate required inputs ──
  if (!country || typeof country !== "string") {
    return NextResponse.json(
      { error: "missing required field: country (ISO alpha-2)" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!docType || typeof docType !== "string") {
    return NextResponse.json(
      { error: "missing required field: doc_type (national_id | passport | driver_license | residence)" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  if (!Array.isArray(detectedFieldsRaw)) {
    return NextResponse.json(
      { error: "missing or non-array: detected_fields must be an array of { name, position }" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // ── Look up the template ──
  const template = getTemplate(country, docType);
  if (!template) {
    const available = DOCUMENT_TEMPLATES.filter(
      (t) => t.country.toUpperCase() === country.toUpperCase(),
    ).map((t) => ({ docType: t.docType, fields: t.fields.length }));
    return NextResponse.json(
      {
        error: `no template for country="${country}" doc_type="${docType}"`,
        availableDocTypesForCountry: available,
        totalTemplates: getTemplateCount(),
      },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  // ── Coerce detected_fields into DetectedField[] with BoundingBox ──
  const detectedFields: DetectedField[] = [];
  const coercionWarnings: string[] = [];
  for (let i = 0; i < detectedFieldsRaw.length; i++) {
    const df = detectedFieldsRaw[i];
    if (!df || typeof df !== "object") {
      coercionWarnings.push(`detected_fields[${i}]: not an object, skipped`);
      continue;
    }
    const name = df.name;
    if (!name || typeof name !== "string") {
      coercionWarnings.push(`detected_fields[${i}]: missing or non-string "name", skipped`);
      continue;
    }
    const position = coerceBoundingBox(df.position ?? df.box);
    if (!position) {
      coercionWarnings.push(
        `detected_fields[${i}] ("${name}"): invalid position (expected {x,y,w,h} in 0-1), skipped`,
      );
      continue;
    }
    detectedFields.push({ name, position });
  }

  // ── Run the matcher ──
  let result: TemplateMatchResult;
  try {
    result = matchDocumentToTemplate(
      imageWidth,
      imageHeight,
      detectedFields,
      template,
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: "match failed",
        message: e?.message || String(e),
        country,
        docType,
        templateFieldCount: template.fields.length,
        detectedFieldCount: detectedFields.length,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    {
      ...result,
      country,
      docType,
      imageWidth,
      imageHeight,
      detectedFieldCount: detectedFields.length,
      templateFieldCount: template.fields.length,
      coercionWarnings,
      template: {
        country: template.country,
        docType: template.docType,
        fieldCount: template.fields.length,
        fields: template.fields,
        layout: template.layout,
        colors: template.colors,
        notes: template.notes,
      },
    },
    { headers: CORS_HEADERS },
  );
}
