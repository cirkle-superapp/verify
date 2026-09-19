import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { randomUUID } from "crypto";
import {
  searchKnowledgeBase,
  getKnowledgeStats,
  type KnowledgeChunk,
} from "@/lib/chatbot-knowledge-base";
import { ensureZaiConfig } from "@/lib/zai-config";

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
  let chunks: KnowledgeChunk[] = [];
  try {
    chunks = searchKnowledgeBase(lastUser.content, 8);
  } catch (e) {
    // Retrieval failures should not block the chat — fall back to no context.
    console.error("[chat] knowledge-base retrieval failed:", e);
    chunks = [];
  }

  // RAG step 2: build the system prompt with retrieved context
  const systemPrompt = buildSystemPrompt(chunks);

  // RAG step 3: call the LLM
  let replyText: string;
  const model = "glm-4-plus";
  try {
    // Bootstrap the z-ai config file from env vars if missing
    // (required for Vercel production where /etc/.z-ai-config doesn't exist)
    const configResult = ensureZaiConfig();
    if (!configResult.ok) {
      return NextResponse.json(
        {
          error: "LLM not configured",
          code: "llm_config_missing",
          detail: configResult.error,
        },
        { status: 503, headers: CORS_HEADERS },
      );
    }
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        ...truncatedMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ],
      thinking: { type: "disabled" },
    });
    replyText = completion?.choices?.[0]?.message?.content || "";
    if (!replyText) {
      return NextResponse.json(
        {
          error: "LLM returned an empty response",
          code: "llm_empty",
        },
        { status: 502, headers: CORS_HEADERS },
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[chat] LLM call failed:", msg);
    return NextResponse.json(
      {
        error: "LLM call failed",
        code: "llm_error",
        detail: msg.slice(0, 500),
      },
      { status: 502, headers: CORS_HEADERS },
    );
  }

  const sessionId = body.sessionId || randomUUID();
  const latencyMs = Date.now() - startTime;

  return NextResponse.json(
    {
      response: replyText,
      sources: chunks.map((c) => ({ title: c.title, source: c.source })),
      sessionId,
      model,
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
      model: "glm-4-plus",
      llmProvider: "z-ai-web-dev-sdk",
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
