import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory rate limiter for API routes.
 * No external dependencies, no billing — just a Map with TTL cleanup.
 *
 * Limits are per-IP per-window. In production behind a proxy, falls back to
 * the X-Forwarded-For header (Caddy sets this).
 */

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Cleanup expired buckets every 60s
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt < now) buckets.delete(key);
    }
  }, 60_000).unref?.();
}

interface RateLimitOptions {
  /** Max requests per window per IP */
  maxRequests: number;
  /** Window size in ms */
  windowMs: number;
  /** Identifier prefix (e.g. "doc", "face", "liveness") */
  prefix: string;
}

export function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/**
 * Check rate limit for a request. Returns null if allowed, or a NextResponse
 * (429) if the limit is exceeded.
 */
export function checkRateLimit(req: NextRequest, opts: RateLimitOptions): NextResponse | null {
  const ip = getClientIp(req);
  const key = `${opts.prefix}:${ip}`;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + opts.windowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;

  if (bucket.count > opts.maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Max ${opts.maxRequests} requests per ${opts.windowMs / 1000}s. Try again in ${retryAfter}s.`,
        code: "rate_limited",
        retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter),
          "X-RateLimit-Limit": String(opts.maxRequests),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(bucket.resetAt),
        },
      }
    );
  }

  return null;
}
