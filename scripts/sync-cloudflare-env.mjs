// Sync Cloudflare env vars to Vercel project cirkle-verify.
// Adds: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvLocal();

const TOKEN = process.env.VERCEL_ACCESS_TOKEN;
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || "cirkle-verify";
let PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const TARGETS = ["production", "preview", "development"];
const HEADERS = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const REQUIRED = [
  { key: "CLOUDFLARE_ACCOUNT_ID", value: process.env.CLOUDFLARE_ACCOUNT_ID },
  { key: "CLOUDFLARE_API_TOKEN", value: process.env.CLOUDFLARE_API_TOKEN },
  { key: "NEON_REST_API_URL", value: process.env.NEON_REST_API_URL },
];

async function listEnvs() {
  if (!PROJECT_ID) {
    const res = await fetch(`https://api.vercel.com/v9/projects`, { headers: HEADERS });
    if (!res.ok) throw new Error(`v9/projects: ${res.status}`);
    const data = await res.json();
    const proj = (data.projects || []).find((p) => p.name === PROJECT_NAME);
    if (!proj) throw new Error(`project not found`);
    PROJECT_ID = proj.id;
  }
  const res = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, { headers: HEADERS });
  const data = await res.json();
  return data.envs || [];
}

async function main() {
  console.log(`[INFO] Syncing ${REQUIRED.length} env vars (Cloudflare + Neon REST)…`);
  const existing = await listEnvs();
  let set = 0;
  for (const { key, value } of REQUIRED) {
    if (!value || value.includes("PLACEHOLDER")) { console.warn(`[SKIP] ${key}`); continue; }
    const ex = existing.find((e) => e.key === key);
    if (ex) { console.log(`[DELETE] ${key}`); await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${ex.id}`, { method: "DELETE", headers: HEADERS }); }
    console.log(`[CREATE] ${key}`);
    await fetch(`https://api.vercel.com/v10/projects/${PROJECT_ID}/env`, {
      method: "POST", headers: HEADERS,
      body: JSON.stringify({ key, value, type: "encrypted", target: TARGETS }),
    });
    set++;
  }
  console.log(`[DONE] Set: ${set}`);
}
main().catch((e) => { console.error("[FATAL]", e.message); process.exit(1); });
