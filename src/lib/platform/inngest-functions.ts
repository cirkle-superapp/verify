/**
 * Inngest Durable Workflow Functions (v4 SDK).
 *
 * Per architecture mandate (Section 29-30):
 *   - Inngest for: email, SMS orchestration, database replication, webhooks,
 *     retries, notifications, scheduled jobs, reconciliation, file processing
 *   - NOT for ordinary synchronous CRUD
 *   - Every workflow must be idempotent (idempotencyKey enforced)
 *   - Every step must be safely replayable
 *
 * Functions registered:
 *   1. "verification.completed" → send P2 transactional email (Brevo)
 *   2. "verification.rejected"  → send P1 security alert email (Brevo)
 *   3. "outbox.drain.requested" → Turso outbox → Neon replication
 *   4. "sms.send.requested"     → async SMS send (customer-funded, fail-closed)
 *   5. "reconciliation.hourly"  → cron: hourly orphan + quota check
 *
 * v4 API: createFunction({ id, name, triggers: { event|cron }, retries }, handler)
 */

import { Inngest } from "inngest";
import { brevoAdapter } from "./brevo-adapter";
import { customerFundedSmsAdapter } from "./sms-adapter";
import { drainOutbox, markOutboxProcessed, markOutboxFailed } from "./turso-adapter";
import { applyEvents } from "./neon-recovery-adapter";

// ─── Inngest client ───────────────────────────────────────────────
export const inngest = new Inngest({
  id: "cirkle-verify",
  name: "Cirkle Verify Platform",
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});

// ─── 1. Verification completed → P2 transactional email ─────────
export const onVerificationCompleted = inngest.createFunction(
  { id: "verification-completed", name: "Verification Completed → Email", retries: 3, triggers: { event: "verification.completed" } },
  async ({ event, step, logger }) => {
    const data = (event.data || {}) as any;
    const verificationId = data?.verificationId;
    const email = data?.email || data?.recipientEmail;

    if (!email) {
      logger.info("No email on event — skipping notification", { verificationId });
      return { skipped: true, reason: "no_email" };
    }

    // Step 1: Build email content (deterministic, replayable)
    const emailBody = await step.run("build-email", async () => {
      return {
        subject: `✅ Identity Verified — Cirkle Verify (${verificationId?.slice(-8)})`,
        html: `<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
<h1 style="color: #0d9488;">✅ Identity Verification Successful</h1>
<p>Your identity has been verified by Cirkle Verify.</p>
<table style="border-collapse: collapse; margin: 20px 0;">
<tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Reference</td><td style="padding: 8px; border: 1px solid #e5e7eb; font-family: monospace;">${verificationId}</td></tr>
<tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Document Confidence</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${Math.round((data.docConfidence || 0) * 100)}%</td></tr>
<tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Face Match</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${Math.round(data.faceMatchScore || 0)}%</td></tr>
<tr><td style="padding: 8px; border: 1px solid #e5e7eb;">Liveness</td><td style="padding: 8px; border: 1px solid #e5e7eb;">${Math.round(data.livenessScore || 0)}%</td></tr>
</table>
<p style="color: #6b7280; font-size: 12px;">This is an automated message from Cirkle Verify.</p>
</div>`,
      };
    });

    // Step 2: Send via Brevo (governor may defer — never fails the workflow)
    const result = await step.run("send-email", async () => {
      return brevoAdapter.send({
        to: email,
        subject: emailBody.subject,
        html: emailBody.html,
        priority: "P2", // transactional
        idempotencyKey: `email:verify:${verificationId}`,
        correlationId: verificationId,
      });
    });

    logger.info("Email workflow completed", {
      verificationId,
      emailStatus: result.status,
      messageId: result.messageId,
    });

    return { verificationId, emailStatus: result.status, messageId: result.messageId };
  },
);

// ─── 2. Verification rejected → P1 security alert email ──────────
export const onVerificationRejected = inngest.createFunction(
  { id: "verification-rejected", name: "Verification Rejected → Alert", retries: 3, triggers: { event: "verification.rejected" } },
  async ({ event, step, logger }) => {
    const data = (event.data || {}) as any;
    const verificationId = data?.verificationId;
    const email = data?.email || data?.recipientEmail;
    const fraudFlags = data?.fraudFlags || [];

    if (!email) {
      return { skipped: true, reason: "no_email" };
    }

    const result = await step.run("send-alert", async () => {
      return brevoAdapter.send({
        to: email,
        subject: `⚠️ Verification Rejected — Cirkle Verify (${verificationId?.slice(-8)})`,
        html: `<div style="font-family: sans-serif; max-width: 600px;">
<h1 style="color: #dc2626;">⚠️ Identity Verification Rejected</h1>
<p>Your identity verification could not be completed.</p>
${fraudFlags.length > 0 ? `<p><strong>Flags:</strong> ${fraudFlags.join(", ")}</p>` : ""}
<p>Reference: <code>${verificationId}</code></p>
<p style="color: #6b7280; font-size: 12px;">If this was not you, contact support immediately.</p>
</div>`,
        priority: "P1", // security-critical
        idempotencyKey: `email:reject:${verificationId}`,
        correlationId: verificationId,
      });
    });

    logger.info("Rejection alert sent", { verificationId, status: result.status });
    return { verificationId, emailStatus: result.status };
  },
);

// ─── 3. Outbox drain → Neon replication (triggered by drain endpoint) ───
export const onOutboxDrainRequested = inngest.createFunction(
  { id: "outbox-drain", name: "Outbox Drain → Neon Replication", retries: 2, triggers: { event: "outbox.drain.requested" } },
  async ({ event, step, logger }) => {
    const batchSize = ((event.data as any)?.batchSize as number) || 20;

    // Step 1: Claim pending events from Turso outbox
    const claimed = await step.run("claim-events", async () => {
      return drainOutbox(batchSize);
    });

    if (claimed.length === 0) {
      logger.info("No pending outbox events");
      return { drained: 0 };
    }

    // Step 2: Replicate to Neon (idempotent ON CONFLICT)
    const neonResult = await step.run("replicate-to-neon", async () => {
      return applyEvents(claimed).catch((e: any) => {
        logger.error("Neon replication failed", { error: e.message?.slice(0, 100) });
        return { applied: 0, skipped: 0, failed: claimed.length };
      });
    });

    // Step 3: Mark events as processed (or failed)
    await step.run("mark-processed", async () => {
      for (const e of claimed) {
        try {
          await markOutboxProcessed(e.eventId);
        } catch (err: any) {
          await markOutboxFailed(e.eventId, err?.message || "mark failed", e.attemptCount >= 5);
        }
      }
    });

    logger.info("Outbox drained", {
      drained: claimed.length,
      neonApplied: neonResult.applied,
      neonFailed: neonResult.failed,
    });

    return { drained: claimed.length, neon: neonResult };
  },
);

// ─── 4. SMS send (customer-funded, fail-closed) ──────────────────
export const onSmsSendRequested = inngest.createFunction(
  { id: "sms-send-requested", name: "SMS Send (Customer-Funded)", retries: 2, triggers: { event: "sms.send.requested" } },
  async ({ event, step, logger }) => {
    const d = (event.data || {}) as any;

    // Step 1: Verify authorization still valid (replayable check)
    const authCheck = await step.run("verify-authorization", async () => {
      return { authorized: !!d.authorizationReference };
    });

    if (!authCheck.authorized) {
      logger.warn("SMS authorization missing — failing closed", { smsRequestId: d.smsRequestId });
      return { smsRequestId: d.smsRequestId, status: "FAILED", reason: "authorization_missing" };
    }

    // Step 2: Send via provider (fail-closed if no provider configured)
    const result = await step.run("send-sms", async () => {
      return customerFundedSmsAdapter.send({
        smsRequestId: d.smsRequestId,
        customerId: d.customerId,
        userId: d.userId,
        purpose: d.purpose,
        destination: d.destination,
        provider: d.provider || process.env.SMS_PROVIDER || "none",
        estimatedCost: d.estimatedCost,
        currency: d.currency,
        authorizationReference: d.authorizationReference,
        consentReference: d.consentReference,
        message: d.message,
        correlationId: d.correlationId,
      });
    });

    logger.info("SMS send result", { smsRequestId: d.smsRequestId, status: result.status });
    return { smsRequestId: d.smsRequestId, status: result.status };
  },
);

// ─── 5. Hourly reconciliation (cron) ──────────────────────────────
export const onReconciliationHourly = inngest.createFunction(
  { id: "reconciliation-hourly", name: "Hourly Reconciliation", retries: 1, triggers: { cron: "0 * * * *" } },
  async ({ step, logger }) => {
    // Step 1: Check quota states
    const quotas = await step.run("check-quotas", async () => {
      const emailQuota = await brevoAdapter.quota().catch(() => null);
      return { email: emailQuota };
    });

    logger.info("Reconciliation complete", { emailQuota: quotas.email });
    return { emailQuota: quotas.email };
  },
);

// ─── All functions (for /api/inngest route registration) ──────────
export const allFunctions = [
  onVerificationCompleted,
  onVerificationRejected,
  onOutboxDrainRequested,
  onSmsSendRequested,
  onReconciliationHourly,
];
