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
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * GET /api/chat/health — chatbot service health.
 *
 * The Cirkle chatbot is powered by a custom NLP engine (cirkle-nlp-v1)
 * built from scratch — zero external API calls. No Groq, OpenRouter,
 * NVIDIA, HuggingFace, or Gemini dependencies.
 *
 * Reports:
 *   - status: "healthy" if the knowledge base loaded.
 *   - knowledgeBase: live stats.
 *   - engine: "custom-nlp" (built from scratch).
 *   - model: "cirkle-nlp-v1".
 *   - latency: <5ms per query (no network calls).
 *   - rateLimit: { limit: 20, window: "1m" }.
 */
export async function GET() {
  let status: "healthy" | "degraded" = "healthy";
  let knowledgeBase: ReturnType<typeof getKnowledgeStats> | null = null;
  let error: string | undefined;

  try {
    knowledgeBase = getKnowledgeStats();
    if (!knowledgeBase || knowledgeBase.docSpecs === 0 || knowledgeBase.idValidators === 0) {
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
      engine: "custom-nlp",
      model: "cirkle-nlp-v1",
      externalApiCalls: 0,
      privacyFirst: true,
      rateLimit: { limit: 20, window: "1m" },
      ...(error ? { error: error.slice(0, 300) } : {}),
    },
    { status: status === "healthy" ? 200 : 503, headers: CORS_HEADERS },
  );
}
