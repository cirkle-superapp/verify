/**
 * Phase 2 module tests.
 *
 * Verifies the four Phase-2 deliverables from the seed-db-kyb-tests-prado
 * task:
 *   1. Decision engine — `evaluateDecision` with various evidence
 *      combinations (all-pass → VERIFIED, structural fail →
 *      INVALID_STRUCTURE, expired → EXPIRED, unsupported →
 *      UNSUPPORTED_DOCUMENT, low-confidence → MANUAL_REVIEW_REQUIRED).
 *   2. Source-registry v2 lifecycle — happy-path forward transitions
 *      DISCOVERED → UNDER_REVIEW → APPROVED → DOWNLOADABLE, plus
 *      rejection of illegal jumps.
 *   3. Coverage matrix — `buildCoverageMatrix()` returns the expected
 *      number of entries (≥300), and `getCoverageStats()` returns
 *      correct counts.
 *   4. Barcode parser — `detectBarcode()` with empty/undersized
 *      input, `parseAAMVA()` with a sample driver-licence payload,
 *      `parseQRContent()` with JSON / key-value / URL payloads.
 *   5. KYB sources catalogue (15+ sources).
 *   6. PRADO references (40+ countries, parser, legal notes).
 *
 * Each test uses the tiny `runTest()` + `assert()` framework — no
 * Jest, no Bun:test, no external runner.
 */

import {
  evaluateDecision,
  isPositiveStatus,
  requiresManualReview,
  type EvidenceItem,
  type FieldFinding,
  type VerificationStatus,
} from "@/lib/decision-engine";
import {
  getAllSourcesV2,
  getApprovedSources,
  getDownloadableSources,
  getIntegratedSources,
  getSourceRegistryV2Summary,
  getSourceProvenance,
  upgradeSourceState,
  isTransitionAllowed,
  LIFECYCLE_ORDER,
  TERMINAL_STATES,
} from "@/lib/source-registry-v2";
import {
  buildCoverageMatrix,
  getCoverageStats,
  getCoverageForCountry,
  getCoverageForDocType,
  type CoverageEntry,
} from "@/lib/coverage-matrix";
import {
  detectBarcode,
  parseAAMVA,
  parseQRContent,
  getCountriesWithBarcodes,
} from "@/lib/barcode-parser";
import {
  KYB_SOURCES,
  getKybSources,
  getKybSourcesForCountry,
  getAvailableKybSources,
  getKybSummary,
  isKybDataProvided,
} from "@/lib/kyb-sources";
import {
  PRADO_COUNTRIES,
  getPradoCountries,
  getPradoLegalNotes,
  extractPradoReference,
  buildPradoReviewRequest,
} from "@/lib/prado-references";
import { runTest, assert, assertEqual, assertRange } from "./lib/runner";

// ─── Helpers ─────────────────────────────────────────────────────────

function passEvidence(check: string, method = "automatic"): EvidenceItem {
  return { check, method, result: "pass", detail: "ok" };
}
function failEvidence(check: string, method = "automatic"): EvidenceItem {
  return { check, method, result: "fail", detail: "failed" };
}
function notPerformedEvidence(check: string): EvidenceItem {
  return { check, method: "not_performed", result: "not_performed", detail: "skipped" };
}
function inconclusiveEvidence(check: string): EvidenceItem {
  return { check, method: "not_performed", result: "inconclusive", detail: "could not verify" };
}
function finding(field: string, source: FieldFinding["source"] = "ocr"): FieldFinding {
  return {
    field,
    source,
    validationStatus: "valid",
    ocrConfidence: 0.9,
  };
}

const baseMethods = ["ocr", "mrz_check", "cross_field"];
const baseSources = ["internal", "prado"];
const baseLimits: string[] = [];

// ─── Tests ───────────────────────────────────────────────────────────

export async function run() {
  return [
    // ─── Decision engine: all-pass → VERIFIED_WITH_SUPPORTED_EVIDENCE ───
    await runTest("decision-engine: all-pass → VERIFIED_WITH_SUPPORTED_EVIDENCE", () => {
      const evidence: EvidenceItem[] = [
        passEvidence("MRZ structure"),
        passEvidence("cross_field consistency"),
        passEvidence("liveness"),
        passEvidence("face_match"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName"), finding("nationalId"), finding("dateOfBirth")],
        documentType: "passport",
        country: "EG",
        isExpired: false,
        isUnsupported: false,
        livenessScore: 0.9,
        faceMatchScore: 0.95,
        overallConfidence: 0.95,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "VERIFIED_WITH_SUPPORTED_EVIDENCE",
        "status",
      );
      assert(r.humanReviewRequired === false, "human review should not be required");
      assert(isPositiveStatus(r.status), "isPositiveStatus should return true");
      assert(requiresManualReview(r.status) === false, "requiresManualReview should return false");
    }),

    // ─── Decision engine: structural failure → INVALID_STRUCTURE ───
    await runTest("decision-engine: MRZ failure → INVALID_STRUCTURE", () => {
      const evidence: EvidenceItem[] = [
        failEvidence("MRZ structure"),
        passEvidence("cross_field consistency"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName")],
        documentType: "passport",
        country: "EG",
        isExpired: false,
        isUnsupported: false,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "INVALID_STRUCTURE",
        "status should be INVALID_STRUCTURE when MRZ fails",
      );
      assert(r.humanReviewRequired, "human review should be required");
    }),

    // ─── Decision engine: cross-field failure → DOCUMENT_MISMATCH ───
    await runTest("decision-engine: cross_field failure → DOCUMENT_MISMATCH", () => {
      const evidence: EvidenceItem[] = [
        passEvidence("MRZ structure"),
        failEvidence("cross_field consistency"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName"), finding("nationalId")],
        documentType: "passport",
        country: "EG",
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "DOCUMENT_MISMATCH",
        "status should be DOCUMENT_MISMATCH when cross_field fails",
      );
      assert(r.humanReviewRequired, "human review should be required");
    }),

    // ─── Decision engine: expired → EXPIRED ───
    await runTest("decision-engine: isExpired=true → EXPIRED", () => {
      const evidence: EvidenceItem[] = [
        passEvidence("MRZ structure"),
        passEvidence("cross_field consistency"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName"), finding("dateOfExpiry")],
        documentType: "passport",
        country: "EG",
        isExpired: true,
        isUnsupported: false,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "EXPIRED",
        "status should be EXPIRED when isExpired is true",
      );
    }),

    // ─── Decision engine: unsupported country/doc → UNSUPPORTED_DOCUMENT ───
    await runTest("decision-engine: isUnsupported=true → UNSUPPORTED_DOCUMENT", () => {
      const r = evaluateDecision({
        evidence: [passEvidence("MRZ structure")],
        fieldFindings: [finding("fullName")],
        documentType: "driver_license",
        country: "XX",
        isUnsupported: true,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "UNSUPPORTED_DOCUMENT",
        "status should be UNSUPPORTED_DOCUMENT when isUnsupported is true",
      );
      assert(r.humanReviewRequired, "human review should be required");
    }),

    // ─── Decision engine: low confidence → MANUAL_REVIEW_REQUIRED ───
    await runTest("decision-engine: low overallConfidence → MANUAL_REVIEW_REQUIRED", () => {
      // No structural checks performed at all → allStructuralPassed=false,
      // no critical failures, no chip/issuer pass → falls through to
      // the manual-review branch on low confidence.
      const r = evaluateDecision({
        evidence: [],
        fieldFindings: [finding("fullName", "ocr")],
        overallConfidence: 0.2,
        manualReviewThreshold: 0.65,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "MANUAL_REVIEW_REQUIRED",
        "status should be MANUAL_REVIEW_REQUIRED when confidence < threshold",
      );
      assert(r.humanReviewRequired, "human review should be required");
    }),

    // ─── Decision engine: structure valid but no authenticity → STRUCTURE_VALID ───
    await runTest("decision-engine: structural pass + no chip/issuer → STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED", () => {
      // Structural checks pass, but chip + issuer are inconclusive (not
      // "pass" or "not_performed"), so allChecksPassed=false and we land
      // on STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED.
      const evidence: EvidenceItem[] = [
        passEvidence("MRZ structure"),
        passEvidence("cross_field consistency"),
        inconclusiveEvidence("chip"),
        inconclusiveEvidence("issuer"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName")],
        documentType: "passport",
        country: "EG",
        isExpired: false,
        isUnsupported: false,
        livenessScore: 0.8,
        faceMatchScore: 0.85,
        overallConfidence: 0.7,
        manualReviewThreshold: 0.65,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED",
        "status should be STRUCTURE_VALID_BUT_AUTHENTICITY_UNCONFIRMED",
      );
    }),

    // ─── Decision engine: chip pass → ELECTRONIC_AUTHENTICATION_PASSED ───
    await runTest("decision-engine: chip pass → ELECTRONIC_AUTHENTICATION_PASSED", () => {
      const evidence: EvidenceItem[] = [
        passEvidence("MRZ structure"),
        passEvidence("cross_field consistency"),
        passEvidence("chip authentication"),
        notPerformedEvidence("issuer check"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName")],
        documentType: "passport",
        country: "DE",
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "ELECTRONIC_AUTHENTICATION_PASSED",
        "status should be ELECTRONIC_AUTHENTICATION_PASSED when chip passes",
      );
    }),

    // ─── Decision engine: liveness below threshold → LIVENESS_INCONCLUSIVE ───
    await runTest("decision-engine: livenessScore below threshold → LIVENESS_INCONCLUSIVE", () => {
      const evidence: EvidenceItem[] = [
        passEvidence("MRZ structure"),
        passEvidence("cross_field consistency"),
        failEvidence("liveness"),
      ];
      const r = evaluateDecision({
        evidence,
        fieldFindings: [finding("fullName")],
        documentType: "passport",
        country: "EG",
        livenessScore: 0.3,
        livenessThreshold: 0.6,
        methodsPerformed: baseMethods,
        sourcesConsulted: baseSources,
        unresolvedLimitations: baseLimits,
      });
      assertEqual(
        r.status as VerificationStatus,
        "LIVENESS_INCONCLUSIVE",
        "status should be LIVENESS_INCONCLUSIVE when liveness < threshold",
      );
    }),

    // ─── Source registry v2: lifecycle happy path ───
    await runTest("source-registry-v2: DISCOVERED → UNDER_REVIEW → APPROVED → DOWNLOADABLE transitions succeed", () => {
      assert(isTransitionAllowed("DISCOVERED", "UNDER_REVIEW"), "DISCOVERED → UNDER_REVIEW should be allowed");
      assert(isTransitionAllowed("UNDER_REVIEW", "APPROVED"), "UNDER_REVIEW → APPROVED should be allowed");
      assert(isTransitionAllowed("APPROVED", "DOWNLOADABLE"), "APPROVED → DOWNLOADABLE should be allowed");
      assert(isTransitionAllowed("DOWNLOADABLE", "DOWNLOADED"), "DOWNLOADABLE → DOWNLOADED should be allowed");
      assert(isTransitionAllowed("DOWNLOADED", "VALIDATED"), "DOWNLOADED → VALIDATED should be allowed");
      assert(isTransitionAllowed("VALIDATED", "INTEGRATED"), "VALIDATED → INTEGRATED should be allowed");
    }),

    // ─── Source registry v2: illegal transitions rejected ───
    await runTest("source-registry-v2: illegal transitions rejected", () => {
      assert(!isTransitionAllowed("DISCOVERED", "DOWNLOADABLE"), "DISCOVERED → DOWNLOADABLE must be rejected");
      assert(!isTransitionAllowed("DISCOVERED", "INTEGRATED"), "DISCOVERED → INTEGRATED must be rejected");
      assert(!isTransitionAllowed("DISCOVERED", "DOWNLOADED"), "DISCOVERED → DOWNLOADED must be rejected");
      assert(!isTransitionAllowed("BLOCKED", "INTEGRATED"), "BLOCKED → INTEGRATED must be rejected (terminal)");
      assert(!isTransitionAllowed("REJECTED", "INTEGRATED"), "REJECTED → INTEGRATED must be rejected");
      assert(!isTransitionAllowed("APPROVED", "DISCOVERED"), "APPROVED → DISCOVERED must be rejected (no backward)");
    }),

    // ─── Source registry v2: upgradeSourceState throws on illegal jump ───
    await runTest("source-registry-v2: upgradeSourceState throws on illegal transition", () => {
      // Pick any source that's currently INTEGRATED (auto-seeded from v1 verified sources).
      const integrated = getIntegratedSources();
      assert(integrated.length > 0, "expected at least one integrated source in seed");
      const src = integrated[0];
      // INTEGRATED → DISCOVERED is not in the allowed transition map.
      let threw = false;
      try {
        upgradeSourceState(src.id, "DISCOVERED");
      } catch {
        threw = true;
      }
      assert(threw, "expected upgradeSourceState to throw on illegal transition");
    }),

    // ─── Source registry v2: summary stats are consistent ───
    await runTest("source-registry-v2: getSourceRegistryV2Summary reports consistent counts", () => {
      const s = getSourceRegistryV2Summary();
      const all = getAllSourcesV2();
      assertEqual(s.totalSources, all.length, "summary.totalSources");
      assert(s.approved <= s.totalSources, "approved <= total");
      assert(s.downloadable <= s.approved, "downloadable <= approved");
      assert(s.integrated <= s.downloadable, "integrated <= downloadable");
      assert(s.countriesCovered >= 1, "should cover at least 1 country");
    }),

    // ─── Source registry v2: provenance has a SHA-256 head ───
    await runTest("source-registry-v2: getSourceProvenance returns a 64-char hash head", () => {
      const integrated = getIntegratedSources();
      const src = integrated[0];
      const prov = getSourceProvenance(src.id);
      assert(prov.length >= 1, "expected at least one provenance entry (INIT seed)");
      assert(prov.head.length === 64, `expected 64-char SHA-256 head, got ${prov.head.length}`);
      assert(/^[0-9a-f]+$/.test(prov.head), "head should be hex SHA-256");
    }),

    // ─── Coverage matrix: returns ≥300 entries (75 countries × 4 doc types = 300) ───
    await runTest("coverage-matrix: buildCoverageMatrix returns ≥300 entries", () => {
      const m: CoverageEntry[] = buildCoverageMatrix();
      assert(m.length >= 300, `expected ≥300 coverage entries, got ${m.length}`);
      // Each country contributes 4 entries (national_id, passport, driver_license, residence).
      const countries = new Set(m.map((e) => e.countryCode));
      assert(countries.size >= 60, `expected ≥60 countries in matrix, got ${countries.size}`);
    }),

    // ─── Coverage matrix: getCoverageStats reports correct counts ───
    await runTest("coverage-matrix: getCoverageStats reports correct counts", () => {
      const m = buildCoverageMatrix();
      const s = getCoverageStats();
      assertEqual(s.totalEntries, m.length, "totalEntries");
      assert(s.countriesCovered === new Set(m.map((e) => e.countryCode)).size, "countriesCovered");
      // By doc-type breakdown
      const expected = ["national_id", "passport", "driver_license", "residence"];
      for (const dt of expected) {
        const count = m.filter((e) => e.documentType === dt).length;
        assertEqual(s.byDocType[dt], count, `byDocType.${dt}`);
      }
      // Sum of byState counts should equal totalEntries
      const stateSum = Object.values(s.byState).reduce((a, b) => a + b, 0);
      assertEqual(stateSum, s.totalEntries, "sum of byState");
    }),

    // ─── Coverage matrix: per-country lookup works ───
    await runTest("coverage-matrix: getCoverageForCountry returns 4 entries for EG", () => {
      const eg = getCoverageForCountry("EG");
      assertEqual(eg.length, 4, "EG entries (one per doc type)");
      assert(eg.every((e) => e.countryCode === "EG"), "all entries should be EG");
    }),

    // ─── Coverage matrix: per-doc-type lookup works ───
    await runTest("coverage-matrix: getCoverageForDocType returns all passport entries", () => {
      const ps = getCoverageForDocType("passport");
      const m = buildCoverageMatrix().filter((e) => e.documentType === "passport");
      assertEqual(ps.length, m.length, "passport entry count");
    }),

    // ─── Barcode parser: empty input returns found=false ───
    await runTest("barcode-parser: detectBarcode with empty pixels returns found=false", () => {
      const r = detectBarcode(new Uint8Array(0), 0, 0);
      assert(r.found === false, "should not detect on empty pixels");
      assertEqual(r.type, "none", "type should be 'none' on empty input");
    }),

    // ─── Barcode parser: tiny image rejected ───
    await runTest("barcode-parser: detectBarcode rejects images smaller than 50×50", () => {
      // 30×30 image filled with zeros.
      const small = new Uint8Array(30 * 30);
      const r = detectBarcode(small, 30, 30);
      assert(r.found === false, "should not detect on tiny image");
      assert(r.notes.toLowerCase().includes("too small"), "notes should mention 'too small'");
    }),

    // ─── Barcode parser: parseAAMVA with a sample payload ───
    await runTest("barcode-parser: parseAAMVA extracts fields from sample driver-licence payload", () => {
      // Minimal AAMVA-2005-style payload (no real PII).
      const text =
        "DCS SAMPLE\n" +
        "DCT TEST\n" +
        "DBA 20250101\n" +
        "DBB 19900101\n" +
        "DBC M\n" +
        "DCG USA\n" +
        "DCA CA\n";
      const r = parseAAMVA(text);
      assert(r.parsed, "should parse successfully");
      assert(r.fields.DCS === "SAMPLE", "DCS surname should be SAMPLE");
      assert(r.fields.DCT === "TEST", "DCT given name should be TEST");
      assert(r.fields.DBA === "20250101", "DBA expiry should be 20250101");
      assert(r.fields.DBB === "19900101", "DBB DOB should be 19900101");
      assert(r.fields.DBC === "M", "DBC sex should be M");
      assert(r.fields.DCG === "USA", "DCG country should be USA");
    }),

    // ─── Barcode parser: parseAAMVA with too-short text returns parsed=false ───
    await runTest("barcode-parser: parseAAMVA with text < 20 chars returns parsed=false", () => {
      const r = parseAAMVA("short");
      assert(r.parsed === false, "should not parse short text");
      assertEqual(r.compliance, "unknown", "compliance should be unknown");
    }),

    // ─── Barcode parser: parseQRContent with JSON payload ───
    await runTest("barcode-parser: parseQRContent parses JSON QR payload", () => {
      const json = JSON.stringify({ name: "Cirkle User", id: "12345", country: "EG" });
      const r = parseQRContent(json);
      assert(r.parsed, "should parse JSON");
      assertEqual(r.format, "json", "format should be json");
      assert(r.fields.name === "Cirkle User", "fields.name should match");
      assert(r.fields.id === "12345", "fields.id should match");
    }),

    // ─── Barcode parser: parseQRContent with key=value pairs ───
    await runTest("barcode-parser: parseQRContent parses key-value QR payload", () => {
      const text = "name=Cirkle User\nid=12345\ncountry=EG";
      const r = parseQRContent(text);
      assert(r.parsed, "should parse key-value");
      assertEqual(r.format, "key_value", "format should be key_value");
      assert(r.fields.name === "Cirkle User", "fields.name should match");
      assert(r.fields.id === "12345", "fields.id should match");
      assert(r.fields.country === "EG", "fields.country should match");
    }),

    // ─── Barcode parser: parseQRContent with URL payload ───
    await runTest("barcode-parser: parseQRContent parses URL QR payload", () => {
      const url = "https://verify.cirkle.app/d/abc123";
      const r = parseQRContent(url);
      assert(r.parsed, "should parse URL");
      assertEqual(r.format, "url", "format should be url");
      assert(r.fields.url === url, "fields.url should match");
    }),

    // ─── Barcode parser: parseQRContent with empty input returns parsed=false ───
    await runTest("barcode-parser: parseQRContent with empty text returns parsed=false", () => {
      const r = parseQRContent("");
      assert(r.parsed === false, "should not parse empty text");
      assertEqual(r.format, "unknown", "format should be unknown for empty input");
    }),

    // ─── Barcode parser: getCountriesWithBarcodes returns expected list ───
    await runTest("barcode-parser: getCountriesWithBarcodes returns ≥10 countries", () => {
      const list = getCountriesWithBarcodes();
      assert(list.length >= 10, `expected ≥10 entries, got ${list.length}`);
      assert(list.some((c) => c.country === "US" && c.format.includes("PDF417")), "US uses PDF417");
      assert(list.some((c) => c.country === "IN" && c.format.includes("Aadhaar")), "IN uses Aadhaar QR");
    }),

    // ─── KYB sources: ≥15 sources ───
    await runTest("kyb-sources: KYB_SOURCES contains ≥15 sources", () => {
      assert(KYB_SOURCES.length >= 15, `expected ≥15 KYB sources, got ${KYB_SOURCES.length}`);
      // Every source must declare at least one dataProvided attribute.
      for (const s of KYB_SOURCES) {
        assert(s.dataProvided.length >= 1, `source ${s.id} must declare ≥1 dataProvided`);
        assert(s.country.length === 2, `source ${s.id} country must be ISO alpha-2`);
      }
    }),

    // ─── KYB sources: getKybSourcesForCountry works ───
    await runTest("kyb-sources: getKybSourcesForCountry('GB') returns Companies House", () => {
      const gb = getKybSourcesForCountry("GB");
      assert(gb.length >= 1, "GB should have at least 1 source");
      assert(gb.some((s) => s.id === "uk-companies-house"), "should find uk-companies-house");
    }),

    // ─── KYB sources: getAvailableKybSources excludes unavailable ───
    await runTest("kyb-sources: getAvailableKybSources excludes unavailable sources", () => {
      const avail = getAvailableKybSources();
      assert(avail.every((s) => s.available), "all returned sources should be available");
      assert(avail.length < KYB_SOURCES.length, "at least one source is unavailable");
    }),

    // ─── KYB sources: getKybSummary has consistent counts ───
    await runTest("kyb-sources: getKybSummary reports consistent counts", () => {
      const s = getKybSummary();
      assertEqual(s.totalSources, KYB_SOURCES.length, "totalSources");
      assert(s.availableSources <= s.totalSources, "available ≤ total");
      assert(s.countriesCovered >= 10, "should cover ≥10 countries");
      const byCountrySum = Object.values(s.byCountry).reduce((a, b) => a + b, 0);
      assertEqual(byCountrySum, s.totalSources, "sum(byCountry)");
    }),

    // ─── KYB sources: isKybDataProvided checks directors ───
    await runTest("kyb-sources: isKybDataProvided('GB','directors') is true (Companies House)", () => {
      assert(isKybDataProvided("GB", "directors"), "GB should provide directors");
      assert(isKybDataProvided("GB", "legal_existence"), "GB should provide legal_existence");
    }),

    // ─── PRADO references: ≥40 countries listed ───
    await runTest("prado-references: PRADO_COUNTRIES contains ≥40 entries", () => {
      assert(PRADO_COUNTRIES.length >= 40, `expected ≥40 PRADO countries, got ${PRADO_COUNTRIES.length}`);
      // Each entry must have a code, name, and a consilium.europa.eu URL.
      for (const c of PRADO_COUNTRIES) {
        assert(c.code.length === 2, `country ${c.name} code must be ISO alpha-2`);
        assert(c.url.includes("consilium.europa.eu/prado"), `country ${c.code} URL must be a PRADO URL`);
      }
      // Spot-check a few key countries
      const codes = PRADO_COUNTRIES.map((c) => c.code);
      assert(codes.includes("DE"), "DE should be in PRADO");
      assert(codes.includes("FR"), "FR should be in PRADO");
      assert(codes.includes("GB"), "GB should be in PRADO");
    }),

    // ─── PRADO references: getPradoCountries returns the same list ───
    await runTest("prado-references: getPradoCountries returns the catalogue", () => {
      const list = getPradoCountries();
      assertEqual(list.length, PRADO_COUNTRIES.length, "list length");
    }),

    // ─── PRADO references: legal notes are present ───
    await runTest("prado-references: getPradoLegalNotes returns non-empty warning text", () => {
      const notes = getPradoLegalNotes();
      assert(notes.length > 100, "legal notes should be substantive");
      assert(notes.toLowerCase().includes("not redistributable"), "notes must mention specimens are NOT redistributable");
      assert(notes.toLowerCase().includes("link to prado"), "notes must mention linking to PRADO as source");
    }),

    // ─── PRADO references: parser extracts document from synthetic HTML ───
    await runTest("prado-references: extractPradoReference parses a synthetic PRADO document page", () => {
      const html =
        "<html><title>Austria — Passports</title><body><div>" +
        '<a href="/prado/en/prado-documents/AT/AT-PO-01001/index.html">Austrian Passport</a>' +
        "<p>Issued on 16 June 2014. The Austrian passport contains TD3 MRZ.</p>" +
        "<p>Security features: hologram, UV watermark, microprint, ghost photo, chip.</p>" +
        "<p>Fields: surname, given names, nationality, date of birth, sex, date of expiry.</p>" +
        "<p>Bilingual: German, English.</p>" +
        "</div></body></html>";
      const recs = extractPradoReference(html, "AT");
      assertEqual(recs.length, 1, "should extract exactly 1 record");
      const r = recs[0];
      assertEqual(r.country, "AT", "country");
      assertEqual(r.docId, "AT-PO-01001", "docId");
      assert(r.docType.toLowerCase().includes("passport"), "docType should mention passport");
      assertEqual(r.mrzFormat, "TD3", "mrzFormat");
      assert(r.securityFeatures.length >= 3, `should extract ≥3 security features, got ${r.securityFeatures.length}`);
      assert(r.fields.length >= 3, `should extract ≥3 fields, got ${r.fields.length}`);
      assert(r.languages.includes("de"), "should detect German");
      assert(r.languages.includes("en"), "should detect English");
      assert(r.url.includes("consilium.europa.eu/prado"), "url should be on PRADO");
    }),

    // ─── PRADO references: parser returns [] on empty HTML ───
    await runTest("prado-references: extractPradoReference returns [] on empty input", () => {
      const r1 = extractPradoReference("", "AT");
      assertEqual(r1.length, 0, "empty html returns no records");
      const r2 = extractPradoReference("   ", "AT");
      assertEqual(r2.length, 0, "whitespace html returns no records");
    }),

    // ─── PRADO references: buildPradoReviewRequest populates the review record ───
    await runTest("prado-references: buildPradoReviewRequest produces a pending review record", () => {
      const html =
        '<a href="/prado/en/prado-documents/FR/FR-PO-02001/index.html">French Passport</a>' +
        "<p>TD3 MRZ. Security features: chip, hologram. Bilingual: French, English.</p>";
      const review = buildPradoReviewRequest("FR", html);
      assertEqual(review.country, "FR", "country");
      assertEqual(review.legalReviewStatus, "pending", "review status should be pending");
      assert(review.records.length === 1, "should extract 1 document");
      assert(!!review.fetchedAt, "fetchedAt must be set");
    }),

    // ─── Terminal / lifecycle constants ───
    await runTest("source-registry-v2: LIFECYCLE_ORDER has 7 forward states + 3 terminal states", () => {
      assertEqual(LIFECYCLE_ORDER.length, 7, "forward states count");
      assertEqual(TERMINAL_STATES.length, 3, "terminal states count");
      assert(TERMINAL_STATES.includes("BLOCKED"), "BLOCKED should be terminal");
      assert(TERMINAL_STATES.includes("REJECTED"), "REJECTED should be terminal");
      assert(TERMINAL_STATES.includes("RESTRICTED"), "RESTRICTED should be terminal");
    }),
  ];
}
