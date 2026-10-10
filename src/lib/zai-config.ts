/**
 * z-ai-web-dev-sdk config bootstrap.
 *
 * The z-ai-web-dev-sdk reads its config from a file at one of:
 *   - <cwd>/.z-ai-config
 *   - <home>/.z-ai-config
 *   - /etc/.z-ai-config
 *
 * On Vercel production:
 *   - <cwd> = /var/task/ is READ-ONLY
 *   - <home> might be read-only too
 *   - /etc/.z-ai-config — not present
 *
 * Fix: write the config to a writable location (os.tmpdir() which is /tmp
 * on Linux/macOS) and set process.env.HOME so the SDK finds it via os.homedir().
 *
 * Required env vars (set on Vercel + in .env.local):
 *   ZAI_BASE_URL    - default: https://internal-api.z.ai/v1
 *   ZAI_API_KEY     - default: Z.ai (literal string for this SDK)
 *   ZAI_TOKEN       - JWT token from the platform
 *   ZAI_USER_ID     - user ID for the API
 *   ZAI_CHAT_ID     - chat ID (optional)
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";

// Standard config search paths used by z-ai-web-dev-sdk
const PREFERRED_CONFIG_PATHS = [
  join(process.cwd(), ".z-ai-config"),
  join(homedir(), ".z-ai-config"),
  "/etc/.z-ai-config",
];

// Writable fallback locations (in priority order)
const WRITABLE_PATHS = [
  join(tmpdir(), ".z-ai-config"),  // /tmp/.z-ai-config on Linux/macOS
  "/tmp/.z-ai-config",             // explicit /tmp fallback
  join(homedir(), ".z-ai-config"), // sometimes writable
];

let bootstrapped = false;
let bootstrapError: string | null = null;
let bootstrapPath: string | null = null;

/**
 * Write the .z-ai-config file from env vars, in a writable location.
 * Sets process.env.HOME so the SDK can find the config via os.homedir().
 *
 * Idempotent: only runs once per process.
 */
export function ensureZaiConfig(): { ok: boolean; path?: string; error?: string } {
  if (bootstrapped) {
    return bootstrapError
      ? { ok: false, error: bootstrapError }
      : { ok: true, path: bootstrapPath || undefined };
  }
  bootstrapped = true;

  // 1. If any of the standard paths already has a config, use it
  for (const p of PREFERRED_CONFIG_PATHS) {
    if (existsSync(p)) {
      bootstrapPath = p;
      return { ok: true, path: p };
    }
  }

  // 2. No existing config — write one from env vars to a writable location
  const token = process.env.ZAI_TOKEN;
  if (!token || token === "PLACEHOLDER_FILL_FROM_USER") {
    bootstrapError = "ZAI_TOKEN env var not set — cannot bootstrap z-ai config";
    return { ok: false, error: bootstrapError };
  }

  const config = {
    baseUrl: process.env.ZAI_BASE_URL || "https://internal-api.z.ai/v1",
    apiKey: process.env.ZAI_API_KEY || "Z.ai",
    token,
    userId: process.env.ZAI_USER_ID || "cirkle-verify-bot",
    chatId: process.env.ZAI_CHAT_ID || "cirkle-verify-bot-session",
  };

  let writtenPath: string | null = null;
  let lastError: string | null = null;

  for (const tryPath of WRITABLE_PATHS) {
    try {
      const dir = dirname(tryPath);
      try {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      } catch {
        // dir might be unwritable — let writeFileSync fail naturally below
      }
      writeFileSync(tryPath, JSON.stringify(config), { mode: 0o600 });
      writtenPath = tryPath;
      break;
    } catch (e: any) {
      lastError = `${tryPath}: ${e?.message || String(e)}`;
    }
  }

  if (!writtenPath) {
    bootstrapError = `Could not write z-ai config to any writable path. Last error: ${lastError}`;
    return { ok: false, error: bootstrapError };
  }

  // 3. If we wrote to /tmp or os.tmpdir(), set HOME so the SDK finds it
  // The SDK's loadConfig() reads from path.join(homedir(), '.z-ai-config')
  // — homedir() reads process.env.HOME on Linux/macOS.
  const writtenDir = dirname(writtenPath);
  if (writtenDir !== process.env.HOME) {
    process.env.HOME = writtenDir;
  }

  bootstrapPath = writtenPath;
  return { ok: true, path: writtenPath };
}
