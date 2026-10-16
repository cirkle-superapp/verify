import { NextResponse } from "next/server";
import { getAllSources, getSourceRegistrySummary } from "@/lib/global-source-registry";

export const runtime = "nodejs";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET() {
  return NextResponse.json({
    sources: getAllSources(),
    summary: getSourceRegistrySummary(),
  }, { headers: CORS });
}
