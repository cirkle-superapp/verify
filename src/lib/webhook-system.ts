/**
 * Webhook System — event-driven delivery with retries + dead-letter queue.
 *
 * Task ID 20-a (real-ocr-webhooks).
 *
 * The existing `/api/v1/verify/webhook` route only stores registrations and
 * relies on Inngest for delivery. Inngest is "cloud mode, no signing key
 * found" in this sandbox (see dev.log), so webhooks don't actually get
 * delivered. This module is a self-contained, in-memory, retry-aware
 * delivery engine that works with zero external dependencies:
 *
 *   1. Register an endpoint with a secret + list of subscribed event types.
 *   2. Trigger an event — the system walks all matching endpoints and
 *      schedules a delivery for each (HMAC-SHA256 signed).
 *   3. Deliver each event with exponential-backoff retries: 1 s, 4 s,
 *      16 s. After 3 failed attempts the event moves to the dead-letter
 *      queue (status = "dead_letter").
 *   4. A dead-letter event can be manually replayed via `replayWebhook`.
 *
 * The system is intentionally in-memory (no DB): a single server process
 * maintains the endpoints + pending/delivered/failed events. This is
 * sufficient for the sandbox / single-instance deploy; in a multi-region
 * production deploy, persist the `WebhookEndpoint` rows to Turso and
 * run the delivery loop in an Inngest step function.
 *
 * HMAC signature: HMAC-SHA256(payload, endpoint.secret) sent as the
 * `X-Cirkle-Signature: sha256=<hex>` header. The receiver recomputes
 * the HMAC and compares (constant-time) to verify the sender.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";

// ─── Public types ─────────────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
  failureCount: number;
}

export type WebhookEventStatus = "pending" | "delivered" | "failed" | "dead_letter";

export interface WebhookEvent {
  id: string;
  endpointId: string;
  eventType: string;
  payload: unknown;
  timestamp: string;
  status: WebhookEventStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
  deliveredAt?: string;
}

export const WEBHOOK_EVENT_TYPES = [
  "verification.completed",
  "verification.failed",
  "verification.reviewed",
  "document.extracted",
  "face.matched",
  "liveness.passed",
  "liveness.failed",
  "risk.assessed",
  "certificate.issued",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export const WEBHOOK_RETRY_DELAYS_MS = [1_000, 4_000, 16_000];
export const WEBHOOK_MAX_ATTEMPTS = 3;

// ─── HMAC helpers ──────────────────────────────────────────────────

/**
 * Compute the HMAC-SHA256 hex signature for a JSON payload + secret.
 * Used both to sign outgoing deliveries AND to verify incoming replay.
 */
export function computeSignature(payload: unknown, secret: string): string {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Format the signature header value the way receivers expect it. */
export function formatSignatureHeader(hex: string): string {
  return `sha256=${hex}`;
}

/**
 * Verify an incoming signature against a secret. Constant-time compare.
 */
export function verifySignature(payload: unknown, secret: string, headerVal: string): boolean {
  if (!headerVal || !secret) return false;
  const expected = formatSignatureHeader(computeSignature(payload, secret));
  const a = Buffer.from(expected);
  const b = Buffer.from(headerVal);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── WebhookSystem class ───────────────────────────────────────────

/**
 * In-memory webhook system. Holds registered endpoints, the in-flight
 * event queue, and the dead-letter queue.
 *
 * Methods:
 *   registerEndpoint(url, events, secret) → WebhookEndpoint
 *   unregisterEndpoint(id) → boolean
 *   listEndpoints() → WebhookEndpoint[]
 *   triggerEvent(eventType, payload) → Promise<WebhookEvent[]>
 *   deliverWebhook(event) → Promise<boolean>   (with retries)
 *   getDeadLetterQueue() → WebhookEvent[]
 *   replayWebhook(eventId) → Promise<boolean>
 *
 * The retry loop uses `setTimeout` so callers don't have to await the
 * full 21 s backoff — the initial `triggerEvent` returns after the
 * first attempt; subsequent attempts run on background timers.
 */
export class WebhookSystem {
  private endpoints = new Map<string, WebhookEndpoint>();
  private events = new Map<string, WebhookEvent>();
  private timers = new Map<string, NodeJS.Timeout[]>();
  private fetchImpl: typeof fetch;

  constructor(opts?: { fetchImpl?: typeof fetch }) {
    this.fetchImpl = opts?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined as any);
  }

  /**
   * Register a new webhook endpoint. The secret is stored in plain text
   * (in a real deploy it would be hashed — kept plain here so we can
   * sign outgoing deliveries without an extra key-management step).
   */
  registerEndpoint(url: string, events: string[], secret: string): WebhookEndpoint {
    this.validateUrl(url);
    this.validateSecret(secret);
    this.validateEvents(events);

    const endpoint: WebhookEndpoint = {
      id: `wh_${randomUUID().slice(0, 12)}`,
      url,
      events: [...events],
      secret,
      active: true,
      createdAt: new Date().toISOString(),
      failureCount: 0,
    };
    this.endpoints.set(endpoint.id, endpoint);
    return endpoint;
  }

  /**
   * Unregister an endpoint. Cancels any pending retry timers.
   */
  unregisterEndpoint(id: string): boolean {
    const removed = this.endpoints.delete(id);
    if (removed) {
      this.cancelTimers(id);
      // Mark pending events for this endpoint as failed.
      for (const ev of this.events.values()) {
        if (ev.endpointId === id && ev.status === "pending") {
          ev.status = "failed";
          ev.lastError = "Endpoint unregistered";
        }
      }
    }
    return removed;
  }

  /** List all registered endpoints. */
  listEndpoints(): WebhookEndpoint[] {
    return Array.from(this.endpoints.values());
  }

  /**
   * Trigger an event — find all active endpoints subscribed to this
   * event type, create one WebhookEvent per endpoint, and start the
   * delivery loop. Returns the created events (caller can poll them
   * via `getEvent` if needed).
   */
  async triggerEvent(eventType: string, payload: unknown): Promise<WebhookEvent[]> {
    this.validateEventType(eventType);
    const matching = this.listEndpoints().filter(
      (e) => e.active && e.events.includes(eventType),
    );
    const created: WebhookEvent[] = [];
    for (const ep of matching) {
      const event: WebhookEvent = {
        id: `evt_${randomUUID().slice(0, 12)}`,
        endpointId: ep.id,
        eventType,
        payload,
        timestamp: new Date().toISOString(),
        status: "pending",
        attempts: 0,
      };
      this.events.set(event.id, event);
      // Update lastTriggeredAt on the endpoint.
      ep.lastTriggeredAt = new Date().toISOString();
      created.push(event);

      // Fire-and-forget the delivery loop.
      void this.deliverWithRetries(event.id).catch(() => {
        // already handled inside deliverWithRetries
      });
    }
    return created;
  }

  /**
   * Deliver a single webhook with retries. Returns true if delivered,
   * false if it failed all attempts (and was moved to dead_letter).
   */
  async deliverWebhook(event: WebhookEvent): Promise<boolean> {
    const ep = this.endpoints.get(event.endpointId);
    if (!ep) {
      event.status = "failed";
      event.lastError = "Endpoint not found";
      this.events.set(event.id, event);
      return false;
    }
    return this.attemptDelivery(event, ep, 0);
  }

  /**
   * Recursive delivery loop with exponential backoff.
   * Attempts: 0 (immediate), 1 (after 1 s), 2 (after 4 s), 3 (after 16 s).
   * After WEBHOOK_MAX_ATTEMPTS failures, status → dead_letter.
   *
   * `event.attempts` is CUMULATIVE — each retry (and each replay) adds to
   * the existing count. So a fresh event that fails 3 times has attempts=3;
   * a replay of that event that succeeds on the first try has attempts=4.
   */
  private async deliverWithRetries(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (!event) return;
    const ep = this.endpoints.get(event.endpointId);
    if (!ep) {
      event.status = "failed";
      event.lastError = "Endpoint not found";
      this.events.set(eventId, event);
      return;
    }

    // Baseline = the existing attempts count (0 for fresh events, 3 for
    // dead-letter replays). Each retry adds to the baseline so attempts
    // is monotonically increasing across the event's lifetime.
    const baseline = event.attempts || 0;
    let attempt = 0;
    while (attempt < WEBHOOK_MAX_ATTEMPTS) {
      event.attempts = baseline + attempt + 1;
      event.lastAttemptAt = new Date().toISOString();
      const ok = await this.doFetch(event, ep);
      if (ok) {
        event.status = "delivered";
        event.deliveredAt = new Date().toISOString();
        event.lastError = undefined;
        // Reset the endpoint's failure counter on success.
        ep.failureCount = 0;
        this.events.set(eventId, event);
        return;
      }
      // Failed — schedule the next attempt after the backoff delay.
      const delay = WEBHOOK_RETRY_DELAYS_MS[attempt] ?? WEBHOOK_RETRY_DELAYS_MS[WEBHOOK_RETRY_DELAYS_MS.length - 1];
      attempt++;
      if (attempt >= WEBHOOK_MAX_ATTEMPTS) break;

      // For testability: if no fetch implementation, just count down
      // attempts without sleeping (tests pass a mock fetch).
      if (!this.fetchImpl) {
        event.lastError = "No fetch implementation configured";
        this.events.set(eventId, event);
        continue;
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), delay);
        // Allow tests to cancel pending retries when unregistering.
        const list = this.timers.get(eventId) ?? [];
        list.push(t as unknown as NodeJS.Timeout);
        this.timers.set(eventId, list);
      });
      // Remove the timer reference post-fire.
      const list = this.timers.get(eventId);
      if (list && list.length > 0) {
        list.shift();
        if (list.length === 0) this.timers.delete(eventId);
      }
    }

    // All retries exhausted → dead-letter.
    event.status = "dead_letter";
    ep.failureCount += 1;
    this.events.set(eventId, event);
  }

  /**
   * Single attempt — perform the actual HTTP POST with HMAC signature.
   * Returns true on HTTP 2xx, false otherwise.
   */
  private async attemptDelivery(
    event: WebhookEvent,
    ep: WebhookEndpoint,
    attemptIdx: number,
  ): Promise<boolean> {
    event.attempts = attemptIdx + 1;
    event.lastAttemptAt = new Date().toISOString();
    const ok = await this.doFetch(event, ep);
    this.events.set(event.id, event);
    return ok;
  }

  private async doFetch(event: WebhookEvent, ep: WebhookEndpoint): Promise<boolean> {
    if (!this.fetchImpl) {
      event.lastError = "No fetch implementation configured";
      return false;
    }
    const body = JSON.stringify(event.payload ?? {});
    const sig = computeSignature(event.payload, ep.secret);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await this.fetchImpl(ep.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Cirkle-Signature": formatSignatureHeader(sig),
            "X-Cirkle-Event": event.eventType,
            "X-Cirkle-Event-Id": event.id,
            "User-Agent": "cirkle-webhook/1.0",
          },
          body,
          signal: controller.signal,
        });
        if (res.status >= 200 && res.status < 300) {
          return true;
        }
        event.lastError = `HTTP ${res.status}`;
        return false;
      } finally {
        clearTimeout(timeout);
      }
    } catch (e: any) {
      event.lastError = e?.message?.slice(0, 200) || "fetch failed";
      return false;
    }
  }

  /**
   * List all events in the dead-letter queue.
   */
  getDeadLetterQueue(): WebhookEvent[] {
    return Array.from(this.events.values()).filter((e) => e.status === "dead_letter");
  }

  /** Get any event by id (for tests / inspection). */
  getEvent(id: string): WebhookEvent | undefined {
    return this.events.get(id);
  }

  /** List all events. */
  listEvents(): WebhookEvent[] {
    return Array.from(this.events.values());
  }

  /**
   * Replay a dead-letter event. Resets status to pending and re-runs the
   * delivery loop. The attempts counter is preserved (so the next attempt
   * is attempts+1, attempts+2, etc., giving a cumulative count across the
   * event's lifetime). Returns true if the event was found and replay was
   * started, false otherwise.
   */
  async replayWebhook(eventId: string): Promise<boolean> {
    const event = this.events.get(eventId);
    if (!event) return false;
    if (event.status !== "dead_letter") return false;

    // Reset status for replay — but PRESERVE attempts (cumulative).
    event.status = "pending";
    event.lastError = undefined;
    event.lastAttemptAt = undefined;
    event.deliveredAt = undefined;
    this.events.set(eventId, event);

    void this.deliverWithRetries(eventId).catch(() => { /* handled */ });
    return true;
  }

  // ─── Internal validators ───────────────────────────────────────

  private validateUrl(url: string): void {
    if (!url || typeof url !== "string") {
      throw new Error("url (string) required");
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      throw new Error("url must start with http:// or https://");
    }
    try { new URL(url); } catch { throw new Error("url is not a valid URL"); }
  }

  private validateSecret(secret: string): void {
    if (!secret || typeof secret !== "string") {
      throw new Error("secret (string) required");
    }
    if (secret.length < 16) {
      throw new Error("secret must be at least 16 characters for HMAC security");
    }
  }

  private validateEvents(events: string[]): void {
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error("events (non-empty array) required");
    }
    const invalid = events.filter((e) => !WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType));
    if (invalid.length > 0) {
      throw new Error(
        `Invalid event types: ${invalid.join(", ")}. Valid: ${WEBHOOK_EVENT_TYPES.join(", ")}`,
      );
    }
  }

  private validateEventType(eventType: string): void {
    if (!WEBHOOK_EVENT_TYPES.includes(eventType as WebhookEventType)) {
      throw new Error(
        `Invalid event type: ${eventType}. Valid: ${WEBHOOK_EVENT_TYPES.join(", ")}`,
      );
    }
  }

  private cancelTimers(endpointId: string): void {
    // Cancel any pending timers for events of this endpoint.
    for (const [eventId, list] of this.timers.entries()) {
      const ev = this.events.get(eventId);
      if (ev && ev.endpointId === endpointId) {
        for (const t of list) clearTimeout(t as unknown as NodeJS.Timeout);
        this.timers.delete(eventId);
      }
    }
  }

  /**
   * Tear down — clear all timers (useful for test cleanup).
   */
  dispose(): void {
    for (const list of this.timers.values()) {
      for (const t of list) clearTimeout(t as unknown as NodeJS.Timeout);
    }
    this.timers.clear();
    this.endpoints.clear();
    this.events.clear();
  }
}

// ─── Module-level singleton (the API route uses this) ─────────────

let _globalSystem: WebhookSystem | null = null;

/**
 * Get the shared WebhookSystem singleton. Created lazily so the module
 * import is side-effect-free.
 */
export function getWebhookSystem(): WebhookSystem {
  if (!_globalSystem) {
    _globalSystem = new WebhookSystem();
  }
  return _globalSystem;
}

/** Replace the singleton (for tests). */
export function setWebhookSystemForTest(system: WebhookSystem | null): void {
  if (_globalSystem) _globalSystem.dispose();
  _globalSystem = system;
}
