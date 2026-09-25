/**
 * Chatbot Knowledge Base — RAG source for the Cirkle Assistant.
 *
 * Aggregates knowledge from all existing Cirkle verification knowledge modules:
 *   - Document security features (132 specs, 73 countries)
 *   - ID validators catalog (54 country-specific checksum algorithms)
 *   - MRZ parser (ICAO 9303 TD1/TD2/TD3 formats + check digits)
 *   - Cross-field validation (30 consistency checks)
 *   - OCR post-processing (confusion patterns, Arabic + Western name dictionary)
 *   - Face quality (13 ISO/IEC 19794-5 dimensions)
 *   - Liveness Pro (9 PAD + anti-spoofing signals)
 *   - AI consensus providers (Gemini, Groq, OpenRouter, NVIDIA, HuggingFace)
 *   - Verification certificate (HMAC-signed proof of verification)
 *   - Risk-adaptive verification (low / medium / high strictness)
 *
 * The chunks are built lazily on first access to avoid paying the
 * ~132-spec iteration cost on every serverless cold start.
 */

import {
  DOCUMENT_SECURITY_SPECS,
  getSecuritySpecCountries,
} from "@/lib/document-security-features";
import {
  supportedCountries,
  validateNationalId,
  type IdValidation,
} from "@/lib/id-validators";
import {
  CROSS_FIELD_CHECK_COUNT,
  CROSS_FIELD_CHECK_NAMES,
} from "@/lib/cross-field-validation";
import {
  ARABIC_NAME_DICTIONARY,
  OCR_CONFUSION_MAP,
  FIELD_LABEL_PATTERNS,
} from "@/lib/ocr-postprocess";
import { hasVisionProviders, hasTextProviders, configuredProviders } from "@/lib/ai-router";

// ─── Public types ────────────────────────────────────────────────────

export interface KnowledgeChunk {
  /** Unique chunk ID (e.g. "doc-specs:EG:national_id"). */
  id: string;
  /** Source module the chunk came from. */
  source:
    | "doc-specs"
    | "id-validators"
    | "mrz"
    | "cross-field"
    | "ocr"
    | "face-quality"
    | "liveness"
    | "ai-consensus"
    | "certificate"
    | "risk";
  /** Human-readable title (e.g. "Egypt National ID Security Features"). */
  title: string;
  /** Human-readable content with all relevant details. */
  content: string;
  /** Lowercased keywords used for search matching. */
  keywords: string[];
}

export interface KnowledgeStats {
  countries: number;
  docSpecs: number;
  idValidators: number;
  mrzFormats: string[];
  crossFieldChecks: number;
  faceQualityDims: number;
  livenessSignals: number;
  aiProviders: number;
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Map of ISO alpha-2 → country name (built lazily from doc specs + MRZ). */
function buildCountryNames(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of DOCUMENT_SECURITY_SPECS) {
    if (!out[spec.country]) out[spec.country] = spec.countryName;
  }
  return out;
}

/** Normalize a string for keyword matching (lowercase, alnum, strip accents). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06FF ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Chunk builders (one per source) ─────────────────────────────────

function buildDocSpecChunks(countryNames: Record<string, string>): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  for (const spec of DOCUMENT_SECURITY_SPECS) {
    const countryName = spec.countryName || countryNames[spec.country] || spec.country;
    const features = spec.features
      .map(
        (f) =>
          `  • ${f.feature} (${f.position}) — ${f.description}`,
      )
      .join("\n");
    const title = `${countryName} ${spec.docType.replace(/_/g, " ")} — security features`;
    const content = [
      `Country: ${countryName} (${spec.country})`,
      `Document type: ${spec.docType}`,
      `Material: ${spec.material}`,
      spec.dimensions ? `Dimensions: ${spec.dimensions}` : null,
      spec.issuedSince ? `Issued since: ${spec.issuedSince}` : null,
      spec.mrzFormat ? `MRZ format: ${spec.mrzFormat}` : null,
      spec.hasChip !== undefined ? `Has chip: ${spec.hasChip ? "yes" : "no"}` : null,
      "",
      "Security features:",
      features,
      spec.notes ? `\nNotes: ${spec.notes}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const keywords = [
      spec.country.toLowerCase(),
      countryName.toLowerCase(),
      spec.docType.toLowerCase(),
      spec.docType.replace(/_/g, " ").toLowerCase(),
      spec.material.toLowerCase(),
      ...(spec.mrzFormat ? [spec.mrzFormat.toLowerCase()] : []),
      ...spec.features.flatMap((f) => [
        f.feature.toLowerCase(),
        f.position.toLowerCase(),
      ]),
      ...(spec.notes ? normalize(spec.notes).split(" ").filter((w) => w.length > 3) : []),
    ].filter((k) => k && k.length > 1);
    chunks.push({
      id: `doc-specs:${spec.country}:${spec.docType}`,
      source: "doc-specs",
      title,
      content,
      keywords: Array.from(new Set(keywords)),
    });
  }
  return chunks;
}

function buildIdValidatorChunks(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];
  for (const country of supportedCountries()) {
    // Probe the validator with an empty id to learn what it returns
    // (cheap — every validator does an early return on bad input).
    let probe: IdValidation;
    try {
      probe = validateNationalId(country, "");
    } catch {
      continue;
    }
    // Derive a doc-type label (almost always "national_id" in this codebase).
    const idType = probe.idType || "national_id";
    const reasoning = probe.reasoning || `Validator for country ${country}`;
    // Try to find a country name in the doc-specs catalog.
    const countryName =
      DOCUMENT_SECURITY_SPECS.find((s) => s.country === country)?.countryName || country;
    const title = `${countryName} national ID validator (${country})`;
    const content = [
      `Country: ${countryName} (ISO alpha-2: ${country})`,
      `ID type: ${idType}`,
      `Algorithm: ${reasoning}`,
      ``,
      `Use POST /api/verify/validate-id with body { "country": "${country}", "id": "<id>" }`,
      `Returns: { isValid, checksumValid, extractedFields?, reasoning }`,
    ].join("\n");
    const keywords = [
      country.toLowerCase(),
      countryName.toLowerCase(),
      idType.toLowerCase(),
      "validator",
      "checksum",
      "national id",
      ...normalize(reasoning).split(" ").filter((w) => w.length > 3),
    ];
    chunks.push({
      id: `id-validators:${country}`,
      source: "id-validators",
      title,
      content,
      keywords: Array.from(new Set(keywords)),
    });
  }
  return chunks;
}

function buildMrzChunks(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  // Overview / check digit chunk
  chunks.push({
    id: "mrz:overview",
    source: "mrz",
    title: "MRZ parser — ICAO 9303 overview",
    content: [
      "The Machine Readable Zone (MRZ) is the standardized machine-readable text",
      "at the bottom of passports, ID cards, and residence permits. Parsing it gives",
      "authoritative structured data that does not depend on OCR accuracy.",
      "",
      "Three formats:",
      "  • TD1 — ID cards, residence permits — 3 lines × 30 chars",
      "  • TD2 — passport cards            — 2 lines × 36 chars",
      "  • TD3 — passport booklets         — 2 lines × 44 chars",
      "",
      "Each format uses check digits computed with weights [7, 3, 1] repeating.",
      "Values: 0-9 → 0-9, A-Z → 10-35, '<' → 0. Sum mod 10 = check digit.",
      "",
      "Country codes are ISO 3166-1 alpha-3 (e.g. EGY = Egypt, SAU = Saudi Arabia).",
      "",
      "Endpoints: POST /api/verify/parse-mrz  body: { text: 'P<EGYMOHAMED...' }",
    ].join("\n"),
    keywords: [
      "mrz",
      "machine readable zone",
      "icao 9303",
      "td1",
      "td2",
      "td3",
      "passport",
      "national id",
      "check digit",
      "alpha3",
      "parse",
    ],
  });

  // TD1 chunk
  chunks.push({
    id: "mrz:td1",
    source: "mrz",
    title: "MRZ TD1 format — ID cards (3 lines × 30 chars)",
    content: [
      "TD1 is used for ID cards and residence permits.",
      "Layout: 3 lines of exactly 30 characters each.",
      "",
      "Line 1: I[document_code](2) + ISO3(3) + doc_number(9) + check(1) + optional(15)",
      "Line 2: YYMMDD(6) + check(1) + sex(1) + YYMMDD(6) + check(1) + nationality(3) + optional(11) + composite(1)",
      "Line 3: name field (30) — surname<<given names",
      "",
      "Returned fields: format, documentCode, issuingCountry, issuingCountryName,",
      "documentNumber, documentNumberCheckValid, birthDate, birthDateCheckValid,",
      "sex, expiryDate, expiryDateCheckValid, nationality, nationalityName,",
      "name{primary, secondary, full}, compositeCheckValid, valid, errors[]",
      "",
      `Use parseTD1(lines) or parseMrz(text) which auto-detects the format.`,
    ].join("\n"),
    keywords: ["td1", "id card", "residence permit", "30 chars", "mrz", "parse", "icao"],
  });

  // TD2 chunk
  chunks.push({
    id: "mrz:td2",
    source: "mrz",
    title: "MRZ TD2 format — passport cards (2 lines × 36 chars)",
    content: [
      "TD2 is used for passport cards and similar 2-line documents.",
      "Layout: 2 lines of exactly 36 characters each.",
      "",
      "Line 1: I[doc_code](2) + ISO3(3) + name field (31)",
      "Line 2: doc_number(9) + check(1) + nationality(3) + YYMMDD(6) + check(1) + sex(1) + YYMMDD(6) + check(1) + optional(7) + composite(1)",
      "",
      "Returned fields: same shape as TD1 (format, documentCode, country, names, dates, etc.).",
      "",
      `Use parseTD2(lines) or parseMrz(text) which auto-detects the format.`,
    ].join("\n"),
    keywords: ["td2", "passport card", "36 chars", "mrz", "parse", "icao"],
  });

  // TD3 chunk
  chunks.push({
    id: "mrz:td3",
    source: "mrz",
    title: "MRZ TD3 format — passport booklets (2 lines × 44 chars)",
    content: [
      "TD3 is used for passport booklets (the standard passport book).",
      "Layout: 2 lines of exactly 44 characters each.",
      "",
      "Line 1: P< + ISO3(3) + name field (surname<<given, 39 chars)",
      "Line 2: passport_number(9) + check(1) + nationality(3) + YYMMDD(6) + check(1) + sex(1) + YYMMDD(6) + check(1) + personal_number(14) + composite(1)",
      "",
      "Composite check digit covers positions 1-10, 14-20, and 21-42 of line 2",
      "(NOT the composite check digit itself at position 43, and INCLUDING sex at position 21).",
      "",
      `Use parseTD3(lines) or parseMrz(text) which auto-detects the format.`,
    ].join("\n"),
    keywords: ["td3", "passport booklet", "44 chars", "mrz", "parse", "icao", "passport"],
  });

  return chunks;
}

function buildCrossFieldChunks(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  chunks.push({
    id: "cross-field:overview",
    source: "cross-field",
    title: `Cross-field validation — ${CROSS_FIELD_CHECK_COUNT} consistency checks`,
    content: [
      "The cross-field validation engine catches inconsistencies between extracted fields",
      "that AI consensus might miss. Each check produces a CrossFieldFlag with severity",
      "(info / warning / error / critical).",
      "",
      "Severity → consistency-score deduction per flag:",
      "  critical = 1.0 (hard fail)",
      "  error    = 0.5 (major issue)",
      "  warning  = 0.2 (minor issue)",
      "  info     = 0.0 (advisory only)",
      "",
      "Fraud-probability weight per flag:",
      "  critical = 0.30",
      "  error    = 0.15",
      "  warning  = 0.05",
      "  info     = 0.00",
      "",
      `Endpoint: POST /api/verify/cross-check  body: CrossFieldInput`,
      "Response: { flags, consistencyScore, hasCritical, hasErrors, fraudProbability, checkCount, byCode }",
    ].join("\n"),
    keywords: [
      "cross field",
      "validation",
      "consistency",
      "fraud",
      "checksum",
      "mrz",
      "name script",
      "arabic",
      "english",
      "age",
      "expiry",
      "issue",
    ],
  });

  for (const name of CROSS_FIELD_CHECK_NAMES) {
    const keywords = name
      .toLowerCase()
      .split("_")
      .filter((w) => w.length > 1);
    const description = describeCrossFieldCheck(name);
    chunks.push({
      id: `cross-field:${name}`,
      source: "cross-field",
      title: `Cross-field check — ${name}`,
      content: [
        `Check name: ${name}`,
        ``,
        description,
        ``,
        `Inputs inspected by this check are inferred from the CrossFieldInput struct:`,
        `fullNameAr, fullNameEn, nationalId, country, birthDate, gender, expiryDate,`,
        `issueDate, nationality, documentNo, mrzText, docType, birthPlace, issuePlace,`,
        `photoGender, photoPresent.`,
      ].join("\n"),
      keywords: [...keywords, "cross field", "check", "validation"],
    });
  }
  return chunks;
}

/** Short human-readable description per cross-field check name. */
function describeCrossFieldCheck(name: string): string {
  const map: Record<string, string> = {
    ID_FORMAT_CHECKSUM:
      "Validates the national ID format + checksum (calls validateNationalId for the detected country). Critical if checksum fails.",
    ID_GENDER_MATCH:
      "Checks that the gender encoded in the national ID matches the extracted gender field (e.g. Egyptian ID sequence odd = Male, even = Female).",
    ID_BIRTHDATE_MATCH:
      "Checks that the birth date encoded in the national ID matches the extracted birth date.",
    ID_BIRTHPLACE_MATCH:
      "Checks that the birth place encoded in the national ID matches the extracted birth place (where supported).",
    ARABIC_NAME_SCRIPT:
      "Flags Arabic name fields that contain Latin characters (script mismatch = fraud signal).",
    ENGLISH_NAME_SCRIPT:
      "Flags English name fields that contain Arabic characters.",
    ARABIC_NAME_DICTIONARY:
      "Checks each Arabic name token against the 190+ Arabic name dictionary; unknown tokens are flagged.",
    BIRTHDATE_SANITY:
      "Validates that the birth date is a real calendar date and not in the future.",
    AGE_PLAUSIBILITY:
      "Checks the holder's age is plausible for the document type (no children with driver licenses, etc.).",
    EXPIRY_SANITY:
      "Flags documents that are already expired.",
    NATIONALITY_COUNTRY_MATCH:
      "Cross-checks that the nationality field matches the issuing country (extended to 20+ new countries in Task 19-c).",
    MRZ_CHECKSUMS:
      "Re-runs all four TD1/TD2/TD3 check digit validations (document number, birth date, expiry date, composite).",
    MRZ_NAME_MATCH:
      "Cross-checks the MRZ name field against the OCR-extracted name fields.",
    MRZ_DOCNUM_MATCH:
      "Cross-checks the MRZ document number against the OCR-extracted document number.",
    MRZ_NATIONALITY_MATCH:
      "Cross-checks the MRZ nationality (ISO alpha-3) against the extracted nationality.",
    MRZ_BIRTHDATE_MATCH:
      "Cross-checks the MRZ birth date against the extracted birth date.",
    MRZ_GENDER_MATCH:
      "Cross-checks the MRZ sex marker (M/F) against the extracted gender.",
    MRZ_EXPIRY_MATCH:
      "Cross-checks the MRZ expiry date against the extracted expiry date.",
    DOCUMENT_VALIDITY_PERIOD:
      "Checks the document is within its expected validity window (issue date < today < expiry date).",
    ISSUE_DATE_PLAUSIBILITY:
      "Flags issue dates in the future or implausibly far in the past.",
    ISSUE_AFTER_BIRTH:
      "Sanity check: the document must have been issued after the holder was born.",
    PHOTO_GENDER_MATCH:
      "Heuristic: cross-checks the gender detected from the photo (if any) against the extracted gender.",
    NAME_LENGTH_SANITY:
      "Flags names that are suspiciously short or long.",
    REQUIRED_FIELDS_PRESENT:
      "Flags missing required fields (per doc type) — e.g. national_id is required for national_id docs.",
    DATE_FORMAT_CONSISTENCY:
      "Flags dates that are not in ISO YYYY-MM-DD format.",
    GENDER_ENUM:
      "Validates that gender is exactly 'Male', 'Female', or 'Other'.",
    DOCUMENT_NUMBER_FORMAT:
      "Validates that the document number matches the expected country-specific format (length, charset).",
    ISSUE_PLACE_PLAUSIBILITY:
      "Flags issue places that don't look plausible (e.g. mismatched country).",
    CROSS_LANGUAGE_NAME_SIMILARITY:
      "Cross-checks the Arabic and English name fields by transliterating Arabic to Latin and computing Levenshtein distance.",
    EXPIRY_RECENTLY_ISSUED:
      "Flags documents whose expiry is suspiciously soon after the issue date (e.g. < 1 month validity).",
    // ── Task 19-c — 15 new checks ──
    ID_BIRTHDATE_NEW_COUNTRIES:
      "Decodes the birthDate embedded at country-specific positions in the national ID for the 20 new countries (VN/TH/ID/MY/LK/LB/SD/LY/YE) and cross-checks against the extracted birthDate.",
    ID_GENDER_NEW_COUNTRIES:
      "Decodes the gender digit embedded in the national ID for new countries (Indonesia NIK day+40 offset, Malaysia MyKad pos 7, Thailand pos 13, Vietnam heuristic) and cross-checks against the extracted gender.",
    DOCUMENT_NUMBER_FORMAT_BY_COUNTRY:
      "Validates the document number against the country-specific pattern for the 20 new countries (VN 12 digits, ID 16 digits, SG S/T/F/G/M letter + 7 digits + check letter, etc.).",
    NATIONALITY_DUAL_CITIZEN:
      "Handles dual-citizen cases for the new 20 countries — allows known nationality pairings (e.g. LB + French) and flags unverified pairs for secondary-document check.",
    MRZ_EXPIRY_DATE_VALIDITY:
      "Validates the MRZ expiry date is in the future, or within a 6-month grace period for recently expired documents.",
    MRZ_ISSUE_DATE_CONSISTENCY:
      "If the MRZ optional data encodes an issue date, validates it is after the birth date and before the expiry date.",
    NAME_LENGTH_BY_COUNTRY:
      "Flags names that are unusually short or long for the declared country (e.g. Arabic names typically 4-5 words, Western 2-3 words).",
    ADDRESS_FORMAT_BY_COUNTRY:
      "Flags addresses that don't match the expected country-specific format (e.g. US address should have a 5-digit ZIP, Arabic-country address should contain Arabic script).",
    PHOTO_PRESENCE:
      "Flags documents where no photo was detected — verification requires a holder photo.",
    DOCUMENT_AGE:
      "Flags documents that are too old (e.g. >50 years for indefinite-validity countries, >15 years for 10-year-reissue countries).",
    BIOMETRIC_TEMPLATE_CONSISTENCY:
      "If biometric face embeddings are available across multiple captures, flags high variance (likely different person).",
    CROSS_DOCUMENT_CONSISTENCY:
      "Cross-checks names, birthDate, and gender across all of the user's previously verified documents (e.g. national_id vs passport).",
    AGE_GENDER_CONSISTENCY:
      "Validates the country-specific gender digit (where present) against the declared gender, and flags minor-with-ID-card cases (e.g. age <16 with national ID).",
    NATIONALITY_LANGUAGE_CONSISTENCY:
      "Validates that the nationality country's official language matches the script of the extracted name (e.g. Egyptian → Arabic name, German → Latin name).",
    ISSUE_PLACE_NEW_COUNTRIES:
      "Validates the issue place against the extended authority list for the 20 new countries (KNOWN_ISSUING_AUTHORITIES now covers 28 countries).",
  };
  return map[name] || "Cross-field consistency check.";
}

function buildOcrChunks(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  chunks.push({
    id: "ocr:overview",
    source: "ocr",
    title: "OCR post-processing engine — overview",
    content: [
      "Corrects common OCR errors AFTER the AI consensus extraction, BEFORE cross-field validation.",
      "Catches errors that even multi-provider consensus might agree on (e.g. all 3 vision providers",
      "misread 'محمد' as 'محماد' — Levenshtein corrects it back to the canonical form).",
      "",
      "5 strategies:",
      "  1. Levenshtein distance against known vocabularies (Arabic names, country names, field labels)",
      "  2. Country-specific name dictionaries (most common names per region)",
      "  3. Common OCR confusion patterns (0↔O, 1↔l/I, 5↔S, 8↔B, etc.)",
      "  4. Field label normalization (الاسم → fullNameAr, الرقم القومي → nationalId, etc.)",
      "  5. Digit extraction and cleanup (remove spaces/dashes from IDs)",
      "",
      `Arabic name dictionary size: ${ARABIC_NAME_DICTIONARY.size} entries (male + female + surnames).`,
      "",
      "Endpoints: POST /api/verify/ocr-correct  body: { field, value }",
    ].join("\n"),
    keywords: [
      "ocr",
      "post process",
      "levenshtein",
      "arabic",
      "name dictionary",
      "confusion",
      "correction",
    ],
  });

  // Confusion patterns chunk (summarized)
  const confusionPairs = Object.keys(OCR_CONFUSION_MAP).slice(0, 30);
  chunks.push({
    id: "ocr:confusion",
    source: "ocr",
    title: "OCR confusion patterns (Latin + Arabic)",
    content: [
      "Bidirectional map of frequently-confused character pairs. Covers Latin",
      "digit↔letter and letter↔letter confusions plus Arabic letter↔letter confusions",
      "common in low-resolution OCR of ID cards, passports, and other identity documents.",
      "",
      `Sample of ${confusionPairs.length} of ${Object.keys(OCR_CONFUSION_MAP).length} entries:`,
      ...confusionPairs.map((k) => `  ${k} ↔ ${OCR_CONFUSION_MAP[k].join(", ")}`),
      "",
      "The function applyConfusionPatterns(text, isArabic) applies only the asymmetric,",
      "conservative subset (alef/hamza normalization in Arabic, rn→m / vv→w in Latin).",
      "Levenshtein-based correctors (correctNameField, cleanIdField) handle the symmetric pairs.",
    ].join("\n"),
    keywords: [
      "ocr",
      "confusion",
      "0 o",
      "1 l",
      "5 s",
      "8 b",
      "levenshtein",
      "latin",
      "arabic",
    ],
  });

  // Field labels chunk
  const fieldNames = Object.keys(FIELD_LABEL_PATTERNS);
  chunks.push({
    id: "ocr:field-labels",
    source: "ocr",
    title: "OCR field label patterns (Arabic + English)",
    content: [
      "Map of canonical field name → known labels (Arabic + English) that the OCR",
      "post-processor looks for to identify which field an OCR'd text snippet belongs to.",
      "",
      `Fields supported (${fieldNames.length}):`,
      ...fieldNames.map(
        (f) =>
          `  ${f}: ${FIELD_LABEL_PATTERNS[f].map((l) => l.label).join(" | ")}`,
      ),
      "",
      "Used by extractFieldByLabel(value, label) to strip the label from a captured value.",
    ].join("\n"),
    keywords: [
      "ocr",
      "field label",
      "arabic",
      "english",
      "الاسم",
      "الرقم القومي",
      "تاريخ الميلاد",
      "الجنسية",
      "name",
      "national id",
      "birth date",
      "nationality",
    ],
  });

  return chunks;
}

function buildFaceQualityChunks(): KnowledgeChunk[] {
  const dims: { name: string; desc: string }[] = [
    { name: "Brightness", desc: "Image brightness — not too dark, not too bright." },
    { name: "Contrast", desc: "Sufficient dynamic range between dark and light pixels." },
    { name: "Sharpness", desc: "Not blurry — measured via Laplacian variance on the grayscale image." },
    { name: "Face size", desc: "Face fills a sufficient portion of the frame (central-region variance proxy)." },
    { name: "Background uniformity", desc: "No distracting background — measured by corner std-dev." },
    { name: "Pose", desc: "Head pose (yaw / pitch / roll in degrees) from landmarks or gradient fallback. Frontal pose = high score." },
    { name: "Occlusion", desc: "Eyes / nose / mouth visibility via variance + edge density." },
    { name: "Lighting uniformity", desc: "Coefficient of variation of intensities across the face (1 = uniform)." },
    { name: "Color naturalness", desc: "No unnatural red/blue/green cast on skin tones." },
    { name: "Background simplicity", desc: "Edge density in background regions (1 = simple background)." },
    { name: "Face symmetry", desc: "Left/right half similarity (1 = symmetric)." },
    { name: "Defocus blur", desc: "Laplacian variance normalized (1 = no defocus blur)." },
    { name: "Motion blur", desc: "Directional gradient analysis (1 = no motion blur). Includes direction classification." },
  ];

  const chunks: KnowledgeChunk[] = [];
  chunks.push({
    id: "face-quality:overview",
    source: "face-quality",
    title: "Face image quality — 13 ISO/IEC 19794-5 dimensions",
    content: [
      "Evaluates face image quality on 13 dimensions. Each dimension scores 0..1.",
      "`overall` = legacy 5-dimension weighted average.",
      "`compositeQuality` = full 13-dimension weighted average.",
      "Pure TypeScript (uses `sharp` only for image decode/resize, no native deps).",
      "Runs in <80ms for a 640x480 image.",
      "",
      "Endpoint: POST /api/verify/face-quality  body: { image, landmarks? }",
      "Response: FaceQualityScore (5 legacy + 8 new sub-scores + overall + compositeQuality + issues + suggestions + pass)",
    ].join("\n"),
    keywords: [
      "face",
      "quality",
      "iso 19794",
      "brightness",
      "contrast",
      "sharpness",
      "pose",
      "blur",
      "occlusion",
    ],
  });

  for (const d of dims) {
    chunks.push({
      id: `face-quality:${d.name.toLowerCase().replace(/\s+/g, "-")}`,
      source: "face-quality",
      title: `Face quality — ${d.name}`,
      content: [
        `Dimension: ${d.name}`,
        ``,
        d.desc,
        ``,
        "Score range: 0..1 (1 = perfect).",
        "Returns issues[] and suggestions[] to help users improve their selfie.",
      ].join("\n"),
      keywords: [
        "face quality",
        d.name.toLowerCase(),
        "iso 19794",
        ...d.name.toLowerCase().split(/\s+/),
      ],
    });
  }
  return chunks;
}

function buildLivenessChunks(): KnowledgeChunk[] {
  const signals: { name: string; desc: string }[] = [
    { name: "Optical flow consistency", desc: "Coherent, non-zero optical flow across frames = real person. Inconsistent or zero flow = static photo / print attack." },
    { name: "LBP texture", desc: "Local Binary Pattern texture analysis — real skin has a distinctive texture distribution. Printed photos / screens have a different texture signature." },
    { name: "FFT moiré", desc: "Frequency-domain (FFT) moiré detection on the face ROI — screen-replay attacks produce high-frequency moiré noise spikes." },
    { name: "Color distortion", desc: "Detects color cast typical of printed photos (re-photographed or scanned) — real faces have natural skin tones." },
    { name: "3D depth disparity", desc: "Estimates 3D depth from left/right face-half disparity (brightness gradient proxy). Real 3D faces have a gradient; printed photos are flat." },
    { name: "Specular highlights", desc: "Real skin has specular highlights from ambient light. Printed photos / matte screens don't." },
    { name: "Blink detection", desc: "Eye-region intensity change over multiple frames. Real humans blink; static photos don't." },
    { name: "Motion direction", desc: "Block-based optical flow direction analysis (left / right / up / down / mixed). Used to verify the requested challenge action was actually performed." },
    { name: "Velocity profile", desc: "Motion velocity profile (bell curve = human, flat = static). Combined with motion smoothness to detect replay attacks." },
  ];

  const chunks: KnowledgeChunk[] = [];
  chunks.push({
    id: "liveness:overview",
    source: "liveness",
    title: "Liveness Pro — anti-spoofing v2 overview",
    content: [
      "Enhanced anti-spoofing liveness detection. Score: 0-100 with detailed breakdown.",
      "Threshold: 60 to pass.",
      "",
      "Score breakdown:",
      "  • Motion analysis (0-40): directional block-based optical flow",
      "  • Challenge-response (0-30): verifies requested action was performed",
      "  • Anti-spoofing (0-20): print attack, screen artifact, depth",
      "  • Temporal (0-10): motion smoothness + velocity profile",
      "  • PAD aggregate score (0..1): weighted combination of all 7 anti-spoof signals",
      "",
      "Pure TypeScript — `sharp` is used only for image decode/resize; all signal math",
      "(FFT, LBP, optical flow) operates on raw typed arrays.",
      "",
      "Endpoint: POST /api/verify/liveness-pro  body: { frames, actions }",
    ].join("\n"),
    keywords: [
      "liveness",
      "anti spoofing",
      "pad",
      "presentation attack",
      "print attack",
      "screen replay",
      "blink",
      "optical flow",
      "fft",
      "lbp",
    ],
  });

  for (const s of signals) {
    chunks.push({
      id: `liveness:${s.name.toLowerCase().replace(/\s+/g, "-")}`,
      source: "liveness",
      title: `Liveness signal — ${s.name}`,
      content: [
        `Signal: ${s.name}`,
        ``,
        s.desc,
        ``,
        "Score range: 0..1 (1 = real person, 0 = spoof).",
      ].join("\n"),
      keywords: [
        "liveness",
        "anti spoofing",
        s.name.toLowerCase(),
        ...s.name.toLowerCase().split(/\s+/),
      ],
    });
  }
  return chunks;
}

function buildAiConsensusChunks(): KnowledgeChunk[] {
  const chunks: KnowledgeChunk[] = [];

  chunks.push({
    id: "ai-consensus:overview",
    source: "ai-consensus",
    title: "AI consensus router — multi-provider overview",
    content: [
      "The Cirkle AI router sends every vision / text request to multiple free-tier",
      "providers IN PARALLEL and merges results. This consensus across independent",
      "providers catches single-provider hallucinations — if all providers agree,",
      "confidence is high; if they disagree, the consensus engine flags low confidence.",
      "",
      "Provider list (all free tier, no billing):",
      "  1. Google Gemini (gemini-2.5-flash) — vision OCR, face comparison, translation",
      "  2. Groq (llama-3.3-70b) — fast text generation, Arabic translation",
      "  3. OpenRouter (multi-model) — fallback for vision + text",
      "  4. NVIDIA (nvapi) — GPU-accelerated inference + vision",
      "  5. HuggingFace (inference API) — text generation",
      "",
      `Vision providers configured: ${hasVisionProviders() ? "yes" : "no"}`,
      `Text providers configured: ${hasTextProviders() ? "yes" : "no"}`,
      `Currently active: ${configuredProviders().join(", ") || "(none — set API keys)"}`,
      "",
      "Endpoint: GET /api/verify/consensus-status — reports active providers + brands.",
    ].join("\n"),
    keywords: [
      "ai",
      "consensus",
      "providers",
      "gemini",
      "groq",
      "openrouter",
      "nvidia",
      "huggingface",
      "multi provider",
    ],
  });

  const providerDetails: { name: string; model: string; role: string }[] = [
    { name: "Gemini", model: "gemini-2.5-flash", role: "Vision OCR, face comparison, translation. Free tier with generous limits." },
    { name: "Groq", model: "llama-3.3-70b-versatile", role: "Fast text generation and Arabic translation. Free tier, ultra-low latency." },
    { name: "OpenRouter", model: "inclusionai/ling-3.0-flash-vl:free", role: "Fallback vision + text. Multi-model gateway, free models available." },
    { name: "NVIDIA", model: "deepseek-ai/deepseek-v4-flash-0731", role: "GPU-accelerated inference + vision. NVIDIA NIM API free tier." },
    { name: "HuggingFace", model: "various", role: "Text generation via the HuggingFace Inference API." },
  ];

  for (const p of providerDetails) {
    chunks.push({
      id: `ai-consensus:${p.name.toLowerCase()}`,
      source: "ai-consensus",
      title: `AI provider — ${p.name}`,
      content: [
        `Provider: ${p.name}`,
        `Model: ${p.model}`,
        ``,
        p.role,
      ].join("\n"),
      keywords: [
        "ai",
        "consensus",
        p.name.toLowerCase(),
        p.model.toLowerCase(),
        ...p.name.toLowerCase().split(/\s+/),
      ],
    });
  }

  return chunks;
}

function buildCertificateChunks(): KnowledgeChunk[] {
  return [
    {
      id: "certificate:overview",
      source: "certificate",
      title: "Verification certificate — cryptographic proof of identity",
      content: [
        "After a verification completes, Cirkle issues a signed certificate that any third",
        "party can independently verify (no API call needed).",
        "",
        "Competitors (Onfido, Jumio) issue opaque 'verified' statuses that require",
        "trusting their platform. Cirkle issues a cryptographic certificate with:",
        "  • Verification result (status, scores, fields)",
        "  • Timestamp + expiry (TTL = 90 days)",
        "  • Digital signature (HMAC-SHA256 with platform signing key)",
        "  • Verification ID (traceable)",
        "  • Knowledge layers applied (8 layers listed)",
        "",
        "Anyone can verify the certificate using:",
        "  POST /api/v1/verify/certificate/verify  body: { certificate }",
        "",
        "Endpoint to issue:  POST /api/v1/verify/certificate  body: { verificationId, subject, result, layers, epoch }",
      ].join("\n"),
      keywords: [
        "certificate",
        "verification",
        "hmac",
        "signature",
        "proof",
        "third party",
        "signed",
      ],
    },
  ];
}

function buildRiskChunks(): KnowledgeChunk[] {
  return [
    {
      id: "risk:overview",
      source: "risk",
      title: "Risk-adaptive verification — dynamic strictness",
      content: [
        "Dynamically adjusts verification strictness based on risk signals.",
        "Competitors charge MORE for high-risk checks. Cirkle adapts for free.",
        "",
        "Levels:",
        "  • Low-risk  (new device, first verification, low-risk country) → 1 liveness challenge, fast flow",
        "  • Medium-risk (repeat user, known country) → 2 challenges",
        "  • High-risk (duplicate ID, velocity, blacklisted IP, geo-mismatch) → 3+ challenges + tampering + cross-field",
        "",
        "Risk factors scored:",
        "  • Duplicate ID (weight 30)",
        "  • Image reuse / hash match (weight 25)",
        "  • Geo-mismatch — browser language ≠ document country (weight 15)",
        "  • Repeat device fingerprint (weight 5)",
        "  • Name script mismatch (Latin name with Arabic chars, weight 10)",
        "",
        "Level thresholds: 0-9 = low, 10-29 = medium, 30+ = high.",
        "Challenge actions are shuffled for unpredictability (prevents replay attacks).",
        "",
        "Endpoint: POST /api/v1/verify/risk-assessment  body: RiskInput",
        "Response: RiskAssessment { level, score, factors[], recommendedActions[], requireTamperingCheck, requireCrossFieldCheck, requireFaceQuality, reasoning }",
      ].join("\n"),
      keywords: [
        "risk",
        "adaptive",
        "strictness",
        "liveness challenge",
        "duplicate id",
        "image reuse",
        "geo mismatch",
        "device fingerprint",
      ],
    },
  ];
}

// ─── Lazy initialization ─────────────────────────────────────────────

let cachedChunks: KnowledgeChunk[] | null = null;
let cachedStats: KnowledgeStats | null = null;

function buildAllChunks(): KnowledgeChunk[] {
  if (cachedChunks) return cachedChunks;
  const countryNames = buildCountryNames();
  const chunks: KnowledgeChunk[] = [
    ...buildDocSpecChunks(countryNames),
    ...buildIdValidatorChunks(),
    ...buildMrzChunks(),
    ...buildCrossFieldChunks(),
    ...buildOcrChunks(),
    ...buildFaceQualityChunks(),
    ...buildLivenessChunks(),
    ...buildAiConsensusChunks(),
    ...buildCertificateChunks(),
    ...buildRiskChunks(),
  ];
  cachedChunks = chunks;
  return chunks;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Keyword search across all knowledge sources. Case-insensitive, matches on
 * country names, document types, feature names, ID validator country names, etc.
 * Returns ranked chunks (most keyword matches first).
 */
export function searchKnowledgeBase(query: string, maxResults = 8): KnowledgeChunk[] {
  const chunks = buildAllChunks();
  const q = normalize(query);
  if (!q) return [];

  const terms = q.split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  const scored = chunks.map((c) => {
    const haystack = c.keywords.join(" ") + " " + normalize(c.title) + " " + normalize(c.content);
    let score = 0;
    for (const term of terms) {
      // Whole-word match in keywords = highest weight
      const kwHit = c.keywords.some((k) => k === term || k.includes(term));
      if (kwHit) score += 5;
      // Substring in keyword (covers multi-word keywords like "national id")
      const kwSubstringHits = c.keywords.filter((k) => k.includes(term)).length;
      score += kwSubstringHits;
      // Prefix / morphological variant match — handles "egyptian" → "egypt",
      // "japanese" → "japan", "saudi" → "saudi arabia", etc. (length >= 3 to
      // avoid noise from short terms).
      if (term.length >= 3) {
        const prefixHits = c.keywords.filter(
          (k) =>
            k.length >= 3 &&
            (term.startsWith(k) || k.startsWith(term)),
        ).length;
        score += prefixHits * 2;
      }
      // Substring in title / content
      const titleHits = (haystack.match(new RegExp(escapeRegex(term), "g")) || []).length;
      score += Math.min(titleHits, 5);
    }
    return { chunk: c, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.chunk);
}

/** Escape a string for safe use inside a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns all knowledge chunks. Used to build the system prompt context (or
 * for debugging / inspection).
 */
export function getAllKnowledge(): KnowledgeChunk[] {
  return buildAllChunks();
}

/** Quick stats for the chatbot's self-introduction. */
export function getKnowledgeStats(): KnowledgeStats {
  if (cachedStats) return cachedStats;
  const countryNames = buildCountryNames();
  const countries = new Set<string>();
  let docSpecs = 0;
  for (const spec of DOCUMENT_SECURITY_SPECS) {
    countries.add(spec.country);
    docSpecs++;
  }
  const stats: KnowledgeStats = {
    countries: countries.size || getSecuritySpecCountries().length,
    docSpecs,
    idValidators: supportedCountries().length,
    mrzFormats: ["TD1", "TD2", "TD3"],
    crossFieldChecks: CROSS_FIELD_CHECK_COUNT,
    faceQualityDims: 13,
    livenessSignals: 9,
    aiProviders: 5,
  };
  cachedStats = stats;
  // Touch countryNames to avoid "unused variable" lint
  void countryNames;
  return stats;
}
