/**
 * Platform barrel — single import surface for all provider-agnostic code.
 *
 * Business layer imports ONLY from here. Never import adapter files directly
 * (e.g. `brevo-adapter`) — that would leak provider details into domain logic.
 *
 * Usage:
 *   import { db, storage, email, sms, workflow, notify, getEpoch, getQuotas } from "@/lib/platform";
 *
 * Approved providers: GitHub · Cloudflare · Vercel · Inngest · Turso · Neon · Brevo
 * Removed: Cloudflare R2, Resend
 */

export type {
  FailureType,
  QuotaSnapshot,
  QuotaLevel,
  DatabasePort,
  DbTransaction,
  OutboxEventInput,
  OutboxEvent,
  StoragePort,
  StorageObjectMeta,
  StorageClass,
  EmailPort,
  EmailMessage,
  EmailPriority,
  EmailResult,
  SmsPort,
  SmsRequest,
  SmsResult,
  SmsState,
  WorkflowPort,
  EpochState,
  CircuitState,
  CircuitSnapshot,
} from "./ports";

export { PlatformError } from "./ports";
export { tursoAdapter as db } from "./turso-adapter";
export { neonRecoveryAdapter as recoveryDb, getReplicationState, applyEvents, ensureNeonSchema } from "./neon-recovery-adapter";
export { vercelBlobAdapter as storage, blobFullQuota } from "./vercel-blob-adapter";
export { brevoAdapter as email } from "./brevo-adapter";
export { customerFundedSmsAdapter as sms, getSmsRecord } from "./sms-adapter";
export { inngestAdapter as workflow } from "./inngest-adapter";
export { sendNotification, type NotificationRequest, type NotificationResult } from "./notification-service";

export { getEpoch, promoteDatabase, isWritable, issueFencingToken, verifyEpoch } from "./epoch";
export { withBreaker, withRetry, snapshotBreaker, allBreakerSnapshots, DEFAULT_RETRY, type RetryConfig } from "./circuit-breaker";
export { drainOutbox, markOutboxProcessed, markOutboxFailed } from "./turso-adapter";

import { tursoAdapter } from "./turso-adapter";
import { neonRecoveryAdapter, getReplicationState } from "./neon-recovery-adapter";
import { vercelBlobAdapter, blobFullQuota } from "./vercel-blob-adapter";
import { brevoAdapter } from "./brevo-adapter";
import { customerFundedSmsAdapter } from "./sms-adapter";
import { inngestAdapter } from "./inngest-adapter";
import { getEpoch, isWritable } from "./epoch";
import { allBreakerSnapshots } from "./circuit-breaker";
import type { QuotaSnapshot } from "./ports";

/** Collect ALL provider quotas + health for the unified cost dashboard. */
export async function getPlatformStatus(): Promise<{
  epoch: ReturnType<typeof getEpoch>;
  writablePrimary: "turso" | "neon";
  databases: {
    turso: { role: "primary"; writable: boolean; health: { ok: boolean; latencyMs: number; detail?: string } };
    neon: { role: "recovery"; writable: boolean; replication: ReturnType<typeof getReplicationState>; health: { ok: boolean; latencyMs: number; detail?: string } };
  };
  storage: {
    quota: QuotaSnapshot;
    full: Awaited<ReturnType<typeof blobFullQuota>>;
  };
  email: { quota: QuotaSnapshot };
  sms: { quota: QuotaSnapshot };
  workflows: { health: { ok: boolean; detail?: string } };
  breakers: ReturnType<typeof allBreakerSnapshots>;
  costModel: {
    platformFunded: ("turso" | "neon" | "vercel-blob" | "brevo" | "inngest")[];
    customerFunded: ("sms")[];
  };
}> {
  const epoch = getEpoch();
  const writablePrimary = isWritable("primary") ? "turso" : "neon";

  const [tursoHealth, neonHealth, blobQuota, blobFull, emailQuota, smsQuota, wfHealth] = await Promise.allSettled([
    tursoAdapter.health(),
    neonRecoveryAdapter.health(),
    vercelBlobAdapter.quota(),
    blobFullQuota(),
    brevoAdapter.quota(),
    customerFundedSmsAdapter.quota(),
    inngestAdapter.health(),
  ]);

  const settle = <T>(p: PromiseSettledResult<T>, fallback: T): T =>
    p.status === "fulfilled" ? p.value : fallback;

  return {
    epoch,
    writablePrimary,
    databases: {
      turso: {
        role: "primary",
        writable: isWritable("primary"),
        health: settle(tursoHealth, { ok: false, latencyMs: 0, detail: "probe failed" }),
      },
      neon: {
        role: "recovery",
        writable: isWritable("recovery"),
        replication: getReplicationState(),
        health: settle(neonHealth, { ok: false, latencyMs: 0, detail: "probe failed" }),
      },
    },
    storage: {
      quota: settle(blobQuota, { provider: "vercel-blob", resource: "storage_bytes", used: 0, limit: 0, percent: 0, level: "ok", remaining: 0, lastUpdated: new Date().toISOString() }),
      full: settle(blobFull, {
        storage: { provider: "vercel-blob", resource: "storage_bytes", used: 0, limit: 0, percent: 0, level: "ok", remaining: 0, lastUpdated: new Date().toISOString() },
        ops: { provider: "vercel-blob", resource: "ops_monthly", used: 0, limit: 0, percent: 0, level: "ok", remaining: 0, lastUpdated: new Date().toISOString() },
        transfer: { provider: "vercel-blob", resource: "transfer_bytes_monthly", used: 0, limit: 0, percent: 0, level: "ok", remaining: 0, lastUpdated: new Date().toISOString() },
      }),
    },
    email: { quota: settle(emailQuota, { provider: "brevo", resource: "email_daily", used: 0, limit: 300, percent: 0, level: "ok", remaining: 300, lastUpdated: new Date().toISOString() }) },
    sms: { quota: settle(smsQuota, { provider: "sms", resource: "customer_funded_usage", used: 0, limit: 1, percent: 0, level: "ok", remaining: 999999, lastUpdated: new Date().toISOString() }) },
    workflows: { health: settle(wfHealth, { ok: false, detail: "probe failed" }) },
    breakers: allBreakerSnapshots(),
    costModel: {
      platformFunded: ["turso", "neon", "vercel-blob", "brevo", "inngest"],
      customerFunded: ["sms"],
    },
  };
}
