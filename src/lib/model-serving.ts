/**
 * Cirkle Model Serving — lightweight inference engine for the numpy-based
 * .npz models produced by `training/train.py` (_save_model_np).
 *
 * The training pipeline persists each binary classifier in two files:
 *
 *   models/<name>.pt   — JSON side-car with metadata (weights_shape, bias_shape,
 *                          metrics, feature_keys, etc.). The .pt "torch" path
 *                          would replace this file if torch is installed; on
 *                          this sandbox torch is NOT available, so the .pt
 *                          file is actually JSON.
 *   models/<name>.npz   — a numpy .npz (ZIP) archive containing `weights.npy`
 *                          and `bias.npy` as Float32 arrays.
 *
 * This module ships a *pure-Node* reader for those two files (no dependency
 * on numpy / onnxruntime / torch):
 *
 *   1. parseNpz() walks the ZIP central directory, extracts the raw
 *      `weights.npy` and `bias.npy` entries, inflates them with
 *      zlib.inflateRawSync, then parses the .npy header to find the
 *      little-endian Float32 payload.
 *   2. loadModel() caches { weights, bias, metadata }.
 *   3. runInference() does the linear-logistic forward pass:
 *        z = bias + Σ features[i] * weights[i]
 *        p = sigmoid(z)
 *        prediction = p > 0.5 ? 1 : 0
 *        confidence = max(p, 1 - p)
 *        probabilities = [1 - p, p]
 *
 * If the input feature vector length does not match the model's expected
 * input size, the caller is told via the `featureCountAdjusted` flag in the
 * response (the vector is zero-padded or right-truncated to the expected
 * size so a prediction is always returned for known models).
 */

import { readFileSync, existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { inflateRawSync } from "zlib";

export const runtime = "nodejs";

// ─── Paths ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();
const MODELS_DIR = join(PROJECT_ROOT, "models");

// ─── Types ─────────────────────────────────────────────────────────────────

export interface LoadedModel {
  weights: Float32Array;
  bias: number;
  metadata: ModelMetadata;
  npzPath: string;
  ptPath: string;
  npzBytes: number;
  npzMtimeMs: number;
}

export interface ModelMetadata {
  kind?: string;
  weights_shape?: number[];
  bias_shape?: number[];
  meta?: {
    feature_keys?: string[];
    metrics?: {
      accuracy?: number;
      precision?: number;
      recall?: number;
      f1?: number;
      apcer?: number;
      bpcer?: number;
      acer?: number;
      confusion?: Record<string, number>;
    };
    [k: string]: unknown;
  };
  note?: string;
  [k: string]: unknown;
}

export interface ModelInfo {
  name: string;
  inputSize: number;
  outputSize: number;
  accuracy: number;
  trainedAt: string;
  fileSizeBytes: number;
  kind: string;
  featureKeys?: string[];
  metrics?: Record<string, unknown>;
}

export interface AvailableModel {
  name: string;
  size: number;
  accuracy: number;
}

export interface InferenceResult {
  prediction: number;
  confidence: number;
  probabilities: number[];
}

// ─── In-memory cache ──────────────────────────────────────────────────────

const MODEL_CACHE = new Map<string, LoadedModel | null>();

// ─── .npy / .npz parsing ──────────────────────────────────────────────────

/** Parse the .npy header. Returns { dtype, shape, fortranOrder, dataOffset }.
 * The .npy format is: magic "\x93NUMPY", 2 version bytes, header_len
 * (2 bytes for v1.0, 4 bytes for v2.0+), then a Python dict literal in
 * ASCII, padded with spaces to a 16-byte boundary (v1.0) or 64-byte (v2.0),
 * then the binary payload.
 */
function parseNpyHeader(buf: Buffer): {
  dtype: string;
  shape: number[];
  fortranOrder: boolean;
  dataOffset: number;
} {
  if (buf.length < 10) throw new Error("npy: too short");
  // Magic: \x93NUMPY
  const magic = buf.toString("latin1", 0, 6);
  if (magic !== "\x93NUMPY") throw new Error(`npy: bad magic ${JSON.stringify(magic)}`);
  const major = buf.readUInt8(6);
  const minor = buf.readUInt8(7);
  let headerLen: number;
  let headerOffset: number;
  if (major === 1) {
    headerLen = buf.readUInt16LE(8);
    headerOffset = 10;
  } else if (major >= 2) {
    // v2.0/v3.0: 4 bytes for header_len, 2 bytes padding
    headerLen = buf.readUInt32LE(8);
    headerOffset = 12;
  } else {
    throw new Error(`npy: unsupported version ${major}.${minor}`);
  }
  const headerEnd = headerOffset + headerLen;
  if (headerEnd > buf.length) throw new Error("npy: header truncated");
  const headerStr = buf.toString("latin1", headerOffset, headerEnd);
  // Parse the dict literal — for our purposes, just regex out dtype + shape.
  // The numpy dict uses the key `'descr'` (not `'dtype'`) for the dtype field.
  const dtypeMatch = headerStr.match(/'descr'[:]\s*'([^']+)'/);
  const shapeMatch = headerStr.match(/'shape'[:]\s*\(([^)]*)\)/);
  const fortranMatch = headerStr.match(/'fortran_order'[:]\s*(False|True)/);
  const dtype = dtypeMatch ? dtypeMatch[1] : "";
  const shapeStr = shapeMatch ? shapeMatch[1].trim() : "";
  const shape: number[] = shapeStr
    ? shapeStr.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n))
    : [];
  const fortranOrder = fortranMatch ? fortranMatch[1] === "True" : false;
  return { dtype, shape, fortranOrder, dataOffset: headerEnd };
}

/** Convert a parsed .npy payload Buffer to a Float32Array.
 * Supports the common numpy dtypes we write from Python:
 *   - <f4 / f4 (little-endian float32)
 *   - <f8 / f8 (little-endian float64)
 *   - <i4 / i8 (little-endian int32/int64)
 */
function npyToFloat32(buf: Buffer, dtype: string, shape: number[]): Float32Array {
  const totalElements = shape.reduce((a, b) => a * b, 1) || (buf.byteLength / 4);
  const out = new Float32Array(totalElements);
  if (dtype.endsWith("f4") || dtype === "<f4" || dtype === ">f4" || dtype === "f4") {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    // Assume little-endian (< prefix); for >f4 swap bytes
    const littleEndian = !dtype.startsWith(">");
    for (let i = 0; i < totalElements; i++) {
      out[i] = view.getFloat32(i * 4, littleEndian);
    }
  } else if (dtype.endsWith("f8") || dtype === "<f8" || dtype === "f8") {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const littleEndian = !dtype.startsWith(">");
    for (let i = 0; i < totalElements; i++) {
      out[i] = view.getFloat64(i * 8, littleEndian);
    }
  } else if (dtype.endsWith("i4") || dtype === "<i4" || dtype === "i4") {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const littleEndian = !dtype.startsWith(">");
    for (let i = 0; i < totalElements; i++) {
      out[i] = view.getInt32(i * 4, littleEndian);
    }
  } else if (dtype.endsWith("i8") || dtype === "<i8" || dtype === "i8") {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const littleEndian = !dtype.startsWith(">");
    for (let i = 0; i < totalElements; i++) {
      out[i] = view.getBigInt64(i * 8, littleEndian) as unknown as number;
    }
  } else {
    throw new Error(`npy: unsupported dtype ${dtype}`);
  }
  return out;
}

/** Parse a ZIP (.npz) buffer and return a map of name → raw entry bytes.
 * Walks the End-of-Central-Directory record + central directory entries.
 * For each entry: read local file header, skip the header + name + extra,
 * then read `compressedSize` bytes. Inflate with inflateRawSync if the
 * compression method is DEFLATE (8), otherwise pass through (method 0).
 */
function parseZipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // ── Find the EOCD record (signature 0x06054b50, "PK\5\6") ──
  // Search the last 64 KiB for the signature.
  const searchStart = Math.max(0, buf.length - 65536);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (
      buf.readUInt8(i) === 0x50 &&
      buf.readUInt8(i + 1) === 0x4b &&
      buf.readUInt8(i + 2) === 0x05 &&
      buf.readUInt8(i + 3) === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("npz: EOCD record not found — not a ZIP file");
  const numEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  // ── Walk the central directory ──
  let off = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    if (off + 46 > buf.length) break;
    if (
      buf.readUInt8(off) !== 0x50 ||
      buf.readUInt8(off + 1) !== 0x4b ||
      buf.readUInt8(off + 2) !== 0x01 ||
      buf.readUInt8(off + 3) !== 0x02
    ) {
      break; // not a central directory entry
    }
    const compressionMethod = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const uncompressedSize = buf.readUInt32LE(off + 24);
    const fileNameLen = buf.readUInt16LE(off + 28);
    const extraFieldLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localHeaderOffset = buf.readUInt32LE(off + 42);
    const fileName = buf.toString("latin1", off + 46, off + 46 + fileNameLen);

    // Read the local file header to skip its name + extra field
    if (localHeaderOffset + 30 > buf.length) {
      off += 46 + fileNameLen + extraFieldLen + commentLen;
      continue;
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);

    let raw: Buffer;
    if (compressionMethod === 0) {
      raw = compressed;
    } else if (compressionMethod === 8) {
      // DEFLATE — inflateRaw expects raw deflate stream (no zlib header)
      raw = inflateRawSync(compressed);
    } else {
      // Unsupported compression; skip silently
      off += 46 + fileNameLen + extraFieldLen + commentLen;
      continue;
    }

    if (raw.length < uncompressedSize) {
      // truncated? skip
      off += 46 + fileNameLen + extraFieldLen + commentLen;
      continue;
    }
    out.set(fileName, raw);
    off += 46 + fileNameLen + extraFieldLen + commentLen;
  }
  return out;
}

/** Read `weights.npy` and `bias.npy` from a .npz archive and return a Float32
 * array for the weights + a JS number for the bias (assumed scalar).
 */
function readNpzModel(npzPath: string): { weights: Float32Array; bias: number } | null {
  let buf: Buffer;
  try {
    buf = readFileSync(npzPath);
  } catch {
    return null;
  }
  let entries: Map<string, Buffer>;
  try {
    entries = parseZipEntries(buf);
  } catch (e) {
    // Not a ZIP / npz — could be a torch .pt binary; treat as "no npz"
    return null;
  }
  const weightsEntry = entries.get("weights.npy");
  const biasEntry = entries.get("bias.npy");
  if (!weightsEntry || !biasEntry) return null;

  let weights: Float32Array;
  let bias: Float32Array;
  try {
    const wHdr = parseNpyHeader(weightsEntry);
    weights = npyToFloat32(weightsEntry.subarray(wHdr.dataOffset), wHdr.dtype, wHdr.shape);
    const bHdr = parseNpyHeader(biasEntry);
    bias = npyToFloat32(biasEntry.subarray(bHdr.dataOffset), bHdr.dtype, bHdr.shape);
  } catch {
    return null;
  }
  // Bias may be a 1-element array (the saved scalar)
  const biasScalar = bias.length === 1 ? bias[0] : (bias[0] || 0);
  return { weights, bias: biasScalar };
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Load a model by name from `models/<name>.npz` (+ .pt side-car JSON).
 * Returns null if the .npz file is missing or unreadable. Caches per name
 * for the lifetime of the process; pass `force=true` to invalidate.
 */
export function loadModel(modelName: string, force: boolean = false): LoadedModel | null {
  const npzPath = join(MODELS_DIR, `${modelName}.npz`);
  const ptPath = join(MODELS_DIR, `${modelName}.pt`);
  // Detect if the cached entry is stale — re-check on every call when the
  // .npz file's mtime changes (so freshly-trained models are picked up).
  let currentMtime = 0;
  try {
    const st = statSync(npzPath);
    // mtimeMs is a method in Node, a number property in Bun — coerce both
    const raw: unknown = typeof (st as { mtimeMs?: unknown }).mtimeMs === "function"
      ? (st as { mtimeMs: () => number }).mtimeMs()
      : (st as { mtimeMs: number }).mtimeMs;
    currentMtime = Number(raw) || st.mtime.getTime();
  } catch {
    currentMtime = 0;
  }
  const cached = MODEL_CACHE.get(modelName);
  if (!force && cached) {
    if (cached.npzMtimeMs === currentMtime) {
      return cached;
    }
    // mtime changed — fall through to reload
  }
  if (currentMtime === 0) {
    // File doesn't exist — don't cache a null so we re-check next call
    MODEL_CACHE.delete(modelName);
    return null;
  }

  // Read side-car JSON metadata if present
  let metadata: ModelMetadata = {};
  try {
    if (existsSync(ptPath)) {
      const raw = readFileSync(ptPath, "utf8");
      metadata = JSON.parse(raw) as ModelMetadata;
    }
  } catch {
    // ignore — metadata is optional
  }

  const loaded = readNpzModel(npzPath);
  if (!loaded) {
    MODEL_CACHE.set(modelName, null);
    return null;
  }

  let npzBytes = 0;
  try {
    npzBytes = statSync(npzPath).size;
  } catch {
    // ignore
  }

  const result: LoadedModel = {
    weights: loaded.weights,
    bias: loaded.bias,
    metadata,
    npzPath,
    ptPath,
    npzBytes,
    npzMtimeMs: currentMtime,
  };
  MODEL_CACHE.set(modelName, result);
  return result;
}

/** Standard logistic sigmoid with overflow-safe exponent. */
function sigmoid(x: number): number {
  // Numerically stable sigmoid — saturates to 0/1 for |x| > 35
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/** Run a linear-logistic forward pass on the loaded model.
 *
 * - z  = bias + Σ features[i] * weights[i]
 * - p  = sigmoid(z)
 * - prediction = p > 0.5 ? 1 : 0
 * - confidence = max(p, 1 - p)
 * - probabilities = [1 - p, p]
 *
 * If `features` is longer/shorter than `weights.length`, the array is
 * zero-padded or right-truncated and `featureCountAdjusted` is set to true
 * in the second return value (so callers can surface a warning).
 */
export function runInference(
  modelName: string,
  features: number[],
): { result: InferenceResult | null; featureCountAdjusted: boolean; expectedSize: number } {
  const model = loadModel(modelName);
  if (!model) return { result: null, featureCountAdjusted: false, expectedSize: 0 };
  const expected = model.weights.length;
  let feat: number[] = features;
  let adjusted = false;
  if (features.length !== expected) {
    adjusted = true;
    if (features.length < expected) {
      // zero-pad
      feat = features.concat(Array(expected - features.length).fill(0));
    } else {
      // right-truncate
      feat = features.slice(0, expected);
    }
  }
  let z = model.bias;
  for (let i = 0; i < expected; i++) {
    const v = Number(feat[i]);
    if (Number.isFinite(v)) z += v * model.weights[i];
  }
  const p = sigmoid(z);
  const prediction = p > 0.5 ? 1 : 0;
  const confidence = Math.max(p, 1 - p);
  const probabilities = [1 - p, p];
  return {
    result: { prediction, confidence, probabilities },
    featureCountAdjusted: adjusted,
    expectedSize: expected,
  };
}

/** List all .npz models in the models/ directory, with on-disk size and the
 * accuracy recorded in the .pt side-car metadata (if present).
 */
export function listAvailableModels(): AvailableModel[] {
  if (!existsSync(MODELS_DIR)) return [];
  const out: AvailableModel[] = [];
  let files: string[];
  try {
    files = readdirSync(MODELS_DIR);
  } catch {
    return [];
  }
  for (const f of files) {
    if (!f.endsWith(".npz")) continue;
    const name = f.replace(/\.npz$/, "");
    let size = 0;
    try {
      size = statSync(join(MODELS_DIR, f)).size;
    } catch {
      // ignore
    }
    let accuracy = 0;
    try {
      const ptPath = join(MODELS_DIR, `${name}.pt`);
      if (existsSync(ptPath)) {
        const meta = JSON.parse(readFileSync(ptPath, "utf8")) as ModelMetadata;
        accuracy = Number(meta?.meta?.metrics?.accuracy ?? 0);
      }
    } catch {
      // ignore
    }
    out.push({ name, size, accuracy: Number(accuracy.toFixed(4)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Detailed metadata for a single model: input size, output size, accuracy,
 * trainedAt (file mtime), kind, feature keys + metrics from the side-car.
 */
export function getModelInfo(modelName: string): ModelInfo | null {
  const model = loadModel(modelName);
  if (!model) return null;
  const inputSize = model.weights.length;
  const outputSize = 2; // binary classifier → 2 probabilities
  const accuracy = Number(model.metadata?.meta?.metrics?.accuracy ?? 0);
  let trainedAt = "";
  try {
    const st = statSync(model.npzPath);
    const raw: unknown = typeof (st as { mtimeMs?: unknown }).mtimeMs === "function"
      ? (st as { mtimeMs: () => number }).mtimeMs()
      : (st as { mtimeMs: number }).mtimeMs;
    const ms = Number(raw) || st.mtime.getTime();
    trainedAt = new Date(ms).toISOString();
  } catch {
    trainedAt = new Date().toISOString();
  }
  const info: ModelInfo = {
    name: modelName,
    inputSize,
    outputSize,
    accuracy: Number(accuracy.toFixed(4)),
    trainedAt,
    fileSizeBytes: model.npzBytes,
    kind: model.metadata?.kind ?? "numpy_logistic_regression",
    featureKeys: model.metadata?.meta?.feature_keys,
    metrics: model.metadata?.meta?.metrics as Record<string, unknown> | undefined,
  };
  return info;
}

/** Check whether a model name is one of the four supported trained models.
 * Used by the API route to validate the `model` parameter before reading
 * the file from disk.
 */
export function isKnownModelName(name: string): boolean {
  return [
    "liveness_advanced",
    "face_attributes",
    "fraud_ring_detector",
    "mrz_validator",
  ].includes(name);
}
