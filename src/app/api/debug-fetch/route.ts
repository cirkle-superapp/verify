import { NextResponse } from "next/server";
import { processMessage } from "@/lib/custom-nlp";

export const runtime = "nodejs";

/**
 * GET /api/debug-fetch — test the self-hosted NLP engine
 *
 * The Cirkle platform IS the API. This endpoint tests the custom NLP
 * engine (TF-IDF + intent classification + response generation).
 * Zero external API calls.
 */
export async function GET() {
  const start = Date.now();
  try {
    const result = await processMessage("What security features does the Egyptian national ID have?");
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      engine: "custom-nlp",
      model: "cirkle-nlp-v1",
      externalApiCalls: 0,
      test: {
        query: "What security features does the Egyptian national ID have?",
        intent: result.intent,
        latencyMs: result.processingTimeMs,
        sourcesCount: result.sources.length,
        response: result.response.slice(0, 200),
        followUps: result.followUps,
      },
      totalLatencyMs: Date.now() - start,
    });
  } catch (e: any) {
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      engine: "custom-nlp",
      error: e.message,
      totalLatencyMs: Date.now() - start,
    });
  }
}
