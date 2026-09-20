import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  generateVerificationReport,
  verifyReportSignature,
  computeReportSignature,
} from "@/lib/verification-pdf";
import type { VerificationRecord } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/v1/verify/report?verification_id=X[&signature=Y]
 *
 * Returns an HTML verification report (Content-Type: text/html) with:
 *  - Header (Cirkle logo + verification ID + timestamp)
 *  - Status badge
 *  - Score breakdown
 *  - Document details
 *  - AI consensus (if present in the record)
 *  - HMAC-SHA256 signature at the bottom
 *
 * If `signature` query param is provided, the route returns JSON with
 * { valid: boolean } instead of the HTML, allowing third parties to verify
 * a report they were given without re-rendering it.
 *
 * Usage:
 *   - Frontend: open this URL in a new tab / iframe to render the report.
 *   - Third party: fetch with `?verification_id=X&signature=Y` to verify.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const verificationId = url.searchParams.get("verification_id");
    const signatureToVerify = url.searchParams.get("signature");
    const wantJson = url.searchParams.get("format") === "json";

    if (!verificationId) {
      return NextResponse.json(
        { error: "verification_id query parameter is required" },
        { status: 400 },
      );
    }

    // Fetch the record from the database.
    const row = await db.verification.findUnique({ where: { id: verificationId } });
    if (!row) {
      return NextResponse.json(
        { error: "verification record not found", verification_id: verificationId },
        { status: 404 },
      );
    }

    // Map DB row → VerificationRecord.
    const record: VerificationRecord = {
      id: row.id,
      docType: row.docType as VerificationRecord["docType"],
      docSide: row.docSide,
      docImageFront: row.docImageFront,
      docImageBack: row.docImageBack,
      fullNameAr: row.fullNameAr,
      fullNameEn: row.fullNameEn,
      nationalId: row.nationalId,
      birthDate: row.birthDate,
      address: row.address,
      gender: row.gender,
      documentNo: row.documentNo,
      expiryDate: row.expiryDate,
      nationality: row.nationality,
      job: row.job,
      religion: row.religion,
      maritalStatus: row.maritalStatus,
      extraFields: row.extraFields,
      selfieImage: row.selfieImage,
      livenessFrames: row.livenessFrames,
      livenessActions: row.livenessActions,
      docConfidence: row.docConfidence,
      faceMatchScore: row.faceMatchScore,
      livenessScore: row.livenessScore,
      imageQuality: row.imageQuality,
      fieldConfidence: row.fieldConfidence,
      status: row.status as VerificationRecord["status"],
      notes: row.notes,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    };

    // Signature verification mode (third-party verifier).
    if (signatureToVerify) {
      const valid = verifyReportSignature(record, signatureToVerify);
      const expected = computeReportSignature(record);
      return NextResponse.json({
        valid,
        verification_id: record.id,
        algorithm: expected.algorithm,
        keyId: expected.keyId,
        provided_short: signatureToVerify.slice(0, 16) + "…",
        expected_short: expected.short + "…",
      });
    }

    // JSON metadata mode (used by the UI before opening the iframe).
    if (wantJson) {
      const sig = computeReportSignature(record);
      return NextResponse.json({
        verification_id: record.id,
        signature: sig.signature,
        algorithm: sig.algorithm,
        keyId: sig.keyId,
        short: sig.short,
        status: record.status,
        report_url: `/api/v1/verify/report?verification_id=${encodeURIComponent(record.id)}`,
      });
    }

    // Default: render the HTML report.
    const report = generateVerificationReport(record);

    return new NextResponse(report.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Verification-Id": record.id,
        "X-Signature-Short": report.signature.short,
        "X-Signature-Algorithm": report.signature.algorithm,
      },
    });
  } catch (e: any) {
    console.error("[/api/v1/verify/report GET] error", e);
    return NextResponse.json(
      { error: e?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

/** CORS preflight. */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
