/**
 * Security hardening utilities.
 *
 * - sanitizeForDb: strips control chars + limits length to prevent log injection
 *   and oversized payloads in the DB
 * - validateDataUrl: ensures a string is a valid base64 data URL of an allowed
 *   image type, under the max byte size
 * - SecurityHeaders: CSP + other hardening headers applied via next.config
 */

const MAX_FIELD_LENGTH = 500;
const MAX_DATA_URL_BYTES = 6 * 1024 * 1024; // 6MB cap on base64 payload
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];

/** Strip control characters and enforce a max length on a string destined for the DB. */
export function sanitizeForDb(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  let s = typeof input === "string" ? input : String(input);
  // Remove null bytes and other control chars (except newline/tab)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  // Truncate
  if (s.length > MAX_FIELD_LENGTH) s = s.slice(0, MAX_FIELD_LENGTH);
  // Trim
  s = s.trim();
  return s || null;
}

/** Validate a data URL is a supported image under the byte limit. Returns the mime or null. */
export function validateDataUrl(dataUrl: unknown): { mime: string; ok: boolean; reason?: string } {
  if (typeof dataUrl !== "string") return { mime: "", ok: false, reason: "not a string" };
  const m = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/s);
  if (!m) return { mime: "", ok: false, reason: "not a valid data:image/...;base64, URL" };
  const [, mime, b64] = m;
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
    return { mime, ok: false, reason: `unsupported image type: ${mime}` };
  }
  // base64 length ≈ bytes * 1.37
  const approxBytes = (b64.length * 3) / 4;
  if (approxBytes > MAX_DATA_URL_BYTES) {
    return { mime, ok: false, reason: `image too large (${(approxBytes / 1024 / 1024).toFixed(1)}MB > 6MB limit)` };
  }
  return { mime, ok: true };
}

/** Validate a national ID against a regex pattern. */
export function validateNationalId(id: string | null | undefined, pattern?: string): boolean {
  if (!id || !pattern) return true; // no validation if no pattern
  try {
    return new RegExp(pattern).test(id);
  } catch {
    return true; // invalid regex → skip validation
  }
}

/** Escape HTML to prevent XSS in any user-visible output. */
export function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Security headers for next.config.ts (CSP, HSTS, X-Frame-Options, etc.) */
export const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];
