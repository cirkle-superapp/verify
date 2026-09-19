/**
 * z-ai-web-dev-sdk config bootstrap.
 *
 * The z-ai-web-dev-sdk reads its config from a file at one of:
 *   - <cwd>/.z-ai-config
 *   - <home>/.z-ai-config
 *   - /etc/.z-ai-config
 *
 * On Vercel production, none of these locations have the config file
 * (it's gitignored and contains credentials). So we write the file
 * to disk at runtime from environment variables on first request.
 *
 * Required env vars (set on Vercel + in .env.local):
 *   ZAI_BASE_URL    - default: https://internal-api.z.ai/v1
 *   ZAI_API_KEY     - default: Z.ai (literal string for this SDK)
 *   ZAI_TOKEN       - JWT token from the platform
 *   ZAI_USER_ID     - user ID for the API
 *   ZAI_CHAT_ID     - chat ID (optional, set per-session if missing)
 *
 * On local dev, if /etc/.z-ai-config exists (sandbox-installed),
 * the SDK will read that directly and we don't need to write anything.
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(process.cwd(), ".z-ai-config");
const HOME_CONFIG_PATH = join(homedir(), ".z-ai-config");
const ETC_CONFIG_PATH = "/etc/.z-ai-config";

let bootstrapped = false;
let bootstrapError: string | null = null;

/**
 * Write the .z-ai-config file to <cwd>/.z-ai-config from env vars,
 * but ONLY if the file doesn't already exist there and we have the
 * required env vars (ZAI_TOKEN).
 *
 * Idempotent: only runs once per process (sets `bootstrapped` flag).
 */
export function ensureZaiConfig(): { ok: boolean; path?: string; error?: string } {
  if (bootstrapped) {
    return bootstrapError
      ? { ok: false, error: bootstrapError }
      : { ok: true, path: CONFIG_PATH };
  }
  bootstrapped = true;

  // If any of the standard paths already has a config, use it
  for (const p of [CONFIG_PATH, HOME_CONFIG_PATH, ETC_CONFIG_PATH]) {
    if (existsSync(p)) {
      return { ok: true, path: p };
    }
  }

  // No existing config — write one from env vars
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

  try {
    // Ensure cwd exists (it should, but be defensive)
    const cwd = process.cwd();
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config), { mode: 0o600 });
    return { ok: true, path: CONFIG_PATH };
  } catch (e: any) {
    bootstrapError = `Failed to write z-ai config: ${e?.message || String(e)}`;
    return { ok: false, error: bootstrapError };
  }
}
