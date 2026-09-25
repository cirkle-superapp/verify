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
  /** Postal / residential address (used by address-format-by-country check). */
  address?: string;
  /**
   * Variance of the face embedding across multiple captures (0..1).
   * Lower = more consistent (genuine). Used by biometric-template check.
   */
  biometricVariance?: number;
  /**
   * Other documents the same user has already verified against, used by the
   * cross-document consistency check (e.g. a previously verified passport
   * when verifying a national_id). Each entry is a sparse subset of fields.
   */
  otherDocuments?: Array<{
    docType?: string;
    country?: string;
    fullNameAr?: string;
    fullNameEn?: string;
    birthDate?: string;
    gender?: string;
    documentNo?: string;
    nationalId?: string;
  }>;
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
  // ── New 20 countries (Task 19-c) ──
  VN: ["vietnam", "hanoi", "cục quản lý", "việt nam"],
  TH: ["thailand", "bangkok", "กรมการปกครอง", "ไทย", "ministry of interior"],
  ID: ["indonesia", "jakarta", "disdukcapil", "indonesian"],
  MY: ["malaysia", "putrajaya", "jabatan pendaftaran", "jpn"],
  SG: ["singapore", "ica", "immigration & checkpoints"],
  BD: ["bangladesh", "dhaka", "nid", "election commission", "বাংলাদেশ"],
  LK: ["sri lanka", "colombo", "department of registration", "nimh"],
  NP: ["nepal", "kathmandu", "district administration office", "नेपाल"],
  AF: ["afghanistan", "kabul", "وزارت امور", "afghan"],
  IR: ["iran", "tehran", "safo", "ایران", "registration"],
  IQ: ["iraq", "baghdad", "العراق", "ministry of interior"],
  LB: ["lebanon", "beirut", "لبنان", "general directorate"],
  PS: ["palestine", "gaza", "ramallah", "فلسطين"],
  SD: ["sudan", "khartoum", "السودان", "civil registry"],
  LY: ["libya", "tripoli", "ليبيا", "civil registry"],
  YE: ["yemen", "sanaa", "اليمن", "civil status"],
  MU: ["mauritius", "port louis", "mauritian", "passport office"],
  GH: ["ghana", "accra", "ghana card", "national identification"],
  KH: ["cambodia", "phnom penh", "កម្ពុជា", "ministry of interior"],
  BH: ["bahrain", "manama", "البحرين", "informa"],
  KW: ["kuwait", "kuwait city", "الكويت", "paci"],
  DZ: ["algeria", "algiers", "الجزائر", "ministry of interior"],
  TN: ["tunisia", "tunis", "تونس", "ministry of interior"],
  MA: ["morocco", "rabat", "المغرب", "ministry of interior"],
  NG: ["nigeria", "abuja", "nimc", "national identity management"],
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
  // ── New 20 countries (Task 19-c) ──
  // Vietnam CCCD: 12 digits
  VN: { pattern: "^\\d{12}$", length: [12, 12] },
  // Thailand national ID: 13 digits
  TH: { pattern: "^\\d{13}$", length: [13, 13] },
  // Indonesia NIK: 16 digits
  ID: { pattern: "^\\d{16}$", length: [16, 16] },
  // Malaysia MyKad NRIC: 12 digits
  MY: { pattern: "^\\d{12}$", length: [12, 12] },
  // Singapore NRIC: 1 letter + 7 digits + 1 check letter
  SG: { pattern: "^[SFTGM]\\d{7}[A-Z]$", length: [9, 9] },
  // Bangladesh NID Smart Card: 10 digits
  BD: { pattern: "^\\d{10}$", length: [10, 10] },
  // Sri Lanka NIC new format: 12 digits
  LK: { pattern: "^\\d{12}$", length: [12, 12] },
  // Iran Melli Code: 10 digits
  IR: { pattern: "^\\d{10}$", length: [10, 10] },
  // Iraq national ID: 12 digits
  IQ: { pattern: "^\\d{12}$", length: [12, 12] },
  // Lebanon national ID: 12 digits
  LB: { pattern: "^\\d{12}$", length: [12, 12] },
  // Sudan national ID: 11 digits
  SD: { pattern: "^\\d{11}$", length: [11, 11] },
  // Libya national ID: 12 digits
  LY: { pattern: "^\\d{12}$", length: [12, 12] },
  // Yemen national ID: 10 digits
  YE: { pattern: "^\\d{10}$", length: [10, 10] },
  // Mauritius national ID: 14-char alphanumeric
  MU: { pattern: "^[A-Z0-9]{14}$", length: [14, 14] },
  // Ghana Card: GHA-XXXXXXXXXX-X (12-char with hyphen)
  GH: { pattern: "^GHA\\d{9}\\d$", length: [13, 13] },
  // Cambodia national ID: 9 digits
  KH: { pattern: "^\\d{9}$", length: [9, 9] },
  // Nepal citizenship certificate: 11 digits
  NP: { pattern: "^\\d{11}$", length: [11, 11] },
  // Afghanistan e-Tazkira: 10 digits
  AF: { pattern: "^\\d{10}$", length: [10, 10] },
  // Bahrain CPR: 9 digits
  BH: { pattern: "^\\d{9}$", length: [9, 9] },
  // Kuwait Civil ID: 12 digits
  KW: { pattern: "^\\d{12}$", length: [12, 12] },
  // Algeria NIN: 18 digits
  DZ: { pattern: "^\\d{18}$", length: [18, 18] },
  // Tunisia CIN: 8 digits
  TN: { pattern: "^\\d{8}$", length: [8, 8] },
  // Morocco CNIE: 18 digits
  MA: { pattern: "^\\d{18}$", length: [18, 18] },
  // Nigeria NIN: 11 digits
  NG: { pattern: "^\\d{11}$", length: [11, 11] },
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
    // ── New 20 countries (Task 19-c) ──
    VN: ["vietnamese", "vietnam", "việt nam"],
    TH: ["thai", "thailand", "ไทย"],
    ID: ["indonesian", "indonesia"],
    MY: ["malaysian", "malaysia"],
    SG: ["singaporean", "singapore"],
    BD: ["bangladeshi", "bangladesh", "বাংলাদেশ"],
    LK: ["sri lankan", "sri lanka"],
    NP: ["nepalese", "nepal", "नेपाली"],
    AF: ["afghan", "afghanistan", "افغانستان"],
    IR: ["iranian", "iran", "ایرانی", "persian"],
    IQ: ["iraqi", "iraq", "العراقي"],
    LB: ["lebanese", "lebanon", "لبناني"],
    PS: ["palestinian", "palestine", "فلسطيني"],
    SD: ["sudanese", "sudan", "سوداني"],
    LY: ["libyan", "libya", "ليبي"],
    YE: ["yemeni", "yemen", "يمني"],
    MU: ["mauritian", "mauritius"],
    GH: ["ghanaian", "ghana"],
    KH: ["cambodian", "cambodia", "ខ្មែរ", "khmer"],
    BH: ["bahraini", "bahrain", "بحريني"],
    KW: ["kuwaiti", "kuwait", "كويتي"],
    DZ: ["algerian", "algeria", "جزائري"],
    TN: ["tunisian", "tunisia", "تونسي"],
    MA: ["moroccan", "morocco", "مغربي"],
    NG: ["nigerian", "nigeria"],
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
// TASK 19-c — 15 NEW CROSS-FIELD CHECKS
// Covers the 20 new countries (VN, TH, ID, MY, SG, BD, LK, NP, AF, IR,
// IQ, LB, PS, SD, LY, YE, MU, GH, KH, BH, KW, DZ, TN, MA, NG) for:
//   1. ID-encoded birthDate (positions per country)
//   2. ID-encoded gender (positions per country)
//   3. Document number format (per-country)
//   4. Nationality dual-citizen exceptions
//   5. MRZ expiry grace period
//   6. MRZ issue date consistency
//   7. Name length by country
//   8. Address format by country
//   9. Photo presence
//  10. Document age (issueDate not too old)
//  11. Biometric template consistency
//  12. Cross-document consistency
//  13. Age-gender consistency (country-specific gender digits)
//  14. Nationality-language consistency
//  15. Issue place for new countries
// ═══════════════════════════════════════════════════════════════════

// Per-country ID birthDate decoder. Returns ISO YYYY-MM-DD or null.
// Each country's nationalId embeds birthDate at well-known positions:
//   - VN:  CCCD pos 5-12 (8 digits YYYYMMDD, 4-digit year 2K-anchored)
//   - TH:  pos 1-6 (YYMMDD where YY is Buddhist-Era last 2 digits → CE = 1957+YY)
//   - ID:  NIK pos 7-12 (6 digits DDMMYY; female day offset by +40)
//   - MY:  MyKad pos 1-6 (YYMMDD, year pivot at 30: yy>30 → 19yy, else 20yy)
//   - SG:  NRIC year prefix (only birth-year — not full date; returns null)
//   - BD:  legacy NID pos 1-2 (year code) + 3-6 (MMDD) — partial; new 10-digit Smart Card has no embedded date
//   - LK:  NIC old 9-digit pos 1-2 (year) + 3-4 (month) + 5-6 (day, +50 if female) / new 12-digit pos 1-4 (year) + 5-6 (month) + 7-8 (day)
//   - IR:  Melli Code does not embed birthDate
//   - IQ:  NID encodes Islamic-calendar date (not Gregorian) — skip
//   - LB:  12-digit pos 4-9 (YYMMDD)
//   - SD:  11-digit pos 2-7 (YYMMDD)
//   - LY:  12-digit pos 2-7 (YYMMDD)
//   - YE:  10-digit pos 2-5 (YYMM only — day defaults to 15)
//   - MU:  14-char alphanumeric — no embedded birthDate
//   - GH:  Ghana Card — no embedded birthDate
//   - KH:  9-digit — no embedded birthDate
function decodeIdBirthDate(country: string, id: string): string | null {
  const c = country.toUpperCase();
  if (!/^\d+$/.test(id)) return null;
  let yy = "", mm = "", dd = "";
  switch (c) {
    case "VN": // pos 5-12 (8 digits YYYYMMDD)
      if (id.length < 12) return null;
      return `${id.slice(4, 8)}-${id.slice(8, 10)}-${id.slice(10, 12)}`;
    case "TH": { // pos 1-6 (YYMMDD, BE-calendar last 2 digits → CE = 1957 + yy)
      if (id.length < 6) return null;
      yy = id.slice(0, 2);
      mm = id.slice(2, 4);
      dd = id.slice(4, 6);
      const ceYear = 1957 + parseInt(yy, 10);
      return `${ceYear}-${mm}-${dd}`;
    }
    case "ID": // NIK pos 7-12 (1-indexed) → slice(6,12) = DDMMYY (female: day offset +40)
      if (id.length < 12) return null;
      dd = id.slice(6, 8);
      mm = id.slice(8, 10);
      yy = id.slice(10, 12);
      if (parseInt(dd, 10) > 40) {
        dd = String(parseInt(dd, 10) - 40).padStart(2, "0");
      }
      {
        const centuryId = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centuryId + parseInt(yy, 10)}-${mm}-${dd}`;
      }
    case "MY": // MyKad pos 1-6 (YYMMDD)
      if (id.length < 6) return null;
      yy = id.slice(0, 2);
      mm = id.slice(2, 4);
      dd = id.slice(4, 6);
      {
        const centuryMy = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centuryMy + parseInt(yy, 10)}-${mm}-${dd}`;
      }
    case "LK": { // old 9-digit pos 1-6 = YYMMDD (day +50 if female) / new 12-digit pos 1-4 year + 5-6 month + 7-8 day
      if (id.length === 9) {
        yy = id.slice(0, 2);
        mm = id.slice(2, 4);
        dd = id.slice(4, 6);
        if (parseInt(dd, 10) > 50) dd = String(parseInt(dd, 10) - 50).padStart(2, "0");
        const centuryLk = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centuryLk + parseInt(yy, 10)}-${mm}-${dd}`;
      }
      if (id.length === 12) {
        const yyyy = id.slice(0, 4);
        mm = id.slice(4, 6);
        dd = id.slice(6, 8);
        if (parseInt(dd, 10) > 50) dd = String(parseInt(dd, 10) - 50).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
      }
      return null;
    }
    case "LB": // pos 4-9 (6 digits YYMMDD)
      if (id.length < 9) return null;
      yy = id.slice(3, 5);
      mm = id.slice(5, 7);
      dd = id.slice(7, 9);
      {
        const centuryLb = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centuryLb + parseInt(yy, 10)}-${mm}-${dd}`;
      }
    case "SD": // 11-digit pos 2-7 (YYMMDD)
      if (id.length < 7) return null;
      yy = id.slice(1, 3);
      mm = id.slice(3, 5);
      dd = id.slice(5, 7);
      {
        const centurySd = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centurySd + parseInt(yy, 10)}-${mm}-${dd}`;
      }
    case "LY": // 12-digit pos 2-7 (YYMMDD)
      if (id.length < 7) return null;
      yy = id.slice(1, 3);
      mm = id.slice(3, 5);
      dd = id.slice(5, 7);
      {
        const centuryLy = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centuryLy + parseInt(yy, 10)}-${mm}-${dd}`;
      }
    case "YE": // 10-digit pos 2-5 (YYMM only — day defaults to 15)
      if (id.length < 5) return null;
      yy = id.slice(1, 3);
      mm = id.slice(3, 5);
      {
        const centuryYe = parseInt(yy, 10) > 30 ? 1900 : 2000;
        return `${centuryYe + parseInt(yy, 10)}-${mm}-15`;
      }
    default:
      return null;
  }
}

// Per-country ID gender decoder. Returns "Male" / "Female" / null.
//   - ID (Indonesia NIK):  pos 7 (1-indexed) → slice(6,8) day; female day offset +40; pos 15 odd=male even=female
//   - MY (MyKad NRIC):     pos 7 odd=male, even=female → slice(6,7)
//   - TH (Thailand):       pos 13 last digit (odd=male, even=female)
//   - VN (Vietnam CCCD):   pos 3-4 sequence (heuristic, not officially encoded)
function decodeIdGender(country: string, id: string): "Male" | "Female" | null {
  const c = country.toUpperCase();
  if (!/^\d+$/.test(id)) return null;
  switch (c) {
    case "ID": { // NIK: female day is offset +40, so first decode day then check
      if (id.length < 15) return null;
      const dayRaw = parseInt(id.slice(6, 8), 10);
      if (dayRaw > 40) return "Female"; // female: subtract 40 from day
      return dayRaw % 2 === 1 ? "Male" : "Female";
    }
    case "MY":
      if (id.length < 7) return null;
      return parseInt(id.slice(6, 7), 10) % 2 === 1 ? "Male" : "Female";
    case "TH":
      if (id.length < 13) return null;
      return parseInt(id.slice(12, 13), 10) % 2 === 1 ? "Male" : "Female";
    case "VN": // heuristic — Vietnam doesn't officially encode gender
      if (id.length < 4) return null;
      return parseInt(id.slice(2, 4), 10) % 2 === 1 ? "Male" : "Female";
    default:
      return null;
  }
}

// ─── 31. ID-encoded birthDate for the 20 new countries ───────────
function checkIdBirthDateNewCountries(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, nationalId, birthDate } = input;
  if (!country || !nationalId || !birthDate) return flags;
  const decoded = decodeIdBirthDate(country, nationalId);
  if (!decoded) return flags; // country not supported or ID too short
  const ext = birthDate.slice(0, 10);
  if (decoded === ext) return flags;
  // If years match, treat as minor (day mismatch → warning)
  const decYear = decoded.slice(0, 4);
  const extYear = ext.slice(0, 4);
  if (decYear !== extYear) {
    flags.push({
      code: "ID_BIRTHDATE_NEW_COUNTRY_MISMATCH",
      field: "birthDate",
      severity: "error",
      message: `ID-encoded birthDate "${decoded}" ≠ extracted birthDate "${ext}" (year mismatch)`,
      expected: decoded,
      actual: ext,
    });
  } else {
    flags.push({
      code: "ID_BIRTHDATE_NEW_COUNTRY_DAY_MISMATCH",
      field: "birthDate",
      severity: "warning",
      message: `ID-encoded birthDate "${decoded}" ≠ extracted birthDate "${ext}" (year matches)`,
      expected: decoded,
      actual: ext,
    });
  }
  return flags;
}

// ─── 32. ID-encoded gender for the 20 new countries ──────────────
function checkIdGenderNewCountries(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, nationalId, gender } = input;
  if (!country || !nationalId || !gender) return flags;
  const decoded = decodeIdGender(country, nationalId);
  if (!decoded) return flags; // country not supported
  const ext = normalizeGender(gender);
  if (ext && decoded !== ext) {
    flags.push({
      code: "ID_GENDER_NEW_COUNTRY_MISMATCH",
      field: "gender",
      severity: "critical",
      message: `ID-encoded gender "${decoded}" ≠ extracted gender "${ext}" for ${country}`,
      expected: decoded,
      actual: ext,
    });
  }
  return flags;
}

// ─── 33. Document number format by country (new 20 countries) ────
function checkDocumentNumberFormatByCountry(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { documentNo, country, docType } = input;
  if (!documentNo || !country) return flags;
  const pattern = DOCUMENT_NO_PATTERNS[country.toUpperCase()];
  if (!pattern) return flags; // skip countries without a configured pattern
  const cleaned = documentNo.toUpperCase().replace(/\s/g, "").replace(/-/g, "");
  const re = new RegExp(pattern.pattern);
  if (!re.test(cleaned)) {
    flags.push({
      code: "DOCUMENT_NUMBER_FORMAT_BY_COUNTRY",
      field: "documentNo",
      severity: "warning",
      message: `Document number "${documentNo}" does not match expected format for ${country} (${docType || "national_id"}): pattern ${pattern.pattern}`,
      actual: documentNo,
    });
  }
  return flags;
}

// ─── 34. Nationality dual-citizen exceptions (new 20 countries) ─
// Allowlist of country-nationality pairs that are common dual-citizen
// cases (e.g. LB national with FR nationality). If country + nationality
// don't match AND the pair isn't allowlisted, escalate to error.
function checkNationalityDualCitizen(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, nationality } = input;
  if (!country || !nationality) return flags;
  // Allowlist of {country→[allowed foreign nationalities]} (lowercase substrings).
  const dualCitizenAllow: Record<string, string[]> = {
    LB: ["french", "canadian", "american", "brazilian", "australian", "british"],
    IR: ["german", "canadian", "american", "swedish"],
    IQ: ["british", "american", "swedish", "australian"],
    AF: ["german", "dutch", "american", "british"],
    SD: ["egyptian", "british", "american"],
    YE: ["saudi", "american", "british"],
    PS: ["jordanian", "israeli", "american", "egyptian"],
    DZ: ["french", "belgian", "canadian"],
    TN: ["french", "italian", "german"],
    MA: ["french", "spanish", "belgian", "dutch"],
    LY: ["tunisian", "egyptian", "british"],
  };
  const expected3 = alpha2ToAlpha3(country);
  const natLower = nationality.toLowerCase();
  // If MRZ nationality matches country (alpha-3), no dual-citizen check needed.
  if (expected3 && natLower.includes(expected3.toLowerCase())) return flags;
  // If declared nationality still mentions the issuing country (e.g. "Egyptian"), skip.
  const countryMap: Record<string, string[]> = {
    VN: ["vietnamese", "vietnam", "việt nam"],
    TH: ["thai", "thailand", "ไทย"],
    ID: ["indonesian", "indonesia"],
    MY: ["malaysian", "malaysia"],
    SG: ["singaporean", "singapore"],
    BD: ["bangladeshi", "bangladesh"],
    LK: ["sri lankan", "sri lanka"],
    NP: ["nepalese", "nepal"],
    AF: ["afghan", "afghanistan"],
    IR: ["iranian", "iran", "persian"],
    IQ: ["iraqi", "iraq"],
    LB: ["lebanese", "lebanon"],
    PS: ["palestinian", "palestine"],
    SD: ["sudanese", "sudan"],
    LY: ["libyan", "libya"],
    YE: ["yemeni", "yemen"],
    MU: ["mauritian", "mauritius"],
    GH: ["ghanaian", "ghana"],
    KH: ["cambodian", "cambodia", "khmer"],
    BH: ["bahraini", "bahrain"],
    KW: ["kuwaiti", "kuwait"],
    DZ: ["algerian", "algeria"],
    TN: ["tunisian", "tunisia"],
    MA: ["moroccan", "morocco"],
    NG: ["nigerian", "nigeria"],
  };
  const expected = countryMap[country.toUpperCase()];
  if (expected && expected.some((e) => natLower.includes(e))) return flags;
  // Otherwise it's a dual-citizen case — check against allowlist.
  const allow = dualCitizenAllow[country.toUpperCase()] || [];
  if (allow.length === 0) {
    // No allowlist for this country → leave to the existing mismatch check.
    return flags;
  }
  if (!allow.some((a) => natLower.includes(a))) {
    flags.push({
      code: "NATIONALITY_DUAL_CITIZEN_UNVERIFIED",
      field: "nationality",
      severity: "warning",
      message: `Country ${country} with foreign nationality "${nationality}" not in dual-citizen allowlist — verify with secondary document`,
      expected: country,
      actual: nationality,
    });
  } else {
    flags.push({
      code: "NATIONALITY_DUAL_CITIZEN_VERIFIED",
      field: "nationality",
      severity: "info",
      message: `Dual citizen detected: ${country} national + "${nationality}" — accepted as known dual-citizen pair`,
    });
  }
  return flags;
}

// ─── 35. MRZ expiry date validation (future or within 6-month grace) ──
function checkMrzExpiryDateValidity(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz?.expiryDate) return flags;
  const mrzExpiry = parseIsoDate(ctx.mrz.expiryDate);
  if (!mrzExpiry) return flags;
  const daysUntilExpiry = daysBetween(ctx.today, mrzExpiry);
  if (daysUntilExpiry < 0) {
    // Allow 6-month grace period for recently expired documents
    const graceDays = 180;
    if (daysUntilExpiry < -graceDays) {
      flags.push({
        code: "MRZ_EXPIRY_PAST_GRACE",
        field: "expiryDate",
        severity: "error",
        message: `MRZ expiry date ${ctx.mrz.expiryDate} is ${Math.round(-daysUntilExpiry)} days past — beyond 6-month grace period`,
        actual: ctx.mrz.expiryDate,
      });
    } else {
      flags.push({
        code: "MRZ_EXPIRY_RECENTLY_EXPIRED",
        field: "expiryDate",
        severity: "info",
        message: `MRZ expiry date ${ctx.mrz.expiryDate} is within 6-month grace period (expired ${Math.round(-daysUntilExpiry)} days ago) — accepted for verification`,
      });
    }
  }
  return flags;
}

// ─── 36. MRZ issue date consistency (issue > birth, issue < expiry) ─
// MRZ TD3 has no dedicated issue-date field, but some countries (e.g. VN
// passport booklets, ID e-KTP) encode issue date in the optional field.
// If we can parse an issue date from the MRZ optional data, validate.
function checkMrzIssueDateConsistency(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (!ctx.mrz) return flags;
  // Heuristic: if input.issueDate is set AND MRZ optional2 (TD1) or
  // optionalData (TD3) is numeric and looks like a date (YYMMDD), parse it.
  const opt = ctx.mrz.optionalData2 || ctx.mrz.optionalData1;
  if (!opt || !/^\d{6}$/.test(opt)) return flags;
  const parsed = parseIsoDateFromYYMMDD(opt);
  if (!parsed) return flags;
  const birth = parseIsoDate(input.birthDate);
  const expiry = parseIsoDate(input.expiryDate);
  if (birth && parsed < birth) {
    flags.push({
      code: "MRZ_ISSUE_BEFORE_BIRTH",
      field: "issueDate",
      severity: "critical",
      message: `MRZ-encoded issue date ${parsed.toISOString().slice(0, 10)} is before birth date ${input.birthDate}`,
    });
  }
  if (expiry && parsed > expiry) {
    flags.push({
      code: "MRZ_ISSUE_AFTER_EXPIRY",
      field: "issueDate",
      severity: "error",
      message: `MRZ-encoded issue date ${parsed.toISOString().slice(0, 10)} is after expiry date ${input.expiryDate}`,
    });
  }
  return flags;
}

/** Parse a YYMMDD string from MRZ optional data into a Date. Two-digit year pivot: 30→1930, 29→2029. */
function parseIsoDateFromYYMMDD(s: string): Date | null {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2, 4), 10);
  const dd = parseInt(s.slice(4, 6), 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const year = yy > 30 ? 1900 + yy : 2000 + yy;
  const d = new Date(year, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
}

// ─── 37. Name length by country ──────────────────────────────────
// Country-specific name-length expectations:
//   - Arabic countries (EG, SA, AE, etc.): Arabic names typically 4-5 words
//   - Levant (LB, PS, JO, SY): 3-5 words (often with family prefix)
//   - Western countries (US, GB, FR, DE): 2-3 words
//   - East Asian (VN, TH, KH, CN, KR, JP): 2-4 words (often with multiple given names)
function checkNameLengthByCountry(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, fullNameAr, fullNameEn } = input;
  if (!country) return flags;
  const c = country.toUpperCase();
  const isArabicName = !!fullNameAr && containsArabic(fullNameAr);
  const name = isArabicName ? fullNameAr : fullNameEn;
  if (!name) return flags;
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return flags;

  // Per-country expected name-length ranges (min, max, "expected format")
  const ranges: Record<string, [number, number, string]> = {
    EG: [3, 6, "Arabic full name (given + father + grandfather + family)"],
    SA: [2, 6, "Arabic name (given + bin + father + family)"],
    AE: [2, 6, "Arabic Emirati name"],
    KW: [2, 6, "Arabic Kuwaiti name"],
    QA: [2, 6, "Arabic Qatari name"],
    BH: [2, 6, "Arabic Bahraini name"],
    OM: [2, 6, "Arabic Omani name"],
    YE: [2, 6, "Arabic Yemeni name"],
    JO: [2, 6, "Arabic Levantine name"],
    PS: [2, 6, "Arabic Levantine name"],
    LB: [3, 6, "Arabic Levantine name (often with article prefix)"],
    SY: [2, 6, "Arabic Levantine name"],
    IQ: [2, 6, "Arabic Iraqi name"],
    SD: [2, 6, "Arabic Sudanese name"],
    LY: [2, 6, "Arabic Libyan name"],
    DZ: [2, 6, "Arabic Maghrebi name"],
    TN: [2, 6, "Arabic Maghrebi name"],
    MA: [2, 6, "Arabic Maghrebi name"],
    MR: [2, 6, "Arabic Mauritanian name"],
    IR: [2, 5, "Persian name (given + family)"],
    AF: [2, 5, "Pashto/Dari name"],
    US: [2, 4, "Western name (first + middle + last)"],
    GB: [2, 4, "Western name"],
    FR: [2, 5, "Western name"],
    DE: [2, 5, "Western name"],
    ES: [2, 4, "Western name (often with both surnames)"],
    IT: [2, 5, "Western name"],
    NL: [2, 4, "Western name"],
    BE: [2, 4, "Western name"],
    BR: [2, 6, "Western name (often long composite)"],
    VN: [2, 5, "Vietnamese name (family + middle + given)"],
    TH: [2, 5, "Thai name"],
    KH: [2, 5, "Khmer name"],
    ID: [2, 5, "Indonesian name"],
    MY: [2, 5, "Malay name"],
    SG: [2, 5, "Singaporean name"],
    BD: [2, 5, "Bengali name"],
    LK: [2, 5, "Sinhala/Tamil name"],
    NP: [2, 5, "Nepali name"],
    NG: [2, 5, "Nigerian name"],
    GH: [2, 5, "Ghanaian name"],
    MU: [2, 5, "Mauritian name"],
  };
  const range = ranges[c];
  if (!range) return flags;
  const [min, max, fmt] = range;
  if (tokens.length < min) {
    flags.push({
      code: "NAME_TOO_SHORT_FOR_COUNTRY",
      field: isArabicName ? "fullNameAr" : "fullNameEn",
      severity: "warning",
      message: `Name has ${tokens.length} token(s) — expected ≥${min} for ${country} (${fmt})`,
    });
  } else if (tokens.length > max) {
    flags.push({
      code: "NAME_TOO_LONG_FOR_COUNTRY",
      field: isArabicName ? "fullNameAr" : "fullNameEn",
      severity: "info",
      message: `Name has ${tokens.length} token(s) — expected ≤${max} for ${country} (${fmt})`,
    });
  }
  return flags;
}

// ─── 38. Address format by country ───────────────────────────────
// Different countries use different address formats. We do not enforce
// exact format, but flag gross mismatches (e.g. an Egyptian address
// containing a US zip code, or a US address with no zip).
function checkAddressFormatByCountry(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, address } = input;
  if (!country || !address) return flags;
  const addr = address.trim();
  if (addr.length < 5) return flags;
  const c = country.toUpperCase();
  // Heuristic per-country address expectations
  const usZip = /\b\d{5}(?:-\d{4})?\b/;
  const caPostcode = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i;
  const ukPostcode = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/i;
  const arabicAddress = /[\u0600-\u06FF]/.test(addr);
  switch (c) {
    case "US":
      if (!usZip.test(addr)) {
        flags.push({
          code: "ADDRESS_FORMAT_US_NO_ZIP",
          field: "address",
          severity: "info",
          message: "US address should contain a 5-digit ZIP code",
        });
      }
      break;
    case "CA":
      if (!caPostcode.test(addr)) {
        flags.push({
          code: "ADDRESS_FORMAT_CA_NO_POSTCODE",
          field: "address",
          severity: "info",
          message: "Canadian address should contain a 6-char alphanumeric postcode (A1A 1A1)",
        });
      }
      break;
    case "GB":
      if (!ukPostcode.test(addr)) {
        flags.push({
          code: "ADDRESS_FORMAT_GB_NO_POSTCODE",
          field: "address",
          severity: "info",
          message: "UK address should contain a postcode (e.g. SW1A 1AA)",
        });
      }
      break;
    case "EG":
    case "SA":
    case "AE":
    case "KW":
    case "QA":
    case "BH":
    case "OM":
    case "JO":
    case "PS":
    case "LB":
    case "SY":
    case "IQ":
    case "SD":
    case "LY":
    case "YE":
    case "DZ":
    case "TN":
    case "MA":
      if (!arabicAddress) {
        flags.push({
          code: "ADDRESS_FORMAT_AR_NO_ARABIC",
          field: "address",
          severity: "info",
          message: `Address for ${country} should contain Arabic text — currently all-Latin`,
        });
      }
      break;
    case "IR":
    case "AF":
      if (!/[\u0600-\u06FF\u0750-\u077F]/.test(addr)) {
        flags.push({
          code: "ADDRESS_FORMAT_IR_NO_PERSIAN",
          field: "address",
          severity: "info",
          message: `Address for ${country} should contain Persian/Arabic script — currently all-Latin`,
        });
      }
      break;
    default:
      // No address-format rule for this country.
      break;
  }
  return flags;
}

// ─── 39. Photo presence check ────────────────────────────────────
function checkPhotoPresence(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  if (input.photoPresent === undefined) return flags; // not set → unknown, skip
  if (input.photoPresent === false) {
    flags.push({
      code: "PHOTO_MISSING",
      field: "photo",
      severity: "error",
      message: "No photo detected on the document — verification requires a holder photo",
    });
  }
  return flags;
}

// ─── 40. Document age check ──────────────────────────────────────
// Most national ID cards are reissued every 10 years. A 50-year-old
// ID card is suspicious. Passports typically expire in 5-10 years so
// they are inherently bounded, but national IDs may persist.
function checkDocumentAge(input: CrossFieldInput, ctx: CheckContext): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const issue = parseIsoDate(input.issueDate);
  if (!issue) return flags;
  const ageYears = yearsBetween(issue, ctx.today);
  if (ageYears < 0) return flags; // future issue date handled elsewhere
  const c = (input.country || "").toUpperCase();
  const docType = input.docType || "";
  // Passport: if issue+expiry is bounded by passport validity, we don't double-check.
  if (docType === "passport") {
    if (ageYears > 15) {
      flags.push({
        code: "DOCUMENT_AGE_PASSPORT_TOO_OLD",
        field: "issueDate",
        severity: "warning",
        message: `Passport was issued ${ageYears.toFixed(1)} years ago — passports are typically valid 5-10 years`,
        actual: `${ageYears.toFixed(1)} years`,
      });
    }
    return flags;
  }
  // National ID: most countries reissue every 10 years, but some allow
  // indefinite validity (Egypt old paper IDs, Lebanon old booklet). 50
  // years is the absolute upper limit before the document is suspect.
  const indefiniteValidityCountries = new Set(["EG", "LB", "SY", "IQ", "PS"]);
  if (indefiniteValidityCountries.has(c)) {
    if (ageYears > 50) {
      flags.push({
        code: "DOCUMENT_AGE_INDEFINITE_TOO_OLD",
        field: "issueDate",
        severity: "warning",
        message: `Document from ${c} was issued ${ageYears.toFixed(1)} years ago — exceeds 50-year absolute maximum even for indefinite-validity countries`,
        actual: `${ageYears.toFixed(1)} years`,
      });
    }
    return flags;
  }
  if (ageYears > 15) {
    flags.push({
      code: "DOCUMENT_AGE_EXPIRED_BY_REISSUANCE",
      field: "issueDate",
      severity: "warning",
      message: `Document was issued ${ageYears.toFixed(1)} years ago — most countries reissue every 10 years, verify the document is still valid`,
      actual: `${ageYears.toFixed(1)} years`,
    });
  }
  return flags;
}

// ─── 41. Biometric template consistency ─────────────────────────
// If biometricVariance is provided, flag if it's too high (inconsistent
// face embeddings across captures → possible fraud or different person).
function checkBiometricTemplateConsistency(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const v = input.biometricVariance;
  if (v === undefined || v === null) return flags;
  if (v < 0 || v > 1) {
    flags.push({
      code: "BIOMETRIC_VARIANCE_OUT_OF_RANGE",
      field: "biometricVariance",
      severity: "warning",
      message: `Biometric variance ${v} is outside expected [0, 1] range — likely a configuration error`,
      actual: String(v),
    });
    return flags;
  }
  // 0.0 = perfectly consistent, 0.3+ = suspicious, 0.5+ = different person
  if (v >= 0.5) {
    flags.push({
      code: "BIOMETRIC_VARIANCE_HIGH_DIFFERENT_PERSON",
      field: "biometricVariance",
      severity: "critical",
      message: `Biometric variance ${v.toFixed(2)} ≥ 0.50 — face embeddings across captures are inconsistent (likely a different person)`,
      actual: v.toFixed(2),
    });
  } else if (v >= 0.3) {
    flags.push({
      code: "BIOMETRIC_VARIANCE_SUSPICIOUS",
      field: "biometricVariance",
      severity: "warning",
      message: `Biometric variance ${v.toFixed(2)} is in the suspicious range (0.30–0.49) — verify the same person is captured across documents`,
      actual: v.toFixed(2),
    });
  }
  return flags;
}

// ─── 42. Cross-document consistency ─────────────────────────────
// If user has multiple documents (e.g. national_id + passport), the
// names and DOB should match across all documents.
function checkCrossDocumentConsistency(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const others = input.otherDocuments;
  if (!others || others.length === 0) return flags;

  for (let i = 0; i < others.length; i++) {
    const other = others[i];
    // Birth date consistency
    if (input.birthDate && other.birthDate) {
      const a = input.birthDate.slice(0, 10);
      const b = other.birthDate.slice(0, 10);
      if (a !== b) {
        // Year match → warning; year mismatch → error
        if (a.slice(0, 4) === b.slice(0, 4)) {
          flags.push({
            code: "CROSS_DOC_BIRTHDATE_DAY_MISMATCH",
            field: "birthDate",
            severity: "warning",
            message: `Birth date differs between documents: current=${a} vs other#${i + 1}=${b} (year matches)`,
            expected: a,
            actual: b,
          });
        } else {
          flags.push({
            code: "CROSS_DOC_BIRTHDATE_MISMATCH",
            field: "birthDate",
            severity: "error",
            message: `Birth date year differs between documents: current=${a} vs other#${i + 1}=${b}`,
            expected: a,
            actual: b,
          });
        }
      }
    }
    // English name consistency (token-set intersection)
    if (input.fullNameEn && other.fullNameEn) {
      const aTokens = input.fullNameEn.toUpperCase().split(/\s+/).filter((t) => t.length > 2);
      const bTokens = other.fullNameEn.toUpperCase().split(/\s+/).filter((t) => t.length > 2);
      const shared = aTokens.filter((t) => bTokens.includes(t));
      if (shared.length === 0) {
        flags.push({
          code: "CROSS_DOC_NAME_MISMATCH",
          field: "fullNameEn",
          severity: "error",
          message: `No shared name tokens between documents: current="${input.fullNameEn}" vs other#${i + 1}="${other.fullNameEn}"`,
          expected: input.fullNameEn,
          actual: other.fullNameEn,
        });
      } else if (shared.length === 1 && aTokens.length >= 2 && bTokens.length >= 2) {
        flags.push({
          code: "CROSS_DOC_NAME_PARTIAL_MATCH",
          field: "fullNameEn",
          severity: "info",
          message: `Partial name match between documents: shared token "${shared[0]}" only — verify`,
        });
      }
    }
    // Arabic name consistency (token-set intersection)
    if (input.fullNameAr && other.fullNameAr) {
      const aTokens = input.fullNameAr.split(/\s+/).filter((t) => t.length > 1);
      const bTokens = other.fullNameAr.split(/\s+/).filter((t) => t.length > 1);
      const shared = aTokens.filter((t) => bTokens.includes(t));
      if (shared.length === 0) {
        flags.push({
          code: "CROSS_DOC_ARABIC_NAME_MISMATCH",
          field: "fullNameAr",
          severity: "warning",
          message: `No shared Arabic name tokens between documents — verify (could be different name orderings)`,
        });
      }
    }
    // Gender consistency
    if (input.gender && other.gender) {
      const a = normalizeGender(input.gender);
      const b = normalizeGender(other.gender);
      if (a && b && a !== b) {
        flags.push({
          code: "CROSS_DOC_GENDER_MISMATCH",
          field: "gender",
          severity: "critical",
          message: `Gender differs between documents: current="${a}" vs other#${i + 1}="${b}"`,
          expected: a,
          actual: b,
        });
      }
    }
  }
  return flags;
}

// ─── 43. Age-gender consistency (country-specific gender digits) ─
// For countries where the national ID encodes gender at a specific
// position (EG seq, ID day, MY pos 7, TH pos 13, etc.), validate the
// digit against the declared gender. This consolidates the country-
// specific gender-digit logic that the existing ID_GENDER_MATCH may
// not cover if the country validator doesn't return extractedFields.gender.
function checkAgeGenderConsistency(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { country, nationalId, gender, birthDate } = input;
  if (!country || !gender) return flags;
  const ext = normalizeGender(gender);
  if (!ext) return flags;
  // Reuse the ID gender decoder for the new countries (ID, MY, TH, VN).
  // For the existing countries (EG, AE, SA, KW), use the ID-validation
  // result if available; otherwise fall back to a position-based check.
  const c = country.toUpperCase();
  if (nationalId) {
    const decoded = decodeIdGender(c, nationalId);
    if (decoded && decoded !== ext) {
      flags.push({
        code: "AGE_GENDER_DIGIT_MISMATCH",
        field: "gender",
        severity: "critical",
        message: `Country-specific gender digit in ${country} ID encodes "${decoded}" but extracted gender is "${ext}"`,
        expected: decoded,
        actual: ext,
      });
    }
  }
  // Sanity: age vs gender (e.g. a 2-year-old "Male" ID for an Egyptian —
  // the gender digit is correct but the age is implausible for an ID.
  // This is supplementary to AGE_PLAUSIBILITY.)
  if (birthDate && (c === "EG" || c === "SA" || c === "AE" || c === "KW")) {
    const birth = parseIsoDate(birthDate);
    if (birth) {
      const today = new Date();
      const age = ageInYears(birth, today);
      if (age > 0 && age < 16) {
        flags.push({
          code: "AGE_GENDER_MINOR_ID",
          field: "birthDate",
          severity: "info",
          message: `National ID with gender digit "${ext}" issued to a minor (age ${Math.floor(age)}) — verify the ID was parent-issued or for a child passport`,
        });
      }
    }
  }
  return flags;
}

// ─── 44. Nationality-language consistency ───────────────────────
// The nationality country's official language should match the script
// of the extracted name. E.g. Egyptian national should have Arabic name,
// German national should have Latin name, Iranian should have Persian/
// Arabic name, etc. Dual-citizen cases (already covered by another
// check) are skipped here to avoid double-flagging.
function checkNationalityLanguageConsistency(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { nationality, fullNameAr, fullNameEn } = input;
  if (!nationality) return flags;
  const nat = nationality.toLowerCase();

  // Country → expected script
  const arabicScriptCountries = [
    "egypt", "egyptian", "مصر", "saudi", "saudi arabia", "السعودية",
    "emirati", "uae", "united arab emirates", "الإمارات",
    "kuwaiti", "kuwait", "الكويت", "qatari", "qatar", "القطر", "قطري",
    "bahraini", "bahrain", "البحرين", "بحريني", "omani", "oman", "عماني", "عمان",
    "yemeni", "yemen", "اليمن", "يمني", "jordanian", "jordan", "الأردن", "أردني",
    "palestinian", "palestine", "فلسطين", "lebanese", "lebanon", "لبنان", "لبناني",
    "syrian", "syria", "سوريا", "سوري", "iraqi", "iraq", "العراق", "عراقي",
    "sudanese", "sudan", "السودان", "سوداني", "libyan", "libya", "ليبيا", "ليبي",
    "algerian", "algeria", "الجزائر", "tunisian", "tunisia", "تونس", "تونسي",
    "moroccan", "morocco", "المغرب", "مغربي", "mauritanian", "mauritania",
    "afghan", "afghanistan", "افغانستان", "ایرانی", "iranian", "persian", "iran", "ایران",
  ];
  const latinScriptCountries = [
    "american", "united states", "british", "uk", "united kingdom",
    "french", "france", "german", "germany", "spanish", "spain",
    "italian", "italy", "dutch", "netherlands", "belgian", "belgium",
    "swedish", "sweden", "norwegian", "norway", "danish", "denmark",
    "finnish", "finland", "polish", "poland", "czech", "greek", "greece",
    "romanian", "romania", "irish", "ireland", "austrian", "austria",
    "swiss", "switzerland", "hungarian", "hungary", "bulgarian", "bulgaria",
    "croatian", "croatia", "serbian", "serbia", "slovak", "slovakia",
    "slovenian", "slovenia", "estonian", "estonia", "latvian", "latvia",
    "lithuanian", "lithuania", "icelandic", "iceland", "russian", "russia",
    "ukrainian", "ukraine", "belarusian", "belarus", "canadian", "canada",
    "australian", "australia", "new zealand", "kiwi", "brazilian", "brazil",
    "argentine", "argentina", "chilean", "chile", "colombian", "colombia",
    "peruvian", "peru", "mexican", "mexico",
    "vietnamese", "vietnam", "thai", "thailand", "indonesian", "indonesia",
    "malaysian", "malaysia", "singaporean", "singapore", "bangladeshi",
    "bangladesh", "sri lankan", "sri lanka", "nepalese", "nepal",
    "cambodian", "cambodia", "khmer", "filipino", "filipina", "philippines",
    "ghanaian", "ghana", "nigerian", "nigeria", "mauritian", "mauritius",
  ];

  const expectsArabic = arabicScriptCountries.some((s) => nat.includes(s));
  const expectsLatin = latinScriptCountries.some((s) => nat.includes(s));
  if (!expectsArabic && !expectsLatin) return flags;

  const hasArabicName = !!fullNameAr && containsArabic(fullNameAr);
  const hasLatinName = !!fullNameEn && containsLatin(fullNameEn);

  if (expectsArabic && !hasArabicName) {
    flags.push({
      code: "NATIONALITY_LANGUAGE_ARABIC_EXPECTED",
      field: "fullNameAr",
      severity: "info",
      message: `Nationality "${nationality}" implies Arabic/Persian script — Arabic name field is empty or non-Arabic`,
    });
  }
  if (expectsLatin && !hasLatinName) {
    flags.push({
      code: "NATIONALITY_LANGUAGE_LATIN_EXPECTED",
      field: "fullNameEn",
      severity: "info",
      message: `Nationality "${nationality}" implies Latin script — English name field is empty or non-Latin`,
    });
  }
  return flags;
}

// ─── 45. Issue place for new countries ──────────────────────────
// Like checkIssuePlacePlausibility but uses the extended authority
// map (KNOWN_ISSUING_AUTHORITIES now covers 28 countries). This check
// specifically iterates the new 20 countries so the existing check
// continues to handle the original 8.
function checkIssuePlaceNewCountries(input: CrossFieldInput): CrossFieldFlag[] {
  const flags: CrossFieldFlag[] = [];
  const { issuePlace, country } = input;
  if (!issuePlace || !country) return flags;
  const newCountrySet = new Set([
    "VN", "TH", "ID", "MY", "SG", "BD", "LK", "NP", "AF", "IR", "IQ", "LB",
    "PS", "SD", "LY", "YE", "MU", "GH", "KH", "BH", "KW", "DZ", "TN", "MA", "NG",
  ]);
  if (!newCountrySet.has(country.toUpperCase())) return flags;
  const known = KNOWN_ISSUING_AUTHORITIES[country.toUpperCase()];
  if (!known) return flags;
  const ipLower = issuePlace.toLowerCase();
  if (!known.some((k) => ipLower.includes(k))) {
    flags.push({
      code: "ISSUE_PLACE_NEW_COUNTRY_UNKNOWN",
      field: "issuePlace",
      severity: "info",
      message: `Issue place "${issuePlace}" is not in the known-issuing-authority list for ${country} (extended for new 20 countries) — verify`,
      actual: issuePlace,
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
  // ── Task 19-c — 15 new checks for the 20 new countries ──
  { name: "ID_BIRTHDATE_NEW_COUNTRIES", fn: checkIdBirthDateNewCountries },
  { name: "ID_GENDER_NEW_COUNTRIES", fn: checkIdGenderNewCountries },
  { name: "DOCUMENT_NUMBER_FORMAT_BY_COUNTRY", fn: checkDocumentNumberFormatByCountry },
  { name: "NATIONALITY_DUAL_CITIZEN", fn: checkNationalityDualCitizen },
  { name: "MRZ_EXPIRY_DATE_VALIDITY", fn: checkMrzExpiryDateValidity },
  { name: "MRZ_ISSUE_DATE_CONSISTENCY", fn: checkMrzIssueDateConsistency },
  { name: "NAME_LENGTH_BY_COUNTRY", fn: checkNameLengthByCountry },
  { name: "ADDRESS_FORMAT_BY_COUNTRY", fn: checkAddressFormatByCountry },
  { name: "PHOTO_PRESENCE", fn: checkPhotoPresence },
  { name: "DOCUMENT_AGE", fn: checkDocumentAge },
  { name: "BIOMETRIC_TEMPLATE_CONSISTENCY", fn: checkBiometricTemplateConsistency },
  { name: "CROSS_DOCUMENT_CONSISTENCY", fn: checkCrossDocumentConsistency },
  { name: "AGE_GENDER_CONSISTENCY", fn: checkAgeGenderConsistency },
  { name: "NATIONALITY_LANGUAGE_CONSISTENCY", fn: checkNationalityLanguageConsistency },
  { name: "ISSUE_PLACE_NEW_COUNTRIES", fn: checkIssuePlaceNewCountries },
];

/**
 * Run cross-field validation on extracted document data.
 * Returns flags + consistency score + fraud probability.
 *
 * 45 checks cover: ID format/checksum, ID-gender/birth/birthPlace, name
 * scripts, name dictionary, MRZ checksums (TD1/2/3) + name/docnum/
 * nationality/birth/gender/expiry, age plausibility, document validity
 * period, issue date plausibility, issue-after-birth, photo-gender,
 * name length, required-field presence, date format, gender enum,
 * document-number format, issue-place plausibility, cross-language
 * name similarity, expiry-recently-issued, plus 15 new Task 19-c checks:
 * ID-encoded birthDate for new countries (VN/TH/ID/MY/SG/...), ID-encoded
 * gender for new countries (ID/MY/TH/VN), document-number format by
 * country (20 new patterns), nationality dual-citizen allowlist, MRZ
 * expiry date 6-month grace, MRZ issue-date consistency, name length by
 * country, address format by country, photo presence, document age,
 * biometric template consistency, cross-document name/DOB/gender
 * consistency, age-gender consistency, nationality-language consistency,
 * issue-place for the new 20 countries.
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
