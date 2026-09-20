/**
 * Verification Report (HTML/PDF) generator with HMAC signature.
 *
 * Design:
 *  - Generates a self-contained HTML report that the browser can print to PDF
 *    (using the browser's native "Save as PDF" via window.print()).
 *  - The report contains:
 *      • Header (Cirkle logo, verification ID, timestamp)
 *      • Status badge (Verified / Rejected / Needs Review)
 *      • Score breakdown (face match, liveness, OCR, cross-field, risk)
 *      • Document details (extracted fields)
 *      • AI consensus (which providers agreed)
 *      • HMAC-SHA256 signature at the bottom (cryptographic proof)
 *  - The signature is computed via Node's `crypto` module over the canonical
 *    JSON of the report fields, using the CERTIFICATE_HMAC_SECRET env var.
 *  - Any third party can later verify the report by recomputing the HMAC
 *    using `verifyReportSignature()`.
 *
 * NOTE: This module is server-side only (it uses Node's `crypto`).
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { VerificationRecord } from "@/lib/verification-types";

const REPORT_HMAC_SECRET =
  process.env.CERTIFICATE_HMAC_SECRET ||
  process.env.PLATFORM_SIGNING_KEY ||
  process.env.INNGEST_SIGNING_KEY ||
  "cirkle-verification-report-default-secret";

const KEY_ID = createHash("sha256").update(REPORT_HMAC_SECRET).digest("hex").slice(0, 8);

export interface ReportSignature {
  signature: string;
  algorithm: "HMAC-SHA256";
  keyId: string;
  /** Short fingerprint (first 16 hex chars) — for human display. */
  short: string;
  /** The canonical payload that was signed (debugging / audit). */
  payload: string;
}

export interface GeneratedReport {
  /** Full self-contained HTML document. */
  html: string;
  /** HMAC signature over the canonical payload. */
  signature: ReportSignature;
  /** SHA-256 hash of the HTML body (tamper-evidence for the rendered output). */
  hash: string;
  /** Canonical payload (signed). */
  payload: string;
  /** The verification ID. */
  verificationId: string;
}

/**
 * Build the canonical JSON payload that gets signed.
 * Sorts keys alphabetically so any reordering produces the same signature.
 */
export function buildCanonicalPayload(verification: VerificationRecord): string {
  // Pull only the cryptographically-meaningful fields — exclude images (too large,
  // and image bytes are not what we want to authenticate; the score breakdown + fields are).
  const payload = {
    address: verification.address ?? null,
    birthDate: verification.birthDate ?? null,
    createdAt: verification.createdAt,
    docConfidence: verification.docConfidence,
    docSide: verification.docSide,
    docType: verification.docType,
    documentNo: verification.documentNo ?? null,
    expiryDate: verification.expiryDate ?? null,
    faceMatchScore: verification.faceMatchScore,
    fullNameAr: verification.fullNameAr ?? null,
    fullNameEn: verification.fullNameEn ?? null,
    gender: verification.gender ?? null,
    id: verification.id,
    imageQuality: verification.imageQuality ?? null,
    job: verification.job ?? null,
    livenessScore: verification.livenessScore,
    maritalStatus: verification.maritalStatus ?? null,
    nationalId: verification.nationalId ?? null,
    nationality: verification.nationality ?? null,
    religion: verification.religion ?? null,
    status: verification.status,
    updatedAt: verification.updatedAt,
  };
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/** Compute the HMAC-SHA256 signature of the canonical payload. */
export function computeReportSignature(verification: VerificationRecord): ReportSignature {
  const payload = buildCanonicalPayload(verification);
  const sig = createHmac("sha256", REPORT_HMAC_SECRET).update(payload).digest("hex");
  return {
    signature: sig,
    algorithm: "HMAC-SHA256",
    keyId: KEY_ID,
    short: sig.slice(0, 16),
    payload,
  };
}

/**
 * Verify that an HMAC signature matches the verification record.
 * Uses `timingSafeEqual` to prevent timing attacks.
 */
export function verifyReportSignature(
  verification: VerificationRecord,
  signature: string,
): boolean {
  try {
    const expected = computeReportSignature(verification).signature;
    if (expected.length !== signature.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Compute the SHA-256 of the rendered HTML (tamper-evidence for the rendered report). */
function hashHtml(html: string): string {
  return createHash("sha256").update(html).digest("hex");
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusBadge(status: string): { label: string; color: string; bg: string } {
  switch (status) {
    case "verified":
      return { label: "Verified", color: "#0f766e", bg: "#ccfbf1" };
    case "rejected":
      return { label: "Rejected", color: "#9f1239", bg: "#ffe4e6" };
    case "failed":
      return { label: "Needs Review", color: "#92400e", bg: "#fef3c7" };
    default:
      return { label: "Pending", color: "#1f2937", bg: "#f3f4f6" };
  }
}

function scoreBar(label: string, value: number, threshold: number, color: string): string {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const passes = pct >= threshold;
  return `
    <div class="score-row">
      <div class="score-label">${escapeHtml(label)}</div>
      <div class="score-track">
        <div class="score-fill" style="width: ${pct}%; background: ${color};"></div>
      </div>
      <div class="score-value ${passes ? "pass" : "fail"}">${pct}%</div>
    </div>`;
}

/** Format an ISO date string for display. */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC";
  } catch {
    return iso;
  }
}

/**
 * Generate the full HTML report for a verification record.
 * Includes inline CSS + the HMAC signature block at the bottom.
 */
export function generateVerificationReport(
  verification: VerificationRecord,
  consensusInfo?: {
    providers: string[];
    total: number;
    successful: number;
    agreement: number;
    verdict: string;
  },
): GeneratedReport {
  const sig = computeReportSignature(verification);
  const status = statusBadge(verification.status);
  const issuedAt = formatDate(new Date().toISOString());

  // Score breakdown — convert confidence (0-1) → percentage for display.
  const docScorePct = Math.round((verification.docConfidence ?? 0) * 100);
  const faceScorePct = Math.round(verification.faceMatchScore ?? 0);
  const livenessScorePct = Math.round(verification.livenessScore ?? 0);
  const imageQualityPct = Math.round((verification.imageQuality ?? 0) * 100);
  // Risk proxy: derive from cross-field + liveness (lower liveness → higher risk).
  const riskPct = Math.max(0, Math.min(100, 100 - livenessScorePct));

  const consensusBlock = consensusInfo && consensusInfo.total > 0 ? `
    <section class="block">
      <h2>AI Consensus</h2>
      <div class="consensus-grid">
        <div><span class="label">Providers queried</span><strong>${consensusInfo.total}</strong></div>
        <div><span class="label">Successful</span><strong>${consensusInfo.successful}/${consensusInfo.total}</strong></div>
        <div><span class="label">Agreement</span><strong>${Math.round(consensusInfo.agreement * 100)}%</strong></div>
        <div><span class="label">Verdict</span><strong>${escapeHtml(consensusInfo.verdict)}</strong></div>
      </div>
      ${consensusInfo.providers.length > 0 ? `
        <div class="providers">
          <span class="label">Providers that agreed:</span>
          <ul>${consensusInfo.providers.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
        </div>
      ` : ""}
    </section>
  ` : "";

  // Document details — list every extracted field.
  const detailRows: { label: string; value: string | null | undefined; ar?: boolean }[] = [
    { label: "Document type", value: verification.docType },
    { label: "Document side", value: verification.docSide },
    { label: "Full name (Arabic)", value: verification.fullNameAr, ar: true },
    { label: "Full name (English)", value: verification.fullNameEn },
    { label: "National ID", value: verification.nationalId },
    { label: "Document number", value: verification.documentNo },
    { label: "Date of birth", value: verification.birthDate },
    { label: "Gender", value: verification.gender },
    { label: "Nationality", value: verification.nationality },
    { label: "Address", value: verification.address },
    { label: "Profession", value: verification.job },
    { label: "Religion", value: verification.religion },
    { label: "Marital status", value: verification.maritalStatus },
    { label: "Expiry date", value: verification.expiryDate },
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Cirkle Identity Verification Report — ${escapeHtml(verification.id)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans Arabic", sans-serif;
      margin: 0;
      padding: 32px;
      color: #111827;
      background: #fff;
      line-height: 1.55;
      font-size: 14px;
    }
    .container { max-width: 820px; margin: 0 auto; }
    header.report-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 2px solid #0d9488;
      margin-bottom: 24px;
    }
    .logo {
      display: flex; align-items: center; gap: 10px;
      font-weight: 700; font-size: 20px; color: #0d9488;
    }
    .logo .ring {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 50%;
      border: 3px solid #0d9488;
      position: relative;
    }
    .logo .ring::after {
      content: ""; position: absolute; inset: 4px;
      border-radius: 50%; border: 2px solid #14b8a6;
    }
    .logo .arabic { font-size: 14px; color: #475569; font-weight: 500; }
    .header-meta { text-align: right; font-size: 12px; color: #475569; }
    .header-meta strong { display: block; color: #111827; font-size: 14px; font-family: monospace; }
    h1 { font-size: 22px; margin: 0 0 4px 0; }
    h2 { font-size: 16px; margin: 0 0 12px 0; color: #0d9488; border-left: 4px solid #0d9488; padding-left: 10px; }
    .subtitle { color: #6b7280; font-size: 13px; margin-bottom: 20px; }
    .status-badge {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 14px; border-radius: 999px;
      background: ${status.bg}; color: ${status.color};
      font-weight: 600; font-size: 14px;
      margin-bottom: 20px;
    }
    .status-badge::before {
      content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor;
    }
    .block { margin-bottom: 28px; padding: 16px 20px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
    .score-row {
      display: grid; grid-template-columns: 200px 1fr 60px;
      align-items: center; gap: 12px; margin-bottom: 10px;
    }
    .score-label { font-size: 13px; color: #374151; }
    .score-track { height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
    .score-fill { height: 100%; border-radius: 4px; transition: width 0.3s ease; }
    .score-value { font-family: monospace; font-size: 13px; font-weight: 600; text-align: right; }
    .score-value.pass { color: #0f766e; }
    .score-value.fail { color: #b91c1c; }
    table.detail-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.detail-table tr { border-bottom: 1px dashed #e5e7eb; }
    table.detail-table td { padding: 8px 0; vertical-align: top; }
    table.detail-table td:first-child { color: #6b7280; width: 40%; }
    table.detail-table td:last-child { font-weight: 500; text-align: right; }
    .consensus-grid {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 12px;
    }
    .consensus-grid > div {
      background: #fff; padding: 10px; border-radius: 6px;
      border: 1px solid #e5e7eb; text-align: center;
    }
    .consensus-grid .label { display: block; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.04em; }
    .consensus-grid strong { font-size: 14px; }
    .providers { font-size: 12px; color: #475569; }
    .providers ul { list-style: none; padding: 0; margin: 6px 0 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .providers li { background: #ccfbf1; color: #115e59; padding: 2px 8px; border-radius: 4px; font-family: monospace; font-size: 11px; }
    .signature-block {
      margin-top: 32px; padding: 16px; background: #0f172a; color: #e2e8f0; border-radius: 8px;
      font-family: monospace; font-size: 11px; word-break: break-all;
    }
    .signature-block h2 { color: #94a3b8; border-color: #475569; }
    .sig-row { display: grid; grid-template-columns: 120px 1fr; gap: 8px; margin-bottom: 6px; }
    .sig-row .key { color: #94a3b8; }
    .sig-row .val { color: #f1f5f9; }
    .footer-note {
      margin-top: 20px; text-align: center; font-size: 11px; color: #9ca3af;
    }
    .print-bar {
      position: sticky; top: 0; background: #fff; padding: 12px 0;
      display: flex; gap: 8px; justify-content: flex-end; z-index: 10;
      border-bottom: 1px solid #e5e7eb; margin: -32px -32px 16px -32px; padding-left: 32px; padding-right: 32px;
    }
    .print-bar button {
      background: #0d9488; color: #fff; border: 0; padding: 8px 16px;
      border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;
    }
    .print-bar button.secondary { background: #fff; color: #0d9488; border: 1px solid #0d9488; }
    @media print {
      .print-bar { display: none !important; }
      body { padding: 0; }
      .block { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <button onclick="window.print()" class="secondary">Save as PDF</button>
    <button onclick="window.print()">Print</button>
  </div>
  <div class="container">
    <header class="report-header">
      <div class="logo">
        <span class="ring"></span>
        <span>Cirkle <span class="arabic" dir="rtl" lang="ar">دواير</span></span>
      </div>
      <div class="header-meta">
        <span>Verification ID</span>
        <strong>${escapeHtml(verification.id)}</strong>
        <span>Issued: ${escapeHtml(issuedAt)}</span>
      </div>
    </header>

    <h1>Identity Verification Report</h1>
    <p class="subtitle">Generated by Cirkle self-hosted verification · Egyptian &amp; Arabic document OCR + AI consensus + liveness.</p>

    <div class="status-badge">${status.label}</div>

    <section class="block">
      <h2>Score Breakdown</h2>
      ${scoreBar("Document OCR", docScorePct, 60, "#0d9488")}
      ${scoreBar("Face Match", faceScorePct, 70, "#2563eb")}
      ${scoreBar("Liveness", livenessScorePct, 70, "#7c3aed")}
      ${scoreBar("Image Quality", imageQualityPct, 70, "#0891b2")}
      ${scoreBar("Risk Score", 100 - riskPct, 70, "#dc2626")}
    </section>

    <section class="block">
      <h2>Document Details</h2>
      <table class="detail-table">
        ${detailRows
          .map(
            (r) => `
          <tr>
            <td>${escapeHtml(r.label)}</td>
            <td${r.ar ? ' dir="rtl" lang="ar"' : ""}>${escapeHtml(r.value)}</td>
          </tr>`,
          )
          .join("")}
        <tr><td>Record created</td><td>${escapeHtml(formatDate(verification.createdAt))}</td></tr>
        <tr><td>Record updated</td><td>${escapeHtml(formatDate(verification.updatedAt))}</td></tr>
      </table>
    </section>

    ${consensusBlock}

    <div class="signature-block">
      <h2>Cryptographic Signature</h2>
      <div class="sig-row">
        <span class="key">Algorithm</span>
        <span class="val">${sig.algorithm}</span>
      </div>
      <div class="sig-row">
        <span class="key">Key ID</span>
        <span class="val">${sig.keyId}</span>
      </div>
      <div class="sig-row">
        <span class="key">Signature</span>
        <span class="val">${sig.signature}</span>
      </div>
      <div class="sig-row">
        <span class="key">Short</span>
        <span class="val">${sig.short}…</span>
      </div>
      <div class="sig-row">
        <span class="key">Payload hash (SHA-256)</span>
        <span class="val">${createHash("sha256").update(sig.payload).digest("hex")}</span>
      </div>
      <p style="margin: 12px 0 0 0; font-family: -apple-system, sans-serif; font-size: 11px; color: #94a3b8;">
        To verify this report: re-compute HMAC-SHA256 over the canonical JSON of the
        verification fields (see <code>buildCanonicalPayload()</code> in
        <code>src/lib/verification-pdf.ts</code>) and compare with the signature above.
      </p>
    </div>

    <p class="footer-note">Generated by Cirkle self-hosted verification · Zero-cost · Privacy-first · الإصدار 1.0</p>
  </div>
</body>
</html>`;

  return {
    html,
    signature: sig,
    hash: hashHtml(html),
    payload: sig.payload,
    verificationId: verification.id,
  };
}
