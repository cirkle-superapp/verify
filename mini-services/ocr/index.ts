/**
 * Cirkle OCR Mini-Service
 *
 * A persistent Bun server running Tesseract.js with pre-warmed workers.
 * Solves the Vercel serverless cold-start problem: Vercel re-initializes
 * Tesseract (30-60s) on every call; this service keeps workers warm (2-3s).
 *
 * Port: 3030
 * Endpoints:
 *   GET  /health     — health check
 *   POST /ocr         — run OCR on an image
 *
 * Called from Vercel via the gateway:
 *   fetch("/api/ocr?XTransformPort=3030", { method: "POST", body: ... })
 *
 * Zero cost. No billing. No external API calls.
 */

import { createWorker, PSM } from "tesseract.js";
import sharp from "sharp";

const PORT = 3030;

let worker: any = null;
let isReady = false;

async function initWorker() {
  if (worker) return worker;
  console.log("[OCR] Initializing Tesseract worker (ara+eng)...");
  const t0 = Date.now();
  worker = await createWorker("ara+eng", 1, {
    logger: (m: any) => {
      if (m.status === "recognizing text") {
        process.stdout.write(`\r[OCR] ${m.status}: ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
    preserve_interword_spaces: "1",
  });
  console.log(`\n[OCR] Worker ready in ${Date.now() - t0}ms`);
  isReady = true;
  return worker;
}

// Pre-warm on startup
initWorker().catch((e) => console.error("[OCR] Init failed:", e.message));

async function preprocessImage(buf: Buffer): Promise<Buffer> {
  let pipeline = sharp(buf, { failOn: "none" }).rotate();
  const meta = await pipeline.metadata();
  if ((meta.width || 0) > 1000) {
    pipeline = pipeline.resize({ width: 1000, withoutEnlargement: true });
  }
  return pipeline.grayscale().normalize().sharpen({ sigma: 0.8 }).png().toBuffer();
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS headers for cross-origin requests from Vercel
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/health") {
      return Response.json({
        status: isReady ? "ready" : "initializing",
        port: PORT,
        uptime: process.uptime(),
        workerLoaded: isReady,
      }, { headers: corsHeaders });
    }

    if (url.pathname === "/ocr" && req.method === "POST") {
      try {
        const body = await req.json();
        const { image } = body;

        if (!image || !image.startsWith("data:image/")) {
          return Response.json({ error: "image (data URL) required" }, { status: 400, headers: corsHeaders });
        }

        // Extract buffer from data URL
        const b64 = image.split(",")[1];
        const buf = Buffer.from(b64, "base64");

        // Preprocess
        const preprocessed = await preprocessImage(buf);

        // Ensure worker is ready
        const w = await initWorker();

        // Run OCR
        const t0 = Date.now();
        const result = await w.recognize(preprocessed);
        const elapsed = Date.now() - t0;

        const text = (result.data.text || "").trim();
        const confidence = (result.data.confidence || 0) / 100;
        const words = (result.data.words || [])
          .filter((w: any) => w.text && w.text.trim().length > 0)
          .map((w: any) => ({
            text: w.text.trim(),
            confidence: w.confidence || 0,
            bbox: w.bbox || null,
          }));

        return Response.json({
          text,
          confidence,
          words,
          elapsedMs: elapsed,
        }, { headers: corsHeaders });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500, headers: corsHeaders });
      }
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
  },
});

console.log(`[OCR] Service listening on http://localhost:${PORT}`);
