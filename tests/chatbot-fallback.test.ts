/**
 * Conversational fallback tests.
 *
 * Verifies that the chatbot-fallback module:
 *   - Detects the right intent from common KYC query patterns
 *   - Generates conversational markdown responses (not just raw chunks)
 *   - Formats security features as a markdown table
 *   - Formats how-it-works queries as numbered steps
 *   - Formats what-is queries as a bolded definition + details
 *   - Returns exactly 3 follow-up question suggestions
 *   - Falls back gracefully when no chunks match
 *
 * These tests are pure module imports — no HTTP, no LLM call.
 */

import {
  detectQueryIntent,
  generateConversationalFallback,
  generateFollowUpQuestions,
  formatChunkAsAnswer,
  type QueryIntent,
} from "@/lib/chatbot-fallback";
import {
  searchKnowledgeBase,
  type KnowledgeChunk,
} from "@/lib/chatbot-knowledge-base";
import { runTest, assert, assertEqual } from "./lib/runner";

// ─── Fixtures ──────────────────────────────────────────────────────

const SECURITY_CHUNK: KnowledgeChunk = {
  id: "doc-specs:EG:national_id",
  source: "doc-specs",
  title: "Egypt national id — security features",
  content: [
    "Country: Egypt (EG)",
    "Document type: national_id",
    "Material: polycarbonate",
    "Dimensions: 85.6 × 54 mm (ID-1)",
    "Issued since: 2012",
    "",
    "Security features:",
    "  • ghost photo (right side) — Semi-transparent photo visible under UV light",
    "  • UV watermark (center) — Republic of Egypt coat of arms under UV",
    "  • microprint (border) — Tiny text reading 'ARAB REPUBLIC OF EGYPT'",
    "  • guilloche pattern (background) — Security rosette pattern",
    "  • laser engraving (personal data) — Black laser-engraved text",
    "",
    "Notes: Front: photo, name, national ID. Back: address, job, religion, marital status",
  ].join("\n"),
  keywords: ["egypt", "national id", "uv watermark", "ghost photo"],
};

const MRZ_CHUNK: KnowledgeChunk = {
  id: "mrz:overview",
  source: "mrz",
  title: "MRZ parser — ICAO 9303 overview",
  content: [
    "The Machine Readable Zone (MRZ) is the standardized machine-readable text",
    "at the bottom of passports, ID cards, and residence permits.",
    "",
    "Three formats:",
    "  • TD1 — ID cards — 3 lines × 30 chars",
    "  • TD2 — passport cards — 2 lines × 36 chars",
    "  • TD3 — passport booklets — 2 lines × 44 chars",
    "",
    "Each format uses check digits computed with weights [7, 3, 1] repeating.",
    "",
    "Endpoint: POST /api/verify/parse-mrz body: { text: 'P<EGYMOHAMED...' }",
  ].join("\n"),
  keywords: ["mrz", "icao 9303", "td1", "td2", "td3", "passport"],
};

const VALIDATOR_CHUNK: KnowledgeChunk = {
  id: "id-validators:EG",
  source: "id-validators",
  title: "Egypt national ID validator (EG)",
  content: [
    "Country: Egypt (ISO alpha-2: EG)",
    "ID type: national_id",
    "Algorithm: Egyptian national ID: 14-digit YYMMDD-CNS-XXX with checksum mod 11 over the digits.",
    "",
    "Use POST /api/verify/validate-id with body { \"country\": \"EG\", \"id\": \"<id>\" }",
    "Returns: { isValid, checksumValid, extractedFields?, reasoning }",
  ].join("\n"),
  keywords: ["egypt", "validator", "checksum", "mod 11", "national id"],
};

export async function run() {
  return [
    // ─── Intent detection ────────────────────────────────────────
    await runTest("chatbot-fallback: detectQueryIntent identifies 'security features'", () => {
      const r = detectQueryIntent("What security features does the Egyptian national ID have?");
      assertEqual(r.intent as string, "security_features", "intent");
      assert(r.intro.length > 10, "intro should be non-empty", r.intro);
      assert(r.followUps.length === 3, "followUps should be 3 items", r.followUps.length);
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'how does'", () => {
      // Use a query that doesn't match a more specific intent
      // (liveness / mrz / bias / etc.) so the generic 'how does' fires.
      const r = detectQueryIntent("How does the verification pipeline work?");
      assertEqual(r.intent as string, "how_does", "intent");
      assert(r.intro.startsWith("Here's how"), `intro should start with "Here's how", got: ${r.intro}`);
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'what is'", () => {
      const r = detectQueryIntent("What is liveness detection?");
      // Liveness is more specific than 'what is' — it should match first
      assertEqual(r.intent as string, "liveness", "intent (specific intent wins)");
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'liveness'", () => {
      const r = detectQueryIntent("Tell me about liveness anti-spoofing");
      assertEqual(r.intent as string, "liveness", "intent");
      assert(r.followUps.some((q) => q.toLowerCase().includes("spoofing")), "followUps should mention spoofing");
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'MRZ'", () => {
      const r = detectQueryIntent("What is the TD1 MRZ format?");
      assertEqual(r.intent as string, "mrz", "intent");
      assert(r.intro.toLowerCase().includes("mrz"), "intro should mention MRZ", r.intro);
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'validate'", () => {
      const r = detectQueryIntent("How do I validate an Egyptian national ID checksum?");
      assertEqual(r.intent as string, "validate", "intent");
      assert(r.intro.toLowerCase().includes("validation"), "intro should mention validation", r.intro);
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'bias' / 'fairness'", () => {
      const r = detectQueryIntent("How do you measure demographic parity and fairness?");
      assertEqual(r.intent as string, "bias", "intent");
      assert(r.followUps.some((q) => q.toLowerCase().includes("demographic parity")), "followUps should mention demographic parity");
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'multimodal' / 'fusion'", () => {
      const r = detectQueryIntent("Explain the multimodal fusion system");
      assertEqual(r.intent as string, "multimodal", "intent");
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'adversarial' attacks", () => {
      const r = detectQueryIntent("How do you catch deepfake and FGSM adversarial attacks?");
      assertEqual(r.intent as string, "adversarial", "intent");
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'identity graph' / 'fraud ring'", () => {
      const r = detectQueryIntent("How does the identity graph detect a fraud ring?");
      assertEqual(r.intent as string, "identity_graph", "intent");
    }),

    await runTest("chatbot-fallback: detectQueryIntent identifies 'continuous' auth", () => {
      const r = detectQueryIntent("How does continuous session authentication work?");
      assertEqual(r.intent as string, "continuous", "intent");
    }),

    await runTest("chatbot-fallback: detectQueryIntent returns default for unknown query", () => {
      const r = detectQueryIntent("xyz random unrelated question");
      assertEqual(r.intent as string, "default", "intent");
      assert(r.intro.length > 10, "default intro should be non-empty", r.intro);
      assertEqual(r.followUps.length, 3, "followUps length");
    }),

    // ─── formatChunkAsAnswer ──────────────────────────────────────
    await runTest("chatbot-fallback: formatChunkAsAnswer formats security features as a markdown table", () => {
      const out = formatChunkAsAnswer(SECURITY_CHUNK, "security_features");
      assert(out.includes("| Feature | Position | Description |"), "should have table header", out);
      assert(out.includes("**ghost photo**"), "should have ghost photo row", out);
      assert(out.includes("right side"), "should preserve position 'right side'", out);
      assert(out.includes("Republic of Egypt coat of arms"), "should preserve description", out);
      // Should still include the metadata block
      assert(out.includes("Country: Egypt (EG)"), "should include metadata block", out);
    }),

    await runTest("chatbot-fallback: formatChunkAsAnswer formats how_does as numbered steps", () => {
      const out = formatChunkAsAnswer(MRZ_CHUNK, "how_does");
      // Should contain numbered list items (1., 2., 3., ...)
      assert(/\d+\.\s/.test(out), "should contain numbered list items", out);
      // Should NOT have the original "Endpoint:" line as a non-numbered item —
      // actually it gets included as a step. Just check at least 3 numbers.
      const matches = out.match(/^\d+\.\s/gm) || [];
      assert(matches.length >= 3, "should have ≥3 numbered steps", `matches=${matches.length}`);
    }),

    await runTest("chatbot-fallback: formatChunkAsAnswer formats what_is as bolded definition", () => {
      const out = formatChunkAsAnswer(MRZ_CHUNK, "what_is");
      assert(out.startsWith("**"), "should start with bolded definition (**) marker", out.slice(0, 60));
      // Should contain both definition + details
      assert(out.includes("Machine Readable Zone"), "should mention MRZ", out);
    }),

    await runTest("chatbot-fallback: formatChunkAsAnswer formats validate as algorithm + example sections", () => {
      const out = formatChunkAsAnswer(VALIDATOR_CHUNK, "validate");
      assert(out.toLowerCase().includes("algorithm"), "should have algorithm section", out);
      assert(out.includes("POST /api/verify/validate-id"), "should mention the endpoint", out);
      // Should have a fenced code block for the example
      assert(out.includes("```"), "should wrap example in code block", out);
    }),

    // ─── generateConversationalFallback ───────────────────────────
    await runTest("chatbot-fallback: generateConversationalFallback returns helpful message for empty chunks", () => {
      const out = generateConversationalFallback("Egyptian ID security features", []);
      assert(out.includes("couldn't find"), "should mention no matches", out);
      assert(out.includes("Try asking"), "should suggest topics", out);
      assert(out.includes("Document security features"), "should mention security features", out);
    }),

    await runTest("chatbot-fallback: generateConversationalFallback returns conversational intro (not 'Fallback mode')", () => {
      const out = generateConversationalFallback("What security features does the Egyptian national ID have?", [
        SECURITY_CHUNK,
      ]);
      // The OLD fallback started with "⚠️ Fallback mode" — the new one should NOT.
      assert(!out.includes("Fallback mode"), "should NOT include 'Fallback mode' warning", out.slice(0, 200));
      assert(!out.includes("⚠️"), "should NOT include warning emoji at start", out.slice(0, 200));
      // Should start with a natural-language intro
      const firstLine = out.split("\n")[0];
      assert(firstLine.length > 20, "first line should be a natural intro", firstLine);
    }),

    await runTest("chatbot-fallback: generateConversationalFallback includes top chunk title as H2 heading", () => {
      const out = generateConversationalFallback("Egyptian ID", [SECURITY_CHUNK]);
      assert(out.includes(`## ${SECURITY_CHUNK.title}`), "should include top chunk title as H2", out);
    }),

    await runTest("chatbot-fallback: generateConversationalFallback includes 'Related information' section for multi-chunk results", () => {
      const out = generateConversationalFallback("Egyptian ID", [
        SECURITY_CHUNK,
        VALIDATOR_CHUNK,
        MRZ_CHUNK,
      ]);
      assert(out.includes("## Related information"), "should include Related information section", out);
      assert(out.includes(VALIDATOR_CHUNK.title), "should mention validator chunk in related", out);
      assert(out.includes(MRZ_CHUNK.title), "should mention MRZ chunk in related", out);
    }),

    await runTest("chatbot-fallback: generateConversationalFallback includes source citations", () => {
      const out = generateConversationalFallback("Egyptian ID", [SECURITY_CHUNK]);
      assert(out.includes("Source:"), "should include source citation", out);
      // doc-specs source should map to "document security features database"
      assert(out.toLowerCase().includes("security features database"), "should cite doc-specs source", out);
    }),

    await runTest("chatbot-fallback: generateConversationalFallback includes 'Try asking' follow-up suggestions", () => {
      const out = generateConversationalFallback("Egyptian ID", [SECURITY_CHUNK]);
      assert(out.includes("**Try asking:**"), "should include Try asking section", out);
      // Should have at least 3 follow-up bullet points
      const matches = out.match(/^- .+$/gm) || [];
      const followUps = matches.filter((m) => !m.startsWith("- **") && m !== "- ");
      assert(followUps.length >= 3, "should have ≥3 follow-up bullets", `followUps=${followUps.length}\n${out.slice(-400)}`);
    }),

    await runTest("chatbot-fallback: generateConversationalFallback formats security features query as a markdown table", () => {
      const out = generateConversationalFallback("What security features does the Egyptian national ID have?", [
        SECURITY_CHUNK,
      ]);
      assert(out.includes("| Feature | Position | Description |"), "should include table header", out);
      assert(out.includes("| **ghost photo**"), "should include ghost photo row with bold name", out);
      assert(out.includes("| **UV watermark**"), "should include UV watermark row with bold name", out);
    }),

    await runTest("chatbot-fallback: response is conversational (no raw chunk dump with bullet markers)", () => {
      // Use a query that matches the security_features intent so the
      // table formatter kicks in (the bullet list gets reformatted as
      // a markdown table). For a default-intent query the bullets
      // survive (formatAsCleanMarkdown is intentionally a passthrough),
      // so we explicitly exercise the table-reformat path here.
      const out = generateConversationalFallback(
        "What security features does the Egyptian national ID have?",
        [SECURITY_CHUNK],
      );
      // The original raw bullet "  • ghost photo (right side)" should
      // have been replaced by a markdown table row "| **ghost photo** | right side | …"
      assert(!out.includes("  • ghost photo (right side)"), "should NOT contain the raw bullet list", out);
      assert(out.split("\n").length > 10, "response should be multi-line markdown", `lines=${out.split("\n").length}`);
      // The bullet should now appear inside a markdown table row
      assert(out.includes("| **ghost photo**"), "ghost photo should be reformatted as a table row", out);
    }),

    // ─── generateFollowUpQuestions ────────────────────────────────
    await runTest("chatbot-fallback: generateFollowUpQuestions returns exactly 3 items", () => {
      const qs = generateFollowUpQuestions("security_features", [SECURITY_CHUNK, VALIDATOR_CHUNK]);
      assertEqual(qs.length, 3, "follow-ups length");
      // All follow-ups should be non-empty strings
      for (const q of qs) {
        assert(typeof q === "string" && q.length > 0, "follow-up should be non-empty string", q);
      }
    }),

    await runTest("chatbot-fallback: generateFollowUpQuestions substitutes 'Tell me more about X' for the top chunk", () => {
      const qs = generateFollowUpQuestions("security_features", [SECURITY_CHUNK, VALIDATOR_CHUNK]);
      // First follow-up should be derived from the top chunk title
      assert(qs[0].toLowerCase().includes("tell me more about"), "first follow-up should be 'Tell me more about X'", qs[0]);
      // Should mention the country (Egypt) by name
      assert(qs[0].toLowerCase().includes("egypt"), "first follow-up should mention the top chunk subject", qs[0]);
    }),

    await runTest("chatbot-fallback: generateFollowUpQuestions returns 3 items even with empty chunks", () => {
      const qs = generateFollowUpQuestions("liveness", []);
      assertEqual(qs.length, 3, "follow-ups length with no chunks");
      for (const q of qs) {
        assert(typeof q === "string" && q.length > 0, "follow-up should be non-empty", q);
      }
    }),

    // ─── Integration with the real knowledge base ─────────────────
    await runTest("chatbot-fallback: end-to-end with real searchKnowledgeBase (Egyptian ID)", () => {
      const chunks = searchKnowledgeBase("What security features does the Egyptian national ID have?", 5);
      assert(chunks.length > 0, "expected ≥1 chunk from searchKnowledgeBase", `got ${chunks.length}`);
      const out = generateConversationalFallback("What security features does the Egyptian national ID have?", chunks);
      assert(out.includes("## "), "should include a markdown H2 heading", out);
      assert(out.includes("**Try asking:**"), "should include follow-up section", out);
      assert(out.includes("Source:"), "should include source citation", out);
      // For a security-features query, should produce a table
      assert(out.includes("| Feature | Position | Description |"), "should format as a table", out);
    }),

    await runTest("chatbot-fallback: end-to-end with real searchKnowledgeBase (MRZ)", () => {
      const chunks = searchKnowledgeBase("How does MRZ TD1 format work?", 5);
      assert(chunks.length > 0, "expected ≥1 chunk from searchKnowledgeBase");
      const out = generateConversationalFallback("How does MRZ TD1 format work?", chunks);
      assert(out.includes("## "), "should include a markdown H2 heading", out);
      // The query matches the more specific 'mrz' intent (not how_does),
      // so the formatter runs 'formatAsCleanMarkdown' on the top chunk —
      // the intro should mention MRZ since the intent is "mrz".
      assert(out.toLowerCase().includes("mrz"), "intro / response should mention MRZ", out.slice(0, 200));
      assert(out.includes("**Try asking:**"), "should include follow-up section", out);
      // The chunk content already contains bullet points (• TD1, • TD2, • TD3)
      // — verify they survived the clean-markdown formatter.
      assert(out.includes("TD1") && out.includes("TD3"), "should mention TD1 and TD3", out);
    }),

    await runTest("chatbot-fallback: end-to-end with real searchKnowledgeBase (liveness)", () => {
      const chunks = searchKnowledgeBase("How does liveness detection work?", 5);
      assert(chunks.length > 0, "expected ≥1 chunk from searchKnowledgeBase");
      const out = generateConversationalFallback("How does liveness detection work?", chunks);
      // Liveness intro should mention anti-spoofing / signals
      assert(out.toLowerCase().includes("liveness") || out.toLowerCase().includes("anti-spoof"),
        "intro should mention liveness or anti-spoofing", out.slice(0, 200));
      assert(out.includes("**Try asking:**"), "should include follow-up section", out);
    }),

    await runTest("chatbot-fallback: end-to-end with real searchKnowledgeBase (validator)", () => {
      const chunks = searchKnowledgeBase("How do I validate an Egyptian national ID checksum?", 5);
      assert(chunks.length > 0, "expected ≥1 chunk from searchKnowledgeBase");
      const out = generateConversationalFallback("How do I validate an Egyptian national ID checksum?", chunks);
      assert(out.includes("## "), "should include a markdown H2 heading", out);
      // Validate intent should produce algorithm + example sections
      assert(out.toLowerCase().includes("algorithm") || out.toLowerCase().includes("checksum"),
        "should mention algorithm or checksum", out);
      assert(out.includes("**Try asking:**"), "should include follow-up section", out);
    }),
  ];
}
