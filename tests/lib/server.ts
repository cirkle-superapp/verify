/**
 * Server lifecycle helpers for the HTTP-based test suite.
 *
 * The runner uses these to start the Next.js dev server as a child
 * process (if one isn't already listening on :3000), wait for it to
 * become ready, and shut it down at the end.
 */

import { spawn } from "node:child_process";

export const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

/** Probe whether the dev server is already up. */
export async function isServerUp(url: string = BASE_URL): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok || res.status === 503; // 503 = healthy but DB down
  } catch {
    return false;
  }
}

/** Wait for the server to respond — retries every 500ms up to maxMs. */
export async function waitForServer(maxMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await isServerUp()) return true;
    await sleep(500);
  }
  return false;
}

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Spawned subprocess handle — typed loosely since the Bun / Node
// `child_process` typings vary across versions.
let spawnedServer: any = null;

/**
 * Start the Next.js dev server as a child process. Idempotent — if a
 * server is already up on BASE_URL, returns immediately.
 *
 * Returns true if a server was spawned (and the caller is responsible
 * for stopping it via stopSpawnedServer), false if the server was
 * already up.
 */
export async function ensureServerRunning(): Promise<boolean> {
  if (await isServerUp()) {
    return false; // Already up — caller should NOT kill it.
  }

  console.log(`[runner] no server on ${BASE_URL}; spawning \`bunx next dev -p 3000\`…`);
  spawnedServer = spawn(
    "bunx",
    ["next", "dev", "-p", "3000"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Skip telemetry prompt to keep stdout clean.
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );

  spawnedServer.stdout?.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[next] ${line}`);
  });
  spawnedServer.stderr?.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[next] ${line}`);
  });

  const up = await waitForServer(60_000);
  if (!up) {
    throw new Error("Next.js dev server failed to become ready in 60s");
  }
  console.log("[runner] server is up.");
  return true;
}

/** Stop a previously-spawned dev server. Safe to call when none was spawned. */
export function stopSpawnedServer(): void {
  if (spawnedServer) {
    try {
      spawnedServer.kill("SIGTERM");
      setTimeout(() => {
        try {
          spawnedServer?.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }, 3000);
    } catch {
      /* ignore */
    }
    spawnedServer = null;
  }
}
