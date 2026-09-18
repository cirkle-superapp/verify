import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { createHash } from "crypto";
import { detectTampering } from "@/lib/tampering-detection";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * CORS headers — all forensics responses are cross-origin accessible.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/forensics
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Simple JPEG EXIF parser ─────────────────────────────────────
// Reads APP1 (Exif) TIFF IFD0 + GPS IFD to extract camera make/model,
// software tag, and GPS coordinates. Self-contained — no external deps.

interface ExifResult {
  cameraMake?: string;
  cameraModel?: string;
  software?: string;
  dateTime?: string;
  gps?: { lat?: number; lng?: number; altitude?: number };
  rawTags: Record<string, string>;
}

/**
 * Parse a JPEG buffer for EXIF metadata (camera make/model, software, GPS).
 * Returns empty object if buffer is not a JPEG or has no EXIF block.
 */
function parseJpegExif(buffer: Buffer): ExifResult {
  const result: ExifResult = { rawTags: {} };
  // JPEG must start with SOI marker 0xFFD8
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return result;
  }

  // Walk the marker segments to find APP1 (0xFFE1)
  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    const segmentLen = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1) {
      // APP1 — check for "Exif\0\0" header
      const headerTag = buffer.toString("ascii", offset + 4, offset + 10);
      if (headerTag.startsWith("Exif")) {
        const tiffStart = offset + 10;
        parseTiff(buffer, tiffStart, result);
      }
    }
    offset += 2 + segmentLen;
    if (marker === 0xda) break; // SOS — image data follows
  }
  return result;
}

function parseTiff(buf: Buffer, tiffStart: number, result: ExifResult): void {
  if (tiffStart + 8 > buf.length) return;
  const byteOrder = buf.readUInt16BE(tiffStart);
  const littleEndian = byteOrder === 0x4949; // "II"
  const bigEndian = byteOrder === 0x4d4d; // "MM"
  if (!littleEndian && !bigEndian) return;
  const read16 = (off: number) =>
    littleEndian ? buf.readUInt16LE(off) : buf.readUInt16BE(off);
  const read32 = (off: number) =>
    littleEndian ? buf.readUInt32LE(off) : buf.readUInt32BE(off);

  const ifd0Offset = tiffStart + read32(tiffStart + 4);
  const tagCount = read16(ifd0Offset);
  let entryOffset = ifd0Offset + 2;

  let gpsPointer = 0;
  for (let i = 0; i < tagCount; i++) {
    if (entryOffset + 12 > buf.length) break;
    const tagId = read16(entryOffset);
    const typeId = read16(entryOffset + 2);
    const count = read32(entryOffset + 4);
    const valueOffset = entryOffset + 8;
    const value = readTagValue(buf, typeId, count, valueOffset, tiffStart, read32);
    if (value !== undefined) {
      switch (tagId) {
        case 0x010f: // Make
          result.cameraMake = String(value).replace(/\0+$/, "").trim();
          result.rawTags.make = result.cameraMake;
          break;
        case 0x0110: // Model
          result.cameraModel = String(value).replace(/\0+$/, "").trim();
          result.rawTags.model = result.cameraModel;
          break;
        case 0x0131: // Software
          result.software = String(value).replace(/\0+$/, "").trim();
          result.rawTags.software = result.software;
          break;
        case 0x0132: // DateTime
          result.dateTime = String(value).replace(/\0+$/, "").trim();
          result.rawTags.dateTime = result.dateTime;
          break;
        case 0x8825: // GPS IFD pointer
          gpsPointer = typeof value === "number" ? value : 0;
          break;
      }
    }
    entryOffset += 12;
  }

  if (gpsPointer > 0) {
    parseGpsIfd(buf, tiffStart + gpsPointer, result, tiffStart, read16, read32);
  }
}

function readTagValue(
  buf: Buffer,
  typeId: number,
  count: number,
  valueOffset: number,
  tiffStart: number,
  read32: (o: number) => number,
): string | number | undefined {
  // Type sizes in bytes
  const typeSizes: Record<number, number> = {
    1: 1, // BYTE
    2: 1, // ASCII
    3: 2, // SHORT
    4: 4, // LONG
    5: 8, // RATIONAL
    7: 1, // UNDEFINED
  };
  const size = typeSizes[typeId] || 1;
  const totalBytes = size * count;
  let dataOffset = valueOffset;
  // If data > 4 bytes, value field is a pointer to the actual data
  if (totalBytes > 4) {
    dataOffset = tiffStart + read32(valueOffset);
  }

  if (typeId === 2 || typeId === 7) {
    // ASCII / UNDEFINED — read as string
    return buf.toString("ascii", dataOffset, dataOffset + count).replace(/\0+$/, "");
  }
  if (typeId === 3) {
    return buf.readUInt16BE(dataOffset);
  }
  if (typeId === 4) {
    return read32(dataOffset);
  }
  if (typeId === 5) {
    // RATIONAL (two LONGs: numerator / denominator)
    const num = read32(dataOffset);
    const den = read32(dataOffset + 4);
    return den !== 0 ? num / den : 0;
  }
  return undefined;
}

function parseGpsIfd(
  buf: Buffer,
  ifdOffset: number,
  result: ExifResult,
  tiffStart: number,
  read16: (o: number) => number,
  read32: (o: number) => number,
): void {
  if (ifdOffset + 2 > buf.length) return;
  const tagCount = read16(ifdOffset);
  let entryOffset = ifdOffset + 2;
  const rationals: Record<string, [number, number]> = {};
  const refs: Record<string, string> = {};

  for (let i = 0; i < tagCount; i++) {
    if (entryOffset + 12 > buf.length) break;
    const tagId = read16(entryOffset);
    const typeId = read16(entryOffset + 2);
    const count = read32(entryOffset + 4);
    const valueOffset = entryOffset + 8;

    if (typeId === 5 && count >= 1) {
      // RATIONAL — pointer
      const dataOffset = tiffStart + read32(valueOffset);
      const num = read32(dataOffset);
      const den = read32(dataOffset + 4);
      if (tagId === 0x0002) rationals.lat = [num, den];
      if (tagId === 0x0004) rationals.lng = [num, den];
      if (tagId === 0x0006) rationals.alt = [num, den];
    } else if (typeId === 2 && count === 2) {
      // ASCII (1 byte) — N/S, E/W
      const c = buf.toString("ascii", valueOffset, valueOffset + 1);
      if (tagId === 0x0001) refs.lat = c;
      if (tagId === 0x0003) refs.lng = c;
    }
    entryOffset += 12;
  }

  if (rationals.lat) {
    const lat = rationals.lat[0] / (rationals.lat[1] || 1);
    if (lat !== 0 || refs.lat) {
      result.gps = result.gps || {};
      result.gps.lat = refs.lat === "S" ? -lat : lat;
    }
  }
  if (rationals.lng) {
    const lng = rationals.lng[0] / (rationals.lng[1] || 1);
    if (lng !== 0 || refs.lng) {
      result.gps = result.gps || {};
      result.gps.lng = refs.lng === "W" ? -lng : lng;
    }
  }
  if (rationals.alt) {
    result.gps = result.gps || {};
    result.gps.altitude = rationals.alt[0] / (rationals.alt[1] || 1);
  }
}

// ─── ELA at multiple quality levels ───────────────────────────────

interface ElaLevel {
  quality: number;
  meanDiff: number;
  variance: number;
  anomaly: boolean;
}

/**
 * Compute Error Level Analysis at multiple JPEG quality levels.
 * Recompresses the original at each quality and measures per-pixel
 * difference statistics. Regions that compress differently from the
 * rest are signs of splice/paste tampering.
 */
async function computeElaAtLevels(buffer: Buffer, levels: number[]): Promise<ElaLevel[]> {
  const out: ElaLevel[] = [];
  // Get the original as grayscale pixels (downscaled for speed)
  const orig = await sharp(buffer)
    .resize(400, 400, { fit: "inside" })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (const quality of levels) {
    try {
      const recompressed = await sharp(buffer)
        .resize(400, 400, { fit: "inside" })
        .jpeg({ quality })
        .grayscale()
        .raw()
        .toBuffer();
      const len = Math.min(orig.data.length, recompressed.length);
      let total = 0;
      const diffs: number[] = [];
      for (let i = 0; i < len; i += 5) {
        const d = Math.abs(orig.data[i] - recompressed[i]);
        diffs.push(d);
        total += d;
      }
      const count = diffs.length;
      const mean = count > 0 ? total / count : 0;
      let varSum = 0;
      for (const d of diffs) varSum += (d - mean) ** 2;
      const variance = count > 0 ? varSum / count : 0;
      out.push({
        quality,
        meanDiff: Math.round(mean * 100) / 100,
        variance: Math.round(variance * 100) / 100,
        anomaly: variance > 50,
      });
    } catch {
      out.push({ quality, meanDiff: 0, variance: 0, anomaly: false });
    }
  }
  return out;
}

// ─── Clone region detection (block-matching with hash comparison) ──

interface CloneRegion {
  x: number;
  y: number;
  blockSize: number;
  duplicates: number;
}

interface CloneResult {
  detected: boolean;
  score: number;
  duplicateBlockCount: number;
  totalBlocks: number;
  regions: CloneRegion[];
}

/**
 * Detect clone-stamped regions by partitioning the image into 8×8 blocks,
 * hashing each block with MD5, and flagging blocks that recur 3+ times.
 */
async function detectCloneRegions(buffer: Buffer): Promise<CloneResult> {
  try {
    const { data, info } = await sharp(buffer)
      .resize(128, 128, { fit: "cover" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const blockSize = 8;
    const blockMap = new Map<string, Array<{ x: number; y: number }>>();

    for (let y = 0; y <= info.height - blockSize; y += 4) {
      for (let x = 0; x <= w - blockSize; x += 4) {
        let blockStr = "";
        for (let dy = 0; dy < blockSize; dy++) {
          for (let dx = 0; dx < blockSize; dx++) {
            blockStr += data[(y + dy) * w + (x + dx)] + ",";
          }
        }
        const hash = createHash("md5").update(blockStr).digest("hex").slice(0, 8);
        const arr = blockMap.get(hash) || [];
        arr.push({ x, y });
        blockMap.set(hash, arr);
      }
    }

    const regions: CloneRegion[] = [];
    let duplicates = 0;
    let totalBlocks = 0;
    for (const arr of blockMap.values()) {
      totalBlocks += arr.length;
      if (arr.length >= 3) {
        duplicates += arr.length - 2;
        for (const pos of arr.slice(0, 5)) {
          regions.push({ x: pos.x, y: pos.y, blockSize, duplicates: arr.length });
        }
      }
    }
    const score = totalBlocks > 0 ? duplicates / totalBlocks : 0;
    return {
      detected: score > 0.05,
      score: Math.round(score * 1000) / 1000,
      duplicateBlockCount: duplicates,
      totalBlocks,
      regions: regions.slice(0, 50),
    };
  } catch {
    return {
      detected: false,
      score: 0,
      duplicateBlockCount: 0,
      totalBlocks: 0,
      regions: [],
    };
  }
}

// ─── Main route handler ───────────────────────────────────────────

/**
 * POST /api/v1/verify/forensics
 *
 * Document forensics endpoint — runs deep tampering analysis on a
 * single image, returns a structured forensics report.
 *
 * Body: { image: string (base64 data URL or raw base64) }
 *
 * Pipeline:
 *   1. Tampering detection (EXIF suspicious tags, ELA, noise, clone)
 *   2. EXIF extraction (camera make/model, GPS, software) via custom JPEG parser
 *   3. ELA at 3 quality levels (90%, 75%, 50%)
 *   4. Clone region detection (block-matching with MD5 hashing)
 *
 * Returns: {
 *   isTampered: boolean,
 *   confidence: number (0-1),
 *   signals: [{ name, score, description }],
 *   summary: string,
 *   exif: { cameraMake?, cameraModel?, software?, gps? },
 *   ela: [{ quality, meanDiff, variance, anomaly }],
 *   clone: { detected, score, duplicateBlockCount, totalBlocks, regions[] },
 * }
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const image: string | undefined = body?.image;

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "image (base64 string) is required" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // Normalize: strip data URL prefix if present
    const base64 = image.includes(",") ? image.split(",")[1] : image;
    if (!base64 || base64.length < 100) {
      return NextResponse.json(
        { error: "image payload too small — expected JPEG/PNG base64 ≥ 100 bytes" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const buffer = Buffer.from(base64, "base64");

    // 1. Tampering detection (existing library — runs all 4 signals in parallel)
    const tampering = await detectTampering(`data:image/jpeg;base64,${base64}`);

    // 2. EXIF extraction via custom JPEG parser
    const exif = parseJpegExif(buffer);

    // 3. ELA at 3 quality levels
    const ela = await computeElaAtLevels(buffer, [90, 75, 50]);

    // 4. Clone region detection (more detailed than the lib version)
    const clone = await detectCloneRegions(buffer);

    // Aggregate signals into a single report
    const signals = [
      {
        name: "exif_suspicious",
        score: tampering.signals.exifSuspicious ? 1 : 0,
        description:
          tampering.signals.softwareTags.length > 0
            ? `Suspicious software tags: ${tampering.signals.softwareTags.join(", ")}`
            : "No suspicious EXIF software tags detected",
      },
      {
        name: "ela_anomaly",
        score: tampering.signals.elaAnomaly ? 1 : 0,
        description: `ELA variance (Q90): ${tampering.details.elaVariance ?? 0} — high variance suggests splice/paste`,
      },
      {
        name: "noise_inconsistency",
        score: tampering.signals.noiseInconsistency ? 1 : 0,
        description: `Noise inconsistency: ${((tampering.details.noiseScore ?? 0) * 100).toFixed(0)}% quadrant deviation`,
      },
      {
        name: "clone_detected",
        score: tampering.signals.cloneDetected ? 1 : 0,
        description: `Clone-stamp detection: ${(((tampering.details.cloneScore ?? 0) * 100)).toFixed(1)}% duplicate blocks`,
      },
      {
        name: "exif_camera_make",
        score: exif.cameraMake ? 0 : 0.5,
        description: exif.cameraMake
          ? `Camera: ${exif.cameraMake} ${exif.cameraModel || ""}`.trim()
          : "No camera make/model in EXIF (possible re-saved image)",
      },
      {
        name: "exif_gps",
        score: exif.gps?.lat != null ? 0 : 0.3,
        description: exif.gps?.lat != null
          ? `GPS: ${exif.gps.lat.toFixed(4)}, ${exif.gps.lng?.toFixed(4) ?? "n/a"}`
          : "No GPS coordinates embedded",
      },
      {
        name: "exif_software",
        score: exif.software ? 1 : 0,
        description: exif.software
          ? `Image software: "${exif.software}" — editing software detected`
          : "No editing software tag in EXIF",
      },
      {
        name: "ela_multi_quality",
        score: ela.filter((e) => e.anomaly).length / 3,
        description: `ELA anomalies at quality levels: ${ela
          .map((e) => `Q${e.quality}=${e.anomaly ? "Y" : "N"}(var=${e.variance})`)
          .join(", ")}`,
      },
      {
        name: "clone_regions",
        score: clone.score,
        description: `Clone regions: ${clone.duplicateBlockCount}/${clone.totalBlocks} duplicate blocks (${(clone.score * 100).toFixed(1)}%)`,
      },
    ];

    const confidence = Math.min(1, tampering.tamperingScore + (clone.score > 0.1 ? 0.1 : 0));
    const isTampered = tampering.isLikelyTampered || clone.detected || ela.every((e) => e.anomaly);

    const summary = isTampered
      ? `Document forensics: TAMPERED (confidence ${(confidence * 100).toFixed(0)}%). ${tampering.reasoning}`
      : `Document forensics: NO TAMPERING (confidence ${(confidence * 100).toFixed(0)}%). All signals nominal.`;

    return NextResponse.json(
      {
        isTampered,
        confidence: Math.round(confidence * 100) / 100,
        signals,
        summary,
        exif,
        ela,
        clone,
        tamperingScore: tampering.tamperingScore,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "forensics analysis failed",
        code: "FORENSICS_FAILURE",
        durationMs: Date.now() - startedAt,
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/forensics
 * Describes the forensics endpoint and the signals it analyzes.
 */
export async function GET() {
  return NextResponse.json(
    {
      description: "Document Forensics Endpoint — deep tampering analysis",
      method: "POST",
      body: { image: "base64-encoded JPEG/PNG (data URL or raw)" },
      signals: [
        "exif_suspicious — software tags (Photoshop, GIMP, etc.)",
        "ela_anomaly — Error Level Analysis variance",
        "noise_inconsistency — copy-paste noise uniformity",
        "clone_detected — clone-stamp tool detection",
        "exif_camera_make — camera metadata presence",
        "exif_gps — geolocation coordinates",
        "exif_software — image editing software fingerprint",
        "ela_multi_quality — ELA at Q90/Q75/Q50",
        "clone_regions — block-matching with MD5 hashing",
      ],
      elaQualityLevels: [90, 75, 50],
      competitiveAdvantage:
        "Onfido/Jumio don't expose forensics. Cirkle shows EXIF + ELA + clone detection.",
    },
    { headers: CORS_HEADERS },
  );
}
