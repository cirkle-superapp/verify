/**
 * Multi-provider LLM client for the Cirkle chatbot.
 *
 * Replaces the z-ai-web-dev-sdk dependency entirely. Uses OpenAI-compatible
 * API directly via fetch (no SDK dependency).
 *
 * Provider priority (tries in order, uses first that works):
 *   1. Groq (api.groq.com) — ultra-fast, free tier
 *   2. OpenRouter (openrouter.ai) — multi-model gateway
 *   3. NVIDIA (integrate.api.nvidia.com) — enterprise models
 *   4. HuggingFace (api-inference.huggingface.co) — open models
 *
 * All 4 use OpenAI-compatible chat completions API.
 * No z.ai dependency.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  provider: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  latencyMs: number;
}

const TIMEOUT_MS = 30_000;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

/**
 * Get the list of configured LLM providers in priority order.
 */
function getProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // 1. Groq (fastest, free)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey !== "PLACEHOLDER") {
    providers.push({
      name: "groq",
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: groqKey,
      model: process.env.CHATBOT_LLM_MODEL || "llama-3.3-70b-versatile",
    });
  }

  // 2. OpenRouter (multi-model gateway)
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && openrouterKey !== "PLACEHOLDER") {
    providers.push({
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: openrouterKey,
      model: "meta-llama/llama-3.3-70b-instruct:free",
    });
  }

  // 3. NVIDIA (enterprise)
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  if (nvidiaKey && nvidiaKey !== "PLACEHOLDER") {
    providers.push({
      name: "nvidia",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: nvidiaKey,
      model: "meta/llama-3.1-70b-instruct",
    });
  }

  // 4. HuggingFace (open models via OpenAI-compatible router)
  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (hfKey && hfKey !== "PLACEHOLDER") {
    providers.push({
      name: "huggingface",
      baseUrl: "https://router.huggingface.co/v1",
      apiKey: hfKey,
      model: "meta-llama/Llama-3.3-70B-Instruct",
    });
  }

  return providers;
}

/**
 * Create a chat completion using the first available provider.
 * Tries providers in priority order, returns the first successful response.
 */
export async function createChatCompletion(
  options: ChatCompletionOptions,
): Promise<ChatCompletionResult> {
  const providers = getProviders();
  if (providers.length === 0) {
    throw new Error("No LLM provider configured (need GROQ_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, or HUGGINGFACE_API_KEY)");
  }

  const temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const customModel = options.model;

  let lastError: string | null = null;

  for (const provider of providers) {
    const model = customModel || provider.model;
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      };
      // OpenRouter requires these optional headers for ranking
      if (provider.name === "openrouter") {
        headers["HTTP-Referer"] = "https://cirkle-verify.vercel.app";
        headers["X-Title"] = "Cirkle Identity Verification";
      }

      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: options.messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        lastError = `${provider.name} ${res.status}: ${text.slice(0, 200)}`;
        continue; // try next provider
      }

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || "";
      if (!content.trim()) {
        lastError = `${provider.name} returned empty content`;
        continue;
      }

      return {
        content,
        model: data?.model || model,
        provider: provider.name,
        usage: data?.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        latencyMs: Date.now() - start,
      };
    } catch (e: any) {
      clearTimeout(timeout);
      lastError = `${provider.name}: ${e?.name === "AbortError" ? "timeout" : (e?.message || String(e)).slice(0, 150)}`;
      continue; // try next provider
    }
  }

  throw new Error(`All LLM providers failed. Last error: ${lastError}`);
}

/**
 * Check if any LLM provider is available.
 * Tests each provider's /models endpoint (doesn't cost tokens).
 */
export async function isLlmAvailable(): Promise<{ available: boolean; provider: string | null }> {
  const providers = getProviders();
  for (const provider of providers) {
    try {
      const res = await fetch(`${provider.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        return { available: true, provider: provider.name };
      }
    } catch {
      // try next
    }
  }
  return { available: false, provider: null };
}

/**
 * Get the configured chatbot model name (first provider's model).
 */
export function getChatbotModel(): string {
  const providers = getProviders();
  return providers[0]?.model || "llama-3.3-70b-versatile";
}

/**
 * Get the configured chatbot provider name (first provider).
 */
export function getChatbotProvider(): string {
  const providers = getProviders();
  return providers[0]?.name || "groq";
}

/**
 * Get the list of all configured providers.
 */
export function getConfiguredProviders(): string[] {
  return getProviders().map((p) => p.name);
}
