// Sync required env vars to Vercel project cirkle-verify
// Uses Vercel REST API v9/v10/v13. Pure Node fetch, no CLI needed.
//
// Reads credentials from .env.local OR environment variables — never hardcodes secrets.
//
// Usage:
//   node scripts/sync-vercel-env.mjs
//
// Required env vars (set in .env.local or shell):
//   VERCEL_ACCESS_TOKEN  - Vercel API token
//   VERCEL_PROJECT_ID    - Vercel project ID (e.g. prj_xxx) — optional, will look up by name
//   VERCEL_PROJECT_NAME  - Vercel project name (default: "cirkle-verify")
//   TURSO_DATABASE_URL   - Turso libsql URL
//   TURSO_AUTH_TOKEN     - Turso JWT
//   NEON_DATABASE_URL    - Neon Postgres URL
//   INNGEST_SIGNING_KEY  - Inngest signing key
//   INNGEST_EVENT_KEY    - Inngest event key (defaults to signing key)
//   VERCEL_URL           - Production URL (e.g. https://cirkle-verify.vercel.app)

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ─── Load .env.local (gitignored, safe) ────────────────────────────
function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    console.warn(`[WARN] .env.local not found at ${envPath}`);
    return;
  }
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

const TOKEN = process.env.VERCEL_ACCESS_TOKEN;
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || "cirkle-verify";
let PROJECT_ID = process.env.VERCEL_PROJECT_ID;

if (!TOKEN) {
  console.error("[FATAL] VERCEL_ACCESS_TOKEN not set in .env.local or environment.");
  process.exit(1);
}

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const NEON_URL = process.env.NEON_DATABASE_URL;
const INNGEST_KEY = process.env.INNGEST_SIGNING_KEY;
const INNGEST_EVENT = process.env.INNGEST_EVENT_KEY || INNGEST_KEY;
const VERCEL_URL_VALUE = process.env.VERCEL_URL || `https://${PROJECT_NAME}.vercel.app`;

const TARGETS = ["production", "preview", "development"];

const REQUIRED = [
  { key: "DATABASE_URL", value: TURSO_URL },
  { key: "TURSO_DATABASE_URL", value: TURSO_URL },
  { key: "TURSO_AUTH_TOKEN", value: TURSO_TOKEN },
  { key: "NEON_DATABASE_URL", value: NEON_URL },
  { key: "INNGEST_SIGNING_KEY", value: INNGEST_KEY },
  { key: "INNGEST_EVENT_KEY", value: INNGEST_EVENT },
  { key: "INNGEST_DEV", value: "1" },
  { key: "VERCEL_URL", value: VERCEL_URL_VALUE },
  { key: "NEXT_PUBLIC_VERCEL_URL", value: VERCEL_URL_VALUE },
  { key: "SMS_PROVIDER", value: process.env.SMS_PROVIDER || "none" },
  { key: "ENABLE_TURSO", value: process.env.ENABLE_TURSO || "true" },
  { key: "ENABLE_NEON", value: process.env.ENABLE_NEON || "true" },
  { key: "ENABLE_INNGEST", value: process.env.ENABLE_INNGEST || "true" },
  { key: "CERTIFICATE_HMAC_SECRET", value: process.env.CERTIFICATE_HMAC_SECRET || "cirkle-verify-hmac-secret-v2-production" },
  { key: "AUDIT_HMAC_SECRET", value: process.env.AUDIT_HMAC_SECRET || "cirkle-verify-audit-hmac-v2-production" },
];

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function listEnvs() {
  if (!PROJECT_ID) {
    const res = await fetch(`https://api.vercel.com/v9/projects`, { headers: HEADERS });
    if (!res.ok) throw new Error(`v9/projects list: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const proj = (data.projects || []).find((p) => p.name === PROJECT_NAME);
    if (!proj) throw new Error(`Vercel project "${PROJECT_NAME}" not found. Available: ${(data.projects || []).map((p) => p.name).join(", ")}`);
    PROJECT_ID = proj.id;
    console.log(`[INFO] Resolved project "${PROJECT_NAME}" → ${PROJECT_ID}`);
  }

  const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, { headers: HEADERS });
  if (!res.ok) throw new Error(`v9/projects/{id}/env: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.envs || [];
}

async function deleteEnv(envId) {
  const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${envId}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  return res.ok;
}

async function createEnv(key, value) {
  const body = {
    key,
    value,
    type: "encrypted",
    target: TARGETS,
  };
  const res = await fetch(`https://api.vercel.com/v10/projects/${PROJECT_ID}/env`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`create ${key}: ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  console.log(`[INFO] Syncing ${REQUIRED.length} env vars to Vercel project "${PROJECT_NAME}" (ID: ${PROJECT_ID || "TBD"})…`);
  const existing = await listEnvs();
  console.log(`[INFO] Found ${existing.length} existing env vars.`);

  let set = 0;
  let skipped = 0;
  for (const { key, value } of REQUIRED) {
    if (!value || value.includes("PLACEHOLDER")) {
      console.warn(`[SKIP] ${key} has no value or contains PLACEHOLDER.`);
      skipped++;
      continue;
    }
    const existingVar = existing.find((e) => e.key === key);
    if (existingVar) {
      console.log(`[DELETE] ${key} (existing id=${existingVar.id})`);
      await deleteEnv(existingVar.id);
    }
    console.log(`[CREATE] ${key} → production, preview, development`);
    await createEnv(key, value);
    set++;
  }
  console.log(`[DONE] Set: ${set}, Skipped: ${skipped}`);
}

main().catch((e) => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
