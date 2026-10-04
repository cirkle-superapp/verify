import { NextResponse } from "next/server";
import { createChatCompletion, isLlmAvailable, getConfiguredProviders } from "@/lib/multi-llm";

export const runtime = "nodejs";

/**
 * GET /api/debug-fetch — test if the LLM providers are reachable
 *
 * Tests all configured AI providers (Groq, OpenRouter, NVIDIA, HuggingFace)
 * to verify API keys are working and the platform can generate real LLM
 * responses.
 */
export async function GET() {
  const results: any = {
    timestamp: new Date().toISOString(),
    providers: getConfiguredProviders(),
    tests: [],
  };

  // Test 1: Check if any LLM provider is available
  try {
    const t0 = Date.now();
    const avail = await isLlmAvailable();
    results.tests.push({
      test: "isLlmAvailable",
      available: avail.available,
      activeProvider: avail.provider,
      latency: Date.now() - t0,
    });
  } catch (e: any) {
    results.tests.push({
      test: "isLlmAvailable",
      error: e.message,
    });
  }

  // Test 2: Try a real chat completion
  try {
    const t0 = Date.now();
    const result = await createChatCompletion({
      messages: [{ role: "user", content: "Say hello in 3 words" }],
      maxTokens: 20,
    });
    results.tests.push({
      test: "createChatCompletion",
      ok: true,
      provider: result.provider,
      model: result.model,
      latency: result.latencyMs,
      response: result.content.slice(0, 100),
      usage: result.usage,
    });
  } catch (e: any) {
    results.tests.push({
      test: "createChatCompletion",
      error: e.message,
    });
  }

  return NextResponse.json(results);
}
