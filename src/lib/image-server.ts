import sharp from "sharp";

/**
 * Server-side image utilities for VLM input.
 *
 * The z-ai vision API rejects images that are too large or in unsupported
 * formats with error code 1210 ("图片输入格式/解析错误"). These helpers
 * normalize any input data URL into a compact, VLM-friendly JPEG/PNG.
 */

const MAX_DIMENSION = 1280; // max width or height
const TARGET_BYTES = 600 * 1024; // ~600KB target payload
const MIN_BYTES = 5 * 1024; // ignore tiny/corrupt

/** Parse a data URL into { mime, buffer }. Returns null if not a valid data URL. */
export function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
  if (!m) return null;
  try {
    return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
  } catch {
    return null;
  }
}

/**
 * Normalize an image data URL for VLM consumption.
 * - Decodes the base64
 * - Re-encodes as JPEG (or PNG if it has transparency)
 * - Resizes to max 1280px on the long edge
 * - Iteratively lowers quality until under ~600KB
 *
 * Returns a fresh data URL. If anything fails, returns the original.
 */
export async function normalizeForVlm(dataUrl: string): Promise<string> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return dataUrl;

  try {
    // First, get metadata to understand what we're dealing with
    let pipeline = sharp(parsed.buffer, { failOn: "none" }).rotate(); // auto-orient from EXIF

    const meta = await pipeline.metadata();
    const hasAlpha = meta.hasAlpha || meta.channels === 4;

    // Resize if too big
    if ((meta.width || 0) > MAX_DIMENSION || (meta.height || 0) > MAX_DIMENSION) {
      pipeline = pipeline.resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Try JPEG first (smaller). If the image has alpha, flatten to white background.
    let quality = 80;
    let outBuffer: Buffer;

    if (hasAlpha) {
      // Flatten alpha onto white, then JPEG
      outBuffer = await pipeline
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    } else {
      outBuffer = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
    }

    // Iteratively lower quality to hit target size
    while (outBuffer.length > TARGET_BYTES && quality > 35) {
      quality -= 10;
      const retryPipeline = sharp(parsed.buffer, { failOn: "none" }).rotate().resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
      if (hasAlpha) {
        outBuffer = await retryPipeline
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality, mozjpeg: true })
          .toBuffer();
      } else {
        outBuffer = await retryPipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      }
    }

    // If still too big after quality 35, downscale further
    let scaleDim = MAX_DIMENSION;
    while (outBuffer.length > TARGET_BYTES && scaleDim > 640) {
      scaleDim = Math.round(scaleDim * 0.8);
      const retryPipeline = sharp(parsed.buffer, { failOn: "none" }).rotate().resize({
        width: scaleDim,
        height: scaleDim,
        fit: "inside",
        withoutEnlargement: true,
      });
      outBuffer = await retryPipeline
        .jpeg({ quality: Math.max(40, quality), mozjpeg: true })
        .toBuffer();
    }

    return `data:image/jpeg;base64,${outBuffer.toString("base64")}`;
  } catch (e) {
    console.error("[normalizeForVlm] failed, returning original:", e);
    return dataUrl;
  }
}

/**
 * Heuristic: is this data URL likely too large for the VLM API?
 * The VLM tends to reject images whose base64 payload exceeds ~1MB.
 */
export function isLikelyTooLarge(dataUrl: string): boolean {
  // rough: base64 length ≈ bytes * 1.37
  return dataUrl.length > 1.2 * 1024 * 1024;
}
