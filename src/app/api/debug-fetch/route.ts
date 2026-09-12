import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/debug-fetch — test if the Z.ai API is reachable from Vercel
export async function GET() {
  const results: any = {
    timestamp: new Date().toISOString(),
    env: {
      hasBaseUrl: !!process.env.ZAI_BASE_URL,
      hasApiKey: !!process.env.ZAI_API_KEY,
      hasToken: !!process.env.ZAI_TOKEN,
      baseUrl: process.env.ZAI_BASE_URL || "(not set)",
    },
    tests: [],
  };

  // Test 1: Can we reach the Z.ai API at all?
  try {
    const t0 = Date.now();
    const res = await fetch("https://internal-api.z.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
    });
    results.tests.push({
      test: "fetch internal-api.z.ai",
      status: res.status,
      ok: res.ok,
      latency: Date.now() - t0,
      body: (await res.text()).slice(0, 200),
    });
  } catch (e: any) {
    results.tests.push({
      test: "fetch internal-api.z.ai",
      error: e.message,
      cause: e.cause?.message || e.cause?.code || "unknown",
    });
  }

  // Test 2: Try with the SDK
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const t0 = Date.now();
    const response = await zai.chat.completions.create({
      messages: [{ role: "user", content: "Say hello" }],
    });
    results.tests.push({
      test: "SDK chat.completions.create",
      ok: true,
      latency: Date.now() - t0,
      response: response.choices[0]?.message?.content?.slice(0, 100),
    });
  } catch (e: any) {
    results.tests.push({
      test: "SDK chat.completions.create",
      error: e.message,
      cause: e.cause?.message || "unknown",
    });
  }

  return NextResponse.json(results, { status: 200 });
}
