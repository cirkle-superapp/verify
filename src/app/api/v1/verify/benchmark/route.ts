import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { SYNTHETIC_SAMPLES, type SyntheticSampleSpec } from "@/lib/synthetic-samples";
import { extractDocumentData } from "@/lib/vlm-service";
import { fieldMatches } from "@/lib/doc-validators";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * CORS headers — benchmark endpoint is cross-origin accessible.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/benchmark
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Synthetic image generator (Node-side) ────────────────────────
//
// synthetic-doc.ts's renderSyntheticDoc uses browser canvas
// (document.createElement) which is unavailable in a Next.js route.
// For the benchmark endpoint we generate a simple text-overlay image
// via sharp's SVG compositing — sufficient for the OCR/vision pipeline
// to receive a real image input. The benchmark measures the pipeline
// LATENCY primarily; accuracy is computed when AI providers return
// structured fields we can compare to the ground truth.

function escapeXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Render a synthetic ID-like image (SVG → JPEG) using the sample spec.
 * Returns a base64 data URL.
 */
async function renderSyntheticImageNode(spec: SyntheticSampleSpec): Promise<string> {
  const W = 1000;
  const H = 640;
  const fields = [
    { label: "Name:", value: spec.fullNameEn || spec.fullNameAr },
    { label: "Name (Ar):", value: spec.fullNameAr },
    { label: "National ID:", value: spec.nationalId },
    { label: "DOB:", value: spec.birthDate },
    { label: "Gender:", value: spec.gender },
    { label: "Doc No:", value: spec.documentNo },
    { label: "Expiry:", value: spec.expiryDate },
  ];
  const rows = fields
    .map((f, i) => {
      const y = 200 + i * 40;
      return `<text x="40" y="${y}" font-family="Arial" font-size="20" fill="#1a6b3a" font-weight="bold">${escapeXml(f.label)}</text>
              <text x="280" y="${y}" font-family="monospace" font-size="22" fill="#111">${escapeXml(f.value)}</text>`;
    })
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8f5e9"/>
      <stop offset="100%" stop-color="#eef0e0"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="#1a6b3a" stroke-width="6"/>
  <rect x="20" y="20" width="${W - 40}" height="80" fill="#1a6b3a"/>
  <text x="${W / 2}" y="55" font-family="Arial" font-size="30" fill="#fff" text-anchor="middle" font-weight="bold">Republic of Egypt — National ID</text>
  <text x="${W / 2}" y="85" font-family="Arial" font-size="18" fill="#fff" text-anchor="middle">Sample ${escapeXml(spec.name)}</text>
  <rect x="50" y="130" width="180" height="220" fill="#d4d0c0" stroke="#1a6b3a" stroke-width="3"/>
  <text x="140" y="245" font-family="Arial" font-size="14" fill="#888" text-anchor="middle">PHOTO</text>
  ${rows}
  <rect x="20" y="${H - 60}" width="${W - 40}" height="50" fill="#1a6b3a"/>
  <text x="${W / 2}" y="${H - 25}" font-family="monospace" font-size="28" fill="#fff" text-anchor="middle">${escapeXml(spec.nationalId)}</text>
</svg>`;

  const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

// ─── Stats helpers ───────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

/**
 * POST /api/v1/verify/benchmark
 *
 * Benchmark endpoint — runs the full verification pipeline on N
 * synthetic samples and reports aggregate latency + accuracy.
 *
 * Body: {
 *   sample_count?: number  (default 10, max 50)
 *   doc_type?: string      (filter samples by doc type; default = all)
 * }
 *
 * Pipeline (per sample):
 *   1. Take next SYNTHETIC_SAMPLES entry (with known ground truth)
 *   2. Render synthetic image via sharp (SVG → JPEG)
 *   3. Call extractDocumentData() — runs AI consensus + OCR post-processing
 *   4. Compare extracted fields to ground truth (nationalId, fullNameAr, etc.)
 *   5. Record latency + per-field correctness
 *
 * Returns: {
 *   samples_processed: number,
 *   mean_latency_ms: number,
 *   p95_latency_ms: number,
 *   accuracy?: { overall: number, per_field: { name, correct, total } },
 *   errors: [{ sample_id, error }],
 * }
 *
 * NOTE: accuracy is only computed when the pipeline returns structured
 * fields. If AI providers aren't configured, extractDocumentData returns
 * null and accuracy is undefined (the pipeline still runs but produces
 * no extractable output).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sampleCount = Math.max(1, Math.min(50, Number(body?.sample_count) || 10));
    const docTypeFilter: string | undefined = body?.doc_type;

    // Filter samples by doc_type if specified
    let samples = SYNTHETIC_SAMPLES;
    if (docTypeFilter) {
      samples = SYNTHETIC_SAMPLES.filter((s) => s.docType === docTypeFilter);
      if (samples.length === 0) {
        return NextResponse.json(
          {
            error: `No synthetic samples match doc_type='${docTypeFilter}'. Available types: ${[...new Set(SYNTHETIC_SAMPLES.map((s) => s.docType))].join(", ")}`,
          },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Cycle through samples if sample_count > available
    const selected: SyntheticSampleSpec[] = [];
    for (let i = 0; i < sampleCount; i++) {
      selected.push(samples[i % samples.length]);
    }

    const errors: Array<{ sample_id: string; error: string }> = [];
    const latencies: number[] = [];
    const fieldStats: Record<string, { correct: number; total: number }> = {
      nameAr: { correct: 0, total: 0 },
      nameEn: { correct: 0, total: 0 },
      nationalId: { correct: 0, total: 0 },
      documentNo: { correct: 0, total: 0 },
      birthDate: { correct: 0, total: 0 },
      gender: { correct: 0, total: 0 },
      expiry: { correct: 0, total: 0 },
    };
    let accuracySamples = 0;
    let fieldSum = 0;

    for (let i = 0; i < selected.length; i++) {
      const spec = selected[i];
      const sampleId = `bench_${i + 1}`;
      const started = Date.now();
      try {
        // 1. Render the synthetic image
        const imageDataUrl = await renderSyntheticImageNode(spec);

        // 2. Run the full extraction pipeline
        const result = await extractDocumentData(imageDataUrl, null, spec.docType as DocType);
        const latency = Date.now() - started;
        latencies.push(latency);

        if (result) {
          accuracySamples++;
          // 3. Compare per-field to ground truth
          const checks: Array<[keyof typeof fieldStats, string | null | undefined, string | null | undefined]> = [
            ["nameAr", spec.fullNameAr, result.fullNameAr],
            ["nameEn", spec.fullNameEn, result.fullNameEn],
            ["nationalId", spec.nationalId, result.nationalId],
            ["documentNo", spec.documentNo, result.documentNo],
            ["birthDate", spec.birthDate, result.birthDate],
            ["gender", spec.gender, result.gender],
            ["expiry", spec.expiryDate, result.expiryDate],
          ];
          let totalFields = 0;
          let correctFields = 0;
          for (const [k, expected, actual] of checks) {
            if (!expected) continue;
            totalFields++;
            const ok = fieldMatches(expected, actual);
            if (ok) correctFields++;
            fieldStats[k].total += 1;
            if (ok) fieldStats[k].correct += 1;
          }
          if (totalFields > 0) {
            fieldSum += correctFields / totalFields;
          }
        }
      } catch (e: any) {
        latencies.push(Date.now() - started);
        errors.push({ sample_id: sampleId, error: e?.message || "extraction failed" });
      }
    }

    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const mean = sortedLatencies.length > 0
      ? sortedLatencies.reduce((s, x) => s + x, 0) / sortedLatencies.length
      : 0;

    const response: Record<string, unknown> = {
      samples_processed: selected.length,
      mean_latency_ms: Math.round(mean),
      p50_latency_ms: percentile(sortedLatencies, 0.5),
      p95_latency_ms: percentile(sortedLatencies, 0.95),
      p99_latency_ms: percentile(sortedLatencies, 0.99),
      max_latency_ms: sortedLatencies.length > 0 ? sortedLatencies[sortedLatencies.length - 1] : 0,
      min_latency_ms: sortedLatencies.length > 0 ? sortedLatencies[0] : 0,
      errors,
      accuracy: accuracySamples > 0
        ? {
            overall: Math.round((fieldSum / accuracySamples) * 1000) / 1000,
            samples_with_output: accuracySamples,
            per_field: fieldStats,
          }
        : undefined,
      doc_type_filter: docTypeFilter || "all",
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "benchmark failed",
        code: "BENCHMARK_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/benchmark
 * Describes the benchmark endpoint and available sample types.
 */
export async function GET() {
  return NextResponse.json(
    {
      description: "Benchmark endpoint — runs the verification pipeline on synthetic samples and reports latency + accuracy",
      method: "POST",
      body: {
        sample_count: "number (default 10, max 50)",
        doc_type: "string (optional — national_id|passport|driver_license|residence)",
      },
      availableSamples: SYNTHETIC_SAMPLES.length,
      docTypes: [...new Set(SYNTHETIC_SAMPLES.map((s) => s.docType))],
      pipeline: [
        "1. Take next SYNTHETIC_SAMPLES entry (known ground truth)",
        "2. Render synthetic image via sharp (SVG → JPEG, 1000×640)",
        "3. Call extractDocumentData() — AI consensus + OCR post-processing",
        "4. Compare per-field to ground truth (nationalId, fullNameAr, etc.)",
        "5. Aggregate mean + p95/p99 latency, per-field accuracy",
      ],
      notes: [
        "Accuracy is only reported when AI providers return structured fields.",
        "If no AI providers are configured, extractDocumentData returns null — latency still reported.",
        "Each sample runs sequentially to avoid provider rate-limit skew.",
      ],
    },
    { headers: CORS_HEADERS },
  );
}
