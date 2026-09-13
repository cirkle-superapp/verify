import { NextRequest, NextResponse } from "next/server";
import { sendNotification, type NotificationRequest } from "@/lib/platform";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/platform/notification/send
 *
 * Unified notification endpoint. Business layer says "sendNotification(...)"
 * with policy info; the platform decides channel, priority, quota, cost, retry.
 *
 * Body: NotificationRequest
 *   { recipient: {email?, phone?, customerId?, userId?},
 *     message: {subject, bodyHtml?, bodyText?, templateId?},
 *     policy: {channels: ["email","sms"], priority: "P0".."P4",
 *              customerAuthorizedSms?: boolean, smsPurpose?, smsEstimatedCost?},
 *     idempotencyKey, correlationId? }
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 20, windowMs: 60_000, prefix: "notify" });
  if (limited) return limited;

  try {
    const body = (await req.json()) as NotificationRequest;
    if (!body.idempotencyKey) {
      return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });
    }
    if (!body.policy?.channels?.length) {
      return NextResponse.json({ error: "policy.channels required" }, { status: 400 });
    }

    const result = await sendNotification(body);
    return NextResponse.json({ result, idempotencyKey: body.idempotencyKey });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "notification failed" }, { status: 500 });
  }
}
