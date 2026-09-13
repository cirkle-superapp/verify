import { NextRequest, NextResponse } from "next/server";
import { promoteDatabase, getEpoch } from "@/lib/platform";

export const runtime = "nodejs";

/**
 * POST /api/platform/epoch/promote
 *
 * CONTROLLED database promotion — increments epoch, switches writable primary.
 * This is NOT automatic failover. Requires operator authorization.
 *
 * Body:
 *   { newPrimary: "turso" | "neon", reason: string, operatorAuth: string }
 *
 * After promotion, all writers holding old fencing tokens are rejected (split-brain prevention).
 */
export async function POST(req: NextRequest) {
  // Operator auth: in production this verifies against an admin secret
  const operatorAuth = req.headers.get("x-operator-auth") || "";
  const adminSecret = process.env.PLATFORM_ADMIN_SECRET || "cirkle-admin-dev";
  if (operatorAuth !== adminSecret) {
    return NextResponse.json({ error: "operator authorization required" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const newPrimary = body.newPrimary;
    const reason = body.reason || "manual promotion";

    if (newPrimary !== "turso" && newPrimary !== "neon") {
      return NextResponse.json({ error: "newPrimary must be 'turso' or 'neon'" }, { status: 400 });
    }

    const newEpoch = promoteDatabase(newPrimary, reason, operatorAuth);
    return NextResponse.json({
      message: `Promoted to ${newPrimary} (epoch ${newEpoch.epoch}). All old writers are fenced out.`,
      epoch: newEpoch,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "promotion failed" }, { status: 500 });
  }
}

/** GET — current epoch state (read-only, no auth). */
export async function GET() {
  return NextResponse.json(getEpoch());
}
