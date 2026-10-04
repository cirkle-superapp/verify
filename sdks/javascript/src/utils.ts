/**
 * Helper utilities for the Cirkle Verify JavaScript/TypeScript SDK.
 *
 * Framework-free: only the standard library + Web APIs are used so the
 * SDK runs in any modern browser, Node.js, Bun, Deno, or edge runtime.
 *
 * The exports fall into three groups:
 *
 *   1. Image helpers — {@link encodeImage}, {@link fileToDataUrl},
 *      {@link blobToDataUrl}, {@link streamToArrayBuffer}.
 *   2. HMAC-SHA256 webhook helpers — {@link computeSignature},
 *      {@link formatSignatureHeader}, {@link verifySignature}.
 *   3. HTTP / runtime helpers — {@link normalizeBaseUrl},
 *      {@link toQueryString}, {@link isNodeRuntime}, {@link sleep}.
 */

import { InvalidImageError, SignatureVerificationError } from './errors';
import type { ImageInput } from './types';

// ─── Image helpers ────────────────────────────────────────────────

/**
 * Coerce any supported image input into a `data:image/...;base64,...` URL.
 *
 * Strings starting with `data:` are returned as-is. Other strings are
 * treated as file paths (Node only — in the browser, paths are
 * meaningless and will throw `InvalidImageError`).
 */
export async function encodeImage(input: ImageInput, mime?: string): Promise<string> {
  if (input == null) {
    throw new InvalidImageError('image input is null/undefined');
  }

  // Strings — already a data URL or a file path.
  if (typeof input === 'string') {
    if (input.startsWith('data:')) return input;
    if (input.length === 0) {
      throw new InvalidImageError('image string is empty');
    }
    // Treat as a filesystem path (Node only).
    return await readFileAsDataUrl(input, mime);
  }

  // File / Blob — use the FileReader/Blob.text path.
  if (isBlobLike(input)) {
    const buf = await input.arrayBuffer();
    return bytesToDataUrl(new Uint8Array(buf), mime ?? guessMimeFromBlob(input));
  }

  // ArrayBuffer / Uint8Array — encode directly.
  if (input instanceof ArrayBuffer) {
    return bytesToDataUrl(new Uint8Array(input), mime ?? 'image/jpeg');
  }
  if (input instanceof Uint8Array) {
    return bytesToDataUrl(input, mime ?? 'image/jpeg');
  }

  // ReadableStream — read fully into a Uint8Array.
  if (isReadableStream(input)) {
    const buf = await streamToArrayBuffer(input);
    return bytesToDataUrl(buf, mime ?? 'image/jpeg');
  }

  throw new InvalidImageError(`unsupported image input type: ${(input as object)?.constructor?.name ?? typeof input}`);
}

/** Convert a browser `File` (or `Blob`) to a data URL. */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return blobToDataUrl(file);
}

/** Convert a `Blob` (or browser `File`) to a data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Modern browsers expose FileReader; Node 20+ also has it under
    // the global scope. Fall back to Blob.arrayBuffer() otherwise.
    const Reader = (globalThis as { FileReader?: typeof FileReader }).FileReader;
    if (typeof Reader !== 'undefined') {
      const reader = new Reader();
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new InvalidImageError('FileReader produced non-string result')));
      reader.onerror = () => reject(new InvalidImageError(`FileReader error: ${reader.error?.message ?? 'unknown'}`));
      reader.readAsDataURL(blob);
      return;
    }
    blob
      .arrayBuffer()
      .then((buf) => resolve(bytesToDataUrl(new Uint8Array(buf), blob.type || 'image/jpeg')))
      .catch((e) => reject(new InvalidImageError(`Blob.arrayBuffer failed: ${e?.message ?? e}`)));
  });
}

/** Convert raw bytes to a data URL. */
export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  if (bytes.length === 0) {
    throw new InvalidImageError('image bytes are empty');
  }
  // Use btoa when available (browser + Node 16+); fall back to Buffer.
  const btoa = (globalThis as { btoa?: (s: string) => string }).btoa;
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return `data:${mime};base64,${btoa(s)}`;
  }
  const B = (globalThis as { Buffer?: { from: (...args: any[]) => { toString(enc: string): string } } }).Buffer;
  if (B) {
    return `data:${mime};base64,${B.from(bytes).toString('base64')}`;
  }
  throw new InvalidImageError('no base64 encoder available in this runtime');
}

/** Read a Node filesystem path into a data URL. */
async function readFileAsDataUrl(path: string, mime?: string): Promise<string> {
  const fs = await safeImportFs();
  if (!fs) {
    throw new InvalidImageError(
      'string image input is treated as a file path, but the filesystem is not available in this runtime (browser?)',
    );
  }
  let buf: Buffer | Uint8Array;
  try {
    buf = await fs.promises.readFile(path);
  } catch (e) {
    throw new InvalidImageError(`failed to read image ${path}: ${(e as Error)?.message ?? e}`);
  }
  if (!buf || buf.length === 0) {
    throw new InvalidImageError(`image file is empty: ${path}`);
  }
  const detectedMime = mime ?? guessMimeFromPath(path);
  // Buffer extends Uint8Array — pass it straight through.
  const B = (globalThis as { Buffer?: typeof import('buffer').Buffer }).Buffer;
  if (B && buf instanceof B) {
    return `data:${detectedMime};base64,${buf.toString('base64')}`;
  }
  return bytesToDataUrl(buf as Uint8Array, detectedMime);
}

/**
 * Consume a `ReadableStream<Uint8Array>` into a single `Uint8Array`.
 *
 * Used to support streaming image inputs from `fetch(...).body`.
 */
export async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

// ─── HMAC-SHA256 webhook helpers (Web Crypto API) ────────────────

/**
 * Compute the HMAC-SHA256 hex signature for a webhook payload.
 *
 * Uses the Web Crypto API (`globalThis.crypto.subtle`), available in
 * modern browsers, Node 18+, Bun, Deno, and edge runtimes. The payload
 * is signed as raw UTF-8 bytes (string) or as the bytes of an
 * `ArrayBuffer`/`Uint8Array`.
 */
export async function computeSignature(
  payload: string | Uint8Array | ArrayBuffer | Record<string, unknown>,
  secret: string,
): Promise<string> {
  if (!secret) {
    throw new SignatureVerificationError('secret is required to compute a signature');
  }
  const body = toPayloadBytes(payload);
  const key = await importHmacKey(secret);
  const digest = await crypto.subtle.sign('HMAC', key, body as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/** Wrap a hex digest as the `sha256=<hex>` header value. */
export function formatSignatureHeader(hexDigest: string): string {
  return `sha256=${hexDigest}`;
}

/**
 * Verify an incoming `X-Cirkle-Signature` header in constant time.
 *
 * Resolves to `true` if the signature matches, `false` if it parses
 * cleanly but does not match (the most common case — a wrong secret),
 * and rejects with `SignatureVerificationError` if the header is
 * malformed (empty, missing prefix, invalid hex).
 */
export async function verifySignature(
  payload: string | Uint8Array | ArrayBuffer | Record<string, unknown>,
  secret: string,
  headerValue: string,
): Promise<boolean> {
  if (!secret) {
    throw new SignatureVerificationError('secret is required to verify a signature');
  }
  if (!headerValue) {
    throw new SignatureVerificationError('signature header is empty');
  }
  if (!headerValue.startsWith('sha256=')) {
    throw new SignatureVerificationError("signature header must be of the form 'sha256=<hex>'");
  }
  const expectedHex = headerValue.slice('sha256='.length).trim();
  if (!expectedHex) {
    throw new SignatureVerificationError('signature header has no hex digest');
  }
  if (!/^[0-9a-fA-F]+$/.test(expectedHex) || expectedHex.length % 2 !== 0) {
    throw new SignatureVerificationError('signature hex decode failed: invalid characters');
  }
  const expected = hexToBytes(expectedHex);
  const actual = await computeSignature(payload, secret);
  const actualBytes = hexToBytes(actual);
  // Constant-time compare.
  if (expected.length !== actualBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected[i] ^ actualBytes[i];
  }
  return diff === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function toPayloadBytes(payload: string | Uint8Array | ArrayBuffer | Record<string, unknown>): Uint8Array {
  if (typeof payload === 'string') {
    return new TextEncoder().encode(payload);
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (payload instanceof ArrayBuffer) {
    return new Uint8Array(payload);
  }
  if (payload && typeof payload === 'object') {
    return new TextEncoder().encode(canonicalJson(payload));
  }
  throw new SignatureVerificationError(`unsupported payload type for signature: ${typeof payload}`);
}

/**
 * Deterministic JSON serialisation — sorted keys, no whitespace.
 *
 * Mirrors the canonicaliser the Cirkle server uses when signing webhook
 * payloads, so a dict-input verify round-trips the same bytes the server
 * signed.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return '{' + Object.keys(v).sort().map((k) => `"${k}":${canonicalJson(v[k])}`).join(',') + '}';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ─── HTTP / runtime helpers ───────────────────────────────────────

/** Strip trailing slashes from a base URL (avoids double-slash paths). */
export function normalizeBaseUrl(url: string | undefined): string {
  if (!url) return 'https://cirkle-verify.vercel.app';
  return url.replace(/\/+$/, '');
}

/** Render an object as a URL query string (without the leading `?`). */
export function toQueryString(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s;
}

/** Best-effort detection of a Node runtime (vs browser / edge). */
export function isNodeRuntime(): boolean {
  if (typeof process === 'undefined') return false;
  return !!(process.versions?.node) && typeof (globalThis as { window?: unknown }).window === 'undefined';
}

/** Promise-based sleep used by the retry loop. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Internal helpers ─────────────────────────────────────────────

function isBlobLike(v: unknown): v is Blob {
  return (
    v != null &&
    typeof (v as Blob).arrayBuffer === 'function' &&
    typeof (v as Blob).size === 'number'
  );
}

function isReadableStream(v: unknown): v is ReadableStream<Uint8Array> {
  return v != null && typeof (v as ReadableStream<Uint8Array>).getReader === 'function';
}

function guessMimeFromPath(path: string): string {
  const ext = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'heic':
    case 'heif':
      return 'image/heic';
    default:
      return 'application/octet-stream';
  }
}

function guessMimeFromBlob(blob: Blob): string {
  if (blob.type && blob.type.startsWith('image/')) return blob.type;
  const name = (blob as File).name;
  if (typeof name === 'string') return guessMimeFromPath(name);
  return 'image/jpeg';
}

/** Dynamically import 'fs' — returns null in non-Node runtimes. */
async function safeImportFs(): Promise<typeof import('fs') | null> {
  if (!isNodeRuntime()) return null;
  try {
    // The indirection lets Webpack/Bun bundle without bundling fs in the browser.
    const mod = await import(/* webpackIgnore: true */ 'fs');
    return mod;
  } catch {
    return null;
  }
}
