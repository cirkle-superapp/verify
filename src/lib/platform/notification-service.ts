/**
 * Unified Notification Service.
 *
 * Per architecture mandate:
 *   - Business layer says "sendNotification(...)" with policy info
 *   - Notification subsystem decides channel, priority, authorization, quota, cost, provider, retry
 *   - Email ≠ SMS: independent quotas, permissions, cost model, retry policy, billing state
 *
 * Architecture:
 *   NotificationService
 *       │
 *       ├── EmailChannel  → BrevoEmailAdapter  (free 300/day, P0-P4 governor)
 *       └── SMSChannel    → CustomerFundedSmsAdapter (per-customer billing)
 *
 * Email failure NEVER rolls back a business transaction.
 * SMS NEVER sends without explicit customer authorization + billing consent.
 */

import type { EmailPriority, EmailResult, SmsResult } from "./ports";
import { brevoAdapter } from "./brevo-adapter";
import { customerFundedSmsAdapter } from "./sms-adapter";
import { inngestAdapter } from "./inngest-adapter";
import { PlatformError } from "./ports";

export interface NotificationRequest {
  /** Who to notify. */
  recipient: {
    email?: string;
    phone?: string;          // E.164
    customerId?: string;
    userId?: string;
  };
  /** What to send. */
  message: {
    subject: string;
    bodyHtml?: string;
    bodyText?: string;
    templateId?: string;
    templateParams?: Record<string, string>;
  };
  /** Policy: which channels are allowed, and priority. */
  policy: {
    channels: ("email" | "sms")[];
    priority: EmailPriority;          // P0 security, P1 auth, P2 txn, P3 info, P4 nonessential
    smsPurpose?: string;              // required if channels includes "sms"
    smsEstimatedCost?: number;        // quoted to customer before authorization
    smsCurrency?: string;
    customerAuthorizedSms?: boolean;  // explicit opt-in for paid SMS
    consentReference?: string;
  };
  /** Tracing. */
  idempotencyKey: string;
  correlationId?: string;
  causationId?: string;
  tenantId?: string;
}

export interface NotificationResult {
  email?: EmailResult;
  sms?: SmsResult;
  /** Whether the notification was fully delivered to at least one channel. */
  delivered: boolean;
  /** Whether any channel deferred (quota) — business tx NOT affected. */
  deferred: boolean;
}

/**
 * Send a notification across the allowed channels.
 *
 * Email: synchronous call to Brevo (governor may defer).
 * SMS: only if customer explicitly authorized + billing consent.
 *      SMS send is ASYNCHRONOUS via Inngest (never blocks).
 *
 * Throws PlatformError ONLY for programming errors (not quota/payment).
 * Quota/payment boundaries return status="deferred"/"failed" in the result.
 */
export async function sendNotification(req: NotificationRequest): Promise<NotificationResult> {
  const result: NotificationResult = { delivered: false, deferred: false };

  // ── EMAIL CHANNEL ──────────────────────────────────────────────
  if (req.policy.channels.includes("email") && req.recipient.email) {
    try {
      const emailResult = await brevoAdapter.send({
        to: req.recipient.email,
        subject: req.message.subject,
        html: req.message.bodyHtml,
        text: req.message.bodyText,
        templateId: req.message.templateId,
        templateParams: req.message.templateParams,
        priority: req.policy.priority,
        idempotencyKey: `email:${req.idempotencyKey}`,
        correlationId: req.correlationId,
      });
      result.email = emailResult;
      if (emailResult.status === "sent") result.delivered = true;
      if (emailResult.status === "deferred") result.deferred = true;
    } catch (e: any) {
      // Email failure NEVER breaks business transaction — record + continue
      result.email = {
        messageId: null,
        status: "failed",
        reason: e?.message?.slice(0, 200),
      };
    }
  }

  // ── SMS CHANNEL (customer-funded, fail-closed) ────────────────
  if (req.policy.channels.includes("sms") && req.recipient.phone) {
    if (!req.policy.customerAuthorizedSms) {
      // FAIL CLOSED: no SMS without explicit authorization
      result.sms = {
        smsRequestId: req.idempotencyKey,
        status: "FAILED",
        failureType: "SMS_AUTHORIZATION_FAILED",
        reason: "SMS not sent: customer did not explicitly authorize paid SMS (customerAuthorizedSms=false).",
      };
    } else if (!req.policy.smsPurpose) {
      result.sms = {
        smsRequestId: req.idempotencyKey,
        status: "FAILED",
        failureType: "VALIDATION_ERROR",
        reason: "SMS purpose required when channel is enabled.",
      };
    } else {
      // Quote → authorize → enqueue via Inngest (async)
      try {
        const quote = await customerFundedSmsAdapter.quote({
          customerId: req.recipient.customerId || "unknown",
          userId: req.recipient.userId || "unknown",
          purpose: req.policy.smsPurpose,
          destination: req.recipient.phone,
          provider: process.env.SMS_PROVIDER || "none",
          estimatedCost: req.policy.smsEstimatedCost || 0,
          currency: req.policy.smsCurrency || "USD",
          message: req.message.bodyText || req.message.subject,
        });

        // Customer must have pre-authorized — in real flow this is a separate step
        const { authorized, authorizationReference } = await customerFundedSmsAdapter.authorize(
          req.idempotencyKey,
          req.recipient.customerId || "unknown",
        );

        if (!authorized) {
          result.sms = {
            smsRequestId: req.idempotencyKey,
            status: "FAILED",
            failureType: "SMS_AUTHORIZATION_FAILED",
            reason: "SMS authorization rejected (billing/credit unavailable).",
          };
        } else {
          // Enqueue async via Inngest — NEVER block on SMS delivery
          await inngestAdapter.enqueue({
            name: "sms/send.requested",
            data: {
              smsRequestId: req.idempotencyKey,
              customerId: req.recipient.customerId,
              userId: req.recipient.userId,
              destination: req.recipient.phone,
              purpose: req.policy.smsPurpose,
              estimatedCost: quote.estimatedCost,
              currency: quote.currency,
              authorizationReference,
              consentReference: req.policy.consentReference,
              message: req.message.bodyText || req.message.subject,
            },
            idempotencyKey: `sms:${req.idempotencyKey}`,
            correlationId: req.correlationId,
            causationId: req.causationId,
          });
          result.sms = {
            smsRequestId: req.idempotencyKey,
            status: "QUEUED",
            reason: "SMS queued for async delivery via Inngest (customer-funded).",
          };
        }
      } catch (e: any) {
        result.sms = {
          smsRequestId: req.idempotencyKey,
          status: "FAILED",
          failureType: e instanceof PlatformError ? e.type : "UNKNOWN_INFRASTRUCTURE_FAILURE",
          reason: e?.message?.slice(0, 200),
        };
      }
    }
  }

  return result;
}
