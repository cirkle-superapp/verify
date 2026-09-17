import { NextResponse } from "next/server";
import { supportedCountries } from "@/lib/id-validators";
import { getSpecsStats } from "@/lib/doc-specs/catalog";

export const runtime = "nodejs";

/**
 * GET /api/v1/verify/model-card
 *
 * Model card — system capabilities summary (like DeepSeek/ChatGPT model cards).
 * Shows the full knowledge base, training data, architecture, and performance
 * characteristics of the Cirkle Verify identity verification system.
 */
export async function GET() {
  const countries = supportedCountries();
  const specs = getSpecsStats();

  return NextResponse.json({
    model: "Cirkle Verify v2.2.0",
    description: "Zero-cost, edge-first, AI-consensus identity verification for Egyptian, Arabic, and international documents",
    releasedAt: "2026-09-17",
    license: "Zero-cost-by-default with fail-closed quota protection",
    capabilities: {
      documentExtraction: {
        countries: countries.length,
        docTypes: ["national_id", "passport", "driver_license", "residence"],
        algorithms: [
          "AI consensus (5 providers cross-checking in parallel)",
          "OCR post-processing (Levenshtein + confusion correction)",
          "MRZ parsing (ICAO 9303 TD1/TD2/TD3)",
          "Rule-based field extraction (doc-specs catalog)",
        ],
        languages: ["Arabic", "English", "French", "German", "Spanish", "Italian", "Turkish", "Hindi", "Portuguese"],
      },
      idValidation: {
        countries: countries.length,
        algorithms: ["Luhn", "ISO 7064 MOD 11-2/11-10", "Verhoeff", "mod-10/11/23/26/31/97", "country-specific weighted sums"],
        checksums: true,
        fieldExtraction: ["birthDate", "gender", "sequence", "century"],
      },
      crossFieldValidation: {
        checks: 17,
        categories: ["ID-gender consistency", "ID-birthDate consistency", "MRZ-match", "name script", "date sanity", "nationality-country"],
        fraudScoring: true,
      },
      faceMatching: {
        engine: "face-api.js + AI consensus (3 vision providers)",
        qualityScoring: "ISO/IEC 19794-5 (brightness, contrast, sharpness, face size, background)",
        descriptor: "128-dimensional embeddings, Euclidean distance",
      },
      livenessDetection: {
        engines: 3,
        capabilities: [
          "Directional motion analysis (4×4 block-based optical flow)",
          "Challenge-response verification (turn_left/right, look_up, blink, smile)",
          "Anti-spoofing: print attack (texture variance), screen replay (moiré), depth estimation",
          "Temporal analysis: motion smoothness (jerk), velocity profile (bell curve)",
        ],
        scoreBreakdown: "motion(0-40) + challenge(0-30) + anti-spoof(0-20) + temporal(0-10) = 0-100",
      },
      documentSecurity: {
        countries: 14,
        specs: 16,
        features: ["UV watermark", "hologram", "microprint", "ghost photo", "laser engraving", "chip", "kinegram", "thermochromic ink", "guilloche", "intaglio"],
      },
      fraudDetection: {
        checks: ["duplicate ID", "velocity", "blacklist", "age validation", "expiry check", "image reuse"],
        riskLevels: ["allow", "review", "blocked"],
      },
    },
    trainingData: {
      totalSamples: 1841,
      countries: 40,
      docTypes: { national_id: 921, passport: 352, driver_license: 312, residence: 256 },
      sources: {
        benchmark: 337,
        syntheticWorldwide: 504,
        expansionV2: 1000,
      },
      edgeCases: {
        normal: 520,
        rotated: 160,
        blurred: 160,
        dark: 160,
      },
      imageFormat: "JPEG (SVG → sharp → JPEG, 1000×640)",
    },
    architecture: {
      primary: "Turso (authoritative, epoch 41, transactional outbox)",
      recovery: "Neon (recovery projection, in_sync, no direct writes)",
      workflows: "Inngest (5 durable functions: email, SMS, outbox drain, reconciliation)",
      email: "Brevo (300/day free, P0-P4 priority governor)",
      storage: "Vercel Blob (1GB free, quota-governed)",
      sms: "Customer-funded (fail-closed, state machine)",
      edge: "Cloudflare (DNS, Workers, NOT R2)",
      hosting: "Vercel (SSR, cirkle-verify.vercel.app)",
      sourceControl: "GitHub (cirkle-superapp/verify)",
      costModel: "ZERO-COST-BY-DEFAULT · FAIL-CLOSED · NO R2 · NO RESEND",
    },
    aiConsensus: {
      providers: 5,
      brands: ["Gemini", "Groq", "OpenRouter", "NVIDIA", "HuggingFace"],
      visionProviders: 3,
      textProviders: 4,
      strategy: "Parallel calls + per-field majority vote + similarity clustering",
      gracefulDegradation: "If 0 keys: self-hosted only. If 1+ keys: AI consensus active.",
    },
    security: {
      apiKeys: "SHA-256 hashed, cvk_ format, per-key rate limiting (sliding window)",
      authHeaders: "Authorization: Bearer OR X-API-Key",
      rateLimiting: "Per-key sliding window (60s), default 60/min, 429 with Retry-After",
      adminRecovery: "X-Admin-Secret header (PLATFORM_ADMIN_SECRET env var)",
      epoch: 41,
      fencing: "Database epoch fencing prevents split-brain",
      circuitBreakers: "CLOSED/OPEN/HALF_OPEN on all dependencies",
      outboxPattern: "Transactional outbox (no dual-write to Neon)",
      webhookSigning: "HMAC-SHA256, X-Cirkle-Signature header",
      csp: "Content-Security-Policy headers",
      hsts: "Strict-Transport-Security enabled",
      inputSanitization: "All text fields sanitized before DB storage",
    },
    api: {
      totalEndpoints: 38,
      documentation: "/api/docs",
      health: "/api/health",
      modelCard: "/api/v1/verify/model-card",
      authentication: "API key required for v1 routes",
      rateLimiting: "Per-key, 429 on exceed",
    },
    competitiveAdvantage: {
      vs_onfido: "$0 vs $2-5/check, self-hosted, no vendor lock-in",
      vs_jumno: "54-country ID validation vs enterprise-only, free API keys",
      vs_deepseek: "Multi-provider consensus (5 AIs cross-check) vs single model",
      vs_chatgpt: "Specialized for KYC (ID checksums, MRZ, anti-spoof) vs general-purpose",
    },
  });
}
