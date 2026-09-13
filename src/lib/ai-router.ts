/**
 * Unified AI Router — multi-provider, zero-cost, no z-ai dependency.
 *
 * Providers (all free tier, no billing):
 *  1. Google Gemini (gemini-2.5-flash) — vision OCR, face comparison, translation
 *  2. Groq (llama-3.3-70b) — fast text generation, Arabic translation
 *  3. OpenRouter (multi-model) — fallback for vision + text
 *  4. NVIDIA (nvapi) — GPU-accelerated inference + vision
 *  5. HuggingFace (inference API) — text generation
 *
 * All API keys are read from environment variables. If a key is not set,
 * calls to that provider throw immediately (caught by the consensus engine).
 *
 * Strategy:
 *  - Vision tasks (OCR, face match) → Gemini + OpenRouter + NVIDIA in parallel
 *  - Text tasks (translation, analysis) → Groq + Gemini + NVIDIA + OpenRouter + HuggingFace
 *  - All providers have free tiers with generous limits
 */

// ─── API Keys (from env vars ONLY — no hardcoded secrets) ─────────
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GROQ_KEY = process.env.GROQ_API_KEY || "";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const NVIDIA_KEY = process.env.NVIDIA_API_KEY || "";
const HF_KEY = process.env.HUGGINGFACE_API_KEY || "";

/** True if at least one vision provider is configured. */
export function hasVisionProviders(): boolean {
  return !!(GEMINI_KEY || OPENROUTER_KEY || NVIDIA_KEY);
}

/** True if at least one text provider is configured. */
export function hasTextProviders(): boolean {
  return !!(GROQ_KEY || GEMINI_KEY || NVIDIA_KEY || OPENROUTER_KEY || HF_KEY);
}

/** List of configured provider names (for transparency / UI). */
export function configuredProviders(): string[] {
  const list: string[] = [];
  if (GEMINI_KEY) list.push("gemini-2.5-flash");
  if (GROQ_KEY) list.push("groq-llama-3.3-70b");
  if (OPENROUTER_KEY) list.push("openrouter-ling-vl");
  if (NVIDIA_KEY) list.push("nvidia-llama-vision");
  if (HF_KEY) list.push("huggingface");
  return list;
}

// ─── Gemini (Google AI) ────────────────────────────────────────────
function geminiUrl(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
}

/** Call Gemini with image(s) + text prompt — for OCR, face comparison, document analysis */
export async function geminiVision(prompt: string, images: string[]): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not configured");
  const parts: any[] = [{ text: prompt }];
  for (const img of images) {
    const b64 = img.includes(",") ? img.split(",")[1] : img;
    const mime = img.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    parts.push({ inline_data: { mime_type: mime, data: b64 } });
  }

  const res = await fetch(geminiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini error ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

/** Call Gemini for text-only tasks — translation, analysis */
export async function geminiText(prompt: string, systemPrompt?: string): Promise<string> {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY not configured");
  const parts: any[] = [{ text: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt }];
  const res = await fetch(geminiUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!res.ok) throw new Error(`Gemini text error ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ─── Groq (ultra-fast LLM) ─────────────────────────────────────────
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Call Groq for fast text generation — translation, field extraction from text */
export async function groqText(prompt: string, systemPrompt?: string): Promise<string> {
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY not configured");
  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) throw new Error(`Groq error ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

// ─── OpenRouter (multi-model gateway) ──────────────────────────────
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Call OpenRouter with vision — fallback for Gemini */
export async function openRouterVision(prompt: string, images: string[]): Promise<string> {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY not configured");
  const content: any[] = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img } });
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: "inclusionai/ling-3.0-flash-vl:free",
      messages: [{ role: "user", content }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

/** Call OpenRouter for text — fallback for Groq */
export async function openRouterText(prompt: string, systemPrompt?: string): Promise<string> {
  if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY not configured");
  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: "inclusionai/ling-3.0-flash-vl:free",
      messages,
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

// ─── NVIDIA NIM API ────────────────────────────────────────────────
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

export async function nvidiaText(prompt: string, systemPrompt?: string): Promise<string> {
  if (!NVIDIA_KEY) throw new Error("NVIDIA_API_KEY not configured");
  const messages: any[] = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${NVIDIA_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-ai/deepseek-v4-flash-0731",
      messages,
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) throw new Error(`NVIDIA error ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

/** Call NVIDIA with vision — meta/llama-3.2-90b-vision-instruct */
export async function nvidiaVision(prompt: string, images: string[]): Promise<string> {
  if (!NVIDIA_KEY) throw new Error("NVIDIA_API_KEY not configured");
  const content: any[] = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img } });
  }
  const res = await fetch(NVIDIA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${NVIDIA_KEY}`,
    },
    body: JSON.stringify({
      model: "meta/llama-3.2-90b-vision-instruct",
      messages: [{ role: "user", content }],
      temperature: 0.1,
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA vision error ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}

// ─── HuggingFace Inference API ────────────────────────────────────
const HF_TEXT_URL = (model: string) =>
  `https://api-inference.huggingface.co/models/${model}`;

export async function huggingFaceText(prompt: string, systemPrompt?: string): Promise<string> {
  if (!HF_KEY) throw new Error("HUGGINGFACE_API_KEY not configured");
  const model = "meta-llama/Llama-3.2-3B-Instruct";
  const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
  const res = await fetch(HF_TEXT_URL(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${HF_KEY}`,
    },
    body: JSON.stringify({
      inputs: fullPrompt,
      parameters: { temperature: 0.1, max_new_tokens: 1000, return_full_text: false },
    }),
  });
  if (!res.ok) throw new Error(`HuggingFace error ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json) && json[0]?.generated_text) return json[0].generated_text;
  if (typeof json?.generated_text === "string") return json.generated_text;
  return "";
}

// ─── Unified failover API (single-provider, for backward compat) ────

/**
 * Vision call with automatic failover:
 * 1. Gemini (best vision, free tier)
 * 2. OpenRouter (fallback, multi-model)
 */
export async function callVision(prompt: string, images: string[]): Promise<string> {
  try {
    const result = await geminiVision(prompt, images);
    if (result && result.trim().length > 0) return result;
  } catch (e) {
    console.error("[AI Router] Gemini vision failed:", (e as any)?.message?.slice(0, 100));
  }
  try {
    const result = await openRouterVision(prompt, images);
    if (result && result.trim().length > 0) return result;
  } catch (e) {
    console.error("[AI Router] OpenRouter vision failed:", (e as any)?.message?.slice(0, 100));
  }
  return "";
}

/**
 * Text call with automatic failover:
 * 1. Groq (fastest, 500+ tokens/sec)
 * 2. Gemini (fallback)
 * 3. OpenRouter (last resort)
 */
export async function callText(prompt: string, systemPrompt?: string): Promise<string> {
  try {
    const result = await groqText(prompt, systemPrompt);
    if (result && result.trim().length > 0) return result;
  } catch (e) {
    console.error("[AI Router] Groq text failed:", (e as any)?.message?.slice(0, 100));
  }
  try {
    const result = await geminiText(prompt, systemPrompt);
    if (result && result.trim().length > 0) return result;
  } catch (e) {
    console.error("[AI Router] Gemini text failed:", (e as any)?.message?.slice(0, 100));
  }
  try {
    const result = await openRouterText(prompt, systemPrompt);
    if (result && result.trim().length > 0) return result;
  } catch (e) {
    console.error("[AI Router] OpenRouter text failed:", (e as any)?.message?.slice(0, 100));
  }
  return "";
}

/** Check if a string contains Arabic characters */
export function containsArabic(s?: string | null): boolean {
  if (!s) return false;
  return /[\u0600-\u06FF\u0750-\u077F]/.test(s);
}

/** Check if a string contains Latin characters */
export function containsLatin(s?: string | null): boolean {
  if (!s) return false;
  return /[a-zA-Z]/.test(s);
}
