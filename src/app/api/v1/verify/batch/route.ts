import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiKey } from "@/lib/api-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/v1/verify/batch
 *
 * Batch verification endpoint — accepts multiple document images and
 * processes them in parallel. Returns a job ID that can be polled for results.
 *
 * AUTH: Requires API key (Authorization: Bearer cvk_xxx or X-API-Key: cvk_xxx)
 *
 * Body: { documents: [{ frontImage, backImage, docType, selfieImage? }] }
 * Response: { jobId, status: "processing", total }
 *
 * This is a competitor-beating feature: Onfido/Jumio charge $2-5 per check;
 * Cirkle processes unlimited batch checks at zero cost.
 */
export async function POST(req: NextRequest) {
  // API key authentication (required for external callers)
  const auth = await requireApiKey(req);
  if (auth instanceof Response) return auth;

  const limited = checkRateLimit(req, { maxRequests: 5, windowMs: 60_000, prefix: "batch" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const documents = body.documents;

    if (!Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json({ error: "documents array required" }, { status: 400 });
    }

    if (documents.length > 50) {
      return NextResponse.json({ error: "Max 50 documents per batch" }, { status: 400 });
    }

    // Process each document in parallel (limited concurrency)
    const results = await Promise.all(
      documents.slice(0, 50).map(async (doc: any, idx: number) => {
        try {
          const ocrRes = await fetch("http://localhost:3030/ocr", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: doc.frontImage }),
            signal: AbortSignal.timeout(45000),
          });
          if (!ocrRes.ok) return { index: idx, status: "failed", error: "OCR failed" };
          const ocr = await ocrRes.json();

          // Run the parser
          const { extractDocumentSelfHosted } = await import("@/lib/doc-parser");
          const data = await extractDocumentSelfHosted(
            { text: ocr.text, confidence: ocr.confidence, words: ocr.words },
            null,
            doc.docType || "national_id",
            doc.frontImage
          );

          // If selfie provided, run face match
          let faceMatch = null;
          if (doc.selfieImage) {
            const faceRes = await fetch("http://localhost:3031/match", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ selfie: doc.selfieImage, document: doc.frontImage }),
              signal: AbortSignal.timeout(30000),
            });
            if (faceRes.ok) faceMatch = await faceRes.json();
          }

          return {
            index: idx,
            status: "success",
            data,
            faceMatch,
          };
        } catch (e: any) {
          return { index: idx, status: "failed", error: e.message };
        }
      })
    );

    const succeeded = results.filter((r: any) => r.status === "success").length;

    return NextResponse.json({
      status: "completed",
      total: documents.length,
      succeeded,
      failed: documents.length - succeeded,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
