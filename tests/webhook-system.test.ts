/**
 * Webhook System tests.
 *
 * Verifies the in-memory WebhookSystem class:
 *   - register an endpoint and list it
 *   - unregister an endpoint (and that subsequent triggers don't dispatch)
 *   - trigger an event and that matching endpoints receive the delivery
 *     (uses a mock fetch implementation that returns 200)
 *   - dead-letter queue captures events after 3 failed attempts
 *   - replaying a dead-letter event re-runs the delivery loop
 *
 * Plus an HTTP test that hits the /api/v1/verify/webhook-system route
 * and verifies OPTIONS responds 204 + POST action=register returns 200.
 */

import {
  WebhookSystem,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  computeSignature,
  formatSignatureHeader,
  verifySignature,
  getWebhookSystem,
  setWebhookSystemForTest,
} from "@/lib/webhook-system";
import { BASE_URL, sleep } from "./lib/server";
import { runTest, assert, assertEqual } from "./lib/runner";

const VALID_SECRET = "test-secret-0123456789abcdef";
const VALID_URL = "https://example.com/webhook-test";

/** Build a WebhookSystem with a mock fetch that returns 200 for all URLs. */
function makeSystemAlwaysOk(): WebhookSystem {
  const fetchImpl: any = async (_url: string, _init: any) => {
    return { status: 200, ok: true, text: async () => "", json: async () => ({}) };
  };
  return new WebhookSystem({ fetchImpl });
}

/** Build a WebhookSystem with a mock fetch that always returns 500. */
function makeSystemAlwaysFail(): WebhookSystem {
  const fetchImpl: any = async (_url: string, _init: any) => {
    return { status: 500, ok: false, text: async () => "", json: async () => ({}) };
  };
  return new WebhookSystem({ fetchImpl });
}

export async function run() {
  return [
    // ─── register + list + signature helpers ─────────────────────
    await runTest("webhook: register an endpoint and list it", () => {
      const sys = makeSystemAlwaysOk();
      try {
        const ep = sys.registerEndpoint(VALID_URL, ["verification.completed"], VALID_SECRET);
        assert(!!ep.id, "expected endpoint id");
        assertEqual(ep.url, VALID_URL, "endpoint url");
        assertEqual(ep.active, true, "endpoint active");
        assertEqual(ep.events.length, 1, "endpoint events count");
        const all = sys.listEndpoints();
        assertEqual(all.length, 1, "listEndpoints length");
        assertEqual(all[0].id, ep.id, "listEndpoints[0].id");
      } finally {
        sys.dispose();
      }
    }),

    await runTest("webhook: register rejects bad url / secret / events", () => {
      const sys = makeSystemAlwaysOk();
      let caught = 0;
      try {
        // Bad URL
        try { sys.registerEndpoint("not-a-url", ["verification.completed"], VALID_SECRET); }
        catch { caught++; }
        // Short secret
        try { sys.registerEndpoint(VALID_URL, ["verification.completed"], "short"); }
        catch { caught++; }
        // Empty events
        try { sys.registerEndpoint(VALID_URL, [], VALID_SECRET); }
        catch { caught++; }
        // Invalid event type
        try { sys.registerEndpoint(VALID_URL, ["bogus.event"], VALID_SECRET); }
        catch { caught++; }
      } finally {
        sys.dispose();
      }
      assertEqual(caught, 4, "expected 4 rejections");
    }),

    await runTest("webhook: unregister an endpoint", () => {
      const sys = makeSystemAlwaysOk();
      try {
        const ep = sys.registerEndpoint(VALID_URL, ["verification.completed"], VALID_SECRET);
        assertEqual(sys.listEndpoints().length, 1, "before unregister");
        const removed = sys.unregisterEndpoint(ep.id);
        assertEqual(removed, true, "unregister returns true for existing");
        assertEqual(sys.listEndpoints().length, 0, "after unregister");
        // Unregistering a missing id returns false.
        const removed2 = sys.unregisterEndpoint(ep.id);
        assertEqual(removed2, false, "unregister returns false for missing");
      } finally {
        sys.dispose();
      }
    }),

    await runTest("webhook: HMAC signature helpers round-trip", () => {
      const payload = { id: "abc", status: "completed", nationalId: "29001011234567" };
      const secret = VALID_SECRET;
      const hex = computeSignature(payload, secret);
      assert(/^[0-9a-f]{64}$/.test(hex), `expected 64-char hex, got ${hex.slice(0, 12)}…`);
      const header = formatSignatureHeader(hex);
      assert(header.startsWith("sha256="), `expected sha256= prefix, got ${header.slice(0, 12)}…`);
      assert(verifySignature(payload, secret, header), "verifySignature should accept the produced signature");
      // Tampered payload → signature mismatch
      assert(!verifySignature({ ...payload, status: "failed" }, secret, header), "verifySignature should reject tampered payload");
      // Wrong secret → mismatch
      assert(!verifySignature(payload, "wrong-secret-0123456789ab", header), "verifySignature should reject wrong secret");
    }),

    // ─── trigger + delivery ─────────────────────────────────────
    await runTest("webhook: trigger delivers to matching endpoints (fetch returns 200)", async () => {
      const sys = makeSystemAlwaysOk();
      try {
        sys.registerEndpoint(VALID_URL, ["verification.completed"], VALID_SECRET);
        // Different event type — should NOT receive verification.completed events.
        sys.registerEndpoint("https://example.com/other", ["liveness.passed"], VALID_SECRET);
        const events = await sys.triggerEvent("verification.completed", { id: "rec_1" });
        assertEqual(events.length, 1, "only one endpoint should match");
        const ev = events[0];
        // Give the background retry loop a tick to settle.
        await sleep(50);
        const stored = sys.getEvent(ev.id);
        assert(!!stored, "event should be stored");
        assertEqual(stored?.status, "delivered", `expected delivered, got ${stored?.status}`);
        assertEqual(stored?.attempts, 1, "should succeed on first attempt");
        assert(stored?.deliveredAt, "deliveredAt should be set");
      } finally {
        sys.dispose();
      }
    }),

    await runTest("webhook: dead-letter queue captures events after 3 failed attempts", async () => {
      // Use a system with always-failing fetch and zero-length retry delays
      // so we don't actually sleep 21 s in the test.
      const sys = new WebhookSystem({ fetchImpl: async () => ({ status: 500, ok: false, text: async () => "" }) as any });
      // Patch the retry delays to 0 ms so the test runs fast.
      const origDelays = [...WEBHOOK_RETRY_DELAYS_MS];
      (WEBHOOK_RETRY_DELAYS_MS as number[])[0] = 0;
      (WEBHOOK_RETRY_DELAYS_MS as number[])[1] = 0;
      (WEBHOOK_RETRY_DELAYS_MS as number[])[2] = 0;
      try {
        const ep = sys.registerEndpoint(VALID_URL, ["verification.failed"], VALID_SECRET);
        const events = await sys.triggerEvent("verification.failed", { reason: "test" });
        assertEqual(events.length, 1, "one event should be created");
        // Wait for the background loop to exhaust retries.
        await sleep(150);
        const stored = sys.getEvent(events[0].id);
        assert(!!stored, "event should be stored");
        assertEqual(stored?.status, "dead_letter", `expected dead_letter, got ${stored?.status}`);
        assertEqual(stored?.attempts, WEBHOOK_MAX_ATTEMPTS, "should have tried 3 times");
        assert(!!stored?.lastError, "lastError should be set");
        // Dead-letter queue
        const dlq = sys.getDeadLetterQueue();
        assertEqual(dlq.length, 1, "dead-letter queue should have 1 event");
        assertEqual(dlq[0].id, events[0].id, "dead-letter event id match");
        // The endpoint's failureCount should be incremented.
        const epAfter = sys.listEndpoints().find((e) => e.id === ep.id);
        assertEqual(epAfter?.failureCount, 1, "endpoint failureCount should be 1");
      } finally {
        sys.dispose();
        // Restore retry delays.
        for (let i = 0; i < WEBHOOK_RETRY_DELAYS_MS.length; i++) {
          (WEBHOOK_RETRY_DELAYS_MS as number[])[i] = origDelays[i];
        }
      }
    }),

    await runTest("webhook: replay a dead-letter event", async () => {
      // First, fail 3 times to move the event to dead_letter.
      const sys = makeSystemAlwaysFail();
      const origDelays = [...WEBHOOK_RETRY_DELAYS_MS];
      (WEBHOOK_RETRY_DELAYS_MS as number[])[0] = 0;
      (WEBHOOK_RETRY_DELAYS_MS as number[])[1] = 0;
      (WEBHOOK_RETRY_DELAYS_MS as number[])[2] = 0;
      try {
        sys.registerEndpoint(VALID_URL, ["certificate.issued"], VALID_SECRET);
        const events = await sys.triggerEvent("certificate.issued", { id: "cert_1" });
        await sleep(150);
        const ev = sys.getEvent(events[0].id);
        assertEqual(ev?.status, "dead_letter", "precondition: event should be dead-lettered");

        // Now replace the fetch impl with one that always succeeds and replay.
        (sys as any).fetchImpl = async () => ({ status: 200, ok: true, text: async () => "" }) as any;
        const replayed = await sys.replayWebhook(events[0].id);
        assertEqual(replayed, true, "replay should return true for a dead-letter event");
        await sleep(150);
        const evAfter = sys.getEvent(events[0].id);
        assertEqual(evAfter?.status, "delivered", `expected delivered after replay, got ${evAfter?.status}`);
        assertEqual(evAfter?.attempts, WEBHOOK_MAX_ATTEMPTS + 1, "should have tried one more time");

        // Replaying an already-delivered event should return false.
        const replayed2 = await sys.replayWebhook(events[0].id);
        assertEqual(replayed2, false, "replay should return false for a delivered event");
      } finally {
        sys.dispose();
        for (let i = 0; i < WEBHOOK_RETRY_DELAYS_MS.length; i++) {
          (WEBHOOK_RETRY_DELAYS_MS as number[])[i] = origDelays[i];
        }
      }
    }),

    await runTest("webhook: WEBHOOK_EVENT_TYPES lists the documented event set", () => {
      const expected = [
        "verification.completed",
        "verification.failed",
        "verification.reviewed",
        "document.extracted",
        "face.matched",
        "liveness.passed",
        "liveness.failed",
        "risk.assessed",
        "certificate.issued",
      ];
      assertEqual(WEBHOOK_EVENT_TYPES.length, expected.length, "event types count");
      for (const ev of expected) {
        assert(
          (WEBHOOK_EVENT_TYPES as readonly string[]).includes(ev),
          `expected ${ev} in WEBHOOK_EVENT_TYPES`,
        );
      }
    }),

    // ─── HTTP tests against the running dev server ─────────────
    await runTest("webhook: OPTIONS /api/v1/verify/webhook-system responds 204", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/verify/webhook-system`, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(10_000),
      });
      assertEqual(res.status, 204, `OPTIONS status`);
      const aco = res.headers.get("access-control-allow-origin");
      assert(!!aco, "expected Access-Control-Allow-Origin header");
    }),

    await runTest("webhook: GET /api/v1/verify/webhook-system returns the system info", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/verify/webhook-system`, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      const body = await res.json();
      assert(!!body.signingAlgorithm, "expected signingAlgorithm");
      assertEqual(body.signingAlgorithm, "HMAC-SHA256", "signingAlgorithm value");
      assert(!!body.headerName, "expected headerName");
      assertEqual(body.headerName, "X-Cirkle-Signature", "headerName value");
      assert(Array.isArray(body.eventTypes), "expected eventTypes array");
      assert(body.eventTypes.length >= 9, `expected ≥9 event types, got ${body.eventTypes.length}`);
      assert(!!body.retryPolicy, "expected retryPolicy");
      assertEqual(body.retryPolicy.maxAttempts, 3, "retryPolicy.maxAttempts");
    }),

    await runTest("webhook: POST action=register creates an endpoint", async () => {
      // Use the singleton — we can't easily isolate this per-test, but
      // the URL is unique per test run.
      const url = `https://example.com/test-${Date.now()}`;
      const res = await fetch(`${BASE_URL}/api/v1/verify/webhook-system`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          url,
          events: ["verification.completed"],
          secret: "register-test-secret-0123456789abcdef",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      const body = await res.json();
      assertEqual(body.ok, true, "body.ok");
      assertEqual(body.action, "register", "body.action");
      assert(!!body.endpoint?.id, "expected endpoint.id");
      assertEqual(body.endpoint.url, url, "endpoint.url");
      assertEqual(body.endpoint.events.length, 1, "endpoint.events.length");
    }),

    await runTest("webhook: POST action=trigger dispatches to registered endpoints", async () => {
      // Register an endpoint, then trigger. The endpoint URL is unreachable
      // from the sandbox (https://example.com), so the delivery will fail
      // — but the dispatch count should still be ≥ 1 if any endpoint is
      // registered for the event type. We test only that the dispatch
      // produces events array (len ≥ 0).
      const url = `https://example.com/trigger-test-${Date.now()}`;
      await fetch(`${BASE_URL}/api/v1/verify/webhook-system`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          url,
          events: ["risk.assessed"],
          secret: "trigger-test-secret-0123456789abcdef",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const res = await fetch(`${BASE_URL}/api/v1/verify/webhook-system`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "trigger",
          eventType: "risk.assessed",
          payload: { risk: "low", id: "abc" },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      assert(res.ok, `expected 200, got ${res.status}`);
      const body = await res.json();
      assertEqual(body.ok, true, "body.ok");
      assertEqual(body.action, "trigger", "body.action");
      assertEqual(body.eventType, "risk.assessed", "body.eventType");
      assert(body.dispatched >= 1, `expected dispatched ≥ 1, got ${body.dispatched}`);
    }),

    await runTest("webhook: POST action=register with bad body returns 400", async () => {
      const res = await fetch(`${BASE_URL}/api/v1/verify/webhook-system`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register" }), // missing url/events/secret
        signal: AbortSignal.timeout(10_000),
      });
      assertEqual(res.status, 400, `expected 400, got ${res.status}`);
    }),

    // Reset the singleton so future test runs see a clean state.
    await runTest("webhook: dispose singleton cleanly", () => {
      setWebhookSystemForTest(null);
      const sys = getWebhookSystem();
      assert(!!sys, "getWebhookSystem should return a fresh singleton after reset");
      sys.dispose();
    }),
  ];
}
