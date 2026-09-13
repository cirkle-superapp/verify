/**
 * Vercel Blob Storage Adapter + Quota Governor.
 *
 * Per architecture mandate:
 *   - Vercel Blob = small object storage ONLY (avatars, documents, thumbnails)
 *   - Hobby: 1GB storage, 10k simple ops, 2k advanced ops, 10GB transfer / month
 *   - Quota thresholds: 70% monitoring, 80% warning, 90% restrict, 95% emergency, 100% hard stop
 *   - At hard limit: REJECT nonessential uploads (fail closed)
 *   - Large uploads require customer-funded storage (not auto-accepted)
 *
 * Implements StoragePort. No Vercel-specific code leaks into business logic.
 * Cloudflare R2 is EXPLICITLY REMOVED — do not add @aws-s3 or R2 SDKs.
 */

import type { StoragePort, StorageObjectMeta, StorageClass, QuotaSnapshot, QuotaLevel } from "./ports";
import { PlatformError } from "./ports";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";

const BLOB_BREAKER = {
  name: "vercel_blob",
  failureThreshold: 3,
  openDurationMs: 30_000,
  halfOpenProbes: 2,
};

// ─── Quota Governor ───────────────────────────────────────────────
// Vercel Blob Hobby limits
const BLOB_STORAGE_LIMIT_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const BLOB_OPS_LIMIT = 10_000;                              // simple ops / month
const BLOB_TRANSFER_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;  // 10 GB / month

// Max single object size for FREE_PLATFORM_STORAGE (reject larger)
const MAX_FREE_OBJECT_BYTES = 5 * 1024 * 1024; // 5 MB — documents/thumbnails

interface BlobUsageState {
  storageBytes: number;
  opsThisMonth: number;
  transferBytes: number;
  month: string;            // YYYY-MM
  lastReset: string;
}

let usage: BlobUsageState = {
  storageBytes: 0,
  opsThisMonth: 0,
  transferBytes: 0,
  month: new Date().toISOString().slice(0, 7),
  lastReset: new Date().toISOString(),
};

function rolloverIfNewMonth() {
  const month = new Date().toISOString().slice(0, 7);
  if (usage.month !== month) {
    usage = {
      storageBytes: 0,        // storage is cumulative; reset tracked ops/transfer
      opsThisMonth: 0,
      transferBytes: 0,
      month,
      lastReset: new Date().toISOString(),
    };
  }
}

function quotaLevel(percent: number): QuotaLevel {
  if (percent >= 100) return "exhausted";
  if (percent >= 95) return "emergency";
  if (percent >= 90) return "restrict";
  if (percent >= 80) return "warning";
  if (percent >= 70) return "monitoring";
  return "ok";
}

// In-memory object metadata ledger (production: Turso table)
const objectLedger = new Map<string, StorageObjectMeta>();

// ─── Adapter ──────────────────────────────────────────────────────

export const vercelBlobAdapter: StoragePort = {
  name: "vercel-blob",

  async put(key, data, opts) {
    rolloverIfNewMonth();
    const buffer = typeof data === "string" ? Buffer.from(data) : data;
    const sizeBytes = buffer.length;

    // Large file policy: FREE_PLATFORM_STORAGE rejects > MAX_FREE_OBJECT_BYTES
    const storageClass = opts.storageClass || "FREE_PLATFORM_STORAGE";
    const customerFunded = opts.customerFunded || storageClass === "CUSTOMER_FUNDED_STORAGE";

    if (!customerFunded && sizeBytes > MAX_FREE_OBJECT_BYTES) {
      throw new PlatformError(
        "STORAGE_QUOTA_EXCEEDED",
        `Object too large for free platform storage: ${sizeBytes} bytes > ${MAX_FREE_OBJECT_BYTES} bytes max. ` +
          `Reject as free upload; route to customer-funded storage path.`,
        undefined,
        false,
        "vercel-blob",
      );
    }

    // Quota check: reject noncritical uploads at hard limit
    const storagePercent = (usage.storageBytes / BLOB_STORAGE_LIMIT_BYTES) * 100;
    const storageLevel = quotaLevel(storagePercent);
    const opsPercent = (usage.opsThisMonth / BLOB_OPS_LIMIT) * 100;

    if (
      (storageLevel === "exhausted" || quotaLevel(opsPercent) === "exhausted") &&
      storageClass === "NONCRITICAL"
    ) {
      throw new PlatformError(
        "STORAGE_QUOTA_EXCEEDED",
        `Quota exhausted: storage ${storagePercent.toFixed(1)}%, ops ${opsPercent.toFixed(1)}%. ` +
          `Noncritical uploads rejected (fail closed).`,
        undefined,
        false,
        "vercel-blob",
      );
    }

    if (storageLevel === "emergency" && storageClass === "NONCRITICAL") {
      throw new PlatformError(
        "STORAGE_QUOTA_EXCEEDED",
        `Emergency quota level (${storagePercent.toFixed(1)}% storage). Noncritical uploads restricted.`,
        undefined,
        false,
        "vercel-blob",
      );
    }

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      // Dev mode: store in-memory (no Vercel Blob in sandbox)
      return putInMemory(key, buffer, opts, sizeBytes, storageClass, customerFunded);
    }

    try {
      const result = await withBreaker(BLOB_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          const form = new FormData();
          form.append("file", new Blob([buffer], { type: opts.contentType }), key);
          form.append("pathname", key);
          form.append("cacheControl", "max-age=3600");
          form.append("addRandomSuffix", "false");

          const res = await fetch(`https://blob.vercel-storage.com`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PlatformError(
              "DEPENDENCY_UNAVAILABLE",
              `Vercel Blob error ${res.status}: ${text.slice(0, 200)}`,
              undefined,
              res.status >= 500,
              "vercel-blob",
            );
          }
          return res.json();
        }),
      );

      usage.storageBytes += sizeBytes;
      usage.opsThisMonth++;
      usage.transferBytes += sizeBytes;

      const meta: StorageObjectMeta = {
        objectId: key,
        tenantId: opts.tenantId,
        ownerId: opts.ownerId,
        objectType: opts.objectType,
        sizeBytes,
        contentType: opts.contentType,
        storageProvider: "vercel-blob",
        storageClass,
        createdAt: new Date().toISOString(),
        deletable: storageClass !== "SYSTEM_CRITICAL",
        customerFunded,
      };
      objectLedger.set(key, meta);

      return { key, url: result.url, meta };
    } catch (e: any) {
      if (e instanceof PlatformError) throw e;
      throw new PlatformError("DEPENDENCY_UNAVAILABLE", e?.message, e, false, "vercel-blob");
    }
  },

  async get(key) {
    rolloverIfNewMonth();
    const meta = objectLedger.get(key);
    if (!meta) return null;
    // In dev/sandbox without token: return from in-memory store
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return getFromMemory(key, meta);
    }
    try {
      const res = await withBreaker(BLOB_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          const r = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15_000),
          });
          if (!r.ok) throw new PlatformError("NOT_FOUND", `Blob ${key} not found`, undefined, false, "vercel-blob");
          return r.arrayBuffer();
        }),
      );
      usage.transferBytes += meta.sizeBytes;
      usage.opsThisMonth++;
      return { data: Buffer.from(res), meta };
    } catch (e: any) {
      if (e instanceof PlatformError && e.type === "NOT_FOUND") return null;
      throw e;
    }
  },

  async delete(key) {
    const meta = objectLedger.get(key);
    if (!meta) return false;
    if (meta.storageClass === "SYSTEM_CRITICAL") {
      throw new PlatformError("AUTHORIZATION_ERROR", "Cannot delete SYSTEM_CRITICAL object", undefined, false, "vercel-blob");
    }
    objectLedger.delete(key);
    usage.storageBytes = Math.max(0, usage.storageBytes - meta.sizeBytes);
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (token) {
      try {
        await withBreaker(BLOB_BREAKER, () =>
          withRetry(DEFAULT_RETRY, async () => {
            await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(key)}?pathname=${encodeURIComponent(key)}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10_000),
            });
          }),
        );
      } catch {} // best-effort delete
    }
    usage.opsThisMonth++;
    return true;
  },

  async deleteMany(keys) {
    let count = 0;
    for (const k of keys) {
      try {
        if (await this.delete(k)) count++;
      } catch {}
    }
    return count;
  },

  async quota(): Promise<QuotaSnapshot> {
    rolloverIfNewMonth();
    const percent = (usage.storageBytes / BLOB_STORAGE_LIMIT_BYTES) * 100;
    return {
      provider: "vercel-blob",
      resource: "storage_bytes",
      used: usage.storageBytes,
      limit: BLOB_STORAGE_LIMIT_BYTES,
      percent: Math.round(percent * 100) / 100,
      level: quotaLevel(percent),
      remaining: Math.max(0, BLOB_STORAGE_LIMIT_BYTES - usage.storageBytes),
      lastUpdated: new Date().toISOString(),
    };
  },
};

/** Combined quota snapshot (storage + ops + transfer) for dashboard. */
export async function blobFullQuota(): Promise<{
  storage: QuotaSnapshot;
  ops: QuotaSnapshot;
  transfer: QuotaSnapshot;
}> {
  rolloverIfNewMonth();
  const sPct = (usage.storageBytes / BLOB_STORAGE_LIMIT_BYTES) * 100;
  const oPct = (usage.opsThisMonth / BLOB_OPS_LIMIT) * 100;
  const tPct = (usage.transferBytes / BLOB_TRANSFER_LIMIT_BYTES) * 100;
  return {
    storage: {
      provider: "vercel-blob", resource: "storage_bytes",
      used: usage.storageBytes, limit: BLOB_STORAGE_LIMIT_BYTES,
      percent: sPct, level: quotaLevel(sPct),
      remaining: Math.max(0, BLOB_STORAGE_LIMIT_BYTES - usage.storageBytes),
      lastUpdated: new Date().toISOString(),
    },
    ops: {
      provider: "vercel-blob", resource: "ops_monthly",
      used: usage.opsThisMonth, limit: BLOB_OPS_LIMIT,
      percent: oPct, level: quotaLevel(oPct),
      remaining: Math.max(0, BLOB_OPS_LIMIT - usage.opsThisMonth),
      lastUpdated: new Date().toISOString(),
    },
    transfer: {
      provider: "vercel-blob", resource: "transfer_bytes_monthly",
      used: usage.transferBytes, limit: BLOB_TRANSFER_LIMIT_BYTES,
      percent: tPct, level: quotaLevel(tPct),
      remaining: Math.max(0, BLOB_TRANSFER_LIMIT_BYTES - usage.transferBytes),
      lastUpdated: new Date().toISOString(),
    },
  };
}

// ─── In-memory fallback (dev/sandbox without BLOB_READ_WRITE_TOKEN) ─
const memoryStore = new Map<string, { buffer: Buffer; meta: StorageObjectMeta }>();

function putInMemory(
  key: string,
  buffer: Buffer,
  opts: any,
  sizeBytes: number,
  storageClass: StorageClass,
  customerFunded: boolean,
) {
  const meta: StorageObjectMeta = {
    objectId: key,
    tenantId: opts.tenantId,
    ownerId: opts.ownerId,
    objectType: opts.objectType,
    sizeBytes,
    contentType: opts.contentType,
    storageProvider: "vercel-blob (in-memory dev)",
    storageClass,
    createdAt: new Date().toISOString(),
    deletable: storageClass !== "SYSTEM_CRITICAL",
    customerFunded,
  };
  memoryStore.set(key, { buffer, meta });
  objectLedger.set(key, meta);
  usage.storageBytes += sizeBytes;
  usage.opsThisMonth++;
  return Promise.resolve({ key, url: `memory://${key}`, meta });
}

function getFromMemory(key: string, meta: StorageObjectMeta) {
  const item = memoryStore.get(key);
  if (!item) return Promise.resolve(null);
  usage.transferBytes += meta.sizeBytes;
  usage.opsThisMonth++;
  return Promise.resolve({ data: item.buffer, meta });
}
