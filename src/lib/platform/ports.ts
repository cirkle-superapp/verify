/**
 * Platform Ports — provider-neutral interfaces.
 *
 * The domain/business layer talks ONLY to these ports. Provider-specific
 * details (Turso, Neon, Brevo, Vercel Blob, Inngest, SMS vendor) live
 * behind adapter implementations and never leak into business logic.
 *
 * Approved providers:
 *   GitHub · Cloudflare · Vercel · Inngest · Turso · Neon · Brevo
 *
 * Explicitly REMOVED:
 *   Cloudflare R2 → NOT in baseline (billed beyond 10GB free)
 *   Resend        → replaced by Brevo
 */

// ─── Failure Taxonomy ─────────────────────────────────────────────
// All platform errors are classified into one of these categories.
// Failover/retry/circuit-breaker decisions are based on this classification.

export type FailureType =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DEPENDENCY_TIMEOUT"
  | "DEPENDENCY_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_QUOTA_EXCEEDED"
  | "STORAGE_QUOTA_EXCEEDED"
  | "EMAIL_QUOTA_EXCEEDED"
  | "SMS_AUTHORIZATION_FAILED"
  | "SMS_PAYMENT_REQUIRED"
  | "WORKFLOW_FAILURE"
  | "INTERNAL_ERROR"
  | "UNKNOWN_INFRASTRUCTURE_FAILURE";

export class PlatformError extends Error {
  constructor(
    public readonly type: FailureType,
    message: string,
    public readonly cause?: unknown,
    public readonly retryable: boolean = false,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = "PlatformError";
  }

  /** True if the error is transient and a bounded retry is safe. */
  isTransient(): boolean {
    return (
      this.type === "DEPENDENCY_TIMEOUT" ||
      this.type === "DEPENDENCY_UNAVAILABLE" ||
      this.type === "DATABASE_UNAVAILABLE" ||
      this.type === "RATE_LIMITED" ||
      this.type === "WORKFLOW_FAILURE"
    );
  }

  /** True if the error is a hard quota/cost boundary — fail closed. */
  isQuotaBoundary(): boolean {
    return (
      this.type === "DATABASE_QUOTA_EXCEEDED" ||
      this.type === "STORAGE_QUOTA_EXCEEDED" ||
      this.type === "EMAIL_QUOTA_EXCEEDED" ||
      this.type === "SMS_PAYMENT_REQUIRED"
    );
  }
}

// ─── Quota State ──────────────────────────────────────────────────

export type QuotaLevel = "ok" | "monitoring" | "warning" | "restrict" | "emergency" | "exhausted";

export interface QuotaSnapshot {
  provider: string;
  resource: string;             // e.g. "email_daily", "blob_storage_bytes"
  used: number;
  limit: number;
  percent: number;              // 0..100
  level: QuotaLevel;            // derived from percent vs thresholds
  remaining: number;
  resetsAt?: string;            // ISO timestamp
  lastUpdated: string;
}

// ─── Database Port ────────────────────────────────────────────────

export interface DatabasePort {
  /** Provider name for observability. */
  readonly name: string;
  /** "primary" (authoritative) or "recovery" (projection). */
  readonly role: "primary" | "recovery";

  /** Execute a read query. */
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;

  /** Execute a mutation inside a transaction. Returns tx id. */
  transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T>;

  /** Health probe. */
  health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
}

export interface DbTransaction {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  /** Append an outbox event WITHIN this transaction (atomic with business data). */
  appendOutbox(event: OutboxEventInput): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

// ─── Outbox ───────────────────────────────────────────────────────

export interface OutboxEventInput {
  aggregateType: string;        // e.g. "verification"
  aggregateId: string;          // e.g. verification id
  eventType: string;            // e.g. "verification.completed"
  payload: Record<string, unknown>;
  tenantId?: string;
  idempotencyKey: string;
  correlationId?: string;
  causationId?: string;
}

export interface OutboxEvent extends OutboxEventInput {
  eventId: string;
  schemaVersion: number;
  createdAt: string;
  processedAt: string | null;
  attemptCount: number;
  status: "pending" | "processing" | "processed" | "failed" | "dead_letter";
  lastError: string | null;
}

// ─── Storage Port ─────────────────────────────────────────────────

export type StorageClass =
  | "FREE_PLATFORM_STORAGE"
  | "CUSTOMER_FUNDED_STORAGE"
  | "TEMPORARY_STORAGE"
  | "SYSTEM_CRITICAL"
  | "NONCRITICAL";

export interface StorageObjectMeta {
  objectId: string;
  tenantId?: string;
  ownerId?: string;
  objectType: string;             // "avatar" | "document" | "thumbnail" | ...
  sizeBytes: number;
  contentType: string;
  storageProvider: string;
  storageClass: StorageClass;
  createdAt: string;
  retentionPolicy?: string;
  deletable: boolean;
  customerFunded: boolean;
}

export interface StoragePort {
  readonly name: string;

  /** Put an object. Rejects with STORAGE_QUOTA_EXCEEDED when over hard limit. */
  put(
    key: string,
    data: Buffer | string,
    opts: {
      contentType: string;
      objectType: string;
      storageClass?: StorageClass;
      tenantId?: string;
      ownerId?: string;
      customerFunded?: boolean;
    },
  ): Promise<{ key: string; url: string; meta: StorageObjectMeta }>;

  /** Get an object's contents. */
  get(key: string): Promise<{ data: Buffer; meta: StorageObjectMeta } | null>;

  /** Delete an object. */
  delete(key: string): Promise<boolean>;

  /** Delete many objects (used by retention policies). */
  deleteMany(keys: string[]): Promise<number>;

  /** Current quota snapshot. */
  quota(): Promise<QuotaSnapshot>;
}

// ─── Email Port ───────────────────────────────────────────────────

export type EmailPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export interface EmailMessage {
  to: string;
  from?: string;
  subject: string;
  html?: string;
  text?: string;
  templateId?: string;
  templateParams?: Record<string, string>;
  priority: EmailPriority;
  correlationId?: string;
  idempotencyKey: string;
}

export interface EmailResult {
  messageId: string | null;
  status: "sent" | "queued" | "deferred" | "failed";
  reason?: string;
  providerResponse?: unknown;
}

export interface EmailPort {
  readonly name: string;

  /**
   * Send an email. Honors quota governor:
   *  - P0/P1 always attempted (security/auth critical)
   *  - P2 attempted if quota remains
   *  - P3 deferred when near limit
   *  - P4 suppressed/deferred under quota pressure
   * Returns status="deferred" when quota-exhausted (NEVER throws for quota).
   */
  send(msg: EmailMessage): Promise<EmailResult>;

  /** Current quota snapshot. */
  quota(): Promise<QuotaSnapshot>;
}

// ─── SMS Port (customer-funded) ───────────────────────────────────

export type SmsState =
  | "NOT_REQUESTED"
  | "QUOTED"
  | "AUTHORIZED"
  | "QUEUED"
  | "SUBMITTED"
  | "DELIVERED"
  | "FAILED"
  | "CHARGE_PENDING"
  | "CHARGED"
  | "REFUNDED"
  | "CANCELLED";

export interface SmsRequest {
  smsRequestId: string;
  customerId: string;
  userId: string;
  purpose: string;             // "otp" | "notification" | ...
  destination: string;         // E.164
  provider: string;
  estimatedCost: number;
  currency: string;
  authorizationReference: string;
  consentReference: string;
  message: string;
  correlationId?: string;
}

export interface SmsResult {
  smsRequestId: string;
  status: SmsState;
  providerMessageId?: string;
  failureType?: FailureType;
  reason?: string;
}

export interface SmsPort {
  readonly name: string;

  /** Quote a send (no charge yet). */
  quote(req: Omit<SmsRequest, "smsRequestId" | "authorizationReference" | "consentReference">): Promise<{
    estimatedCost: number;
    currency: string;
    validForSeconds: number;
  }>;

  /** Authorize a charge for a quoted send. */
  authorize(smsRequestId: string, customerId: string): Promise<{ authorized: boolean; authorizationReference: string }>;

  /**
   * Send ONLY if authorization state permits. Otherwise fails closed with
   * SMS_AUTHORIZATION_FAILED or SMS_PAYMENT_REQUIRED.
   */
  send(req: SmsRequest): Promise<SmsResult>;

  /** Current SMS cost/usage snapshot (always customer-funded). */
  quota(): Promise<QuotaSnapshot>;
}

// ─── Workflow Port (Inngest) ──────────────────────────────────────

export interface WorkflowPort {
  readonly name: string;

  /** Enqueue an event for durable processing. Idempotent by idempotencyKey. */
  enqueue(event: {
    name: string;
    data: Record<string, unknown>;
    idempotencyKey: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<{ eventId: string; queued: boolean }>;

  /** Health probe. */
  health(): Promise<{ ok: boolean; detail?: string }>;
}

// ─── Epoch / Fencing ──────────────────────────────────────────────

export interface EpochState {
  epoch: number;
  primary: "turso" | "neon";
  promotedAt: string;
  reason: string;
  fencingToken: string;
}

// ─── Circuit Breaker ──────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  halfOpenAt: string | null;
}
