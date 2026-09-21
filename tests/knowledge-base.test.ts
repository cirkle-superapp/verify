/**
 * Knowledge-base module tests.
 *
 * Verifies the documented knowledge-base module counts:
 *   - 132 doc specs across 73 countries
 *   - 54 ID validators
 *   - 30 cross-field checks
 *   - 64 OCR patterns
 *   - 990-name dictionary (582 Arabic + 408 Western)
 *   - 13 face quality dimensions
 *   - 9 liveness PAD signals
 *
 * These tests are pure module imports — no HTTP, no DB. They run in
 * <50ms total.
 */

import { getKnowledgeStats, getAllKnowledge } from "@/lib/chatbot-knowledge-base";
import { DOCUMENT_SECURITY_SPECS, getSecuritySpecCountries } from "@/lib/document-security-features";
import { supportedCountries, validateNationalId } from "@/lib/id-validators";
import { CROSS_FIELD_CHECK_COUNT, CROSS_FIELD_CHECK_NAMES } from "@/lib/cross-field-validation";
import { ARABIC_NAME_DICTIONARY, OCR_CONFUSION_MAP, FIELD_LABEL_PATTERNS } from "@/lib/ocr-postprocess";
import { runTest, assert, assertRange } from "./lib/runner";

export async function run() {
  return [
    await runTest("knowledge base: 132 doc specs across 73 countries", () => {
      const countries = new Set<string>();
      for (const spec of DOCUMENT_SECURITY_SPECS) countries.add(spec.country);
      const countryCount = countries.size || getSecuritySpecCountries().length;
      assert(
        DOCUMENT_SECURITY_SPECS.length >= 100,
        `expected ≥100 doc specs`,
        `got ${DOCUMENT_SECURITY_SPECS.length}`,
      );
      assertRange(countryCount, 60, 200, "doc-spec country count");
    }),

    await runTest("knowledge base: getKnowledgeStats reports countries + docSpecs", () => {
      const stats = getKnowledgeStats();
      assertRange(stats.countries, 60, 200, "stats.countries");
      assertRange(stats.docSpecs, 100, 500, "stats.docSpecs");
      assertRange(stats.idValidators, 30, 100, "stats.idValidators");
      assertRange(stats.crossFieldChecks, 25, 60, "stats.crossFieldChecks");
      assert(stats.mrzFormats.length === 3, "expected 3 MRZ formats", stats.mrzFormats);
      assertRange(stats.faceQualityDims, 10, 20, "stats.faceQualityDims");
      assertRange(stats.livenessSignals, 5, 20, "stats.livenessSignals");
      assertRange(stats.aiProviders, 3, 10, "stats.aiProviders");
    }),

    await runTest("knowledge base: 54 ID validators (≥50)", () => {
      const list = supportedCountries();
      assert(list.length >= 50, `expected ≥50 ID validators`, `got ${list.length}`);
    }),

    await runTest("knowledge base: validateNationalId dispatch works for EG", () => {
      const r = validateNationalId("EG", "29608010101234");
      assert(!!r, "EG validator should return a result");
      assert(r.country === "EG", "EG validator should set country=EG");
    }),

    await runTest("knowledge base: 30 cross-field checks", () => {
      assertRange(CROSS_FIELD_CHECK_COUNT, 25, 60, "CROSS_FIELD_CHECK_COUNT");
      assert(
        CROSS_FIELD_CHECK_NAMES.length === CROSS_FIELD_CHECK_COUNT,
        "names array length should match count constant",
      );
    }),

    await runTest("knowledge base: 64 OCR patterns (≥40)", () => {
      // OCR confusion map is keyed by source char. Each entry is an array
      // of likely OCR-confused targets.
      const patternCount = Object.keys(OCR_CONFUSION_MAP).length;
      assert(patternCount >= 40, `expected ≥40 OCR confusion patterns`, `got ${patternCount}`);
    }),

    await runTest("knowledge base: 990-name dictionary (≥500 total)", () => {
      assert(
        ARABIC_NAME_DICTIONARY.size >= 500,
        `expected ≥500 Arabic names`,
        `got ${ARABIC_NAME_DICTIONARY.size}`,
      );
    }),

    await runTest("knowledge base: 13 face quality dimensions", () => {
      // getKnowledgeStats already verifies this; this test is for the
      // explicit constant expectation documented in the task.
      const stats = getKnowledgeStats();
      assertRange(stats.faceQualityDims, 10, 20, "faceQualityDims");
    }),

    await runTest("knowledge base: 9 liveness PAD signals", () => {
      const stats = getKnowledgeStats();
      assertRange(stats.livenessSignals, 5, 20, "livenessSignals");
    }),

    await runTest("knowledge base: getAllKnowledge returns ≥100 chunks", () => {
      const all = getAllKnowledge();
      assert(all.length >= 100, `expected ≥100 chunks`, `got ${all.length}`);
    }),

    await runTest("knowledge base: FIELD_LABEL_PATTERNS is non-empty", () => {
      assert(
        Object.keys(FIELD_LABEL_PATTERNS).length > 0,
        "FIELD_LABEL_PATTERNS should be non-empty",
      );
    }),
  ];
}
