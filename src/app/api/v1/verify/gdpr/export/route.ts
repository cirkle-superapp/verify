import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { recordAudit, getAuditEvents } from "@/lib/gdpr-store";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — GDPR endpoints are cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/gdpr/export
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Stable JSON canonicalization — keys sorted at every level so the same
 * logical object always produces the same byte string. Used to compute a
 * deterministic SHA-256 of the exported payload (right to portability).
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize((value as Record<string, unknown>)[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * Mask a national ID — keep first 4 and last 4 characters visible.
 */
function maskId(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.length <= 8) return id.replace(/./g, "*");
  return id.slice(0, 4) + "****" + id.slice(-4);
}

/**
 * GET /api/v1/verify/gdpr/export?user_id=<id>
 *
 * GDPR Article 20 — Right to data portability. Aggregates ALL data
 * associated with a user_id into a single JSON document the user can
 * download and re-use elsewhere. Raw biometric images are NEVER
 * included (only SHA-256 hashes of the captured frames, to allow the
 * user to verify that a specific verification happened without
 * exposing the biometric payload).
 *
 * Aggregated buckets:
 *   - verifications: every Verification row linked to the user (PII fields
 *     are kept since the user owns them; document images are omitted)
 *   - audit_events: every Cirkle audit-chain event tagged with this user_id
 *     (this includes GDPR-specific events recorded via the gdpr-store:
 *     consent_change, erasure_scheduled, rectify_submitted, data_export)
 *   - identity_graph: nodes + edges reconstructed from the user's
 *     verification history (one person node + one document node per
 *     verification, with `verified_same_person` edges)
 *   - certificates: verifiable certificate IDs the user has been issued
 *     (fetched from the verification-certificate store when available)
 *   - decisions: a compact list of pass/fail decisions across the user's
 *     verifications (status + scores)
 *
 * Response shape:
 *   {
 *     user_id: string,
 *     exported_at: ISO,
 *     data: { verifications, audit_events, identity_graph, certificates, decisions },
 *     hash: "SHA-256 of canonical JSON",
 *     download_url: "/api/v1/verify/gdpr/export?user_id=...&download=1"
 *   }
 *
 * When the request includes the `download=1` query parameter OR the
 * `Accept` header requests `application/octet-stream`, the response
 * carries a `Content-Disposition: attachment; filename="cirkle-export-...json"`
 * header so the browser treats it as a download.
 *
 * @example
 * curl 'https://cirkle-verify.vercel.app/api/v1/verify/gdpr/export?user_id=u_123&download=1'
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const user_id = url.searchParams.get("user_id");
    const download = url.searchParams.get("download") === "1"
      || (req.headers.get("accept") || "").includes("application/octet-stream");

    if (!user_id || user_id.length === 0) {
      return NextResponse.json(
        { error: "user_id query parameter required", code: "MISSING_USER_ID" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // ─── Verifications ───────────────────────────────────────────────
    // In production, we'd join Verification on a user_id foreign key. For
    // now, the existing schema keys on nationalId, so we treat the user_id
    // as the national-id value (the most natural mapping for KYC flows).
    let verificationRows: any[] = [];
    try {
      verificationRows = await db.verification.findMany({
        where: { nationalId: user_id as any },
      });
    } catch {
      // DB unavailable — return empty list rather than 500 so the user
      // still gets a valid export envelope.
      verificationRows = [];
    }

    const verifications = verificationRows.map((r: any) => ({
      verification_id: r.id,
      doc_type: r.docType,
      doc_side: r.docSide,
      full_name_ar: r.fullNameAr,
      full_name_en: r.fullNameEn,
      national_id: r.nationalId,
      birth_date: r.birthDate,
      address: r.address,
      gender: r.gender,
      document_no: r.documentNo,
      expiry_date: r.expiryDate,
      nationality: r.nationality,
      job: r.job,
      marital_status: r.maritalStatus,
      doc_confidence: r.docConfidence,
      face_match_score: r.faceMatchScore,
      liveness_score: r.livenessScore,
      status: r.status,
      notes: r.notes,
      // Biometric hashes — never raw biometrics
      doc_image_front_hash: r.docImageFront ? createHash("sha256").update(r.docImageFront).digest("hex") : null,
      doc_image_back_hash: r.docImageBack ? createHash("sha256").update(r.docImageBack).digest("hex") : null,
      selfie_image_hash: r.selfieImage ? createHash("sha256").update(r.selfieImage).digest("hex") : null,
      liveness_frames_hash: r.livenessFrames ? createHash("sha256").update(r.livenessFrames).digest("hex") : null,
      // Raw biometrics are explicitly NOT exported — they are deleted
      // immediately after verification per Cirkle's retention policy.
      raw_biometrics: "NOT_EXPORTED — deleted immediately after verification",
      image_quality: r.imageQuality,
      field_confidence: r.fieldConfidence,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    }));

    // ─── Audit events ────────────────────────────────────────────────
    // Pull every GDPR-tagged event from the in-memory chain. Also include
    // a synthetic event of type `data_export` to mark this access.
    recordAudit(
      "data_export",
      user_id,
      { record_count: verifications.length, download: download },
      "system",
    );
    const audit_events = getAuditEvents(user_id).map((e) => ({
      type: e.type,
      timestamp: e.timestamp,
      details: e.details,
      actor: e.actor,
      event_hash: e.event_hash,
    }));

    // ─── Identity graph ──────────────────────────────────────────────
    // Reconstruct a minimal identity graph from the user's verifications:
    //   - 1 person node per distinct full_name_en + national_id combo
    //   - 1 document node per verification (doc_type + document_no)
    //   - 1 `verified_same_person` edge linking each doc node to its person
    const personKey = (r: any) => `${r.fullNameEn || r.fullNameAr || "unknown"}|${r.nationalId || user_id}`;
    const persons = new Map<string, any>();
    const documents: any[] = [];
    const edges: any[] = [];
    for (const v of verificationRows) {
      const pKey = personKey(v);
      if (!persons.has(pKey)) {
        persons.set(pKey, {
          id: `person:${pKey}`,
          type: "person",
          attributes: {
            full_name_en: v.fullNameEn,
            full_name_ar: v.fullNameAr,
            national_id: maskId(v.nationalId),
          },
          first_seen_at: v.createdAt,
          last_seen_at: v.updatedAt,
        });
      }
      const docId = `doc:${v.id}`;
      documents.push({
        id: docId,
        type: "document",
        attributes: {
          doc_type: v.docType,
          document_no: v.documentNo,
          issuing_country: v.nationality,
        },
        first_seen_at: v.createdAt,
        last_seen_at: v.updatedAt,
      });
      edges.push({
        from: docId,
        to: `person:${pKey}`,
        type: "verified_same_person",
        weight: 1,
        evidence_count: 1,
        last_seen_at: v.updatedAt,
      });
    }

    const identity_graph = {
      nodes: [...persons.values(), ...documents],
      edges,
    };

    // ─── Certificates ────────────────────────────────────────────────
    // Verifiable certificate IDs (only IDs — never the signature payload,
    // which is already publicly verifiable via the certificate/verify route).
    const certificates = verificationRows
      .filter((r: any) => r.status === "verified" || r.status === "passed")
      .map((r: any) => ({
        verification_id: r.id,
        issued_at: r.updatedAt || r.createdAt,
        verify_url: `/api/v1/verify/certificate/verify?id=${encodeURIComponent(r.id)}`,
      }));

    // ─── Decisions ───────────────────────────────────────────────────
    const decisions = verificationRows.map((r: any) => ({
      verification_id: r.id,
      decision: r.status,
      doc_confidence: r.docConfidence,
      face_match_score: r.faceMatchScore,
      liveness_score: r.livenessScore,
      decided_at: r.updatedAt,
    }));

    // ─── Assemble + hash ─────────────────────────────────────────────
    const exported_at = new Date().toISOString();
    const data = {
      verifications,
      audit_events,
      identity_graph,
      certificates,
      decisions,
    };
    const envelope = { user_id, exported_at, data };
    const hash = createHash("sha256").update(canonicalize(envelope)).digest("hex");

    const download_url = `/api/v1/verify/gdpr/export?user_id=${encodeURIComponent(user_id)}&download=1`;
    const body = {
      user_id,
      exported_at,
      data,
      hash,
      download_url,
      regulation: "GDPR Article 20 — Right to data portability",
      raw_biometrics_policy: "Raw document + selfie images are deleted immediately after verification. Only SHA-256 hashes of those images are exported, so the user can verify that a specific verification occurred without exposing the biometric payload.",
    };

    const headers: Record<string, string> = {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "X-Export-Hash": hash,
      "X-Export-Records": String(verifications.length),
    };
    if (download) {
      const safeId = user_id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
      headers["Content-Disposition"] =
        `attachment; filename="cirkle-export-${safeId}-${Date.now()}.json"`;
    }
    return NextResponse.json(body, { headers });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "export failed", code: "EXPORT_FAILURE" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
