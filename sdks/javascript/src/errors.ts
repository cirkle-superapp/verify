/**
 * Custom error hierarchy for the Cirkle Verify JavaScript/TypeScript SDK.
 *
 * Every SDK error derives from `CirkleError` so callers can catch the whole
 * family with one `catch` clause while still being able to react to specific
 * failure modes (auth, rate limit, server, network, ...).
 */

export class CirkleError extends Error {
  /** Machine-readable error code from the API (e.g. `rate_limited`). */
  readonly code?: string;
  /** Extra fields returned by the API alongside `error`/`message`. */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts: { code?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'CirkleError';
    if (opts.code) this.code = opts.code;
    if (opts.details) this.details = opts.details;
    // Restore prototype chain after super() (TS-to-ES5 quirk)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** API key is missing, malformed, or revoked (HTTP 401). */
export class AuthenticationError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'AuthenticationError';
  }
}

/** API key is valid but lacks permission for the resource (HTTP 403). */
export class AuthorizationError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'AuthorizationError';
  }
}

/** Request body failed server-side validation (HTTP 400). */
export class ValidationError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'ValidationError';
  }
}

/** Requested resource does not exist (HTTP 404). */
export class NotFoundError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'NotFoundError';
  }
}

/**
 * Rate limit exceeded (HTTP 429).
 *
 * Exposes `retryAfter` (seconds, parsed from `Retry-After` header) so
 * callers can decide how long to wait before retrying.
 */
export class RateLimitError extends CirkleError {
  readonly retryAfter?: number;

  constructor(
    message: string,
    opts: { retryAfter?: number; code?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message, { code: opts.code ?? 'rate_limited', details: opts.details });
    this.name = 'RateLimitError';
    if (typeof opts.retryAfter === 'number') this.retryAfter = opts.retryAfter;
  }
}

/**
 * Server returned a 5xx response after all retries.
 *
 * `status` is the final HTTP status code observed.
 */
export class ServerError extends CirkleError {
  readonly status: number;

  constructor(
    message: string,
    opts: { status: number; code?: string; details?: Record<string, unknown> },
  ) {
    super(message, { code: opts.code ?? 'server_error', details: opts.details });
    this.name = 'ServerError';
    this.status = opts.status;
  }
}

/** A non-2xx response that doesn't map to one of the specific subclasses. */
export class ApiError extends CirkleError {
  readonly status: number;

  constructor(
    message: string,
    opts: { status: number; code?: string; details?: Record<string, unknown> },
  ) {
    super(message, opts);
    this.name = 'ApiError';
    this.status = opts.status;
  }
}

/** Transport-level failure (DNS, TCP reset, TLS handshake, timeout). */
export class NetworkError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'NetworkError';
  }
}

/** An image input could not be loaded or base64-encoded. */
export class InvalidImageError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'InvalidImageError';
  }
}

/** A webhook signature header was malformed (empty, missing prefix, ...). */
export class SignatureVerificationError extends CirkleError {
  constructor(message: string, opts: { code?: string; details?: Record<string, unknown> } = {}) {
    super(message, opts);
    this.name = 'SignatureVerificationError';
  }
}

export {
  /** @internal — re-exported for backward compatibility */
  CirkleError as default,
};
