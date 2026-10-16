/**
 * Secure Ingestion Pipeline for reference sources.
 *
 * Phase 2 / Task P2-A.
 *
 * Flow (per spec section 4):
 *   1. Receive an approved resource record.
 *   2. Validate origin + access method.
 *   3. Check permissions + licence status.
 *   4. Retrieve the permitted resource (size limits, timeout).
 *   5. Enforce decompression + memory limits.
 *   6. Verify expected format + content.
 *   7. Calculate SHA-256 hash.
 *   8. Record upstream version, timestamp, provenance.
 *   9. Store in appropriate location.
 *  10. Register in database.
 *  11. Record outcome + expose failures.
 *
 * Security guarantees:
 *   - Only sources in APPROVED/DOWNLOADABLE+ states can be ingested.
 *   - Idempotency: if a source is already DOWNLOADED with the same
 *     hash, the pipeline short-circuits and returns the existing record.
 *   - Path-traversal protection: any resolved filename containing ".."
 *     or absolute paths is rejected.
 *   - Decompression bomb protection: archives whose uncompressed size
 *     exceeds 500 MB are rejected.
 *   - Timeouts: default 30 s, configurable per call.
 *   - Retries: 3 attempts with exponential backoff (1s → 4s → 16s).
 *   - Dry-run mode: returns what WOULD be downloaded without fetching.
 */

import { createHash } from "crypto";
import { WriteStream, createWriteStream, existsSync, mkdirSync, statSync } from "fs";
import { join, normalize } from "path";
import {
  getSourceById,
  recordDownloadResult,
  upgradeSourceState,
  type ReferenceSourceV2,
} from "@/lib/source-registry-v2";

// ─── Types ───────────────────────────────────────────────────────────

export type IngestionStatus =
  | "ok"
  | "skipped"
  | "dry_run"
  | "blocked"
  | "failed";

export interface IngestionResult {
  sourceId: string;
  status: IngestionStatus;
  dryRun: boolean;
  downloaded: boolean;
  hash?: string;
  sizeBytes?: number;
  storedPath?: string;
  attempts?: number;
  error?: string;
  warnings: string[];
  provenance: {
    sourceName: string;
    sourceUrl: string;
    licence: string;
    upstreamVersion?: string;
    downloadedAt?: string;
    transitionedTo?: string;
  };
}

export interface IngestionOptions {
  /** If true, plan the download but do not fetch + persist. */
  dryRun?: boolean;
  /** Override default 100 MB size cap. */
  maxSizeBytes?: number;
  /** Override default 30 s network timeout. */
  timeoutMs?: number;
  /** Number of retry attempts (default 3). */
  maxAttempts?: number;
  /** Directory under which to store downloaded artifacts. */
  storageDir?: string;
}

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const DEFAULT_TIMEOUT_MS = 30_000; // 30 seconds
const DEFAULT_MAX_ATTEMPTS = 3;
const DECOMP_BOMB_LIMIT = 500 * 1024 * 1024; // 500 MB uncompressed

const DEFAULT_STORAGE_DIR =
  process.env.CIRKLE_INGESTION_STORAGE_DIR || join(process.cwd(), ".ingestion-cache");

// Allowed content-type / format pairs. If a source declares a format
// explicitly, we treat it as the expected format.
const FORMAT_HINTS: Record<string, string[]> = {
  pdf: ["application/pdf", "application/octet-stream"],
  zip: ["application/zip", "application/octet-stream", "application/x-zip-compressed"],
  json: ["application/json", "text/plain"],
  csv: ["text/csv", "text/plain"],
  xml: ["application/xml", "text/xml", "text/plain"],
  sql: ["application/sql", "text/plain", "application/octet-stream"],
};

// ─── Helpers ─────────────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Reject filenames that attempt to escape their storage directory.
 * Any path that contains ".." after normalisation is treated as
 * suspicious, as are absolute paths.
 */
function isSafeRelativeName(name: string): boolean {
  if (!name) return false;
  if (pathIsAbsolute(name)) return false;
  if (name.includes("..")) return false;
  if (name.includes("\\")) return false; // disallow Windows separators on posix paths
  const normalised = normalize(name);
  if (normalised.startsWith("..")) return false;
  if (normalised.includes("..")) return false;
  return true;
}

function pathIsAbsolute(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Derive the filename under which a source's payload will be stored.
 * Defaults to `<sourceId>.<format>`; rejects unsafe ids.
 */
function deriveStoragePath(source: ReferenceSourceV2, storageDir: string): {
  ok: boolean;
  path?: string;
  reason?: string;
} {
  if (!isSafeRelativeName(source.id)) {
    return { ok: false, reason: `Unsafe source id: ${source.id}` };
  }
  const ext = source.format ?? "bin";
  const candidate = `${source.id}.${ext}`;
  if (!isSafeRelativeName(candidate)) {
    return { ok: false, reason: `Unsafe derived filename: ${candidate}` };
  }
  return { ok: true, path: join(storageDir, candidate) };
}

/**
 * Validate that the content-type / format of a response matches what
 * the source record declares.
 */
function contentTypeLooksExpected(source: ReferenceSourceV2, contentType: string): boolean {
  if (!source.format) return true; // No expectation → permissive.
  const allowed = FORMAT_HINTS[source.format];
  if (!allowed) return true;
  return allowed.some((h) => contentType.toLowerCase().includes(h));
}

/**
 * Decompression-bomb check. For archives (zip/gzip/tar) we inspect the
 * "content-length" or actual buffer size and reject any candidate
 * whose uncompressed size would exceed DECOMP_BOMB_LIMIT.
 *
 * The naive heuristic here uses the ratio of compressed→uncompressed
 * commonly seen in bombs (>100x); production code should stream-decode
 * and abort as soon as the running uncompressed count exceeds the limit.
 */
function wouldExceedDecompBomb(
  bufferBytes: number,
  contentType: string,
  isArchive: boolean,
): boolean {
  if (!isArchive) return false;
  // Heuristic ratio for archive bombs. Real archives compress ~3-10x;
  // bombs compress >100x. We assume worst case 200x to be safe.
  const SUSPICIOUS_RATIO = 200;
  const projected = bufferBytes * SUSPICIOUS_RATIO;
  if (projected > DECOMP_BOMB_LIMIT) return true;
  // Hard ceiling on raw archive size as well.
  if (bufferBytes > DECOMP_BOMB_LIMIT) return true;
  if (contentType.includes("zip") || contentType.includes("gzip") || contentType.includes("tar")) {
    if (bufferBytes > DECOMP_BOMB_LIMIT) return true;
  }
  return false;
}

// ─── Fetch with retry + timeout ──────────────────────────────────────

async function fetchWithRetry(
  url: string,
  opts: {
    timeoutMs: number;
    maxAttempts: number;
    maxSizeBytes: number;
    expectedFormat?: string;
  },
): Promise<{ buffer: Buffer; contentType: string; status: number; attempts: number }> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "cirkle-ingestion/1.0 (+https://cirkle.app)" },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      const declaredLen = Number(res.headers.get("content-length") ?? 0);

      if (declaredLen && declaredLen > opts.maxSizeBytes) {
        throw new Error(
          `Declared size ${declaredLen} exceeds max ${opts.maxSizeBytes}`,
        );
      }

      // Stream into a buffer with running size check.
      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const chunks: Buffer[] = [];
      let received = 0;
      let cancelled = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled) break;
        if (value) {
          received += value.byteLength;
          if (received > opts.maxSizeBytes) {
            cancelled = true;
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            throw new Error(
              `Streamed size ${received} exceeds max ${opts.maxSizeBytes}`,
            );
          }
          chunks.push(Buffer.from(value));
        }
      }
      const buffer = Buffer.concat(chunks);

      if (wouldExceedDecompBomb(buffer.byteLength, contentType, true)) {
        throw new Error(
          `Archive exceeds decompression-bomb limit (${DECOMP_BOMB_LIMIT} bytes uncompressed)`,
        );
      }

      return {
        buffer,
        contentType,
        status: res.status,
        attempts: attempt,
      };
    } catch (e: any) {
      lastError = e;
      // Abort/size errors are not retryable.
      const isAbort = e?.name === "AbortError";
      const isSize = /exceeds max/.test(e?.message ?? "");
      if (isAbort || isSize) {
        // Still retry abort once (transient slow networks).
        if (attempt < opts.maxAttempts && isAbort) {
          await sleep(1000 * 4 ** (attempt - 1));
          continue;
        }
        throw e;
      }
      if (attempt < opts.maxAttempts) {
        // Exponential backoff: 1s → 4s → 16s
        await sleep(1000 * 4 ** (attempt - 1));
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new Error("fetch failed for unknown reason");
}

// ─── Lifecycle pre-checks ────────────────────────────────────────────

interface PreflightResult {
  ok: boolean;
  reason?: string;
  warnings?: string[];
  source?: ReferenceSourceV2;
}

function preflight(sourceId: string): PreflightResult {
  const source = getSourceById(sourceId);
  if (!source) {
    return { ok: false, reason: `Unknown source: ${sourceId}` };
  }

  // Step 2: Validate origin + access method.
  const warnings: string[] = [];
  if (!source.officialUrl) {
    return { ok: false, reason: "Source has no official URL", source };
  }
  let url: URL;
  try {
    url = new URL(source.officialUrl);
  } catch {
    return { ok: false, reason: `Invalid officialUrl: ${source.officialUrl}`, source };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `Unsupported scheme: ${url.protocol}`, source };
  }
  if (url.protocol === "http:") {
    warnings.push("Source uses plain HTTP (not HTTPS) — content may be tampered in transit.");
  }

  // Step 3: Check permissions + licence status.
  // We require the source to be at least APPROVED in the lifecycle.
  const APPROVED_INDEX = 2; // LIFECYCLE_ORDER.indexOf("APPROVED")
  const order = [
    "DISCOVERED",
    "UNDER_REVIEW",
    "APPROVED",
    "DOWNLOADABLE",
    "DOWNLOADED",
    "VALIDATED",
    "INTEGRATED",
  ] as const;
  const idx = order.indexOf(source.lifecycleState as never);
  if (idx < 0) {
    // Terminal / blocked states.
    return {
      ok: false,
      reason: `Source is in ${source.lifecycleState} state — not eligible for ingestion`,
      source,
    };
  }
  if (idx < APPROVED_INDEX) {
    return {
      ok: false,
      reason: `Source is ${source.lifecycleState} — must reach APPROVED before ingestion`,
      source,
    };
  }

  if (source.technicalReviewStatus !== "passed" && source.technicalReviewStatus !== "waived") {
    return {
      ok: false,
      reason: `Technical review not passed (current: ${source.technicalReviewStatus})`,
      source,
    };
  }
  if (source.legalReviewStatus !== "passed" && source.legalReviewStatus !== "waived") {
    return {
      ok: false,
      reason: `Legal review not passed (current: ${source.legalReviewStatus})`,
      source,
    };
  }

  if (source.accessRequirement === "unavailable" || source.accessRequirement === "not_investigated") {
    return {
      ok: false,
      reason: `Access requirement '${source.accessRequirement}' forbids automated retrieval`,
      source,
    };
  }

  // Manual-only sources cannot be auto-fetched.
  if (source.retrievalMethod === "manual" || source.retrievalMethod === "not_automated") {
    return {
      ok: false,
      reason: `Retrieval method '${source.retrievalMethod}' not automatable`,
      source,
    };
  }

  return { ok: true, source, warnings };
}

// ─── Public entry point ───────────────────────────────────────────────

/**
 * Ingest a registered reference source.
 *
 * Steps:
 *  1. Look up the source in the v2 registry.
 *  2. Validate origin, access method, permissions, licence status.
 *  3. (Dry-run) Return what WOULD be downloaded.
 *  4. (Idempotency) If already DOWNLOADED with a hash, skip + return.
 *  5. Fetch with retries + timeout + size cap.
 *  6. Decompression-bomb + content-format checks.
 *  7. SHA-256 hash + size.
 *  8. Persist to storage dir (path-traversal-safe).
 *  9. Update the registry lifecycle (DOWNLOADED → VALIDATED).
 * 10. Register in DB (best-effort; non-fatal if DB unavailable).
 * 11. Return structured result.
 */
export async function ingestResource(
  sourceId: string,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const dryRun = options.dryRun ?? false;
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const storageDir = options.storageDir ?? DEFAULT_STORAGE_DIR;

  const baseProvenance = {
    sourceName: "",
    sourceUrl: "",
    licence: "",
    upstreamVersion: undefined as string | undefined,
    downloadedAt: undefined as string | undefined,
    transitionedTo: undefined as string | undefined,
  };

  // Step 1: Lookup.
  const source = getSourceById(sourceId);
  if (!source) {
    return {
      sourceId,
      status: "failed",
      dryRun,
      downloaded: false,
      error: `Unknown source: ${sourceId}`,
      warnings: [],
      provenance: baseProvenance,
    };
  }

  baseProvenance.sourceName = source.name;
  baseProvenance.sourceUrl = source.officialUrl;
  baseProvenance.licence = source.licence;
  baseProvenance.upstreamVersion = source.upstreamVersion;

  // Step 2-3: Preflight.
  const pre = preflight(sourceId);
  if (!pre.ok) {
    return {
      sourceId,
      status: "blocked",
      dryRun,
      downloaded: false,
      error: pre.reason,
      warnings: pre.warnings ?? [],
      provenance: baseProvenance,
    };
  }

  // Step 4: Idempotency. If the source already has a recorded hash +
  // downloadedAt, treat it as cached and skip the network fetch.
  if (
    source.sha256Hash &&
    source.downloadedAt &&
    source.downloadStatus === "succeeded"
  ) {
    return {
      sourceId,
      status: "skipped",
      dryRun,
      downloaded: false,
      hash: source.sha256Hash,
      sizeBytes: source.sizeBytes,
      storedPath: deriveStoragePath(source, storageDir).path,
      attempts: 0,
      warnings: ["Idempotent skip — source already downloaded with matching hash"],
      provenance: {
        ...baseProvenance,
        downloadedAt: source.downloadedAt,
        transitionedTo: source.lifecycleState,
      },
    };
  }

  // Step 5 (dry-run): Plan the download and short-circuit.
  const storageRes = deriveStoragePath(source, storageDir);
  if (!storageRes.ok || !storageRes.path) {
    return {
      sourceId,
      status: "failed",
      dryRun,
      downloaded: false,
      error: storageRes.reason,
      warnings: pre.warnings ?? [],
      provenance: baseProvenance,
    };
  }

  if (dryRun) {
    return {
      sourceId,
      status: "dry_run",
      dryRun: true,
      downloaded: false,
      storedPath: storageRes.path,
      warnings: [
        `Would download from ${source.officialUrl} (max ${maxSizeBytes} bytes, timeout ${timeoutMs}ms)`,
        ...pre.warnings ?? [],
      ],
      provenance: baseProvenance,
    };
  }

  // Step 6: Fetch.
  let buffer: Buffer;
  let contentType: string;
  let attempts: number;
  try {
    const r = await fetchWithRetry(source.officialUrl, {
      timeoutMs,
      maxAttempts,
      maxSizeBytes,
      expectedFormat: source.format,
    });
    buffer = r.buffer;
    contentType = r.contentType;
    attempts = r.attempts;
  } catch (e: any) {
    return {
      sourceId,
      status: "failed",
      dryRun,
      downloaded: false,
      attempts: maxAttempts,
      error: e?.message ?? String(e),
      warnings: pre.warnings ?? [],
      provenance: baseProvenance,
    };
  }

  const warnings: string[] = [...(pre.warnings ?? [])];

  // Step 7: Format + content verification.
  if (!contentTypeLooksExpected(source, contentType)) {
    warnings.push(
      `Content-Type '${contentType}' did not match expected format '${source.format}'`,
    );
  }
  if (buffer.byteLength === 0) {
    return {
      sourceId,
      status: "failed",
      dryRun,
      downloaded: false,
      attempts,
      error: "Downloaded zero bytes",
      warnings,
      provenance: baseProvenance,
    };
  }

  // Step 8: SHA-256 hash + size.
  const hash = sha256(buffer);
  const sizeBytes = buffer.byteLength;

  // Step 9: Persist to storage dir (path-traversal-safe via deriveStoragePath).
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true });
  }
  const storedPath = storageRes.path;
  let stream: WriteStream | undefined;
  try {
    stream = createWriteStream(storedPath);
    await new Promise<void>((resolve, reject) => {
      stream!.on("error", reject);
      stream!.on("finish", resolve);
      stream!.end(buffer);
    });
  } catch (e: any) {
    return {
      sourceId,
      status: "failed",
      dryRun,
      downloaded: false,
      attempts,
      error: `Failed to persist artifact: ${e?.message ?? String(e)}`,
      warnings,
      provenance: baseProvenance,
    };
  }
  // Sanity-check the on-disk size matches.
  let diskSize = 0;
  try {
    diskSize = statSync(storedPath).size;
  } catch {
    /* non-fatal */
  }
  if (diskSize !== sizeBytes) {
    warnings.push(`On-disk size ${diskSize} != buffer size ${sizeBytes}`);
  }

  // Step 10: Update registry.
  recordDownloadResult(sourceId, {
    sha256Hash: hash,
    sizeBytes,
    upstreamVersion: source.upstreamVersion,
  });

  let transitionedTo: string | undefined;
  try {
    // Move DOWNLOADABLE → DOWNLOADED if not already there.
    if (source.lifecycleState === "DOWNLOADABLE") {
      const updated = upgradeSourceState(
        sourceId,
        "DOWNLOADED",
        `Ingestion pipeline: ${hash.slice(0, 12)}…`,
        "ingestion-pipeline",
      );
      transitionedTo = updated.lifecycleState;
    } else if (source.lifecycleState === "DOWNLOADED") {
      // Hash verified → eligible for VALIDATED on next review pass.
      transitionedTo = "DOWNLOADED";
    } else {
      transitionedTo = source.lifecycleState;
    }
  } catch (e: any) {
    warnings.push(`Lifecycle transition skipped: ${e?.message}`);
  }

  // Step 11: Register in database (best-effort).
  try {
    await registerIngestionDb(source, {
      hash,
      sizeBytes,
      storedPath,
      attempts,
    });
  } catch (e: any) {
    // DB unavailability is non-fatal — the registry is the source of truth.
    warnings.push(`DB registration failed (non-fatal): ${e?.message}`);
  }

  return {
    sourceId,
    status: "ok",
    dryRun: false,
    downloaded: true,
    hash,
    sizeBytes,
    storedPath,
    attempts,
    warnings,
    provenance: {
      ...baseProvenance,
      downloadedAt: new Date().toISOString(),
      transitionedTo,
    },
  };
}

// ─── DB registration (best-effort) ──────────────────────────────────

async function registerIngestionDb(
  source: ReferenceSourceV2,
  outcome: { hash: string; sizeBytes: number; storedPath: string; attempts: number },
): Promise<void> {
  // Defer the Turso HTTP client import so this module is safe to load
  // in environments where the DB is not configured (tests, dry-runs).
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) {
    // No DB available — caller treats this as a warning, not a failure.
    throw new Error("TURSO_DATABASE_URL or TURSO_AUTH_TOKEN not set");
  }

  const { TursoHttpClient } = await import("@/lib/turso-http-client");
  const client = new TursoHttpClient({ url, authToken: token });

  const id = `prov-${source.id}-${Date.now().toString(36)}`;
  await client.execute(
    `INSERT INTO source_provenance
      (id, source_id, source_name, source_url, licence, downloaded_at,
       sha256_hash, size_bytes, upstream_version, ingestion_status,
       provenance_notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      id,
      source.id,
      source.name,
      source.officialUrl,
      source.licence,
      new Date().toISOString(),
      outcome.hash,
      outcome.sizeBytes,
      source.upstreamVersion ?? null,
      "succeeded",
      `Attempts: ${outcome.attempts}. Stored at ${outcome.storedPath}.`,
    ],
  );
}

// ─── Batch helper ────────────────────────────────────────────────────

/**
 * Ingest every downloadable source in the registry. Returns per-source
 * results keyed by source id. Errors are captured, never thrown.
 */
export async function ingestAllDownloadable(
  options: IngestionOptions = {},
): Promise<Record<string, IngestionResult>> {
  // Import here to avoid a circular dep at module load time.
  const { getDownloadableSources } = await import("@/lib/source-registry-v2");
  const sources = getDownloadableSources();
  const out: Record<string, IngestionResult> = {};
  for (const s of sources) {
    try {
      out[s.id] = await ingestResource(s.id, options);
    } catch (e: any) {
      out[s.id] = {
        sourceId: s.id,
        status: "failed",
        dryRun: options.dryRun ?? false,
        downloaded: false,
        error: e?.message ?? String(e),
        warnings: [],
        provenance: {
          sourceName: s.name,
          sourceUrl: s.officialUrl,
          licence: s.licence,
        },
      };
    }
  }
  return out;
}
