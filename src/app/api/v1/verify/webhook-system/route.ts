import { NextRequest, NextResponse } from "next/server";
import {
  getWebhookSystem,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_DELAYS_MS,
  type WebhookEvent,
  type WebhookEndpoint,
} from "@/lib/webhook-system";
import { getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — webhook-system endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/webhook-system
 *
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/webhook-system
 *
 * Describes the webhook system: event types, retry policy, signature
 * algorithm, and the list of currently registered endpoints.
 */
export async function GET() {
  const sys = getWebhookSystem();
  return NextResponse.json(
    {
      description: "Event-driven webhook system with HMAC-SHA256 signed deliveries + retries + dead-letter queue",
      signingAlgorithm: "HMAC-SHA256",
      headerName: "X-Cirkle-Signature",
      headerFormat: "sha256=<hex>",
      retryPolicy: {
        maxAttempts: WEBHOOK_MAX_ATTEMPTS,
        backoff: "exponential",
        delaysMs: WEBHOOK_RETRY_DELAYS_MS,
      },
      eventTypes: WEBHOOK_EVENT_TYPES,
      endpoints: sys.listEndpoints(),
      deadLetterQueue: sys.getDeadLetterQueue(),
      commands: [
        "POST /register   { url, events, secret } — register a webhook endpoint",
        "POST /unregister { id } — unregister an endpoint",
        "GET  /endpoints  — list all registered endpoints",
        "POST /trigger    { eventType, payload } — trigger an event to all matching endpoints",
        "GET  /dead-letter — list dead-letter events",
        "POST /replay      { eventId } — replay a dead-letter event",
      ],
    },
    { headers: CORS_HEADERS },
  );
}

/**
 * POST /api/v1/verify/webhook-system
 *
 * Dispatches on the `action` field in the JSON body. Supported actions:
 *
 *   action: "register"     body: { url, events, secret }
 *   action: "unregister"   body: { id }
 *   action: "trigger"      body: { eventType, payload }
 *   action: "replay"       body: { eventId }
 *
 * Convenience: if `action` is omitted, the route infers it from the body
 * fields (url → register, id+!eventType → unregister, eventType → trigger,
 * eventId → replay).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // Allow action via query param (?action=register) for callers that can't
    // set a body, otherwise read from body.action, otherwise infer from fields.
    const action: string =
      (req.nextUrl?.searchParams.get("action") as string) ||
      (body.action as string) ||
      inferAction(body);

    switch (action) {
      case "register":
        return await handleRegister(req, body);
      case "unregister":
        return await handleUnregister(req, body);
      case "trigger":
        return await handleTrigger(req, body);
      case "replay":
        return await handleReplay(req, body);
      default:
        return NextResponse.json(
          {
            error: `Unknown action: '${action}'. Valid: register, unregister, trigger, replay`,
            code: "BAD_ACTION",
          },
          { status: 400, headers: CORS_HEADERS },
        );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "webhook-system POST failed", code: "WEBHOOK_SYSTEM_ERROR" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/** Infer the action from the body fields (sugar for callers). */
function inferAction(body: any): string {
  if (typeof body?.url === "string") return "register";
  if (typeof body?.eventType === "string") return "trigger";
  if (typeof body?.eventId === "string") return "replay";
  if (typeof body?.id === "string") return "unregister";
  return "";
}

// ─── Action handlers ──────────────────────────────────────────────

async function handleRegister(req: NextRequest, body: any) {
  const url: string | undefined = body?.url;
  const events: string[] | undefined = body?.events;
  const secret: string | undefined = body?.secret;

  if (!url || !Array.isArray(events) || !secret) {
    return NextResponse.json(
      {
        error: "register requires { url: string, events: string[], secret: string }",
        code: "BAD_REGISTER",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const sys = getWebhookSystem();
  try {
    const endpoint: WebhookEndpoint = sys.registerEndpoint(url, events, secret);
    logAudit({
      type: "webhook_registered",
      ip: getClientIp(req),
      success: true,
      metadata: { webhookId: endpoint.id, url: url.slice(0, 80), events },
    });
    return NextResponse.json(
      {
        ok: true,
        action: "register",
        endpoint,
        message: `Webhook registered. Events will be delivered via HTTP POST with HMAC-SHA256 signature.`,
      },
      { headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "register failed", code: "REGISTER_FAILED" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
}

async function handleUnregister(req: NextRequest, body: any) {
  const id: string | undefined = body?.id;
  if (!id) {
    return NextResponse.json(
      { error: "unregister requires { id: string }", code: "BAD_UNREGISTER" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const sys = getWebhookSystem();
  const removed = sys.unregisterEndpoint(id);
  logAudit({
    type: "webhook_unregistered",
    ip: getClientIp(req),
    success: removed,
    metadata: { webhookId: id },
  });
  return NextResponse.json(
    { ok: removed, action: "unregister", id, removed },
    { headers: CORS_HEADERS },
  );
}

async function handleTrigger(req: NextRequest, body: any) {
  const eventType: string | undefined = body?.eventType;
  const payload: unknown = body?.payload;
  if (!eventType) {
    return NextResponse.json(
      { error: "trigger requires { eventType: string, payload?: any }", code: "BAD_TRIGGER" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const sys = getWebhookSystem();
  try {
    const events = await sys.triggerEvent(eventType, payload);
    logAudit({
      type: "webhook_triggered",
      ip: getClientIp(req),
      success: true,
      metadata: { eventType, dispatched: events.length },
    });
    return NextResponse.json(
      {
        ok: true,
        action: "trigger",
        eventType,
        dispatched: events.length,
        events: events.map((e: WebhookEvent) => ({
          id: e.id,
          endpointId: e.endpointId,
          status: e.status,
          attempts: e.attempts,
        })),
      },
      { headers: CORS_HEADERS },
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "trigger failed", code: "TRIGGER_FAILED" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
}

async function handleReplay(req: NextRequest, body: any) {
  const eventId: string | undefined = body?.eventId;
  if (!eventId) {
    return NextResponse.json(
      { error: "replay requires { eventId: string }", code: "BAD_REPLAY" },
      { status: 400, headers: CORS_HEADERS },
    );
  }
  const sys = getWebhookSystem();
  const ok = await sys.replayWebhook(eventId);
  logAudit({
    type: "webhook_replayed",
    ip: getClientIp(req),
    success: ok,
    metadata: { eventId },
  });
  return NextResponse.json(
    { ok, action: "replay", eventId, replaying: ok },
    { headers: CORS_HEADERS },
  );
}
