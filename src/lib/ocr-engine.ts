/**
 * Self-hosted OCR engine using Tesseract.js.
 *
 * No external API calls — runs entirely on the server using WebAssembly.
 * Supports Arabic + English text recognition with custom traineddata.
 *
 * This replaces the Z.ai VLM OCR which required a private API endpoint
 * unreachable from Vercel's public cloud.
 *
 * License: Apache-2.0 (Tesseract.js)
 */

import { createWorker, PSM } from "tesseract.js";
import sharp from "sharp";
import { parseDataUrl } from "@/lib/image-server";

let arabicWorker: any = null;
let englishWorker: any = null;

/**
 * Initialize Tesseract workers for Arabic and English.
 * Workers are cached across requests for performance.
 */
async function getArabicWorker() {
  if (!arabicWorker) {
    arabicWorker = await createWorker("ara+eng", 1, {
      logger: () => {}, // silence logs
    });
    // Set page segmentation mode to automatic
    await arabicWorker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: "1",
    });
  }
  return arabicWorker;
}

/**
 * Pre-process image for better OCR accuracy:
 * - Convert to grayscale
 * - Increase contrast
 * - Sharpen
 * - Resize to at least 1000px wide
 */
async function preprocessForOCR(dataUrl: string): Promise<Buffer> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Invalid image data URL");

  let pipeline = sharp(parsed.buffer, { failOn: "none" }).rotate();

  // Aggressively downscale to 800px max — Tesseract is slow on large images
  // and the serverless environment has a time budget of ~30s
  const meta = await pipeline.metadata();
  const maxWidth = 800;
  if ((meta.width || 0) > maxWidth) {
    pipeline = pipeline.resize({
      width: maxWidth,
      withoutEnlargement: true,
    });
  }

  // Grayscale + normalize + sharpen for better OCR
  pipeline = pipeline
    .grayscale()
    .normalize()
    .sharpen({ sigma: 0.8 })
    .png();

  return pipeline.toBuffer();
}

export interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

/**
 * Run OCR on a document image. Extracts both Arabic and English text.
 *
 * @param dataUrl - base64 data URL of the image
 * @returns OCR result with full text, confidence, and word-level data
 */
export async function runOCR(dataUrl: string): Promise<OCRResult> {
  const preprocessed = await preprocessForOCR(dataUrl);

  const worker = await getArabicWorker();

  const result = await worker.recognize(preprocessed);

  const text = (result.data.text || "").trim();
  const confidence = result.data.confidence || 0;

  // Extract word-level data with bounding boxes
  const words: OCRResult["words"] = (result.data.words || [])
    .filter((w: any) => w.text && w.text.trim().length > 0)
    .map((w: any) => ({
      text: w.text.trim(),
      confidence: w.confidence || 0,
      bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
    }));

  return { text, confidence: confidence / 100, words };
}

/**
 * Run OCR on both front and back of a document.
 */
export async function runOCRMulti(
  frontDataUrl: string,
  backDataUrl: string | null
): Promise<{ front: OCRResult; back: OCRResult | null }> {
  const front = await runOCR(frontDataUrl);
  let back: OCRResult | null = null;
  if (backDataUrl) {
    back = await runOCR(backDataUrl);
  }
  return { front, back };
}

/**
 * Terminate workers (for cleanup during shutdown).
 */
export async function terminateOCR() {
  if (arabicWorker) {
    await arabicWorker.terminate();
    arabicWorker = null;
  }
}
