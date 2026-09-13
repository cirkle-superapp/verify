import { NextResponse } from "next/server";
import { isConsensusModeActive, getConfiguredProviders } from "@/lib/vlm-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports the live AI consensus configuration:
 *   - whether consensus mode is active (any AI provider configured)
 *   - which unique provider BRANDS are configured (5 max: gemini, groq, openrouter, nvidia, huggingface)
 *   - which providers are used for vision vs text
 *
 * Used by the UI to show the "Cross-checked by N AI providers" badge
 * with the actual provider count, even before a verification runs.
 */
export async function GET() {
  const active = isConsensusModeActive();
  const allRoles = getConfiguredProviders();

  // Group provider roles into unique brands for display
  // (NVIDIA contributes 2 roles — vision + text — but is 1 brand)
  const brandMap: Record<string, { brand: string; roles: string[] }> = {};
  for (const p of allRoles) {
    const brand =
      p.startsWith("gemini") ? "Gemini" :
      p.startsWith("groq") ? "Groq" :
      p.startsWith("openrouter") ? "OpenRouter" :
      p.startsWith("nvidia") ? "NVIDIA" :
      p.startsWith("huggingface") || p === "huggingface" ? "HuggingFace" :
      p;
    if (!brandMap[brand]) brandMap[brand] = { brand, roles: [] };
    brandMap[brand].roles.push(p);
  }
  const brands = Object.values(brandMap);
  const brandNames = brands.map((b) => b.brand);

  const visionProviders = allRoles.filter((p) =>
    ["gemini-2.5-flash", "openrouter-ling-vl", "nvidia-llama-vision"].includes(p)
  );
  const textProviders = allRoles.filter((p) =>
    ["groq-llama-3.3-70b", "gemini-2.5-flash", "nvidia-deepseek-v4", "openrouter-ling", "huggingface"].includes(p)
  );

  // totalProviders = unique brands (for the UI badge "N AI providers consensus")
  const totalProviders = brands.length;

  return NextResponse.json({
    consensusActive: active,
    providers: allRoles,
    brands: brandNames,
    visionProviders,
    textProviders,
    totalProviders,
    message: active
      ? `Cross-checking with ${totalProviders} AI provider${totalProviders === 1 ? "" : "s"}: ${brandNames.join(", ")}`
      : "Self-hosted only — set AI provider keys in .env to enable multi-provider consensus cross-checking",
  });
}
