// Sync Z-AI chatbot credentials to Vercel project cirkle-verify.
// Adds: ZAI_BASE_URL, ZAI_API_KEY, ZAI_TOKEN, ZAI_USER_ID, ZAI_CHAT_ID
//
// Usage: node scripts/sync-zai-env.mjs

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

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

const TARGETS = ["production", "preview", "development"];
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const REQUIRED = [
  { key: "ZAI_BASE_URL", value: process.env.ZAI_BASE_URL || "https://internal-api.z.ai/v1" },
  { key: "ZAI_API_KEY", value: process.env.ZAI_API_KEY || "Z.ai" },
  { key: "ZAI_TOKEN", value: process.env.ZAI_TOKEN },
  { key: "ZAI_USER_ID", value: process.env.ZAI_USER_ID },
  { key: "ZAI_CHAT_ID", value: process.env.ZAI_CHAT_ID },
];

async function listEnvs() {
  if (!PROJECT_ID) {
    const res = await fetch(`https://api.vercel.com/v9/projects`, { headers: HEADERS });
    if (!res.ok) throw new Error(`v9/projects list: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const proj = (data.projects || []).find((p) => p.name === PROJECT_NAME);
    if (!proj) throw new Error(`Vercel project "${PROJECT_NAME}" not found.`);
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
  const body = { key, value, type: "encrypted", target: TARGETS };
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
  console.log(`[INFO] Syncing ${REQUIRED.length} Z-AI env vars to Vercel project "${PROJECT_NAME}"…`);
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
