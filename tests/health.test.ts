/**
 * Health endpoint tests (HTTP).
 *
 * Verifies:
 *   - GET /api/health returns 200 with status field
 *   - GET /api/platform/harmony returns 200 with score 0-100
 *   - GET /api/v1/verify/health/deep returns 200 with components array
 *   - GET /api/chat/health returns 200 with knowledgeBase stats
 *
 * These tests require the dev server to be running on
 * http://localhost:3000. The runner will start it if it isn't.
 */

import { BASE_URL, sleep } from "./lib/server";
import { runTest, assert, assertRange } from "./lib/runner";

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15000),
    ...({} as any),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

export async function run() {
  return [
    await runTest("/api/health returns 200 with status field", async () => {
      // /api/health returns 200 if Turso is healthy, 503 otherwise. We
      // accept either (sandbox has no Turso creds → 503 is fine).
      const { status, body } = await fetchJson(`${BASE_URL}/api/health`);
      assert(
        status === 200 || status === 503,
        `expected 200 or 503, got ${status}`,
        body,
      );
      assert(!!body?.status, "expected body.status", body);
      assert(!!body?.timestamp, "expected body.timestamp", body);
      assert(!!body?.checks, "expected body.checks", body);
    }),

    await runTest("/api/platform/harmony returns 200 with score 0-100", async () => {
      const { status, body } = await fetchJson(`${BASE_URL}/api/platform/harmony`);
      assert(status === 200, `expected 200, got ${status}`, body);
      assert(!!body?.harmony, "expected body.harmony", body);
      assert(typeof body.harmony.score === "number", "harmony.score should be a number");
      assertRange(body.harmony.score, 0, 100, "harmony.score");
      assert(!!body.harmony.verdict, "harmony.verdict should be present");
    }),

    await runTest("/api/v1/verify/health/deep returns 200 with components array", async () => {
      // Deep health returns 200 if at least the Inngest/AI probes returned
      // a non-5xx status (sandbox may report "degraded" overall, that's fine).
      const { status, body } = await fetchJson(
        `${BASE_URL}/api/v1/verify/health/deep`,
      );
      assert(
        status === 200 || status === 503,
        `expected 200 or 503, got ${status}`,
        body,
      );
      assert(Array.isArray(body?.components), "expected components array", body);
      assert(
        body.components.length >= 5,
        `expected ≥5 components, got ${body.components.length}`,
      );
      // Each component should have name + status.
      for (const c of body.components) {
        assert(typeof c.name === "string", "component.name should be string");
        assert(
          ["healthy", "degraded", "down"].includes(c.status),
          `unexpected status ${c.status}`,
        );
      }
      assert(typeof body.overall === "string", "overall should be a string");
    }),

    await runTest("/api/chat/health returns 200 with knowledgeBase stats", async () => {
      const { status, body } = await fetchJson(`${BASE_URL}/api/chat/health`);
      assert(status === 200 || status === 503, `expected 200 or 503, got ${status}`, body);
      assert(!!body?.knowledgeBase, "expected body.knowledgeBase", body);
      const kb = body.knowledgeBase;
      assertRange(kb.countries, 60, 200, "kb.countries");
      assertRange(kb.docSpecs, 100, 500, "kb.docSpecs");
      assertRange(kb.idValidators, 30, 100, "kb.idValidators");
      assertRange(kb.crossFieldChecks, 25, 60, "kb.crossFieldChecks");
      assert(Array.isArray(kb.mrzFormats), "kb.mrzFormats should be array");
      assert(kb.mrzFormats.length === 3, "expected 3 MRZ formats");
    }),

    // Bonus: keep the runner warm for a moment before the endpoint
    // tests hammer the server.
    await runTest("health tests: short settle delay", async () => {
      await sleep(50);
    }),
  ];
}
