import { NextResponse } from "next/server";
import { getCoverageStats, buildCoverageMatrix, getCoverageForCountry } from "@/lib/coverage-matrix";

export const runtime = "nodejs";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country");
  const stats = url.searchParams.get("stats") === "true";

  if (country) {
    return NextResponse.json({ country, entries: getCoverageForCountry(country) }, { headers: CORS });
  }

  if (stats) {
    return NextResponse.json(getCoverageStats(), { headers: CORS });
  }

  return NextResponse.json({ matrix: buildCoverageMatrix().slice(0, 100), stats: getCoverageStats() }, { headers: CORS });
}
