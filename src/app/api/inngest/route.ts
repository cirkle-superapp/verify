import { serve } from "inngest/next";
import { inngest, allFunctions } from "@/lib/platform/inngest-functions";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * /api/inngest — Inngest SDK route handler (Next.js 16 App Router).
 *
 * Exports GET, POST, PUT for Inngest to:
 *   1. PUT — register functions (on deployment — Inngest polls this)
 *   2. POST — invoke functions (on event trigger)
 *   3. GET  — probe / health
 *
 * Registered durable workflows:
 *   - verification.completed → P2 transactional email (Brevo)
 *   - verification.rejected  → P1 security alert email
 *   - outbox.drain.requested → Turso outbox → Neon replication
 *   - sms.send.requested     → customer-funded SMS (fail-closed)
 *   - reconciliation (cron)  → hourly orphan + quota check
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
  streaming: "allow",
});
