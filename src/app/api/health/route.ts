import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/health — health check for uptime monitoring
export async function GET() {
  const started = Date.now();
  try {
    // Test DB connection
    let dbOk = false;
    let dbLatency = 0;
    try {
      const { db } = await import("@/lib/db");
      const t0 = Date.now();
      await db.verification.findMany({ take: 1 });
      dbLatency = Date.now() - t0;
      dbOk = true;
    } catch (e: any) {
      dbOk = false;
    }

    // Check VLM SDK availability
    let vlmOk = false;
    try {
      const ZAI = (await import("z-ai-web-dev-sdk")).default;
      vlmOk = !!ZAI;
    } catch {
      vlmOk = false;
    }

    const status = dbOk ? "healthy" : "degraded";
    const httpStatus = dbOk ? 200 : 503;

    return NextResponse.json(
      {
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime ? `${Math.floor(process.uptime())}s` : "unknown",
        checks: {
          database: {
            ok: dbOk,
            latency: dbLatency > 0 ? `${dbLatency}ms` : "n/a",
            type: process.env.DATABASE_URL?.startsWith("libsql:") ? "turso" : "sqlite",
          },
          vlm: { ok: vlmOk, provider: "z-ai-web-dev-sdk" },
          rateLimit: { ok: true, type: "in-memory" },
        },
        version: "1.0.0",
      },
      { status: httpStatus }
    );
  } catch (e: any) {
    return NextResponse.json(
      { status: "unhealthy", error: e?.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }
}
