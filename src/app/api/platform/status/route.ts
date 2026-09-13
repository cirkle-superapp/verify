import { NextResponse } from "next/server";
import { getPlatformStatus } from "@/lib/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/platform/status
 * Unified infrastructure + cost dashboard data.
 * Returns: epoch, database health/replication, storage quota, email quota,
 * SMS usage, workflow health, circuit breakers, cost model classification.
 */
export async function GET() {
  const status = await getPlatformStatus();
  return NextResponse.json(status);
}
