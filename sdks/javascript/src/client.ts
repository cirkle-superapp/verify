/**
 * CirkleVerify — main client class for the Cirkle Verify JavaScript SDK.
 *
 * Works in the browser, Node.js (18+), Bun, Deno, and edge runtimes —
 * anywhere the standard `fetch` API is available.
 *
 * Design:
 *  - One client class, both `apiKey` + optional `baseUrl`.
 *  - Every public method is async (because `fetch` is) and returns a
 *    typed result object.
 *  - 5xx responses are retried up to 3 times with exponential backoff
 *    (250ms, 500ms, 1000ms). 4xx responses are never retried.
 *  - HTTP 429 with a `Retry-After` header is honoured — the SDK sleeps
 *    for the requested duration and retries once.
 *  - Auth: the API key is sent as `Authorization: Bearer <key>` and
 *    mirrored as `X-API-Key: <key>`.
 *  - Webhook signature verification is a static method (no client
 *    needed) — `CirkleVerify.verifyWebhookSignature(...)`.
 */

import {
  ApiError,
  AuthenticationError,
  AuthorizationError,
  CirkleError,
  NetworkError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from './errors';
import type {
  Certificate,
  CheckLivenessArgs,
  ExportDataArgs,
  FaceMatchArgs,
  FaceMatchResult,
  GetCertificateArgs,
  GdprExport,
  IdValidationResult,
  LivenessResult,
  ParseMrzArgs,
  MrzParseResult,
  RegisterWebhookArgs,
  ValidateIdArgs,
  VerificationResult,
  VerifyDocumentArgs,
  WebhookEndpoint,
} from './types';
import {
  computeSignature,
  encodeImage,
  formatSignatureHeader,
  normalizeBaseUrl,
  sleep,
  toQueryString,
  verifySignature,
} from './utils';

export interface CirkleVerifyConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://cirkle-verify.vercel.app';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 250;

// Endpoints that are *expected* to take a long time. The SDK bumps the
// default timeout for these so callers don't have to.
const LONG_METHOD_PATHS = new Set<string>([
  '/api/verify/document',
  '/api/verify/liveness',
  '/api/verify/face-match',
  '/api/v1/verify/document',
  '/api/v1/verify/liveness',
  '/api/v1/verify/face-match',
]);

export class CirkleVerify {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly userAgent: string;
  readonly defaultHeaders: Record<string, string>;
  /** Custom fetch implementation (defaults to global fetch). */
  protected readonly fetchImpl: typeof fetch;

  constructor(config: CirkleVerifyConfig) {
    if (!config || !config.apiKey || typeof config.apiKey !== 'string') {
      throw new AuthenticationError('apiKey is required (e.g. "cvk_live_...")');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, config.maxRetries ?? MAX_RETRIES);
    this.userAgent = config.userAgent ?? 'cirkle-verify-js/1.0.0';
    this.defaultHeaders = { ...(config.defaultHeaders ?? {}) };
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new NetworkError('fetch is not available in this runtime — install a polyfill or pass config.fetch');
    }
  }

  // ─── Public API methods ───────────────────────────────────────

  /**
   * Verify a document image — extract fields via OCR + consensus.
   *
   * The image input accepts a data URL, raw bytes, Blob, File, or
   * (Node) a filesystem path.
   */
  async verifyDocument(args: VerifyDocumentArgs): Promise<VerificationResult> {
    if (!args || !args.image) {
      throw new ValidationError('image is required');
    }
    const frontImage = await encodeImage(args.image);
    const body: Record<string, unknown> = {
      frontImage,
      docType: args.docType ?? 'national_id',
    };
    if (args.backImage) {
      body.backImage = await encodeImage(args.backImage);
    }
    if (args.country) {
      body.country = args.country;
    }
    const resp = await this.request<Record<string, unknown>>('POST', '/api/verify/document', { body });
    return resp as VerificationResult;
  }

  /**
   * Check liveness from a sequence of webcam frames.
   *
   * `frames` is an array of image inputs (data URLs, Blobs, bytes, ...).
   * `challengeType` is one of `turn_left`, `turn_right`, `smile`, ...
   */
  async checkLiveness(args: CheckLivenessArgs): Promise<LivenessResult> {
    if (!args || !Array.isArray(args.frames) || args.frames.length === 0) {
      throw new ValidationError('at least one frame is required');
    }
    const frames: string[] = [];
    for (const f of args.frames) {
      frames.push(await encodeImage(f));
    }
    const body: Record<string, unknown> = { frames };
    if (args.actions && args.actions.length > 0) {
      body.actions = args.actions;
    } else if (args.challengeType) {
      body.actions = [args.challengeType];
    }
    const resp = await this.request<Record<string, unknown>>('POST', '/api/verify/liveness', { body });
    return resp as LivenessResult;
  }

  /**
   * Face match — compare a selfie to a document photo.
   */
  async faceMatch(args: FaceMatchArgs): Promise<FaceMatchResult> {
    if (!args || !args.documentImage || !args.selfieImage) {
      throw new ValidationError('documentImage and selfieImage are required');
    }
    const body = {
      docImage: await encodeImage(args.documentImage),
      selfie: await encodeImage(args.selfieImage),
    };
    const resp = await this.request<Record<string, unknown>>('POST', '/api/verify/face-match', { body });
    return resp as FaceMatchResult;
  }

  /**
   * Validate a national ID against the country checksum algorithm.
   */
  async validateId(args: ValidateIdArgs): Promise<IdValidationResult> {
    if (!args || !args.country || !args.id) {
      throw new ValidationError('country and id are required');
    }
    const body = { country: args.country.toUpperCase(), id: args.id };
    const resp = await this.request<Record<string, unknown>>('POST', '/api/verify/validate-id', { body });
    return resp as IdValidationResult;
  }

  /**
   * Parse an ICAO 9303 MRZ text block (TD1/TD2/TD3).
   */
  async parseMrz(args: ParseMrzArgs): Promise<MrzParseResult> {
    if (!args || !args.mrz || args.mrz.trim().length < 20) {
      throw new ValidationError('mrz is required (min 20 chars)');
    }
    const body = { text: args.mrz };
    const resp = await this.request<Record<string, unknown>>('POST', '/api/verify/parse-mrz', { body });
    return resp as MrzParseResult;
  }

  /**
   * Register a webhook endpoint to receive HMAC-signed event deliveries.
   *
   * `secret` must be at least 16 characters. The endpoint will receive
   * signed POSTs to the listed `events`.
   */
  async registerWebhook(args: RegisterWebhookArgs): Promise<WebhookEndpoint> {
    if (!args || !args.url || !args.url.startsWith('https://')) {
      throw new ValidationError('url must be an https:// URL');
    }
    if (!args.secret || args.secret.length < 16) {
      throw new ValidationError('secret must be at least 16 characters');
    }
    if (!args.events || args.events.length === 0) {
      throw new ValidationError('events list cannot be empty');
    }
    const body = {
      action: 'register',
      url: args.url,
      events: args.events,
      secret: args.secret,
    };
    const resp = await this.request<Record<string, unknown>>('POST', '/api/v1/verify/webhook-system', { body });
    const endpoint = (resp.endpoint ?? resp) as WebhookEndpoint;
    return endpoint;
  }

  /**
   * Issue (or retrieve) a signed verification certificate.
   */
  async getCertificate(args: GetCertificateArgs): Promise<Certificate> {
    if (!args || !args.verificationId) {
      throw new ValidationError('verificationId is required');
    }
    const body = {
      verificationId: args.verificationId,
      subject: args.subject ?? { verificationId: args.verificationId, docType: 'national_id' },
      result: args.result ?? { status: 'verified', overallScore: 0 },
      layers: args.layers ?? {},
    };
    const resp = await this.request<Record<string, unknown>>('POST', '/api/v1/verify/certificate', { body });
    const cert = (resp.certificate ?? resp) as Certificate;
    return cert;
  }

  /**
   * Download a GDPR Article 20 data-portability export for a user.
   *
   * The response includes SHA-256 hashes (never raw biometrics) plus a
   * `downloadUrl` you can hand to the user.
   */
  async exportData(args: ExportDataArgs): Promise<GdprExport> {
    if (!args || !args.userId) {
      throw new ValidationError('userId is required');
    }
    const params: Record<string, unknown> = { user_id: args.userId };
    if (args.download) {
      params.download = '1';
    }
    const resp = await this.request<Record<string, unknown>>('GET', '/api/v1/verify/gdpr/export', { params });
    return resp as GdprExport;
  }

  /**
   * Stream a large response body — useful for GDPR exports when the
   * caller wants to write directly to disk without buffering.
   *
   * Returns the underlying `Response` so the caller can read
   * `response.body` as a `ReadableStream`.
   */
  async stream(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: { body?: Record<string, unknown>; params?: Record<string, unknown> } = {},
  ): Promise<Response> {
    const url = this.buildUrl(path, opts.params);
    const init = this.buildRequestInit(method, opts.body, /* stream */ true);
    const resp = await this.fetchImpl(url, init);
    if (!resp.ok) {
      // Drain the body so the connection can be reused.
      await resp.arrayBuffer().catch(() => undefined);
      await this.handleError(resp.status, resp);
    }
    return resp;
  }

  // ─── Webhook signature helpers (static) ───────────────────────

  /**
   * Compute the HMAC-SHA256 signature for an outgoing webhook payload.
   */
  static async computeWebhookSignature(
    payload: string | Uint8Array | ArrayBuffer | Record<string, unknown>,
    secret: string,
  ): Promise<string> {
    return computeSignature(payload, secret);
  }

  /** Wrap a hex digest as the `sha256=<hex>` header value. */
  static formatSignature(hexDigest: string): string {
    return formatSignatureHeader(hexDigest);
  }

  /**
   * Verify an incoming `X-Cirkle-Signature` header in constant time.
   *
   * Resolves to `true` if the signature matches, `false` if it parses
   * cleanly but does not match, and rejects with
   * `SignatureVerificationError` if the header is malformed.
   */
  static async verifyWebhookSignature(
    payload: string | Uint8Array | ArrayBuffer | Record<string, unknown>,
    secret: string,
    headerValue: string,
  ): Promise<boolean> {
    return verifySignature(payload, secret, headerValue);
  }

  // ─── HTTP plumbing ────────────────────────────────────────────

  /**
   * Issue an HTTP request with retries + rate-limit handling.
   */
  protected async request<T = unknown>(
    method: string,
    path: string,
    opts: { body?: Record<string, unknown>; params?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.params);
    const body = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers = this.buildHeaders(opts.headers);
    const timeout = LONG_METHOD_PATHS.has(path) ? Math.max(this.timeoutMs, 120_000) : this.timeoutMs;
    let lastError: CirkleError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.doRequest<T>(method, url, body, headers, timeout);
      } catch (e) {
        if (e instanceof RateLimitError) {
          lastError = e;
          if (attempt >= this.maxRetries) throw e;
          await sleep(Math.min(e.retryAfter ?? 2_000, 60_000));
          continue;
        }
        if (e instanceof ServerError) {
          lastError = e;
          if (attempt >= this.maxRetries) throw e;
          const waitMs = BACKOFF_BASE_MS * 2 ** attempt;
          await sleep(waitMs);
          continue;
        }
        // Network errors are also retryable.
        if (e instanceof NetworkError) {
          lastError = e;
          if (attempt >= this.maxRetries) throw e;
          await sleep(BACKOFF_BASE_MS * 2 ** attempt);
          continue;
        }
        throw e;
      }
    }
    if (lastError) throw lastError;
    throw new ServerError('request failed without a captured exception', { status: 0 });
  }

  protected async doRequest<T>(
    method: string,
    url: string,
    body: string | undefined,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, {
        method,
        body,
        headers,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new NetworkError(`request timed out after ${timeoutMs}ms`);
      }
      throw new NetworkError(`network error: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      await this.handleError(resp.status, resp);
    }
    // Empty 204 etc → empty object.
    const text = await resp.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { _raw: text, _status: resp.status } as unknown as T;
    }
  }

  protected async handleError(status: number, resp: Response): Promise<never> {
    const text = await resp.text().catch(() => '');
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = { error: text || `HTTP ${status}` };
    }
    const message = String(payload.error ?? payload.message ?? `HTTP ${status}`);
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    const details: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k !== 'error' && k !== 'message' && k !== 'code') details[k] = v;
    }
    if (status === 400) throw new ValidationError(message, { code, details });
    if (status === 401) throw new AuthenticationError(message, { code, details });
    if (status === 403) throw new AuthorizationError(message, { code, details });
    if (status === 404) throw new NotFoundError(message, { code, details });
    if (status === 429) {
      const retryAfter = parseRetryAfter(resp.headers.get('Retry-After'));
      throw new RateLimitError(message, { retryAfter, code, details });
    }
    if (status >= 500 && status < 600) {
      throw new ServerError(message, { status, code, details });
    }
    throw new ApiError(message, { status, code, details });
  }

  protected buildUrl(path: string, params?: Record<string, unknown>): string {
    const qs = toQueryString(params);
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  protected buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      ...this.defaultHeaders,
      ...(extra ?? {}),
    };
  }

  protected buildRequestInit(
    method: string,
    body: Record<string, unknown> | undefined,
    stream: boolean,
  ): RequestInit {
    return {
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: this.buildHeaders(stream ? { Accept: 'application/octet-stream' } : undefined),
    };
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isNaN(n) && n >= 0) return n * 1000; // seconds → ms
  return undefined;
}
