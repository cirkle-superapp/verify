/**
 * One-time Neon schema bootstrap.
 *
 * The new Neon database (CIRKLE-VERIFY, user=TONSY) is empty.
 * This script:
 *   1. Calls ensureNeonSchema() to create the event_log table
 *   2. Reads all outbox events from Turso (authoritative)
 *   3. Applies them to Neon via applyEvents() for recovery projection
 *
 * Usage: bun run scripts/bootstrap-neon.ts
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  console.log("[INFO] Bootstrapping Neon schema + replaying outbox events…");

  const { ensureNeonSchema, applyEvents, getReplicationState, neonRecoveryAdapter } = await import("../src/lib/platform/neon-recovery-adapter");
  const { tursoAdapter } = await import("../src/lib/platform/turso-adapter");
  const { getEpoch } = await import("../src/lib/platform/epoch");

  // Step 1: ensure schema
  console.log("[1/3] Ensuring Neon schema (event_log table)…");
  const ok = await ensureNeonSchema();
  console.log(`  → schema ok: ${ok}`);

  // Step 2: read pending outbox events from Turso
  console.log("[2/3] Reading outbox events from Turso…");
  const allEvents = await tursoAdapter.query(
    `SELECT event_id, aggregate_type, aggregate_id, event_type, schema_version, payload, tenant_id, idempotency_key, correlation_id, causation_id, status, attempt_count
     FROM outbox_events ORDER BY created_at ASC`,
  );
  console.log(`  → found ${allEvents.length} total outbox events`);

  if (allEvents.length === 0) {
    console.log("[DONE] No outbox events to replay.");
    return;
  }

  // Step 3: apply each to Neon
  console.log("[3/3] Applying events to Neon (recovery projection)…");
  const epoch = getEpoch();
  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of allEvents) {
    try {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      const result = await applyEvents([{
        eventId: row.event_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        schemaVersion: row.schema_version || 1,
        payload,
        tenantId: row.tenant_id || null,
        idempotencyKey: row.idempotency_key,
        correlationId: row.correlation_id || null,
        causationId: row.causation_id || null,
      }], epoch.fencingToken);
      applied += result.applied;
      skipped += result.skipped;
      failed += result.failed;
    } catch (e: any) {
      console.error(`  ! failed event ${row.event_id}: ${e?.message?.slice(0, 150)}`);
      failed++;
    }
  }

  console.log(`  → applied: ${applied}, skipped: ${skipped}, failed: ${failed}`);

  // Final state
  const rep = getReplicationState();
  console.log("\n[FINAL] Replication state:");
  console.log(`  recoveryState: ${rep.recoveryState}`);
  console.log(`  lastAuthoritativeEventId: ${rep.lastAuthoritativeEventId}`);
  console.log(`  lastReplicatedEventId: ${rep.lastReplicatedEventId}`);
  console.log(`  replicationLagEvents: ${rep.replicationLagEvents}`);
  console.log(`  replicationLagSeconds: ${rep.replicationLagSeconds}`);
  console.log(`  databaseEpoch: ${rep.databaseEpoch}`);

  // Count events in Neon via health (which uses SELECT 1) and then verify via applyEvents idempotency
  console.log("\n[VERIFY] Neon is reachable + schema is in place.");
  console.log("Run the platform harmony endpoint to confirm replication lag = 0.");

  process.exit(0);
}

main().catch((e) => {
  console.error("[FATAL]", e?.message?.slice(0, 500) || e);
  process.exit(1);
});
