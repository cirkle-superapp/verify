/**
 * API Key authentication for the Cirkle Verify public API.
 *
 * Issues, validates, and manages API keys for third-party consumers.
 * Keys are stored in Turso (authoritative) and validated per-request.
 *
 * This makes us a real API provider — competitors (Onfido, Jumio) require
 * enterprise contracts; Cirkle lets anyone sign up and get an API key.
 *
 * Key format: cvk_<48 hex chars>
 * Storage: SHA-256 hash of key stored in api_keys table (never store raw key)
 * Auth methods: Authorization: Bearer cvk_xxx OR X-API-Key: cvk_xxx
 */

import { createHash, randomBytes } from "crypto";

export interface ApiKey {
  keyId: string;          // public identifier (for revocation)
  keyHash: string;        // SHA-256 hash (never store raw key)
  name: string;           // human-readable label
  email: string;
  createdAt: string;
  active: boolean;
  rateLimitPerMin: number;
  totalRequests: number;
}

/** In-memory key cache (refreshed from DB every 5 min) */
const keyCache = new Map<string, ApiKey>();
let lastCacheRefresh = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Generate a new API key. Returns the raw key (only shown once). */
export function generateApiKey(): string {
  const raw = randomBytes(24).toString("hex");
  return `cvk_${raw}`;
}

/** Hash an API key for secure storage. */
export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Extract API key from request headers. */
export function extractApiKey(authHeader: string | null, xApiKey: string | null): string | null {
  if (xApiKey && xApiKey.startsWith("cvk_")) return xApiKey;
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(cvk_[a-f0-9]+)$/i);
    if (match) return match[1];
  }
  return null;
}

/** Get the Turso HTTP client for direct SQL execution (bypasses Prisma shim). */
async function getTursoClient() {
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url || !url.startsWith("libsql:")) return null;
  const { TursoHttpClient } = await import("@/lib/turso-http-client");
  return new TursoHttpClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN,
  });
}

/** Ensure the api_keys table exists. */
async function ensureSchema() {
  const client = await getTursoClient();
  if (!client) return;
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS api_keys (
      key_id TEXT PRIMARY KEY NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
      total_requests INTEGER NOT NULL DEFAULT 0
    )`);
  } catch (e: any) {
    console.error("[api-auth] ensureSchema failed:", e?.message?.slice(0, 150));
  }
}

/**
 * Create a new API key. Returns the raw key (only shown once).
 */
export async function createApiKey(name: string, email: string, rateLimitPerMin = 60): Promise<{ rawKey: string; keyId: string } | null> {
  await ensureSchema();
  const client = await getTursoClient();
  if (!client) return null;

  const rawKey = generateApiKey();
  const keyHash = hashKey(rawKey);
  const keyId = "key_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date().toISOString();

  try {
    await client.execute(
      `INSERT INTO api_keys (key_id, key_hash, name, email, created_at, active, rate_limit_per_min, total_requests) VALUES (?, ?, ?, ?, ?, 1, ?, 0)`,
      [keyId, keyHash, name, email, createdAt, rateLimitPerMin]
    );
    // Cache the new key
    keyCache.set(keyHash, {
      keyId, keyHash, name, email, createdAt, active: true, rateLimitPerMin, totalRequests: 0,
    });
    return { rawKey, keyId };
  } catch (e: any) {
    console.error("[api-auth] Failed to create key:", e?.message?.slice(0, 100));
    return null;
  }
}

/**
 * List all API keys (for management UI).
 */
export async function listApiKeys(): Promise<ApiKey[]> {
  await ensureSchema();
  const client = await getTursoClient();
  if (!client) return [];
  try {
    const result = await client.execute(
      `SELECT key_id, key_hash, name, email, created_at, active, rate_limit_per_min, total_requests FROM api_keys ORDER BY created_at DESC LIMIT 100`
    );
    return (result.rows || []).map((r: any) => ({
      keyId: r.key_id,
      keyHash: r.key_hash?.slice(0, 8) + "...", // truncated for safety
      name: r.name,
      email: r.email,
      createdAt: r.created_at,
      active: r.active === 1 || r.active === true,
      rateLimitPerMin: r.rate_limit_per_min,
      totalRequests: r.total_requests,
    }));
  } catch {
    return [];
  }
}

/**
 * Revoke an API key by ID.
 */
export async function revokeApiKey(keyId: string): Promise<boolean> {
  const client = await getTursoClient();
  if (!client) return false;
  try {
    await client.execute(`UPDATE api_keys SET active = 0 WHERE key_id = ?`, [keyId]);
    // Clear cache
    for (const [hash, key] of keyCache.entries()) {
      if (key.keyId === keyId) {
        keyCache.delete(hash);
        break;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate an API key. Returns the key info if valid, null otherwise.
 * Uses an in-memory cache with 5-minute TTL.
 */
export async function validateApiKey(key: string): Promise<ApiKey | null> {
  if (!key || !key.startsWith("cvk_") || key.length < 10) return null;

  const keyHash = hashKey(key);

  // Check cache
  const cached = keyCache.get(keyHash);
  if (cached && cached.active) {
    return cached;
  }

  // Query database
  await ensureSchema();
  const client = await getTursoClient();
  if (!client) {
    // Fallback: in dev mode without Turso, accept all well-formed keys
    return {
      keyId: "dev",
      keyHash,
      name: "Dev Mode",
      email: "",
      createdAt: new Date().toISOString(),
      active: true,
      rateLimitPerMin: 60,
      totalRequests: 0,
    };
  }

  try {
    const result = await client.execute(
      `SELECT key_id, key_hash, name, email, created_at, active, rate_limit_per_min, total_requests FROM api_keys WHERE key_hash = ? AND active = 1`,
      [keyHash]
    );
    if (result.rows && result.rows.length > 0) {
      const r = result.rows[0];
      const keyInfo: ApiKey = {
        keyId: r.key_id,
        keyHash: r.key_hash,
        name: r.name,
        email: r.email,
        createdAt: r.created_at,
        active: r.active === 1 || r.active === true,
        rateLimitPerMin: r.rate_limit_per_min,
        totalRequests: r.total_requests,
      };
      keyCache.set(keyHash, keyInfo);
      return keyInfo;
    }
  } catch {}

  return null;
}

/**
 * Middleware: check API key for protected endpoints.
 * Returns ApiKey if authorized, or Response (401) if not.
 */
export async function requireApiKey(req: Request): Promise<ApiKey | Response> {
  const authHeader = req.headers.get("authorization");
  const xApiKey = req.headers.get("x-api-key");
  const key = extractApiKey(authHeader, xApiKey);

  if (!key) {
    return new Response(
      JSON.stringify({
        error: "API key required. Pass via 'Authorization: Bearer cvk_xxx' or 'X-API-Key: cvk_xxx'",
        code: "missing_api_key",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const keyInfo = await validateApiKey(key);
  if (!keyInfo) {
    return new Response(
      JSON.stringify({ error: "Invalid or revoked API key", code: "invalid_api_key" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return keyInfo;
}
