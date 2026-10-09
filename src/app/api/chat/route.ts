import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  searchKnowledgeBase,
  getKnowledgeStats,
  type KnowledgeChunk,
} from "@/lib/chatbot-knowledge-base";
import { processMessage, createContext, updateContext, type Intent } from "@/lib/custom-nlp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Rate limiter (in-memory, per IP) ─────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

const RATE_BUCKETS = new Map<string, RateBucket>();
const RATE_LIMIT_PER_MIN = 20;
const RATE_WINDOW_MS = 60_000;

// Cleanup expired buckets every 60s
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of RATE_BUCKETS) {
      if (bucket.resetAt < now) RATE_BUCKETS.delete(key);
    }
  }, 60_000).unref?.();
}

function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function checkRate(req: NextRequest): { ok: true } | { ok: false; retryAfter: number } {
  const ip = getClientIp(req);
  const key = `chat:${ip}`;
  const now = Date.now();
  let bucket = RATE_BUCKETS.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    RATE_BUCKETS.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT_PER_MIN) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

// ─── CORS ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ─── Types ───────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  messages?: ChatMessage[];
  sessionId?: string;
}

// ─── System prompt builder ───────────────────────────────────────────

function buildSystemPrompt(chunks: KnowledgeChunk[]): string {
  const stats = getKnowledgeStats();
  const knowledgeBlock = chunks
    .map((c, i) => {
      return `### ${i + 1}. ${c.title}\nSource: ${c.source}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  return [
    "You are Cirkle Assistant, an expert AI chatbot for the Cirkle Identity Verification platform.",
    "",
    "You help users with questions about identity verification (KYC), document security features,",
    "ID validation, MRZ parsing, liveness detection, face matching, and the Cirkle platform.",
    "",
    `You have access to the following knowledge from the Cirkle knowledge base:`,
    `- ${stats.countries} countries with document security specs (${stats.docSpecs} total specs)`,
    `- ${stats.idValidators} country-specific ID validators (checksum algorithms)`,
    `- MRZ parser supports formats: ${stats.mrzFormats.join(", ")}`,
    `- ${stats.crossFieldChecks} cross-field validation checks`,
    `- ${stats.faceQualityDims} face image quality dimensions`,
    `- ${stats.livenessSignals} liveness / anti-spoofing PAD signals`,
    `- ${stats.aiProviders} AI consensus providers (Gemini, Groq, OpenRouter, NVIDIA, HuggingFace)`,
    "",
    "Use the following retrieved knowledge from the Cirkle knowledge base to answer the user's",
    "question. Cite the source (e.g., 'According to the document security spec for Egypt national",
    "ID...') when relevant. Be specific about country names, document types, security features,",
    "and verification layers when the question touches on them.",
    "",
    "If the user's question is not covered by the knowledge base (e.g. off-topic chitchat,",
    "questions about other platforms, or speculation about future features), say so honestly.",
    "Do not make up facts or invent security features / validators that are not in the knowledge base.",
    "",
    "Be concise but thorough. Use markdown for formatting when helpful (headings, lists,",
    "bold, code blocks for MRZ / IDs).",
    "",
    "Here is the retrieved knowledge (most relevant first):",
    "",
    knowledgeBlock,
  ].join("\n");
}

/**
 * Fallback answer builder when the LLM is unavailable.
 *
 * This happens when all 4 LLM providers (Groq, OpenRouter, NVIDIA,
 * HuggingFace) are unreachable — e.g., network issues or all API keys
 * are rate-limited. When that happens, we still want the chatbot to
 * return a useful, conversational answer from the knowledge base rather
 * than just an error.
 *
 * Delegates to `generateConversationalFallback()` in
 * `src/lib/chatbot-fallback.ts`, which:
 *   1. Detects the query intent (security features, MRZ, liveness, etc.)
 *   2. Opens with a natural-language intro
 *   3. Formats the top chunk with intent-specific markdown (table / steps /
 *      definition / algorithm)
 *   4. Adds a "Related information" section with 2-3 truncated chunks
 *   5. Closes with 3 follow-up question suggestions
 *
 * Returns a markdown-formatted response string.
 */
function buildKnowledgeBaseFallback(query: string, chunks: KnowledgeChunk[]): string {
  return generateConversationalFallback(query, chunks);
}

// ─── OPTIONS (CORS preflight) ────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

// ─── POST /api/chat ───────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Rate limit
  const rate = checkRate(req);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: `Rate limit exceeded. Max ${RATE_LIMIT_PER_MIN} messages per minute.`,
        code: "rate_limited",
        retryAfter: rate.retryAfter,
      },
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          "Retry-After": String(rate.retryAfter),
        },
      },
    );
  }

  // Parse body
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body", code: "bad_request" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json(
      {
        error: "Missing 'messages' array (must be non-empty)",
        code: "bad_request",
      },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Validate each message shape
  const cleanMessages: ChatMessage[] = [];
  for (const m of body.messages) {
    if (!m || typeof m.content !== "string" || m.content.trim().length === 0) {
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") {
      return NextResponse.json(
        {
          error: `Invalid message role: ${m.role}. Must be 'user' or 'assistant'.`,
          code: "bad_request",
        },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    cleanMessages.push({ role: m.role, content: m.content });
  }
  if (cleanMessages.length === 0) {
    return NextResponse.json(
      { error: "No valid messages provided", code: "bad_request" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Cap the conversation history to the last 12 messages to control cost.
  const truncatedMessages = cleanMessages.slice(-12);

  // Extract the last user message for retrieval
  const lastUser = [...truncatedMessages]
    .reverse()
    .find((m) => m.role === "user");
  if (!lastUser) {
    return NextResponse.json(
      { error: "No user message in conversation", code: "bad_request" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // RAG step 1: retrieve top-k relevant knowledge chunks
  const query = lastUser.content;
  let chunks: KnowledgeChunk[] = [];
  try {
    chunks = searchKnowledgeBase(query, 8);
  } catch (e) {
    // Retrieval failures should not block the chat — fall back to no context.
    console.error("[chat] knowledge-base retrieval failed:", e);
    chunks = [];
  }

  // ═══ Custom NLP Engine — built from scratch, zero external API calls ═══
  // The Cirkle platform IS the API. No Groq, OpenRouter, NVIDIA, HuggingFace,
  // or Gemini dependencies. Pure TypeScript NLP: tokenize → stem → TF-IDF →
  // intent classify → generate response. <5ms latency. Always cites sources.
  const nlpResult = await processMessage(query);

  const sessionId = body.sessionId || randomUUID();
  const latencyMs = Date.now() - startTime;

  return NextResponse.json(
    {
      response: nlpResult.response,
      sources: nlpResult.sources,
      sessionId,
      model: "cirkle-nlp-v1",
      provider: "cirkle-engine",
      mode: "custom-nlp",
      intent: nlpResult.intent,
      followUps: nlpResult.followUps,
      llmError: null,
      timestamp: new Date().toISOString(),
      latencyMs,
    },
    { status: 200, headers: CORS_HEADERS },
  );
}

// ─── GET /api/chat (info) ────────────────────────────────────────────

export async function GET() {
  const stats = getKnowledgeStats();
  return NextResponse.json(
    {
      service: "cirkle-assistant",
      description:
        "RAG-powered chatbot for the Cirkle Identity Verification platform. Send POST with {messages:[{role,content}]} to chat.",
      model: "cirkle-nlp-v1",
      engine: "custom-nlp (built from scratch — zero external API calls)",
      rateLimit: { limit: RATE_LIMIT_PER_MIN, window: "1m" },
      knowledgeBase: stats,
      cors: "enabled",
      usage: {
        method: "POST",
        body: {
          messages: "Array<{role: 'user'|'assistant', content: string}>",
          sessionId: "string (optional)",
        },
        response: {
          response: "string",
          sources: "Array<{title, source}>",
          sessionId: "string",
          model: "string",
          timestamp: "string (ISO)",
          latencyMs: "number",
        },
      },
    },
    { headers: CORS_HEADERS },
  );
}
