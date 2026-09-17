import { NextRequest, NextResponse } from "next/server";
import { createApiKey, listApiKeys, revokeApiKey, requireApiKey, type ApiKey } from "@/lib/api-auth";

export const runtime = "nodejs";

/**
 * POST /api/v1/api-keys
 * Create a new API key. Requires admin auth (first key is created with admin secret).
 *
 * Body: { name: string, email: string, rateLimitPerMin?: number }
 *
 * Returns: { rawKey: string (shown ONCE), keyId: string }
 * The rawKey must be saved by the client — it cannot be retrieved again.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name: string = body.name || "";
    const email: string = body.email || "";
    const rateLimitPerMin: number = body.rateLimitPerMin || 60;

    if (!name || name.length < 2) {
      return NextResponse.json({ error: "name (min 2 chars) required" }, { status: 400 });
    }
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "valid email required" }, { status: 400 });
    }

    // Check if this is the first key (bootstrap) or requires admin auth
    const existing = await listApiKeys();
    if (existing.length > 0) {
      // Not the first key — require admin auth OR platform admin secret (for bootstrap recovery)
      const adminSecret = req.headers.get("x-admin-secret");
      const expectedSecret = process.env.PLATFORM_ADMIN_SECRET || "cirkle-admin-dev";
      if (adminSecret !== expectedSecret) {
        const auth = await requireApiKey(req);
        if (auth instanceof Response) {
          return NextResponse.json({ error: "Admin API key required to create new keys (or provide X-Admin-Secret header)" }, { status: 401 });
        }
      }
    }

    const result = await createApiKey(name, email, rateLimitPerMin);
    if (!result) {
      return NextResponse.json({ error: "Failed to create API key" }, { status: 500 });
    }

    return NextResponse.json({
      ...result,
      message: "Save your API key now — it will not be shown again.",
      usage: {
        header: "Authorization: Bearer " + result.rawKey,
        altHeader: "X-API-Key: " + result.rawKey,
        example: `curl -H "Authorization: Bearer ${result.rawKey}" https://cirkle-verify.vercel.app/api/v1/verify`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

/**
 * GET /api/v1/api-keys
 * List all API keys (admin only). Returns key metadata (not raw keys).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireApiKey(req);
    if (auth instanceof Response) {
      return auth;
    }
    const keyInfo = auth as ApiKey;

    const keys = await listApiKeys();
    return NextResponse.json({
      keys,
      total: keys.length,
      requestedBy: { keyId: keyInfo.keyId, name: keyInfo.name },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}

/**
 * DELETE /api/v1/api-keys?keyId=key_xxx
 * Revoke an API key (admin only).
 */
export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireApiKey(req);
    if (auth instanceof Response) {
      return auth;
    }

    const url = new URL(req.url);
    const keyId = url.searchParams.get("keyId");
    if (!keyId) {
      return NextResponse.json({ error: "keyId required" }, { status: 400 });
    }

    const revoked = await revokeApiKey(keyId);
    return NextResponse.json({ revoked, keyId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
