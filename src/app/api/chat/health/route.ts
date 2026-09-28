import { NextResponse } from "next/server";
import { getKnowledgeStats } from "@/lib/chatbot-knowledge-base";
import { getChatbotModel, getChatbotProvider, isLlmAvailable, getConfiguredProviders } from "@/lib/multi-llm";

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
 *   - status: "healthy" if the knowledge base loaded + Groq LLM is available.
 *   - knowledgeBase: live stats from getKnowledgeStats().
 *   - llmProvider: "groq" (no z.ai dependency).
 *   - model: configured model (default: llama-3.3-70b-versatile).
 *   - rateLimit: { limit: 20, window: "1m" }.
 */
export async function GET() {
  let status: "healthy" | "degraded" = "healthy";
  let knowledgeBase: ReturnType<typeof getKnowledgeStats> | null = null;
  let llmAvailable: boolean | null = null;
  let error: string | undefined;

  try {
    knowledgeBase = getKnowledgeStats();
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

  // Check LLM availability across all providers
  let llmProvider: string | null = null;
  try {
    const result = await isLlmAvailable();
    llmAvailable = result.available;
    llmProvider = result.provider;
    if (!llmAvailable) status = "degraded";
  } catch {
    llmAvailable = false;
    status = "degraded";
  }

  return NextResponse.json(
    {
      status,
      timestamp: new Date().toISOString(),
      knowledgeBase,
      llmProvider: getChatbotProvider(),
      llmProviders: getConfiguredProviders(),
      activeProvider: llmProvider,
      model: getChatbotModel(),
      llmAvailable,
      rateLimit: { limit: 20, window: "1m" },
      ...(error ? { error: error.slice(0, 300) } : {}),
    },
    { status: status === "healthy" ? 200 : 503, headers: CORS_HEADERS },
  );
}
