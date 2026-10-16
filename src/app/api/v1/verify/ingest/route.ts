import { NextRequest, NextResponse } from "next/server";
import { ingestResource } from "@/lib/ingestion-pipeline";
import { getAllSourcesV2, getApprovedSources, getDownloadableSources, upgradeSourceState } from "@/lib/source-registry-v2";

export const runtime = "nodejs";
export const maxDuration = 60;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET() {
  return NextResponse.json({
    sources: getAllSourcesV2(),
    approved: getApprovedSources().length,
    downloadable: getDownloadableSources().length,
    summary: {
      total: getAllSourcesV2().length,
      approved: getApprovedSources().length,
      downloadable: getDownloadableSources().length,
    },
  }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sourceId, dryRun, action } = body;

    if (action === "upgrade" && sourceId) {
      const result = upgradeSourceState(sourceId, body.newState, body.notes);
      return NextResponse.json(result, { headers: CORS });
    }

    if (!sourceId) {
      return NextResponse.json({ error: "sourceId required" }, { status: 400, headers: CORS });
    }

    const result = await ingestResource(sourceId, { dryRun: dryRun || false });
    return NextResponse.json(result, { headers: CORS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500, headers: CORS });
  }
}
