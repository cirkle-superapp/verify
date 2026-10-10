import { NextRequest, NextResponse } from "next/server";
import {
  getUserTier,
  upgradeUserTier,
  getAllTiers,
  getTier,
  getUnlockedFeatures,
  getNextTier,
  getTierProgress,
  getTierStats,
  type VerificationTier,
} from "@/lib/verification-tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/v1/verify/tier?user_id=X
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("user_id");
  const allTiers = getAllTiers();

  if (!userId) {
    return NextResponse.json({ tiers: allTiers, total: 7 }, { headers: CORS_HEADERS });
  }

  const tier = getUserTier(userId);
  const tierDef = getTier(tier);
  const nextTier = getNextTier(tier);
  const progress = getTierProgress(tier);
  const unlocked = getUnlockedFeatures(tier);
  const stats = getTierStats();

  return NextResponse.json({
    user_id: userId,
    current_tier: tier,
    tier_name: tierDef.name,
    arabic_name: tierDef.arabicName,
    description: tierDef.description,
    color: tierDef.color,
    progress,
    unlocked_features: unlocked,
    next_tier: nextTier ? { level: nextTier.level, name: nextTier.name, requirements: nextTier.requirements } : null,
    all_tiers: allTiers,
    platform_stats: stats,
  }, { headers: CORS_HEADERS });
}

/**
 * POST /api/v1/verify/tier — upgrade user tier
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { user_id, tier, reason } = body;

    if (!user_id) {
      return NextResponse.json({ error: "user_id required", code: "bad_request" }, { status: 400, headers: CORS_HEADERS });
    }

    if (tier === undefined || tier < 0 || tier > 6) {
      return NextResponse.json({ error: "tier must be 0-6", code: "bad_request" }, { status: 400, headers: CORS_HEADERS });
    }

    const result = upgradeUserTier(user_id, tier as VerificationTier, reason || "manual_upgrade");
    const tierDef = getTier(result.to);
    const progress = getTierProgress(result.to);

    return NextResponse.json({
      user_id,
      from: result.from,
      to: result.to,
      tier_name: tierDef.name,
      arabic_name: tierDef.arabicName,
      color: tierDef.color,
      progress,
      unlocked: result.unlocked,
      message: result.to > result.from ? `Upgraded to ${tierDef.name} — ${result.unlocked.length} new features unlocked` : "No upgrade",
      timestamp: new Date().toISOString(),
    }, { status: 200, headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error", code: "internal_error" }, { status: 500, headers: CORS_HEADERS });
  }
}
