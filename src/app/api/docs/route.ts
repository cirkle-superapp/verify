import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/docs
 *
 * API documentation — lists all 35+ endpoints with descriptions,
 * parameters, and example responses.
 */
export async function GET() {
  return NextResponse.json({
    name: "Cirkle Verify API",
    version: "2.2.0",
    baseUrl: "https://cirkle-verify.vercel.app",
    description: "Identity verification API with AI consensus, OCR post-processing, MRZ parsing, cross-field validation, and anti-spoofing liveness detection.",
    endpoints: {
      verification: [
        {
          method: "POST",
          path: "/api/verify/document",
          description: "Extract structured fields from a document image using AI consensus (3+ vision providers in parallel) + OCR post-processing + cross-field validation",
          body: { frontImage: "data:image/jpeg;base64,...", backImage: "data:image/jpeg;base64,... (optional)", docType: "national_id|passport|driver_license|residence" },
          response: { data: "ExtractedDocumentData", engine: "consensus-merged", consensus: "ConsensusInfo", providers: "string[]" },
        },
        {
          method: "POST",
          path: "/api/verify/face-match",
          description: "Compare selfie to document photo using self-hosted face-api + AI consensus (3 vision providers cross-check)",
          body: { selfie: "data:image/jpeg;base64,...", docImage: "data:image/jpeg;base64,..." },
          response: { result: "FaceMatchResult", engine: "consensus-merged" },
        },
        {
          method: "POST",
          path: "/api/verify/liveness",
          description: "Liveness detection with 3 engines: self-hosted + Liveness Pro (directional+anti-spoof) + AI consensus",
          body: { frames: "string[] (data URLs)", actions: "LivenessAction[]" },
          response: { result: "LivenessResult", proBreakdown: "LivenessProScore" },
        },
        {
          method: "POST",
          path: "/api/verify/liveness-pro",
          description: "Standalone Liveness Pro v2 analysis: directional motion + challenge-response + anti-spoofing (print/screen/depth) + temporal + 7 new PAD signals (optical-flow consistency, LBP texture, FFT moiré, color distortion, 3D depth disparity, specular highlights, blink) + aggregate PAD score",
          body: { frames: "string[]", actions: "LivenessAction[]" },
          response: "LivenessProScore",
        },
        {
          method: "POST",
          path: "/api/verify/records",
          description: "Save verification record to Turso (authoritative) + append outbox event for Inngest → Neon replication",
          body: { docType: "string", docExtracted: "object", faceMatch: "object", liveness: "object" },
          response: { record: "object", fraudCheck: "object", crossField: "object", outboxQueued: "boolean", workflowEnqueued: "boolean" },
        },
      ],
      knowledge: [
        {
          method: "GET|POST",
          path: "/api/verify/validate-id",
          description: "Validate a national ID against 54 country-specific checksum algorithms",
          params: "GET: ?country=EG&id=29501010123456 | POST: {country, id}",
          response: { isValid: "boolean", checksumValid: "boolean", extractedFields: "object", reasoning: "string" },
        },
        {
          method: "POST",
          path: "/api/verify/parse-mrz",
          description: "Parse ICAO 9303 Machine Readable Zone (TD1/TD2/TD3) with check digit validation",
          body: { text: "P<EGYMOHAMED<<...\\n1979123158EGY..." },
          response: "MrzResult (format, country, documentNumber, name, sex, birthDate, expiryDate, checks)",
        },
        {
          method: "POST",
          path: "/api/verify/cross-check",
          description: "Cross-field validation: runs 30 consistency checks (ID format/checksum, ID-gender/birthDate/birthPlace, name scripts, Arabic name dictionary, MRZ TD1/2/3 checksums, MRZ-name/docnum/nationality/birthDate/gender/expiry match, age plausibility, document validity period, issue date plausibility, issue-after-birth, photo-gender heuristic, name length sanity, required-field presence, date format, gender enum, document-number format, issue-place plausibility, cross-language name similarity, expiry-recently-issued)",
          body: "CrossFieldInput {fullNameAr, fullNameEn, nationalId, country, birthDate, gender, expiryDate, issueDate, nationality, documentNo, mrzText, docType, birthPlace, issuePlace, photoGender, photoPresent}",
          response: { flags: "CrossFieldFlag[]", consistencyScore: "number", fraudProbability: "number", hasCritical: "boolean", securitySpec: "DocumentSecuritySpec" },
        },
        {
          method: "POST",
          path: "/api/verify/ocr-correct",
          description: "Correct OCR errors using Levenshtein distance + confusion patterns (190+ name dictionary)",
          body: { field: "fullNameAr|fullNameEn|nationalId|documentNo|nationality", value: "string" },
          response: { original: "string", corrected: "string", changed: "boolean", corrections: "array" },
        },
        {
          method: "POST",
          path: "/api/verify/face-quality",
          description: "Score face image quality on 13 dimensions (ISO/IEC 19794-5 v2): 5 legacy (brightness, contrast, sharpness, face size, background) + 8 new (pose, occlusion, lighting uniformity, color naturalness, background simplicity, face symmetry, defocus blur, motion blur) + composite quality + optional landmark-based pose estimation",
          body: { image: "data:image/jpeg;base64,...", landmarks: "optional Array<{x,y}> (5/68/468-point)" },
          response: "FaceQualityScore (5 legacy + 8 new sub-scores + overall + compositeQuality + issues + suggestions + pass)",
        },
      ],
      platform: [
        {
          method: "GET",
          path: "/api/platform/status",
          description: "Unified infrastructure + cost dashboard: epoch, database health, storage/email/SMS quotas, circuit breakers, cost model",
          response: "PlatformStatus (epoch, databases, storage, email, sms, workflows, breakers, costModel)",
        },
        {
          method: "POST",
          path: "/api/platform/outbox/drain",
          description: "Drain pending outbox events from Turso → relay to Inngest + Neon (idempotent, auth required)",
          headers: "Authorization: Bearer <INNGEST_SIGNING_KEY>",
          response: { drained: "number", inngest: "object", neon: "object" },
        },
        {
          method: "GET|POST",
          path: "/api/platform/epoch/promote",
          description: "Controlled database promotion (epoch increment, split-brain prevention). POST requires operator auth.",
          response: "EpochState (epoch, primary, fencingToken)",
        },
        {
          method: "POST",
          path: "/api/platform/notification/send",
          description: "Unified notification: send email (Brevo) and/or SMS (customer-funded) with quota governors",
          body: "NotificationRequest {recipient, message, policy, idempotencyKey}",
          response: "NotificationResult {email?, sms?, delivered, deferred}",
        },
      ],
      integration: [
        {
          method: "GET|POST|DELETE",
          path: "/api/v1/api-keys",
          description: "API key management. POST creates key (bootstrap: first key no auth, subsequent need admin or X-Admin-Secret). GET lists keys (admin). DELETE revokes by keyId.",
          auth: "X-Admin-Secret header for bootstrap recovery, or valid API key for admin operations",
          body: { name: "string", email: "string", rateLimitPerMin: "number (default 60)" },
          response: { rawKey: "cvk_xxx (shown ONCE)", keyId: "key_xxx" },
        },
        {
          method: "GET|POST",
          path: "/api/v1/verify/webhook",
          description: "Register webhook URL for external integrations. Events: verification.completed/rejected/saved/fraud.detected. HMAC-SHA256 signed, 3 retries with exponential backoff.",
          body: { url: "https://...", events: "string[]", secret: "string (min 16 chars)" },
          response: { webhookId: "string", signingAlgorithm: "HMAC-SHA256", headerName: "X-Cirkle-Signature" },
        },
        {
          method: "GET",
          path: "/api/verify/consensus-status",
          description: "Report AI consensus configuration: active providers, vision vs text providers, brand names",
          response: { consensusActive: "boolean", providers: "string[]", brands: "string[]" },
        },
        {
          method: "GET",
          path: "/api/verify/specs",
          description: "Browse worldwide document specs catalog (41 specs, 32 countries)",
          response: { specs: "DocumentSpec[]", countries: "number", totalSpecs: "number" },
        },
        {
          method: "GET",
          path: "/api/verify/samples",
          description: "Browse training samples (841 samples, 28 countries, 4 doc types)",
          response: { samples: "TrainingSample[]", total: "number" },
        },
        {
          method: "GET",
          path: "/api/inngest",
          description: "Inngest SDK route — registers 5 durable workflow functions (email, SMS, outbox drain, reconciliation)",
          response: { function_count: 5, mode: "dev|cloud", has_signing_key: "boolean" },
        },
      ],
      data: [
        {
          method: "GET",
          path: "/api/verify/records",
          description: "List verification records (latest 200)",
          response: { records: "VerificationRecord[]" },
        },
        {
          method: "GET",
          path: "/api/verify/records/export",
          description: "Export verification records as CSV or JSON",
          params: "?format=csv|json",
        },
      ],
      chatbot: [
        {
          method: "POST",
          path: "/api/chat",
          description: "RAG-powered chatbot. Searches the Cirkle knowledge base (132 doc specs across 73 countries, 54 ID validators, MRZ TD1/TD2/TD3, 30 cross-field checks, OCR patterns, 13 face-quality dimensions, 9 liveness PAD signals, 5 AI consensus providers, verification certificate, risk-adaptive) for the top 8 relevant chunks, then sends those + the conversation history to glm-4-plus via z-ai-web-dev-sdk as a system prompt.",
          body: { messages: "Array<{role: 'user'|'assistant', content: string}>", sessionId: "string (optional)" },
          response: { response: "string", sources: "Array<{title, source}>", sessionId: "string", model: "glm-4-plus", timestamp: "string (ISO)", latencyMs: "number" },
          rateLimit: "20 messages per minute per IP (in-memory)",
          cors: "enabled (Access-Control-Allow-Origin: *)",
        },
        {
          method: "GET",
          path: "/api/chat",
          description: "Chatbot service info + usage instructions + live knowledge-base stats.",
          response: "ChatInfo (service, model, llmProvider, rateLimit, knowledgeBase, usage)",
        },
        {
          method: "GET",
          path: "/api/chat/health",
          description: "Chatbot service health: status (healthy|degraded), live knowledge-base stats, llmProvider, model, rateLimit.",
          response: "ChatHealth { status, knowledgeBase: KnowledgeStats, llmProvider: 'z-ai-web-dev-sdk', model: 'glm-4-plus', rateLimit: { limit: 20, window: '1m' } }",
        },
      ],
    },
    authentication: {
      type: "API Key",
      header: "Authorization: Bearer cvk_xxx OR X-API-Key: cvk_xxx",
      keyFormat: "cvk_<48 hex chars>",
      protectedRoutes: [
        "POST /api/v1/verify/batch",
        "POST /api/v1/verify/fraud-check",
        "GET|POST /api/v1/verify/session",
        "GET /api/v1/verify/analytics",
        "GET /api/v1/api-keys (admin)",
        "POST /api/v1/api-keys (first key = bootstrap, subsequent = admin)",
      ],
      rateLimiting: {
        type: "Per-key sliding window (60s)",
        default: "60 requests/minute",
        headers: "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After (on 429)",
        exceededResponse: "429 { error, code: 'rate_limited', retryAfter, limit }",
      },
      adminRecovery: "X-Admin-Secret header (PLATFORM_ADMIN_SECRET env var) for bootstrap recovery",
      security: "Raw keys never stored in DB — only SHA-256 hashes",
    },
    knowledgeBase: {
      idValidators: "54 countries with checksum algorithms (Luhn, ISO 7064, Verhoeff, mod-11/23/26/31/97)",
      mrzParser: "ICAO 9303 TD1/TD2/TD3 with check digit validation",
      crossFieldValidation: "30 consistency checks (ID format/checksum, ID-gender/birthDate/birthPlace, name scripts, Arabic name dictionary, MRZ TD1/2/3 checksums, MRZ field matches, age plausibility, document validity period, issue date plausibility, issue-after-birth, photo-gender heuristic, name length, required fields, date format, gender enum, document-number format, issue-place plausibility, cross-language name similarity, expiry-recently-issued)",
      ocrPostProcessing: "Levenshtein + confusion patterns (O→0, l→1, S→5), 190+ name dictionary",
      faceQuality: "ISO/IEC 19794-5 (brightness, contrast, sharpness, face size, background)",
      livenessPro: "Directional motion + challenge-response + anti-spoof (print, screen, depth) + temporal",
      documentSecurity: "16 specs (14 countries): UV watermark, hologram, microprint, chip, kinegram",
      trainingData: "841 samples (337 benchmark Egyptian + 504 worldwide 28 countries)",
    },
    architecture: {
      primary: "Turso (authoritative, epoch 41)",
      recovery: "Neon (recovery projection, in_sync, no direct writes)",
      workflows: "Inngest (5 durable functions, idempotent, step-level replay)",
      email: "Brevo (300/day free, P0-P4 priority governor)",
      storage: "Vercel Blob (1GB free, quota-governed, fail-closed)",
      sms: "Customer-funded (explicit authorization required, fail-closed)",
      ai: "5-provider consensus (Gemini, Groq, OpenRouter, NVIDIA, HuggingFace)",
      costModel: "ZERO-COST-BY-DEFAULT · FAIL-CLOSED · NO R2 · NO RESEND",
    },
  });
}
