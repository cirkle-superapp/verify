import { NextResponse } from "next/server";
import { isConsensusModeActive, getConfiguredProviders } from "@/lib/vlm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports the live AI consensus configuration:
 *   - whether consensus mode is active (any AI provider configured)
 *   - which providers are configured
 *   - which providers are used for vision vs text
 *
 * Used by the UI to show the "Cross-checked by N AI providers" badge
 * with the actual provider count, even before a verification runs.
 */
export async function GET() {
  const active = isConsensusModeActive();
  const providers = getConfiguredProviders();

  const visionProviders = providers.filter((p) =>
    ["gemini-2.5-flash", "openrouter-ling-vl", "nvidia-llama-vision"].includes(p)
  );
  const textProviders = providers.filter((p) =>
    ["groq-llama-3.3-70b", "gemini-2.5-flash", "nvidia-deepseek-v4", "openrouter-ling", "huggingface"].includes(p)
  );

  return NextResponse.json({
    consensusActive: active,
    providers,
    visionProviders,
    textProviders,
    totalProviders: providers.length,
    message: active
      ? `Cross-checking with ${providers.length} AI provider${providers.length === 1 ? "" : "s"}: ${providers.join(", ")}`
      : "Self-hosted only — set AI provider keys in .env to enable multi-provider consensus cross-checking",
  });
}
