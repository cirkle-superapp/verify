/**
 * Cross-Field Validation Engine.
 *
 * Catches inconsistencies between extracted fields that AI consensus might miss.
 * For example:
 *   - nationalId encodes Male (Egyptian ID seq is odd) but extracted gender = Female → flag
 *   - nationalId encodes birthDate 1995-01-01 but extracted birthDate = 1990-06-15 → flag
 *   - nationalId country = EG but extracted nationality = SA → flag
 *   - MRZ says passport expires 2028 but extracted expiry = 2025 → flag
 *   - fullNameAr contains Latin chars → flag
 *   - fullNameEn contains Arabic chars → flag
 *   - birthDate in the future → flag
 *   - expiryDate before today → flag (expired)
 *   - nationalId checksum invalid → flag (high severity)
 *
 * Each check produces a CrossFieldFlag with severity (info/warning/error/critical).
 * The verification flow uses this to adjust confidence and surface fraud signals.
 *
 * Severity → score-deduction mapping (updated Task 9-a):
 *   critical = 1.0 deduction (hard fail)
 *   error    = 0.5 deduction (major issue)
 *   warning  = 0.2 deduction (minor issue)
 *   info     = 0.0 deduction (advisory only)
 */

import { validateNationalId } from "@/lib/id-validators";
import { parseMrz, type MrzResult } from "@/lib/mrz-parser";
import { ARABIC_NAME_DICTIONARY } from "@/lib/ocr-postprocess";

export type CrossFieldSeverity = "info" | "warning" | "error" | "critical";

export interface CrossFieldFlag {
  code: string;
  field: string;
  severity: CrossFieldSeverity;
  message: string;
  expected?: string;
  actual?: string;
}

export interface CrossFieldResult {
  flags: CrossFieldFlag[];
  consistencyScore: number; // 0..1 (1 = perfectly consistent)
  hasCritical: boolean;
  hasErrors: boolean;
  fraudProbability: number; // 0..1 (0 = likely genuine, 1 = likely fraud)
  checkCount: number; // total number of checks evaluated
  /** Map of check code → flag(s) emitted (for UI breakdown). */
  byCode: Record<string, CrossFieldFlag[]>;
}

export interface CrossFieldInput {
  fullNameAr?: string;
  fullNameEn?: string;
  nationalId?: string;
  country?: string; // ISO 3166-1 alpha-2
  birthDate?: string; // ISO YYYY-MM-DD
  gender?: string; // "Male" | "Female" | "Other"
  expiryDate?: string;
  issueDate?: string;
  nationality?: string;
  documentNo?: string;
  mrzText?: string;
  docType?: string;
  birthPlace?: string;
  issuePlace?: string;
  /** Gender detected by the photo/face analyzer (for human review only). */
  photoGender?: string;
  /** Whether a photo was extracted at all. */
  photoPresent?: boolean;
}

/** Severity → consistency-score deduction per Task 9-a spec. */
const SEVERITY_DEDUCTION: Record<CrossFieldSeverity, number> = {
  critical: 1.0,
  error: 0.5,
  warning: 0.2,
  info: 0.0,
};

/** Severity → fraud-probability weight per flag. */
const SEVERITY_FRAUD_WEIGHT: Record<CrossFieldSeverity, number> = {
  critical: 0.3,
  error: 0.15,
  warning: 0.05,
  info: 0.0,
};

// ─── Small pure helper functions ────────────────────────────────

function normalizeGender(s?: string | null): "Male" | "Female" | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower.startsWith("m") || lower === "ذكر" || lower === "male") return "Male";
  if (lower.startsWith("f") || lower === "أنثى" || lower === "انثى" || lower === "female") return "Female";
  return null;
}

function containsArabic(s?: string | null): boolean {
  if (!s) return false;
  return /[\u0600-\u06FF\u0750-\u077F]/.test(s);
}

function containsLatin(s?: string | null): boolean {
  if (!s) return false;
  return /[a-zA-Z]/.test(s);
}

function parseIsoDate(s?: string): Date | null {
  if (!s) return null;
  // Accept YYYY-MM-DD or YYYY/MM/DD
  const m = s.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

function isIsoDateFormat(s?: string): boolean {
  if (!s) return false;
  return /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(s.trim());
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Simple Arabic→Latin transliteration for cross-language name similarity.
 * Not a true Arab transliteration, but good enough to detect gross
 * mismatches between Arabic and English name fields.
 */
function transliterateArabic(s: string): string {
  const map: Record<string, string> = {
    "\u0621": "a", "\u0622": "a", "\u0623": "a", "\u0624": "w", "\u0625": "a",
    "\u0626": "y", "\u0627": "a", "\u0628": "b", "\u0629": "h", "\u062a": "t",
    "\u062b": "th", "\u062c": "j", "\u062d": "h", "\u062e": "kh", "\u062f": "d",
    "\u0630": "th", "\u0631": "r", "\u0632": "z", "\u0633": "s", "\u0634": "sh",
    "\u0635": "s", "\u0636": "d", "\u0637": "t", "\u0638": "z", "\u0639": "a",
    "\u063a": "gh", "\u0640": "", "\u0641": "f", "\u0642": "q", "\u0643": "k",
    "\u0644": "l", "\u0645": "m", "\u0646": "n", "\u0647": "h", "\u0648": "w",
    "\u0649": "a", "\u064a": "y",
  };
  let out = "";
  for (const ch of s) out += map[ch] ?? ch;
  // Collapse repeated letters and trim
  return out.replace(/(.)\1+/g, "$1").trim();
}

function ageInYears(birth: Date, asOf: Date): number {
  const ms = asOf.getTime() - birth.getTime();
  return ms / (365.25 * 24 * 3600 * 1000);
}

function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 3600 * 1000);
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (24 * 3600 * 1000);
}

// ─── Egyptian governorate codes encoded in national ID ───────────
// Egyptian ID digits at positions 7-8 (2-digit governorate code) indicate
// birthplace governorate. Used by ID_BIRTHPLACE_MISMATCH check.
const EGYPT_GOVERNORATES: Record<string, string> = {
  "01": "Cairo",
  "02": "Damietta",
  "03": "Dakahlia",
  "04": "Sharqia",
  "05": "Qalyubia",
  "06": "Kafr El Sheikh",
  "07": "Gharbia",
  "08": "Monufia",
  "09": "Beheira",
  "10": "Ismailia",
  "11": "Giza",
  "12": "Beni Suef",
  "13": "Fayoum",
  "14": "Minya",
  "15": "Asyut",
  "16": "Sohag",
  "17": "Qena",
  "18": "Aswan",
  "19": "Luxor",
  "20": "Red Sea",
  "21": "New Valley",
  "22": "Matrouh",
  "23": "North Sinai",
  "24": "South Sinai",
  "25": "Port Said",
  "26": "Suez",
  "88": "Born Abroad",
};

// ─── Known issuing-authority substrings per country ──────────────
// Used by ISSUE_PLACE_UNKNOWN check. Very small starter list; the
// check is "warning" not "error" so unlisted issuePlace is just advisory.
const KNOWN_ISSUING_AUTHORITIES: Record<string, string[]> = {
  EG: ["cairo", "giza", "egypt", "ministry of interior", "مصر", "الداخلية"],
  SA: ["saudi", "riyadh", "jeddah", "ministry of interior", "السعودية", "الداخلية"],
  AE: ["emirates", "uae", "abu dhabi", "dubai", "الإمارات"],
  US: ["united states", "state department", "passport agency"],
  GB: ["united kingdom", "uk", "hm passport", "ips"],
  FR: ["france", "prefecture", "sous-prefecture"],
  DE: ["germany", "deutschland", "bundesrepublik", "burgeramt"],
  TR: ["türkiye", "turkey", "nüfus", "(passport)"],
};

// ─── Document-number format expectations per country ─────────────
// Each entry: { pattern: regex source, length: [min, max] }
const DOCUMENT_NO_PATTERNS: Record<string, { pattern: string; length: [number, number] }> = {
  // Passports: 1-2 letters + 7-8 digits, or 9 digits
  default_passport: { pattern: "^[A-Z0-9<]{6,12}$", length: [6, 12] },
  // Egyptian national ID: 14 digits
  EG: { pattern: "^\\d{14}$", length: [14, 14] },
  // Saudi national ID: 10 digits
  SA: { pattern: "^\\d{10}$", length: [10, 10] },
  // UAE national ID: 15 digits (residence permit format also 15)
  AE: { pattern: "^\\d{15}$", length: [15, 15] },
  // Israeli Teudat Zehut: 9 digits
  IL: { pattern: "^\\d{9}$", length: [9, 9] },
  // Turkish TC Kimlik: 11 digits
  TR: { pattern: "^\\d{11}$", length: [11, 11] },
  // French INSEE: 15 digits
  FR: { pattern: "^\\d{15}$", length: [15, 15] },
  // Spanish DNI: 8 digits + 1 letter
  ES: { pattern: "^\\d{8}[A-Z]$", length: [9, 9] },
  // Portuguese CC: 12 digits (Citizen Card)
  PT: { pattern: "^\\d{8}\\d{2}\\d[A-Z0-9]\\d", length: [12, 12] },
  // Brazilian CPF: 11 digits
  BR: { pattern: "^\\d{11}$", length: [11, 11] },
};

// ─── Country → ISO 3166-1 alpha-3 (used for MRZ nationality check) ─
const ALPHA2_TO_ALPHA3: Record<string, string> = {
  EG: "EGY", SA: "SAU", AE: "ARE", KW: "KWT", QA: "QAT", JO: "JOR", MA: "MAR",
  TN: "TUN", DZ: "DZA", LB: "LBN", IQ: "IRQ", SY: "SYR", LY: "LBY", SD: "SDN",
  BH: "BHR", OM: "OMN", YE: "YEM", PS: "PSE", IL: "ISR", TR: "TUR", IR: "IRN",
  US: "USA", GB: "GBR", FR: "FRA", DE: "DEU", ES: "ESP", IT: "ITA", NL: "NLD",
  BE: "BEL", SE: "SWE", NO: "NOR", DK: "DNK", FI: "FIN", PL: "POL", CZ: "CZE",
  GR: "GRC", RO: "ROU", PT: "PRT", IE: "IRL", AT: "AUT", CH: "CHE", HU: "HUN",
  BG: "BGR", HR: "HRV", RS: "SRB", SK: "SVK", SI: "SVN", EE: "EST", LV: "LVA",
  LT: "LTU", IS: "ISL", RU: "RUS", UA: "UKR", BY: "BLR", IN: "IND", PK: "PAK",
  BD: "BGD", JP: "JPN", KR: "KOR", CN: "CHN", SG: "SGP", MY: "MYS", TH: "THA",
  ID: "IDN", PH: "PHL", VN: "VNM", AU: "AUS", NZ: "NZL", CA: "CAN", BR2: "BRA",
  AR: "ARG", CL: "CHL", CO: "COL", PE: "PER", MX: "MEX", ZA: "ZAF", NG: "NGA",
  KE: "KEN", ID2: "IDN", HK: "HKG",
};

function alpha2ToAlpha3(code?: string): string | null {
  if (!code) return null;
  return ALPHA2_TO_ALPHA3[code.toUpperCase()] || null;
}

// ─── Cross-field check function type ─────────────────────────────
// Each check is a pure function: takes the full input, returns 0..n flags.
type CrossFieldCheck = (input: CrossFieldInput, ctx: CheckContext) => CrossFieldFlag[];

interface CheckContext {
  today: Date;
  mrz: MrzResult | null;
  /** Cached validateNationalId() result (only if nationalId+country present). */
  idValidation: ReturnType<typeof validateNationalId> | null;
}

// ═══════════════════════════════════════════════════════════════════
// CHECK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

// ─── 1. ID validity + checksum (existing, refactored to single check) ───
function checkIdValidity(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { nationalId, country } = input;
  if (!nationalId || !country || !_ctx.idValidation) return flags;
  const v = _ctx.idValidation;
  if (!v.isValid) {
    flags.push({
      code: "ID_FORMAT_INVALID",
      field: "nationalId",
      severity: "error",
      message: `National ID format invalid for ${country}: ${v.reasoning}`,
    });
  } else if (!v.checksumValid) {
    flags.push({
      code: "ID_CHECKSUM_MISMATCH",
      field: "nationalId",
      severity: "critical",
      message: `National ID checksum failed for ${country} — possible fabrication`,
    });
  }
  return flags;
}

// ─── 2. ID-encoded gender vs extracted gender ──────────────────────
function checkIdGenderMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.idValidation?.extractedFields?.gender || !input.gender) return flags;
  const idGender = ctx.idValidation.extractedFields.gender;
  const extGender = normalizeGender(input.gender);
  if (extGender && idGender !== extGender) {
    flags.push({
      code: "GENDER_MISMATCH_ID",
      field: "gender",
      severity: "critical",
      message: `Gender mismatch: national ID encodes ${idGender} but extracted field says ${extGender}`,
      expected: idGender,
      actual: extGender,
    });
  }
  return flags;
}

// ─── 3. ID-encoded birth date vs extracted birth date ────────────
function checkIdBirthDateMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.idValidation?.extractedFields?.birthDate || !input.birthDate) return flags;
  const idBirth = ctx.idValidation.extractedFields.birthDate;
  const extBirth = input.birthDate.slice(0, 10);
  if (idBirth === extBirth) return flags;
  const idYear = idBirth.slice(0, 4);
  const extYear = extBirth.slice(0, 4);
  if (idYear !== extYear) {
    flags.push({
      code: "BIRTHDATE_YEAR_MISMATCH",
      field: "birthDate",
      severity: "error",
      message: `Birth year mismatch: national ID encodes ${idYear} but extracted field says ${extYear}`,
      expected: idBirth,
      actual: extBirth,
    });
  } else {
    flags.push({
      code: "BIRTHDATE_MISMATCH",
      field: "birthDate",
      severity: "warning",
      message: `Birth date mismatch: national ID says ${idBirth} but extracted ${extBirth}`,
      expected: idBirth,
      actual: extBirth,
    });
  }
  return flags;
}

// ─── 4. ID-encoded birthplace vs extracted birthPlace (Egyptian IDs) ─
function checkIdBirthPlaceMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { nationalId, country, birthPlace } = input;
  if (!nationalId || !country || !birthPlace || !ctx.idValidation) return flags;
  // Only Egyptian IDs encode a 2-digit governorate code at positions 7-8.
  if (country.toUpperCase() !== "EG") return flags;
  if (!/^\d{14}$/.test(nationalId)) return flags;
  const govCode = nationalId.slice(7, 9);
  const idBirthPlace = EGYPT_GOVERNORATES[govCode];
  if (!idBirthPlace) {
    flags.push({
      code: "ID_BIRTHPLACE_CODE_UNKNOWN",
      field: "nationalId",
      severity: "warning",
      message: `Egyptian ID governorate code "${govCode}" not recognized`,
    });
    return flags;
  }
  const bpLower = birthPlace.toLowerCase();
  if (!bpLower.includes(idBirthPlace.toLowerCase()) &&
      !idBirthPlace.toLowerCase().includes(bpLower)) {
    flags.push({
      code: "ID_BIRTHPLACE_MISMATCH",
      field: "birthPlace",
      severity: "warning",
      message: `National ID encodes birthplace "${idBirthPlace}" but extracted "${birthPlace}"`,
      expected: idBirthPlace,
      actual: birthPlace,
    });
  }
  return flags;
}

// ─── 5. Arabic name field contains non-Arabic letters (expanded) ──
function checkArabicNameScript(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { fullNameAr } = input;
  if (!fullNameAr) return flags;
  // Arabic name must contain only Arabic letters + spaces + optional shadda/tatweel.
  // Allow Arabic diacritics (tashkeel) too.
  const valid = /^[\u0600-\u06FF\u0750-\u077F\s\u0640\u0670\u06D6-\u06ED]*$/.test(fullNameAr);
  if (!valid && containsLatin(fullNameAr)) {
    flags.push({
      code: "ARABIC_NAME_HAS_LATIN",
      field: "fullNameAr",
      severity: "warning",
      message: "Arabic name field contains Latin characters — possible OCR confusion",
    });
  } else if (!valid) {
    flags.push({
      code: "ARABIC_NAME_HAS_NON_ARABIC",
      field: "fullNameAr",
      severity: "warning",
      message: "Arabic name field contains non-Arabic characters",
    });
  }
  return flags;
}

// ─── 6. English name field contains non-Latin letters (expanded) ──
function checkEnglishNameScript(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { fullNameEn } = input;
  if (!fullNameEn) return flags;
  const valid = /^[a-zA-Z\s\-'.]*$/.test(fullNameEn);
  if (!valid && containsArabic(fullNameEn)) {
    flags.push({
      code: "ENGLISH_NAME_HAS_ARABIC",
      field: "fullNameEn",
      severity: "warning",
      message: "English name field contains Arabic characters — possible OCR confusion",
    });
  } else if (!valid) {
    flags.push({
      code: "ENGLISH_NAME_HAS_NON_LATIN",
      field: "fullNameEn",
      severity: "warning",
      message: "English name field contains non-Latin characters",
    });
  }
  return flags;
}

// ─── 7. Arabic name tokens in dictionary (warn if unknown) ───────
function checkArabicNameDictionary(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { fullNameAr } = input;
  if (!fullNameAr || !containsArabic(fullNameAr)) return flags;
  const tokens = fullNameAr.trim().split(/\s+/).filter((t) => t.length > 1);
  const unknown = tokens.filter((t) => !ARABIC_NAME_DICTIONARY.has(t));
  if (unknown.length > 0) {
    flags.push({
      code: "ARABIC_NAME_NOT_IN_DICTIONARY",
      field: "fullNameAr",
      severity: "info",
      message: `${unknown.length} Arabic name token(s) not in name dictionary: ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""} — may be rare or OCR-corrupted`,
    });
  }
  return flags;
}

// ─── 8. Birth date in future / implausibly old ───────────────────
function checkBirthDateSanity(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const birth = parseIsoDate(input.birthDate);
  if (!birth) return flags;
  if (birth > ctx.today) {
    flags.push({
      code: "BIRTHDATE_FUTURE",
      field: "birthDate",
      severity: "error",
      message: "Birth date is in the future — invalid",
    });
    return flags;
  }
  const age = ageInYears(birth, ctx.today);
  if (age > 120) {
    flags.push({
      code: "BIRTHDATE_TOO_OLD",
      field: "birthDate",
      severity: "warning",
      message: `Birth date implies age ${Math.round(age)} — implausibly old`,
    });
  }
  if (age < 0) {
    flags.push({
      code: "BIRTHDATE_FUTURE",
      field: "birthDate",
      severity: "error",
      message: "Birth date is in the future",
    });
  }
  return flags;
}

// ─── 9. Age plausibility (minors need guardian; >100 unusual) ────
function checkAgePlausibility(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const birth = parseIsoDate(input.birthDate);
  if (!birth) return flags;
  const age = ageInYears(birth, ctx.today);
  if (age < 0 || age > 120) return flags; // handled by BIRTHDATE_FUTURE / TOO_OLD
  if (age < 16) {
    flags.push({
      code: "AGE_MINOR",
      field: "birthDate",
      severity: "info",
      message: `Age ${Math.floor(age)} — minor (guardian may be required)`,
    });
  }
  if (age > 100) {
    flags.push({
      code: "AGE_VERY_ELDERLY",
      field: "birthDate",
      severity: "warning",
      message: `Age ${Math.round(age)} — unusually old, verify document is genuine`,
    });
  }
  return flags;
}

// ─── 10. Document expiry sanity ──────────────────────────────────
function checkExpirySanity(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const expiry = parseIsoDate(input.expiryDate);
  if (!expiry) return flags;
  if (expiry < ctx.today) {
    flags.push({
      code: "DOCUMENT_EXPIRED",
      field: "expiryDate",
      severity: "error",
      message: `Document expired on ${input.expiryDate} (today is ${ctx.today.toISOString().slice(0, 10)})`,
    });
  } else {
    const days = daysBetween(ctx.today, expiry);
    if (days < 30) {
      flags.push({
        code: "DOCUMENT_EXPIRING_SOON",
        field: "expiryDate",
        severity: "info",
        message: `Document expires in ${Math.round(days)} days`,
      });
    }
  }
  return flags;
}

// ─── 11. Nationality vs country (with dual-citizen allowlist) ────
function checkNationalityCountryMatch(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, nationality } = input;
  if (!country || !nationality) return flags;
  const countryMap: Record<string, string[]> = {
    EG: ["egypt", "مصر", "egyptian"],
    SA: ["saudi", "السعودية", "saudi arabia"],
    AE: ["emirati", "الإمارات", "uae", "united arab emirates"],
    US: ["american", "united states", "usa"],
    GB: ["british", "uk", "united kingdom"],
    FR: ["french", "france"],
    DE: ["german", "germany", "deutsch"],
    TR: ["turkish", "türkiye", "turkey"],
    IN: ["indian", "india"],
    BR: ["brazilian", "brazil"],
  };
  const expected = countryMap[country.toUpperCase()];
  if (expected && !expected.some((e) => nationality.toLowerCase().includes(e))) {
    flags.push({
      code: "NATIONALITY_COUNTRY_MISMATCH",
      field: "nationality",
      severity: "warning",
      message: `Country is ${country} but nationality is "${nationality}" — possible dual citizen, verify`,
      expected: country,
      actual: nationality,
    });
  }
  return flags;
}

// ─── 12. MRZ parse + checksum validation (TD1/TD2/TD3) ────────────
function checkMrzChecksums(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz) return flags;
  const mrz = ctx.mrz;
  if (!mrz.documentNumberCheckValid) {
    flags.push({
      code: "MRZ_DOCNUM_CHECKSUM_FAIL",
      field: "mrzText",
      severity: "critical",
      message: `MRZ ${mrz.format} document-number check digit mismatch — likely OCR corruption or tampering`,
    });
  }
  if (!mrz.birthDateCheckValid) {
    flags.push({
      code: "MRZ_BIRTH_CHECKSUM_FAIL",
      field: "mrzText",
      severity: "error",
      message: `MRZ ${mrz.format} birth-date check digit mismatch`,
    });
  }
  if (!mrz.expiryDateCheckValid) {
    flags.push({
      code: "MRZ_EXPIRY_CHECKSUM_FAIL",
      field: "mrzText",
      severity: "error",
      message: `MRZ ${mrz.format} expiry-date check digit mismatch`,
    });
  }
  if (!mrz.compositeCheckValid) {
    flags.push({
      code: "MRZ_COMPOSITE_CHECKSUM_FAIL",
      field: "mrzText",
      severity: "critical",
      message: `MRZ ${mrz.format} composite check digit mismatch — likely tampering`,
    });
  }
  return flags;
}

// ─── 13. MRZ name vs extracted fullNameEn (Levenshtein ≤2) ───────
function checkMrzNameMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz?.name?.full || !input.fullNameEn) return flags;
  const mrzName = ctx.mrz.name.full.toUpperCase().replace(/[^A-Z ]/g, "").trim();
  const extName = input.fullNameEn.toUpperCase().replace(/[^A-Z ]/g, "").trim();
  if (!mrzName || !extName) return flags;
  // Token-set intersection (last name should match exactly)
  const mrzTokens = mrzName.split(/\s+/).filter(Boolean);
  const extTokens = extName.split(/\s+/).filter(Boolean);
  const shared = mrzTokens.some((t) => extTokens.includes(t) && t.length > 2);
  if (shared) return flags;
  // Otherwise: per-token Levenshtein; if all close, it's a minor warning
  let minDist = Infinity;
  for (const mt of mrzTokens) {
    for (const et of extTokens) {
      const d = levenshtein(mt, et);
      if (d < minDist) minDist = d;
    }
  }
  if (minDist > 2) {
    flags.push({
      code: "MRZ_NAME_MISMATCH",
      field: "fullNameEn",
      severity: "error",
      message: `MRZ name "${ctx.mrz.name.full}" doesn't match extracted "${input.fullNameEn}" (min token Levenshtein ${minDist})`,
    });
  } else {
    flags.push({
      code: "MRZ_NAME_NEAR_MATCH",
      field: "fullNameEn",
      severity: "info",
      message: `MRZ name near-matches extracted name (min token Levenshtein ${minDist}) — verify`,
    });
  }
  return flags;
}

// ─── 14. MRZ document number vs extracted documentNo ──────────────
function checkMrzDocNumberMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz?.documentNumber || !input.documentNo) return flags;
  const mrzDoc = ctx.mrz.documentNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const extDoc = input.documentNo.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!mrzDoc || !extDoc) return flags;
  if (mrzDoc === extDoc || mrzDoc.includes(extDoc) || extDoc.includes(mrzDoc)) return flags;
  flags.push({
    code: "MRZ_DOCNUM_MISMATCH",
    field: "documentNo",
    severity: "error",
    message: `MRZ document number "${ctx.mrz.documentNumber}" ≠ extracted "${input.documentNo}"`,
  });
  return flags;
}

// ─── 15. MRZ nationality (3-letter) vs extracted nationality ──────
function checkMrzNationalityMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz?.nationality || !input.country) return flags;
  const mrzNat = ctx.mrz.nationality.toUpperCase();
  const expected3 = alpha2ToAlpha3(input.country);
  if (!expected3) return flags;
  if (mrzNat !== expected3) {
    flags.push({
      code: "MRZ_NATIONALITY_MISMATCH",
      field: "nationality",
      severity: "warning",
      message: `MRZ nationality "${mrzNat}" ≠ extracted country "${input.country}" (→ ${expected3})`,
      expected: expected3,
      actual: mrzNat,
    });
  }
  return flags;
}

// ─── 16. MRZ birth date vs extracted birthDate ───────────────────
function checkMrzBirthDateMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz?.birthDate || !input.birthDate) return flags;
  const mrzB = ctx.mrz.birthDate.slice(0, 10);
  const extB = input.birthDate.slice(0, 10);
  if (mrzB === extB) return flags;
  const mrzYear = mrzB.slice(0, 4);
  const extYear = extB.slice(0, 4);
  if (mrzYear !== extYear) {
    flags.push({
      code: "MRZ_BIRTHDATE_MISMATCH",
      field: "birthDate",
      severity: "error",
      message: `MRZ birth year ${mrzYear} ≠ extracted ${extYear}`,
      expected: mrzB,
      actual: extB,
    });
  } else {
    flags.push({
      code: "MRZ_BIRTHDATE_DAY_MISMATCH",
      field: "birthDate",
      severity: "warning",
      message: `MRZ birth date ${mrzB} ≠ extracted ${extB} (year matches)`,
      expected: mrzB,
      actual: extB,
    });
  }
  return flags;
}

// ─── 17. MRZ sex vs extracted gender ──────────────────────────────
function checkMrzGenderMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz || ctx.mrz.sex === "Unspecified" || !input.gender) return flags;
  const extGender = normalizeGender(input.gender);
  if (extGender && ctx.mrz.sex !== extGender) {
    flags.push({
      code: "MRZ_GENDER_MISMATCH",
      field: "gender",
      severity: "critical",
      message: `MRZ sex "${ctx.mrz.sex}" ≠ extracted gender "${extGender}"`,
      expected: ctx.mrz.sex,
      actual: extGender,
    });
  }
  return flags;
}

// ─── 18. MRZ expiry vs extracted expiryDate ──────────────────────
function checkMrzExpiryMatch(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz?.expiryDate || !input.expiryDate) return flags;
  const mrzE = ctx.mrz.expiryDate.slice(0, 10);
  const extE = input.expiryDate.slice(0, 10);
  if (mrzE === extE) return flags;
  const mrzYear = mrzE.slice(0, 4);
  const extYear = extE.slice(0, 4);
  if (mrzYear !== extYear) {
    flags.push({
      code: "MRZ_EXPIRY_MISMATCH",
      field: "expiryDate",
      severity: "warning",
      message: `MRZ expiry year ${mrzYear} ≠ extracted ${extYear}`,
      expected: mrzE,
      actual: extE,
    });
  }
  return flags;
}

// ─── 19. Document validity period (issue → expiry) ───────────────
function checkDocumentValidityPeriod(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const issue = parseIsoDate(input.issueDate);
  const expiry = parseIsoDate(input.expiryDate);
  if (!issue || !expiry) return flags;
  const years = yearsBetween(issue, expiry);
  if (years <= 0) {
    flags.push({
      code: "EXPIRY_BEFORE_ISSUE",
      field: "expiryDate",
      severity: "error",
      message: `Expiry date (${input.expiryDate}) is before issue date (${input.issueDate})`,
    });
    return flags;
  }
  if (years > 15) {
    flags.push({
      code: "VALIDITY_PERIOD_TOO_LONG",
      field: "expiryDate",
      severity: "warning",
      message: `Document validity period ${years.toFixed(1)} years exceeds 15-year maximum — verify`,
      actual: `${years.toFixed(1)} years`,
    });
  }
  // Passport: typical 5 or 10 years
  if (input.docType === "passport") {
    if (years !== 5 && years !== 10 && years < 15) {
      flags.push({
        code: "PASSPORT_VALIDITY_UNUSUAL",
        field: "expiryDate",
        severity: "info",
        message: `Passport validity period ${years.toFixed(1)} years — typical is 5 or 10 years`,
      });
    }
  }
  return flags;
}

// ─── 20. Issue date plausibility (not future; expiry not past) ───
function checkIssueDatePlausibility(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const issue = parseIsoDate(input.issueDate);
  if (!issue) return flags;
  if (issue > ctx.today) {
    flags.push({
      code: "ISSUE_DATE_FUTURE",
      field: "issueDate",
      severity: "error",
      message: `Issue date ${input.issueDate} is in the future`,
    });
  }
  // (expiry-not-in-past is handled by DOCUMENT_EXPIRED above; we don't duplicate.)
  return flags;
}

// ─── 21. Issue-before-birth check (national IDs need ≥14-year gap) ─
function checkIssueAfterBirth(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const birth = parseIsoDate(input.birthDate);
  const issue = parseIsoDate(input.issueDate);
  if (!birth || !issue) return flags;
  if (issue < birth) {
    flags.push({
      code: "ISSUE_BEFORE_BIRTH",
      field: "issueDate",
      severity: "critical",
      message: `Issue date (${input.issueDate}) is before birth date (${input.birthDate}) — impossible`,
      expected: `after ${input.birthDate}`,
      actual: input.issueDate,
    });
    return flags;
  }
  const ageAtIssue = yearsBetween(birth, issue);
  if (input.docType === "national_id" && ageAtIssue < 14) {
    flags.push({
      code: "ISSUED_TO_MINOR",
      field: "issueDate",
      severity: "info",
      message: `National ID issued at age ${ageAtIssue.toFixed(1)} (under 14) — may be parent-issued minor ID`,
    });
  }
  return flags;
}

// ─── 22. Photo-vs-extracted-gender heuristic (informational) ─────
function checkPhotoGenderMatch(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!input.photoPresent || !input.photoGender || !input.gender) return flags;
  const photoG = normalizeGender(input.photoGender);
  const extG = normalizeGender(input.gender);
  if (photoG && extG && photoG !== extG) {
    flags.push({
      code: "PHOTO_GENDER_HEURISTIC_MISMATCH",
      field: "photo",
      severity: "info",
      message: `Photo-derived gender "${photoG}" ≠ extracted gender "${extG}" — flag for human review (no automated decision)`,
      expected: extG,
      actual: photoG,
    });
  }
  return flags;
}

// ─── 23. Name length sanity (≥2 words for Arabic + English) ─────
function checkNameLengthSanity(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (input.fullNameAr) {
    const tokens = input.fullNameAr.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      flags.push({
        code: "ARABIC_NAME_TOO_SHORT",
        field: "fullNameAr",
        severity: "warning",
        message: `Arabic name has only ${tokens.length} token(s) — expected at least given + family name`,
      });
    }
  }
  if (input.fullNameEn) {
    const tokens = input.fullNameEn.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      flags.push({
        code: "ENGLISH_NAME_TOO_SHORT",
        field: "fullNameEn",
        severity: "warning",
        message: `English name has only ${tokens.length} token(s) — expected at least given + family name`,
      });
    }
  }
  return flags;
}

// ─── 24. Empty/missing required fields ────────────────────────────
function checkRequiredFieldsPresent(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const required: Array<[keyof CrossFieldInput, string]> = [
    ["nationalId", "nationalId"],
    ["fullNameAr", "fullNameAr"],
    ["fullNameEn", "fullNameEn"],
    ["birthDate", "birthDate"],
    ["gender", "gender"],
    ["nationality", "nationality"],
  ];
  for (const [key, field] of required) {
    const v = input[key];
    if (v === undefined || v === null || String(v).trim() === "") {
      flags.push({
        code: "MISSING_REQUIRED_FIELD",
        field,
        severity: "error",
        message: `Required field "${field}" is empty or missing`,
      });
    }
  }
  return flags;
}

// ─── 25. Date format consistency (YYYY-MM-DD) ────────────────────
function checkDateFormatConsistency(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const dateFields: Array<[keyof CrossFieldInput, string]> = [
    ["birthDate", "birthDate"],
    ["expiryDate", "expiryDate"],
    ["issueDate", "issueDate"],
  ];
  for (const [key, field] of dateFields) {
    const v = input[key];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    if (!isIsoDateFormat(String(v))) {
      flags.push({
        code: "DATE_FORMAT_NON_ISO",
        field,
        severity: "warning",
        message: `Date "${v}" is not in YYYY-MM-DD format — parsing may fail downstream`,
        actual: String(v),
      });
    }
  }
  return flags;
}

// ─── 26. Gender enum check ────────────────────────────────────────
function checkGenderEnum(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { gender } = input;
  if (!gender) return flags;
  const g = normalizeGender(gender);
  if (!g) {
    // "Other" is acceptable for countries that legally recognize a third gender
    // (e.g., DE: "diverse", IN: "Third Gender", NP: "Other"). Otherwise flag.
    const lower = gender.toLowerCase().trim();
    const otherAllowlist = ["other", "x", "non-binary", "nonbinary", "diverse", "third gender", "third"];
    if (otherAllowlist.some((t) => lower === t || lower.includes(t))) {
      flags.push({
        code: "GENDER_OTHER_ACCEPTED",
        field: "gender",
        severity: "info",
        message: `Gender "${gender}" recognized as non-binary/other — verify legally recognized in country`,
      });
    } else {
      flags.push({
        code: "GENDER_UNRECOGNIZED",
        field: "gender",
        severity: "warning",
        message: `Gender value "${gender}" not recognized — expected "Male" or "Female"`,
        actual: gender,
      });
    }
  }
  return flags;
}

// ─── 27. Document number format (per-country pattern) ─────────────
function checkDocumentNumberFormat(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { documentNo, country, docType } = input;
  if (!documentNo) return flags;
  // For passports, use the default passport pattern; for national IDs use country pattern
  let pattern: { pattern: string; length: [number, number] } | undefined;
  if (docType === "passport" || (!country && !docType)) {
    pattern = DOCUMENT_NO_PATTERNS["default_passport"];
  } else if (country) {
    pattern = DOCUMENT_NO_PATTERNS[country.toUpperCase()];
  }
  // If no pattern is configured, fall back to "alphanumeric, length 6-14"
  const p = pattern || { pattern: "^[A-Z0-9<]{6,14}$", length: [6, 14] as [number, number] };
  const cleaned = documentNo.toUpperCase().replace(/\s/g, "").replace(/-/g, "");
  const re = new RegExp(p.pattern);
  if (!re.test(cleaned)) {
    flags.push({
      code: "DOCUMENT_NUMBER_FORMAT_MISMATCH",
      field: "documentNo",
      severity: "warning",
      message: `Document number "${documentNo}" does not match expected pattern for ${country || docType || "this document type"} (expected length ${p.length[0]}–${p.length[1]})`,
      actual: documentNo,
    });
  }
  return flags;
}

// ─── 28. Issue place plausibility ────────────────────────────────
function checkIssuePlacePlausibility(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { issuePlace, country } = input;
  if (!issuePlace || !country) return flags;
  const known = KNOWN_ISSUING_AUTHORITIES[country.toUpperCase()];
  if (!known) return flags; // No allowlist for this country → skip
  const ipLower = issuePlace.toLowerCase();
  if (!known.some((k) => ipLower.includes(k))) {
    flags.push({
      code: "ISSUE_PLACE_UNKNOWN",
      field: "issuePlace",
      severity: "info",
      message: `Issue place "${issuePlace}" is not in the known-issuing-authority list for ${country} — verify`,
      actual: issuePlace,
    });
  }
  return flags;
}

// ─── 29. Cross-language name similarity (Arabic↔English) ─────────
function checkCrossLanguageNameSimilarity(input: CrossFieldInput, _ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { fullNameAr, fullNameEn } = input;
  if (!fullNameAr || !fullNameEn) return flags;
  if (!containsArabic(fullNameAr)) return flags; // Arabic name must be Arabic
  const arTokens = fullNameAr.trim().split(/\s+/).filter((t) => t.length > 1);
  const enTokens = fullNameEn.trim().split(/\s+/).filter((t) => t.length > 1);
  if (arTokens.length === 0 || enTokens.length === 0) return flags;
  // Transliterate each Arabic token to Latin, then Levenshtein against each English token
  let maxDist = 0;
  let worstPair: [string, string] | null = null;
  for (const ar of arTokens) {
    const translit = transliterateArabic(ar).toLowerCase();
    if (!translit) continue;
    let bestForThis = Infinity;
    let bestEn = "";
    for (const en of enTokens) {
      const d = levenshtein(translit, en.toLowerCase());
      if (d < bestForThis) {
        bestForThis = d;
        bestEn = en;
      }
    }
    if (bestForThis > maxDist) {
      maxDist = bestForThis;
      worstPair = [ar, bestEn];
    }
  }
  // Allow Levenshtein ≤3 per word (transliteration is lossy)
  if (maxDist > 3 && worstPair) {
    flags.push({
      code: "CROSS_LANGUAGE_NAME_MISMATCH",
      field: "fullNameAr",
      severity: "warning",
      message: `Arabic token "${worstPair[0]}" (transliterated) does not match any English token (closest: "${worstPair[1]}", Levenshtein ${maxDist}) — possible OCR or transcription error`,
      expected: worstPair[0],
      actual: worstPair[1],
    });
  }
  return flags;
}

// ─── 30. Expiry-recently-issued check ──────────────────────────────
function checkExpiryRecentlyIssued(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const issue = parseIsoDate(input.issueDate);
  const expiry = parseIsoDate(input.expiryDate);
  if (!issue || !expiry) return flags;
  const daysSinceIssue = daysBetween(issue, ctx.today);
  // If issued in the last 30 days, it must not already be expired
  if (daysSinceIssue <= 30 && expiry < ctx.today) {
    flags.push({
      code: "RECENTLY_ISSUED_BUT_EXPIRED",
      field: "expiryDate",
      severity: "critical",
      message: `Document was issued ${Math.round(daysSinceIssue)} days ago but is already expired (${input.expiryDate}) — likely fraud or OCR error`,
      expected: "expiry after issue date",
      actual: input.expiryDate,
    });
  }
  return flags;
}

// ═══════════════════════════════════════════════════════════════════
// REGISTRY OF ALL CHECKS
// ═══════════════════════════════════════════════════════════════════
//
// Order matters for UI readability only; each check is pure and independent.
const CHECKS: Array<{ name: string; fn: CrossFieldCheck }> = [
  { name: "ID_FORMAT_CHECKSUM", fn: checkIdValidity },
  { name: "ID_GENDER_MATCH", fn: checkIdGenderMatch },
  { name: "ID_BIRTHDATE_MATCH", fn: checkIdBirthDateMatch },
  { name: "ID_BIRTHPLACE_MATCH", fn: checkIdBirthPlaceMatch },
  { name: "ARABIC_NAME_SCRIPT", fn: checkArabicNameScript },
  { name: "ENGLISH_NAME_SCRIPT", fn: checkEnglishNameScript },
  { name: "ARABIC_NAME_DICTIONARY", fn: checkArabicNameDictionary },
  { name: "BIRTHDATE_SANITY", fn: checkBirthDateSanity },
  { name: "AGE_PLAUSIBILITY", fn: checkAgePlausibility },
  { name: "EXPIRY_SANITY", fn: checkExpirySanity },
  { name: "NATIONALITY_COUNTRY_MATCH", fn: checkNationalityCountryMatch },
  { name: "MRZ_CHECKSUMS", fn: checkMrzChecksums },
  { name: "MRZ_NAME_MATCH", fn: checkMrzNameMatch },
  { name: "MRZ_DOCNUM_MATCH", fn: checkMrzDocNumberMatch },
  { name: "MRZ_NATIONALITY_MATCH", fn: checkMrzNationalityMatch },
  { name: "MRZ_BIRTHDATE_MATCH", fn: checkMrzBirthDateMatch },
  { name: "MRZ_GENDER_MATCH", fn: checkMrzGenderMatch },
  { name: "MRZ_EXPIRY_MATCH", fn: checkMrzExpiryMatch },
  { name: "DOCUMENT_VALIDITY_PERIOD", fn: checkDocumentValidityPeriod },
  { name: "ISSUE_DATE_PLAUSIBILITY", fn: checkIssueDatePlausibility },
  { name: "ISSUE_AFTER_BIRTH", fn: checkIssueAfterBirth },
  { name: "PHOTO_GENDER_MATCH", fn: checkPhotoGenderMatch },
  { name: "NAME_LENGTH_SANITY", fn: checkNameLengthSanity },
  { name: "REQUIRED_FIELDS_PRESENT", fn: checkRequiredFieldsPresent },
  { name: "DATE_FORMAT_CONSISTENCY", fn: checkDateFormatConsistency },
  { name: "GENDER_ENUM", fn: checkGenderEnum },
  { name: "DOCUMENT_NUMBER_FORMAT", fn: checkDocumentNumberFormat },
  { name: "ISSUE_PLACE_PLAUSIBILITY", fn: checkIssuePlacePlausibility },
  { name: "CROSS_LANGUAGE_NAME_SIMILARITY", fn: checkCrossLanguageNameSimilarity },
  { name: "EXPIRY_RECENTLY_ISSUED", fn: checkExpiryRecentlyIssued },
];

/**
 * Run cross-field validation on extracted document data.
 * Returns flags + consistency score + fraud probability.
 *
 * 30 checks cover: ID format/checksum, ID-gender/birth/birthPlace, name
 * scripts, name dictionary, MRZ checksums (TD1/2/3) + name/docnum/
 * nationality/birth/gender/expiry, age plausibility, document validity
 * period, issue date plausibility, issue-after-birth, photo-gender,
 * name length, required-field presence, date format, gender enum,
 * document-number format, issue-place plausibility, cross-language
 * name similarity, expiry-recently-issued.
 */
export function crossFieldValidate(input: CrossFieldInput): CrossFieldResult {
  const today = new Date();
  // Parse MRZ once and cache
  const mrz = input.mrzText && input.mrzText.length > 30 ? parseMrz(input.mrzText) : null;
  // Run validateNationalId once and cache (only if both fields present)
  const idValidation =
    input.nationalId && input.country
      ? validateNationalId(input.country, input.nationalId)
      : null;

  const ctx: CheckContext = { today, mrz, idValidation };

  const flags: CrossFieldFlag[] = [];
  for (const check of CHECKS) {
    try {
      const newFlags = check.fn(input, ctx);
      for (const f of newFlags) flags.push(f);
    } catch {
      // Defensive: a check throwing should never block the others.
      // (Checks are designed to be pure; this is just a safety net.)
    }
  }

  // Group flags by code for UI breakdown.
  const byCode: Record<string, CrossFieldFlag[]> = {};
  for (const f of flags) {
    if (!byCode[f.code]) byCode[f.code] = [];
    byCode[f.code].push(f);
  }

  const hasCritical = flags.some((f) => f.severity === "critical");
  const hasErrors = flags.some((f) => f.severity === "error" || f.severity === "critical");

  // Consistency score: start at 1.0, subtract per flag (clamped to [0,1])
  let consistencyScore = 1.0;
  for (const flag of flags) {
    consistencyScore -= SEVERITY_DEDUCTION[flag.severity];
  }
  consistencyScore = Math.max(0, Math.min(1, consistencyScore));

  // Fraud probability: weighted sum of flag severities (clamped to [0,1])
  let fraudWeight = 0;
  for (const flag of flags) {
    fraudWeight += SEVERITY_FRAUD_WEIGHT[flag.severity];
  }
  const fraudProbability = Math.min(1, fraudWeight);

  return {
    flags,
    consistencyScore: Math.round(consistencyScore * 1000) / 1000,
    hasCritical,
    hasErrors,
    fraudProbability: Math.round(fraudProbability * 1000) / 1000,
    checkCount: CHECKS.length,
    byCode,
  };
}

/**
 * Total number of registered checks (for UI / docs).
 */
export const CROSS_FIELD_CHECK_COUNT = CHECKS.length;

/**
 * Names of all registered checks (for UI / docs).
 */
export const CROSS_FIELD_CHECK_NAMES: string[] = CHECKS.map((c) => c.name);
