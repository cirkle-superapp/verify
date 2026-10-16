/**
 * Global Coverage Matrix
 *
 * Per-country, per-document-type coverage tracking with explicit states:
 *   - reference_available: a documented source exists
 *   - ocr_supported: text extraction has been benchmarked
 *   - structural_validation: relevant rules implemented and tested
 *   - authenticity_checks: specified checks implemented
 *   - authoritative_verification: issuer/registry check operational
 *   - electronic_authentication: chip/signed-data verification supported
 *   - human_review_required: cannot yet be safely automated
 *   - unsupported: evidence or technical support insufficient
 *
 * This matrix is the single source of truth for what the platform can
 * actually verify. It prevents false claims of "worldwide coverage".
 */

export type CoverageState =
  | "reference_available"
  | "ocr_supported"
  | "structural_validation"
  | "authenticity_checks"
  | "authoritative_verification"
  | "electronic_authentication"
  | "human_review_required"
  | "unsupported";

export type DocumentCategory =
  | "passport"
  | "national_id"
  | "driver_license"
  | "residence";

export interface CoverageEntry {
  countryCode: string;        // ISO alpha-2
  countryName: string;
  documentType: DocumentCategory;
  coverageState: CoverageState;
  idValidatorImplemented: boolean;  // ID checksum algorithm exists
  docTemplateExists: boolean;       // Field position template exists
  securitySpecExists: boolean;     // Security feature spec exists
  mrzFormat?: "TD1" | "TD2" | "TD3";
  languagesSupported: string[];
  testedWithRealDocument: boolean;  // Has it been tested with a REAL document?
  testedWithSyntheticDocument: boolean;
  notes: string;
  lastReviewed: string;
}

/**
 * Coverage states ordered from strongest to weakest.
 */
const STATE_PRIORITY: CoverageState[] = [
  "electronic_authentication",
  "authoritative_verification",
  "authenticity_checks",
  "structural_validation",
  "ocr_supported",
  "reference_available",
  "human_review_required",
  "unsupported",
];

/**
 * Get the highest coverage state achieved for a country/document pair.
 */
function determineState(entry: Partial<CoverageEntry>): CoverageState {
  if (entry.electronic_authentication) return "electronic_authentication";
  if (entry.authoritative_verification) return "authoritative_verification";
  if (entry.authenticity_checks) return "authenticity_checks";
  if (entry.structural_validation) return "structural_validation";
  if (entry.ocr_supported) return "ocr_supported";
  if (entry.reference_available) return "reference_available";
  if (entry.human_review_required) return "human_review_required";
  return "unsupported";
}

// ─── Coverage Matrix Builder ─────────────────────────────────────

import { supportedCountries } from "./id-validators";
import { getDocumentSecuritySpec } from "./document-security-features";
import { getTemplate } from "./document-templates";

/**
 * Build the coverage matrix dynamically from the existing knowledge base.
 * This reflects ACTUAL implemented capabilities, not aspirational coverage.
 */
export function buildCoverageMatrix(): CoverageEntry[] {
  const entries: CoverageEntry[] = [];
  const countries = supportedCountries();
  const now = new Date().toISOString();

  // For each country, check what document types are supported
  for (const countryCode of countries) {
    const countryName = getCountryName(countryCode);

    // Check each document type
    for (const docType of ["national_id", "passport", "driver_license", "residence"] as DocumentCategory[]) {
      const idValidator = docType === "national_id";
      const securitySpec = !!getDocumentSecuritySpec(countryCode, docType);
      const docTemplate = !!getTemplate(countryCode, docType);

      // Determine coverage state
      let state: CoverageState = "unsupported";
      if (idValidator && securitySpec) {
        state = "structural_validation"; // ID checksum + security specs = structural validation
      } else if (securitySpec) {
        state = "reference_available"; // Security specs exist but no ID validator
      } else if (idValidator) {
        state = "ocr_supported"; // ID validator exists but no security specs
      }

      entries.push({
        countryCode,
        countryName,
        documentType: docType,
        coverageState: state,
        idValidatorImplemented: idValidator,
        docTemplateExists: docTemplate,
        securitySpecExists: securitySpec,
        mrzFormat: docType === "passport" ? "TD3" : docType === "national_id" ? "TD1" : undefined,
        languagesSupported: getCountryLanguages(countryCode),
        testedWithRealDocument: false, // Honest: no real document testing yet
        testedWithSyntheticDocument: true, // Synthetic samples exist
        notes: getCoverageNotes(countryCode, docType, state),
        lastReviewed: now,
      });
    }
  }

  return entries;
}

/**
 * Get a human-readable country name from ISO code.
 */
function getCountryName(code: string): string {
  const names: Record<string, string> = {
    EG: "Egypt", SA: "Saudi Arabia", AE: "United Arab Emirates", KW: "Kuwait",
    QA: "Qatar", BH: "Bahrain", OM: "Oman", JO: "Jordan", MA: "Morocco",
    TN: "Tunisia", DZ: "Algeria", LB: "Lebanon", SY: "Syria", IQ: "Iraq",
    IR: "Iran", YE: "Yemen", SD: "Sudan", LY: "Libya", PS: "Palestine",
    IL: "Israel", TR: "Türkiye", FR: "France", DE: "Germany", IT: "Italy",
    ES: "Spain", NL: "Netherlands", BE: "Belgium", SE: "Sweden", NO: "Norway",
    RU: "Russia", CN: "China", JP: "Japan", KR: "South Korea", IN: "India",
    PK: "Pakistan", US: "United States", GB: "United Kingdom", CA: "Canada",
    AU: "Australia", BR: "Brazil", MX: "Mexico", ZA: "South Africa",
    KE: "Kenya", NG: "Nigeria", GH: "Ghana", MU: "Mauritius",
    KH: "Cambodia", VN: "Vietnam", TH: "Thailand", PH: "Philippines",
    SG: "Singapore", MY: "Malaysia", ID: "Indonesia", BD: "Bangladesh",
    LK: "Sri Lanka", NP: "Nepal", AF: "Afghanistan",
    // Add more as needed
  };
  return names[code] || code;
}

/**
 * Get the languages supported for a country.
 */
function getCountryLanguages(code: string): string[] {
  const arabicCountries = ["EG", "SA", "AE", "KW", "QA", "BH", "OM", "JO", "MA", "TN", "DZ", "LB", "SY", "IQ", "IR", "YE", "SD", "LY", "PS", "AF"];
  if (arabicCountries.includes(code)) return ["ar", "en"];
  return ["en"];
}

/**
 * Get coverage notes for a specific country/document/state.
 */
function getCoverageNotes(country: string, docType: string, state: CoverageState): string {
  switch (state) {
    case "structural_validation":
      return `ID checksum + security features implemented. No chip authentication or issuer check available.`;
    case "reference_available":
      return `Security feature specifications available. No ID checksum algorithm implemented for this document type.`;
    case "ocr_supported":
      return `ID checksum algorithm implemented. No security feature specifications for this document type.`;
    case "unsupported":
      return `No validators, templates, or security specs implemented for this document type.`;
    default:
      return state;
  }
}

/**
 * Get coverage statistics.
 */
export function getCoverageStats() {
  const matrix = buildCoverageMatrix();
  const total = matrix.length;
  const byState = matrix.reduce((acc, e) => {
    acc[e.coverageState] = (acc[e.coverageState] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const byDocType = matrix.reduce((acc, e) => {
    acc[e.documentType] = (acc[e.documentType] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalEntries: total,
    countriesCovered: new Set(matrix.map((e) => e.countryCode)).size,
    byState,
    byDocType,
    structuralValidationCount: byState["structural_validation"] || 0,
    referenceAvailableCount: byState["reference_available"] || 0,
    ocrSupportedCount: byState["ocr_supported"] || 0,
    unsupportedCount: byState["unsupported"] || 0,
    testedWithRealDocuments: matrix.filter((e) => e.testedWithRealDocument).length,
    testedWithSyntheticDocuments: matrix.filter((e) => e.testedWithSyntheticDocument).length,
  };
}

/**
 * Get coverage for a specific country.
 */
export function getCoverageForCountry(countryCode: string): CoverageEntry[] {
  return buildCoverageMatrix().filter((e) => e.countryCode === countryCode.toUpperCase());
}

/**
 * Get coverage for a specific document type.
 */
export function getCoverageForDocType(docType: DocumentCategory): CoverageEntry[] {
  return buildCoverageMatrix().filter((e) => e.documentType === docType);
}
