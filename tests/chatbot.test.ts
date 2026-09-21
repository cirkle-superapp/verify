/**
 * Chatbot knowledge-base tests.
 *
 * Verifies that the RAG search engine returns relevant results for
 * common KYC questions, specifically:
 *   - Knowledge base search returns relevant results for "Egyptian ID"
 *   - Egyptian ID question returns chunks mentioning UV watermark
 *   - Generic questions (e.g. "MRZ") return at least one matching chunk
 *
 * These tests are pure module imports — no HTTP, no LLM call.
 */

import {
  searchKnowledgeBase,
  getKnowledgeStats,
  getAllKnowledge,
} from "@/lib/chatbot-knowledge-base";
import { runTest, assert, assertRange } from "./lib/runner";

export async function run() {
  return [
    await runTest("chatbot: searchKnowledgeBase returns results for 'Egyptian ID'", () => {
      const results = searchKnowledgeBase("Egyptian ID security features", 5);
      assert(results.length > 0, "expected ≥1 result", `got ${results.length}`);
      // Top result should mention Egypt.
      const top = results[0];
      const mentionsEgypt =
        top.title.toLowerCase().includes("egypt") ||
        top.content.toLowerCase().includes("egypt") ||
        top.keywords.some((k) => k.includes("egypt"));
      assert(mentionsEgypt, "top chunk should mention Egypt");
    }),

    await runTest("chatbot: Egyptian ID question returns chunks mentioning UV watermark", () => {
      const results = searchKnowledgeBase(
        "What security features does the Egyptian national ID have?",
        10,
      );
      assert(results.length > 0, "expected ≥1 result");
      // At least one chunk should mention UV watermark.
      const mentionsUV = results.some((r) => {
        const hay = (r.title + " " + r.content + " " + r.keywords.join(" ")).toLowerCase();
        return hay.includes("uv") && (hay.includes("watermark") || hay.includes("ultraviolet"));
      });
      assert(mentionsUV, "expected ≥1 chunk to mention UV watermark");
    }),

    await runTest("chatbot: search returns relevant chunks for 'MRZ TD1'", () => {
      const results = searchKnowledgeBase("How does MRZ TD1 format work?", 5);
      assert(results.length > 0, "expected ≥1 result");
      const mentionsMrz = results.some((r) => {
        const hay = (r.title + " " + r.content).toLowerCase();
        return hay.includes("mrz") || hay.includes("machine readable");
      });
      assert(mentionsMrz, "expected ≥1 chunk to mention MRZ");
    }),

    await runTest("chatbot: search returns relevant chunks for 'liveness'", () => {
      const results = searchKnowledgeBase("How does liveness detection work?", 5);
      assert(results.length > 0, "expected ≥1 result");
      const mentionsLiveness = results.some((r) => {
        const hay = (r.title + " " + r.content).toLowerCase();
        return hay.includes("liveness") || hay.includes("anti-spoof");
      });
      assert(mentionsLiveness, "expected ≥1 chunk to mention liveness");
    }),

    await runTest("chatbot: search returns relevant chunks for 'Saudi'", () => {
      const results = searchKnowledgeBase("Saudi Arabia national ID", 5);
      assert(results.length > 0, "expected ≥1 result");
      const mentionsSaudi = results.some((r) => {
        const hay = (r.title + " " + r.content).toLowerCase();
        return hay.includes("saudi") || hay.includes("ksa");
      });
      assert(mentionsSaudi, "expected ≥1 chunk to mention Saudi Arabia");
    }),

    await runTest("chatbot: empty query returns no results", () => {
      const results = searchKnowledgeBase("", 5);
      assertEqualLocal(results.length, 0, "empty query");
    }),

    await runTest("chatbot: gibberish query returns no or few results", () => {
      const results = searchKnowledgeBase("zzzzzzqqqqqq", 5);
      // Gibberish may match zero or a small number of chunks; we only
      // require it doesn't return the full corpus.
      assert(results.length < 100, `expected few results, got ${results.length}`);
    }),

    await runTest("chatbot: getKnowledgeStats returns non-zero counts", () => {
      const stats = getKnowledgeStats();
      assertRange(stats.countries, 60, 200, "stats.countries");
      assertRange(stats.docSpecs, 100, 500, "stats.docSpecs");
      assertRange(stats.idValidators, 30, 100, "stats.idValidators");
      assertRange(stats.crossFieldChecks, 25, 60, "stats.crossFieldChecks");
      assertRange(stats.faceQualityDims, 10, 20, "stats.faceQualityDims");
      assertRange(stats.livenessSignals, 5, 20, "stats.livenessSignals");
      assertRange(stats.aiProviders, 3, 10, "stats.aiProviders");
    }),

    await runTest("chatbot: getAllKnowledge returns ≥100 chunks", () => {
      const all = getAllKnowledge();
      assertRange(all.length, 100, 1000, "all chunks length");
    }),

    await runTest("chatbot: search caps results at maxResults", () => {
      const results = searchKnowledgeBase("Egypt Saudi Arabia UAE", 3);
      assert(results.length <= 3, `expected ≤3 results, got ${results.length}`);
    }),
  ];
}

// Inline assertEqual to avoid one more import.
function assertEqualLocal<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
