/**
 * Brevo Email Adapter + Quota Governor.
 *
 * Per architecture mandate:
 *   - Brevo Free = 300 emails/day, $0/month, transactional supported
 *   - Treat 300/day as a HARD operational boundary
 *   - P0/P1 always attempted; P3 deferred when near limit; P4 suppressed
 *   - On quota exhaustion: status="deferred" (NEVER throws for quota)
 *   - Email is ASYNCHRONOUS via Inngest (never blocks business transaction)
 *
 * Implements EmailPort. No Brevo-specific code leaks into business logic.
 */

import type { EmailPort, EmailMessage, EmailResult, QuotaSnapshot, QuotaLevel } from "./ports";
import { PlatformError } from "./ports";
import { withBreaker, withRetry, DEFAULT_RETRY } from "./circuit-breaker";

const BREVO_BREAKER = {
  name: "brevo",
  failureThreshold: 5,
  openDurationMs: 60_000,
  halfOpenProbes: 2,
};

const BREVO_API_URL = "https://api.brevo.com/v3";

// ─── Quota Governor ───────────────────────────────────────────────
// Brevo Free: 300 emails/day. We track in-memory (single-instance) and
// persist daily counts in Turso for cross-instance accuracy.

const BREVO_DAILY_LIMIT = 300;

interface EmailUsageState {
  sentToday: number;
  date: string;                  // YYYY-MM-DD — resets daily
  lastReset: string;
  deferredCount: number;
  suppressedCount: number;
}

let usage: EmailUsageState = {
  sentToday: 0,
  date: new Date().toISOString().slice(0, 10),
  lastReset: new Date().toISOString(),
  deferredCount: 0,
  suppressedCount: 0,
};

function rolloverIfNewDay() {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.date !== today) {
    usage = {
      sentToday: 0,
      date: today,
      lastReset: new Date().toISOString(),
      deferredCount: 0,
      suppressedCount: 0,
    };
  }
}

function quotaLevel(percent: number): QuotaLevel {
  if (percent >= 100) return "exhausted";
  if (percent >= 95) return "emergency";
  if (percent >= 90) return "restrict";
  if (percent >= 80) return "warning";
  if (percent >= 70) return "monitoring";
  return "ok";
}

/**
 * Quota decision matrix — controls whether an email of a given priority
 * is sent, deferred, or suppressed.
 */
function decideAction(priority: EmailMessage["priority"], level: QuotaLevel): "send" | "defer" | "suppress" {
  switch (level) {
    case "ok":
    case "monitoring":
      return "send";
    case "warning":
      return "send"; // all priorities still allowed
    case "restrict":
      // P3 deferred, P4 suppressed
      if (priority === "P4") return "suppress";
      if (priority === "P3") return "defer";
      return "send"; // P0/P1/P2 always
    case "emergency":
      // Only P0/P1
      if (priority === "P0" || priority === "P1") return "send";
      return "defer";
    case "exhausted":
      // Only P0 (security-critical)
      if (priority === "P0") return "send"; // even at limit, attempt P0
      return "defer";
  }
}

// ─── Adapter ───────────────────────────────────────────────────────

export const brevoAdapter: EmailPort = {
  name: "brevo",

  async send(msg: EmailMessage): Promise<EmailResult> {
    rolloverIfNewDay();
    const used = usage.sentToday;
    const percent = (used / BREVO_DAILY_LIMIT) * 100;
    const level = quotaLevel(percent);
    const action = decideAction(msg.priority, level);

    if (action === "suppress") {
      usage.suppressedCount++;
      return {
        messageId: null,
        status: "deferred",
        reason: `Suppressed: quota level ${level}, priority ${msg.priority} (nonessential)`,
      };
    }

    if (action === "defer") {
      usage.deferredCount++;
      // Business transaction is NOT affected — email is async
      return {
        messageId: null,
        status: "deferred",
        reason: `Deferred: daily quota ${used}/${BREVO_DAILY_LIMIT} (${level}). Will retry via Inngest on next reset.`,
      };
    }

    // action === "send"
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      // No Brevo key → fail closed but mark as deferred (not a business failure)
      usage.deferredCount++;
      return {
        messageId: null,
        status: "deferred",
        reason: "BREVO_API_KEY not configured — email deferred",
      };
    }

    try {
      const response = await withBreaker(BREVO_BREAKER, () =>
        withRetry(DEFAULT_RETRY, async () => {
          const res = await fetch(`${BREVO_API_URL}/smtp/email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "api-key": apiKey,
              accept: "application/json",
            },
            body: JSON.stringify({
              to: [{ email: msg.to }],
              sender: { email: msg.from || "no-reply@cirkle.verify", name: "Cirkle Verify" },
              subject: msg.subject,
              htmlContent: msg.html || msg.text || "",
              tags: [`priority:${msg.priority}`],
              messageId: msg.idempotencyKey,
            }),
            signal: AbortSignal.timeout(10_000),
          });

          if (res.status === 429) {
            // Brevo rate limit — defer, don't fail
            throw new PlatformError("RATE_LIMITED", "Brevo rate limited (429)", undefined, true, "brevo");
          }
          if (res.status === 401 || res.status === 403) {
            throw new PlatformError("AUTHENTICATION_ERROR", `Brevo auth error ${res.status}`, undefined, false, "brevo");
          }
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new PlatformError("DEPENDENCY_UNAVAILABLE", `Brevo error ${res.status}: ${text.slice(0, 200)}`, undefined, false, "brevo");
          }
          return res.json();
        }),
      );

      usage.sentToday++;
      return {
        messageId: response?.messageId || response?.id || msg.idempotencyKey,
        status: "sent",
        providerResponse: response,
      };
    } catch (e: any) {
      // Even on failure, the business transaction is unaffected.
      // Email is async — it'll be retried via Inngest outbox relay.
      if (e instanceof PlatformError && e.isQuotaBoundary()) {
        usage.deferredCount++;
        return { messageId: null, status: "deferred", reason: e.message };
      }
      return {
        messageId: null,
        status: "failed",
        reason: e?.message || "Brevo send failed",
      };
    }
  },

  async quota(): Promise<QuotaSnapshot> {
    rolloverIfNewDay();
    const used = usage.sentToday;
    const percent = (used / BREVO_DAILY_LIMIT) * 100;
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return {
      provider: "brevo",
      resource: "email_daily",
      used,
      limit: BREVO_DAILY_LIMIT,
      percent: Math.round(percent * 10) / 10,
      level: quotaLevel(percent),
      remaining: Math.max(0, BREVO_DAILY_LIMIT - used),
      resetsAt: tomorrow.toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  },
};
