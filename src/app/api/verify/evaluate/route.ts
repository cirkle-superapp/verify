import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/verify/evaluate — list all evaluation runs
export async function GET() {
  try {
    const runs = await db.evaluationRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 50,
      include: { results: { take: 0 } as any },
    });
    return NextResponse.json({ runs });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// POST /api/verify/evaluate — create a new evaluation run over all samples
// Body: { name?: string, concurrency?: number, sampleIds?: string[] }
// Returns: the created run (status "running"). The client then POSTs each
// sample to /api/verify/evaluate/run for actual processing.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = body.name || `Stress test ${new Date().toLocaleString()}`;
    const concurrency = Math.max(1, Math.min(8, body.concurrency || 1));

    // count target samples
    const where = body.sampleIds?.length ? { id: { in: body.sampleIds } } : {};
    const total = await db.documentSample.count({ where });

    const run = await db.evaluationRun.create({
      data: {
        name,
        status: "running",
        totalSamples: total,
        completedSamples: 0,
        passedSamples: 0,
        avgDocTimeMs: 0,
        avgQualityScore: 0,
        overallAccuracy: 0,
        concurrency,
      },
    });
    return NextResponse.json({ run });
  } catch (e: any) {
    console.error("[/api/verify/evaluate POST]", e);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
