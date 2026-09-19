import { NextResponse } from "next/server";
import { getKnowledgeStats } from "@/lib/chatbot-knowledge-base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * GET /api/chat/health — chatbot service health.
 *
 * Reports:
 *   - status: "healthy" if the knowledge base loaded and stats are present.
 *   - knowledgeBase: live stats from getKnowledgeStats().
 *   - llmProvider: "z-ai-web-dev-sdk".
 *   - model: "glm-4-plus".
 *   - rateLimit: { limit: 20, window: "1m" }.
 */
export async function GET() {
  let status: "healthy" | "degraded" = "healthy";
  let knowledgeBase: ReturnType<typeof getKnowledgeStats> | null = null;
  let error: string | undefined;

  try {
    knowledgeBase = getKnowledgeStats();
    // Sanity check: if any of these are zero, mark degraded.
    if (
      !knowledgeBase ||
      knowledgeBase.docSpecs === 0 ||
      knowledgeBase.idValidators === 0 ||
      knowledgeBase.crossFieldChecks === 0
    ) {
      status = "degraded";
    }
  } catch (e) {
    status = "degraded";
    error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      knowledgeBase,
      llmProvider: "z-ai-web-dev-sdk",
      model: "glm-4-plus",
      rateLimit: { limit: 20, window: "1m" },
      ...(error ? { error: error.slice(0, 300) } : {}),
    },
    { status: status === "healthy" ? 200 : 503, headers: CORS_HEADERS },
  );
}
