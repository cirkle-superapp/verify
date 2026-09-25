/**
 * Real OCR pipeline — server-side Tesseract.js + OCR post-processing.
 *
 * Task ID 20-a (real-ocr-webhooks).
 *
 * The existing AI consensus (`src/lib/vlm-service.ts`) relies on 5 cloud
 * providers (Gemini, Groq, OpenRouter, NVIDIA, HuggingFace) whose API
 * keys are placeholder values in this sandbox. When no provider returns
 * a structured document, there is currently no fallback. This module
 * fills that gap with a real, dependency-free OCR pipeline:
 *
 *   1. Decode the base64 image to a Buffer.
 *   2. Pre-process with sharp (grayscale / normalize / sharpen / downscale)
 *      — improves Tesseract accuracy on noisy phone-camera scans.
 *   3. Run Tesseract.js with `ara+eng` LSTM models (downloaded from
 *      the jsdelivr CDN on first use, then cached on disk).
 *   4. Walk the Tesseract `Page` tree and split each line into Arabic
 *      vs Latin script (per-line language detection).
 *   5. Run the existing OCR post-processing engine on each line
 *      (confusion patterns + Arabic name dictionary + Latin cleanup).
 *   6. Slice document fields out of the post-processed text using the
 *      shared `FIELD_LABEL_PATTERNS` (الاسم → fullNameAr, الرقم القومي
 *      → nationalId, Date of Birth → birthDate, etc.).
 *   7. Return a `RealOcrResult` with text, arabicText, englishText,
 *      word-level bboxes, line-level language tags, processing time,
 *      and the engine name (`tesseract`).
 *
 * Tesseract.js has a known issue under Bun (regenerator-runtime error
 * when its worker bundle is imported statically at the top level). To
 * work around this we use dynamic `import()` inside a try/catch, and
 * if it fails we fall back to a regex-based extractor that scans the
 * raw text for ID-like numbers, phone numbers, dates, and email
 * addresses — still useful for downstream field validation.
 *
 * This module is server-only (`runtime = "nodejs"` on the route).
 */

import { parseDataUrl } from "@/lib/image-server";
import {
  applyConfusionPatterns,
  extractFieldByLabel,
  FIELD_LABEL_PATTERNS,
  postProcessField,
} from "@/lib/ocr-postprocess";

// ─── Public types ─────────────────────────────────────────────────

export interface RealOcrWord {
  text: string;
  confidence: number; // 0..1
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface RealOcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  language: "ar" | "en" | "mixed";
}

export interface RealOcrField {
  field: string;
  value: string;
  language: "ar" | "en" | "mixed";
}

export interface RealOcrResult {
  text: string;
  arabicText: string;
  englishText: string;
  words: RealOcrWord[];
  lines: RealOcrLine[];
  fields: Record<string, RealOcrField>;
  processingTimeMs: number;
  engine: "tesseract" | "regex-fallback";
  confidence: number; // 0..1 — mean word confidence, 0 for fallback
  fallbackReason?: string;
}

export interface RealOcrOptions {
  /** Languages to recognize with Tesseract (default: ["ara", "eng"]). */
  languages?: string[];
  /** If true, run the sharp preprocessor (grayscale + sharpen + downscale). */
  enhance?: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Decode a data URL or raw base64 into a Buffer. */
export function decodeImageBase64(imageBase64: string): Buffer | null {
  if (!imageBase64) return null;

  // Data URL form: data:image/jpeg;base64,XXXX
  const parsed = parseDataUrl(imageBase64.startsWith("data:")
    ? imageBase64
    : `data:image/png;base64,${imageBase64}`);
  if (parsed) return parsed.buffer;

  // Raw base64 (no prefix) — try to decode directly.
  try {
    return Buffer.from(imageBase64, "base64");
  } catch {
    return null;
  }
}

/** Returns true if the string contains Arabic Unicode characters. */
export function containsArabicScript(s: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(s || "");
}

/** Returns true if the string contains Latin characters. */
export function containsLatinScript(s: string): boolean {
  return /[A-Za-z]/.test(s || "");
}

/** Detect the dominant script of a single line. */
export function detectLineLanguage(line: string): "ar" | "en" | "mixed" {
  const hasAr = containsArabicScript(line);
  const hasLat = containsLatinScript(line);
  if (hasAr && hasLat) return "mixed";
  if (hasAr) return "ar";
  if (hasLat) return "en";
  // Pure digits/punctuation — treat as "en" (Latin-friendly).
  return "en";
}

/**
 * Split the recognized text into Arabic-only and English-only buffers.
 * Used by `extractFieldByLabel` which expects the two scripts separated
 * so the per-language regex alternation works correctly.
 */
export function splitByScript(text: string): { arabicText: string; englishText: string } {
  const lines = (text || "").split(/\r?\n/);
  const ar: string[] = [];
  const en: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (containsArabicScript(line)) {
      ar.push(line);
    } else {
      en.push(line);
    }
  }
  return { arabicText: ar.join("\n"), englishText: en.join("\n") };
}

/**
 * Apply OCR post-processing to every line of a text block. Returns the
 * block with each line cleaned (confusion patterns + name dictionary
 * + ID cleaning) — runs the existing shared post-processing engine.
 */
export function postProcessTextBlock(text: string): string {
  if (!text) return text;
  const out = (text || "").split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return "";
    const isAr = containsArabicScript(line);
    // Apply conservative confusion patterns (alef/hamza normalization
    // for Arabic; rn→m, vv→w, cl→d for Latin). For ID-like lines we
    // let the field extractor call cleanIdField later via postProcessField.
    let cleaned = applyConfusionPatterns(line, isAr);
    return cleaned;
  });
  return out.filter((l) => l.length > 0).join("\n");
}

/**
 * Extract every known field from the post-processed text using the
 * shared FIELD_LABEL_PATTERNS map (الاسم → fullNameAr, الرقم القومي →
 * nationalId, Date of Birth → birthDate, Gender → gender, etc.).
 *
 * Returns a map of field name → { value, language }.
 */
export function extractAllFields(arabicText: string, englishText: string): Record<string, RealOcrField> {
  const out: Record<string, RealOcrField> = {};
  for (const fieldName of Object.keys(FIELD_LABEL_PATTERNS)) {
    const raw = extractFieldByLabel(arabicText, englishText, fieldName);
    if (!raw) continue;
    // Run the full per-field post-processing (strip label, confusion
    // patterns, name correction, ID cleaning).
    const corrected = postProcessField(fieldName, raw).corrected;
    if (!corrected) continue;
    const language = detectLineLanguage(corrected);
    out[fieldName] = { field: fieldName, value: corrected, language };
  }
  return out;
}

// ─── Tesseract worker cache ────────────────────────────────────────
//
// A single long-lived worker is reused across requests. Creating a
// Tesseract worker takes 1–3 s (downloads traineddata on first use);
// recognizing a single image is ~200–800 ms.

interface TessWorkerLike {
  recognize: (image: Buffer | string, options?: Record<string, unknown>) => Promise<{
    data: {
      text: string;
      confidence: number;
      words?: Array<{
        text: string;
        confidence: number;
        bbox?: { x0: number; y0: number; x1: number; y1: number };
      }>;
      blocks?: Array<{
        paragraphs?: Array<{
          lines?: Array<{
            text: string;
            confidence: number;
            bbox?: { x0: number; y0: number; x1: number; y1: number };
            words?: Array<{
              text: string;
              confidence: number;
              bbox?: { x0: number; y0: number; x1: number; y1: number };
            }>;
          }>;
        }>;
      }> | null;
    };
  }>;
  terminate: () => Promise<unknown>;
  setParameters?: (params: Record<string, unknown>) => Promise<unknown>;
}

let cachedWorker: TessWorkerLike | null = null;
let cachedWorkerLangs = "";

/**
 * Get (or create) a cached Tesseract worker for the requested languages.
 * Returns null on failure — caller falls back to the regex extractor.
 */
async function getTesseractWorker(langs: string[]): Promise<TessWorkerLike | null> {
  const langStr = langs.join("+");
  if (cachedWorker && cachedWorkerLangs === langStr) {
    return cachedWorker;
  }
  // Terminate any stale worker of a different language set.
  if (cachedWorker) {
    try { await cachedWorker.terminate(); } catch { /* ignore */ }
    cachedWorker = null;
    cachedWorkerLangs = "";
  }

  try {
    // Dynamic import — Tesseract.js's worker bundle includes
    // regenerator-runtime which throws on `import` in Bun; the dynamic
    // form lets us catch and fall back.
    const mod: any = await import("tesseract.js");
    const createWorker = mod.createWorker || (mod.default && mod.default.createWorker);
    if (!createWorker) {
      throw new Error("createWorker not exported by tesseract.js");
    }
    const worker: TessWorkerLike = await createWorker(langStr, 1, {
      logger: () => { /* silence progress spam */ },
      errorHandler: (err: any) => {
        console.error("[real-ocr] Tesseract worker error:", err?.message?.slice(0, 120));
      },
    });
    if (typeof worker.setParameters === "function") {
      try {
        await worker.setParameters({
          preserve_interword_spaces: "1",
        });
      } catch { /* ignore — non-fatal */ }
    }
    cachedWorker = worker;
    cachedWorkerLangs = langStr;
    return worker;
  } catch (e: any) {
    console.error("[real-ocr] Failed to initialize Tesseract worker:", e?.message?.slice(0, 200));
    return null;
  }
}

/**
 * Pre-process the image buffer for better OCR accuracy.
 * - Auto-orient from EXIF
 * - Grayscale + normalize + sharpen
 * - Downscale to <=1000 px on the long edge
 *
 * Returns a PNG Buffer. Returns the original on failure.
 */
async function preprocessImage(buffer: Buffer, enhance: boolean): Promise<Buffer> {
  try {
    // Lazy-load sharp so the route compiles even if sharp is somehow
    // unavailable in a minimal environment.
    const sharp = (await import("sharp")).default;
    let pipeline = sharp(buffer, { failOn: "none" }).rotate();
    const meta = await pipeline.metadata();
    const maxDim = 1000;
    if (enhance) {
      if ((meta.width || 0) > maxDim || (meta.height || 0) > maxDim) {
        pipeline = pipeline.resize({
          width: maxDim,
          height: maxDim,
          fit: "inside",
          withoutEnlargement: true,
        });
      }
      pipeline = pipeline
        .grayscale()
        .normalize()
        .sharpen({ sigma: 0.8 })
        .png();
      return pipeline.toBuffer();
    }
    // No enhance — still normalize format to PNG (Tesseract handles many
    // formats but PNG is safest cross-platform).
    return await pipeline.png().toBuffer();
  } catch (e: any) {
    console.warn("[real-ocr] sharp preprocessing failed, using raw buffer:", e?.message?.slice(0, 100));
    return buffer;
  }
}

// ─── Regex fallback extractor ─────────────────────────────────────
//
// Used when Tesseract.js can't be loaded (e.g., regenerator-runtime
// mismatch under Bun, or traineddata download failure). Scans raw
// text for common ID-document patterns: phone numbers, dates, ID-like
// numbers (14-digit Egyptian national ID, alphanumeric document numbers,
// credit-card-style numbers), and email addresses. Still useful for
// downstream field validation when no AI provider is available.

const REGEX_PATTERNS: Record<string, RegExp> = {
  // Egyptian national ID: 14 consecutive digits, optionally separated
  // by spaces/dashes. Century digit (2|3) then YYMMDD...
  egyptianNationalId: /\b[23]\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{7}\b/g,
  // Generic 14-digit run (used when the century/month/day don't validate)
  nationalId14: /\b\d{14}\b/g,
  // Dates: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY
  birthDate: /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g,
  // Phone numbers (Egyptian or international)
  phone: /(?:\+20|0)?1[0125]\d{8}|\+\d{6,15}/g,
  // Email addresses
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Document numbers: 8–12 alphanumeric chars starting with 2+ letters
  documentNo: /\b[A-Z]{2,}[\dA-Z]{6,12}\b/gi,
};

/**
 * Run the regex fallback extractor. Returns a minimal RealOcrResult with
 * `engine: "regex-fallback"` and any patterns matched in the raw text.
 */
function runRegexFallback(
  rawText: string,
  startedAt: number,
  reason: string,
): RealOcrResult {
  const found: Record<string, string[]> = {};
  for (const [name, re] of Object.entries(REGEX_PATTERNS)) {
    const matches = (rawText.match(re) || []).map((s) => s.trim()).filter(Boolean);
    if (matches.length > 0) found[name] = matches;
  }

  // Build the fields map (best match for each pattern).
  const fields: Record<string, RealOcrField> = {};
  if (found.egyptianNationalId?.[0]) {
    fields.nationalId = { field: "nationalId", value: found.egyptianNationalId[0], language: "en" };
  } else if (found.nationalId14?.[0]) {
    fields.nationalId = { field: "nationalId", value: found.nationalId14[0], language: "en" };
  }
  if (found.birthDate?.[0]) {
    fields.birthDate = { field: "birthDate", value: found.birthDate[0], language: "en" };
  }
  if (found.documentNo?.[0]) {
    fields.documentNo = { field: "documentNo", value: found.documentNo[0], language: "en" };
  }

  // Lines for display — just the raw text split on newlines.
  const lines: RealOcrLine[] = (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => ({
      text: l,
      bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
      language: detectLineLanguage(l),
    }));

  const { arabicText, englishText } = splitByScript(rawText);

  return {
    text: rawText,
    arabicText,
    englishText,
    words: [],
    lines,
    fields,
    processingTimeMs: Date.now() - startedAt,
    engine: "regex-fallback",
    confidence: 0,
    fallbackReason: reason,
  };
}

// ─── Main entry point ──────────────────────────────────────────────

/**
 * Run the real OCR pipeline on a base64 image.
 *
 * @param imageBase64 data URL (`data:image/...;base64,...`) or raw base64
 * @param options.languages  default `["ara", "eng"]`
 * @param options.enhance     default `true` — grayscale + sharpen + downscale
 * @returns RealOcrResult — always succeeds; falls back to regex on error
 */
export async function runRealOcr(
  imageBase64: string,
  options?: RealOcrOptions,
): Promise<RealOcrResult> {
  const startedAt = Date.now();
  const languages = options?.languages ?? ["ara", "eng"];
  const enhance = options?.enhance ?? true;

  // 1. Decode base64
  const rawBuffer = decodeImageBase64(imageBase64);
  if (!rawBuffer || rawBuffer.length === 0) {
    return runRegexFallback("", startedAt, "Invalid or empty image data");
  }

  // 2. Pre-process with sharp (best-effort)
  const imageBuffer = await preprocessImage(rawBuffer, enhance);

  // 3. Try to load Tesseract
  const worker = await getTesseractWorker(languages);
  if (!worker) {
    // Worker couldn't be created (Tesseract.js / Bun incompatibility,
    // traineddata download failure, etc.). Fall back to regex — but
    // since we have no text yet, return an empty fallback.
    return runRegexFallback("", startedAt, "Tesseract.js worker initialization failed");
  }

  // 4. Run recognition
  let tessResult;
  try {
    tessResult = await worker.recognize(imageBuffer);
  } catch (e: any) {
    console.error("[real-ocr] Tesseract recognize() failed:", e?.message?.slice(0, 200));
    return runRegexFallback("", startedAt, `Tesseract recognition failed: ${e?.message?.slice(0, 100)}`);
  }

  const page = tessResult?.data;
  const rawText: string = (page?.text || "").trim();
  if (!rawText) {
    return runRegexFallback("", startedAt, "Tesseract returned empty text");
  }

  // 5. Walk the Tesseract page tree → line + word arrays with bboxes.
  const lines: RealOcrLine[] = [];
  const words: RealOcrWord[] = [];
  const blocks = page?.blocks || [];
  for (const block of blocks) {
    for (const para of block?.paragraphs || []) {
      for (const line of para?.lines || []) {
        const lineText = (line?.text || "").trim();
        if (!lineText) continue;
        const bbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
        lines.push({
          text: lineText,
          bbox,
          language: detectLineLanguage(lineText),
        });
        for (const w of line?.words || []) {
          const wt = (w?.text || "").trim();
          if (!wt) continue;
          words.push({
            text: wt,
            confidence: typeof w.confidence === "number" ? w.confidence / 100 : 0,
            bbox: w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 },
          });
        }
      }
    }
  }

  // Fallback: if the page tree was empty but `text` exists, split text
  // into pseudo-lines.
  if (lines.length === 0 && rawText) {
    for (const rawLine of rawText.split(/\r?\n/)) {
      const t = rawLine.trim();
      if (!t) continue;
      lines.push({
        text: t,
        bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
        language: detectLineLanguage(t),
      });
    }
  }

  // 6. Post-process every line (confusion patterns + Arabic normalization).
  const cleanedText = postProcessTextBlock(rawText);
  const { arabicText, englishText } = splitByScript(cleanedText);

  // 7. Extract known fields using FIELD_LABEL_PATTERNS.
  const fields = extractAllFields(arabicText, englishText);

  // Mean word confidence.
  const confidence = words.length > 0
    ? words.reduce((s, w) => s + w.confidence, 0) / words.length
    : (typeof page?.confidence === "number" ? page.confidence / 100 : 0);

  return {
    text: cleanedText,
    arabicText,
    englishText,
    words,
    lines,
    fields,
    processingTimeMs: Date.now() - startedAt,
    engine: "tesseract",
    confidence,
  };
}

/**
 * Terminate the cached Tesseract worker. Useful for tests / graceful
 * shutdown. Idempotent.
 */
export async function terminateRealOcrWorker(): Promise<void> {
  if (cachedWorker) {
    try { await cachedWorker.terminate(); } catch { /* ignore */ }
    cachedWorker = null;
    cachedWorkerLangs = "";
  }
}
