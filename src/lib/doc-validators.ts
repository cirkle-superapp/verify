// Field validators and parsers for Egyptian / Arabic identity documents.
// Pure functions — no VLM calls. Used to normalize and verify VLM output.

import type { DocType } from "@/lib/verification-types";

/** Normalize Arabic text: trim, collapse whitespace, fix common OCR confusions. */
export function normalizeArabic(input?: string | null): string | undefined {
  if (!input) return undefined;
  let s = String(input).trim();
  // Remove Tatweel (ـ) which is often an OCR artifact
  s = s.replace(/\u0640/g, "");
  // Normalize Alef variants to plain ا
  s = s.replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627");
  // Normalize Ya variants
  s = s.replace(/\u0649/g, "\u064A");
  // Collapse multiple spaces
  s = s.replace(/\s+/g, " ").trim();
  return s || undefined;
}

/** Normalize Latin text: trim, collapse whitespace. */
export function normalizeLatin(input?: string | null): string | undefined {
  if (!input) return undefined;
  let s = String(input).trim();
  s = s.replace(/\s+/g, " ").trim();
  return s || undefined;
}

/** Keep only digits from a string. */
export function digitsOnly(input?: string | null): string | undefined {
  if (!input) return undefined;
  // Convert Arabic-Indic digits to Western
  const western = String(input)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
  const digits = western.replace(/\D/g, "");
  return digits || undefined;
}

/**
 * Validate & decode an Egyptian National ID number (14 digits).
 * Format: CYYMMDD-SSSN-K
 *  - C: century (2 = 1900s, 3 = 2000s)
 *  - YYMMDD: birth date
 *  - SSSN: serial + gender (odd = male, even = female)
 *  - K: Luhn-ish checksum
 * Returns decoded fields + validity, or null if invalid format.
 */
export interface EgyptianIdInfo {
  raw: string;
  isValid: boolean;
  birthDate?: string; // ISO YYYY-MM-DD
  gender?: "Male" | "Female";
  year?: number;
  month?: number;
  day?: number;
  governorateCode?: number;
  checksumValid?: boolean;
}

export function parseEgyptianNationalId(input?: string | null): EgyptianIdInfo | null {
  const digits = digitsOnly(input);
  if (!digits || digits.length !== 14) return null;
  const info: EgyptianIdInfo = { raw: digits, isValid: false };

  const century = parseInt(digits[0], 10);
  const yy = parseInt(digits.slice(1, 3), 10);
  const mm = parseInt(digits.slice(3, 5), 10);
  const dd = parseInt(digits.slice(5, 7), 10);
  const serial = parseInt(digits.slice(7, 13), 10);
  const check = parseInt(digits[13], 10);

  if (![2, 3].includes(century)) {
    return info;
  }
  const year = (century === 2 ? 1900 : 2000) + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return info;
  info.year = year;
  info.month = mm;
  info.day = dd;
  info.birthDate = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  info.gender = serial % 2 === 1 ? "Male" : "Female";
  info.governorateCode = parseInt(digits.slice(7, 9), 10);

  // Egyptian national ID checksum: weighted sum mod 10 of first 13 digits
  const weights = [2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i], 10) * weights[i];
  const computed = (11 - (sum % 11)) % 10;
  info.checksumValid = computed === check;
  info.isValid = info.checksumValid;
  return info;
}

/** Normalize gender field to Male/Female regardless of language. */
export function normalizeGender(input?: string | null): "Male" | "Female" | undefined {
  if (!input) return undefined;
  const s = String(input).trim().toLowerCase();
  if (["male", "m", "ذكر", "ذ"].some((x) => s === x || s.startsWith(x))) return "Male";
  if (["female", "f", "أنثى", "انثى", "أ", "ا", "femal"].some((x) => s === x || s.startsWith(x))) return "Female";
  // Fallback: contains arabic male/female marker
  if (s.includes("ذكر")) return "Male";
  if (s.includes("أنث") || s.includes("انث")) return "Female";
  return undefined;
}

/** Try to normalize a date string into ISO YYYY-MM-DD. Accepts DD/MM/YYYY, YYYY-MM-DD, Arabic months, etc. */
export function normalizeDate(input?: string | null): string | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  // Already ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [, y, mo, d] = m;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo}-${d}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) > 30 ? "19" : "20") + y;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Arabic month names → month number
  const arabicMonths: Record<string, number> = {
    يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ابريل: 4, مايو: 5, يونيو: 6,
    يوليو: 7, يولية: 7, أغسطس: 8, اغسطس: 8, سبتمبر: 9, أكتوبر: 10, اكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
    ينا: 1, فبرا: 2, مار: 3, أبر: 4, ماي: 5, يون: 6, يول: 7, أغس: 8, سبت: 9, أكت: 10, نوف: 11, ديس: 12,
  };
  for (const [name, num] of Object.entries(arabicMonths)) {
    if (s.includes(name)) {
      const dm = s.match(/(\d{1,2})/);
      const ym = s.match(/(\d{4})/);
      if (dm && ym) {
        const d = dm[1].padStart(2, "0");
        return `${ym[1]}-${String(num).padStart(2, "0")}-${d}`;
      }
    }
  }
  return s || undefined;
}

/**
 * Parse a passport MRZ (Machine Readable Zone).
 * TD3 format: 2 lines × 44 chars (used by passports).
 * TD1 format: 3 lines × 30 chars (used by ID cards).
 * Returns extracted fields or null if not parseable.
 */
export interface MrzInfo {
  format: "TD1" | "TD3";
  documentNumber?: string;
  name?: string;
  nationality?: string;
  birthDate?: string;
  gender?: string;
  expiryDate?: string;
  personalNumber?: string;
}

export function parseMrz(text?: string | null): MrzInfo | null {
  if (!text) return null;
  const lines = text
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, ""))
    .filter((l) => /[A-Z0-9<]/.test(l) && l.length >= 25);
  if (lines.length < 2) return null;

  // TD3: two 44-char lines
  const td3 = lines.filter((l) => l.length >= 40 && l.length <= 44).slice(0, 2);
  if (td3.length === 2) {
    const l1 = td3[0].padEnd(44, "<");
    const l2 = td3[1].padEnd(44, "<");
    const docType = l1.slice(0, 2).replace(/</g, "");
    const issuing = l1.slice(2, 5);
    const docNum = l2.slice(0, 9).replace(/</g, "");
    const nationality = l2.slice(10, 13);
    const birthYY = l2.slice(13, 15);
    const birthMM = l2.slice(15, 17);
    const birthDD = l2.slice(17, 19);
    const sex = l2.slice(20, 21).replace(/</g, "") || "U";
    const expiryYY = l2.slice(21, 23);
    const expiryMM = l2.slice(23, 25);
    const expiryDD = l2.slice(25, 27);
    const nameBlock = l1.slice(5).replace(/</g, " ").replace(/\s+/g, " ").trim();

    return {
      format: "TD3",
      documentNumber: docNum || undefined,
      name: nameBlock || undefined,
      nationality: nationality || undefined,
      birthDate: birthYY ? `${birthYY > "30" ? "19" : "20"}${birthYY}-${birthMM}-${birthDD}` : undefined,
      gender: sex === "M" ? "Male" : sex === "F" ? "Female" : undefined,
      expiryDate: expiryYY ? `${expiryYY > "30" ? "19" : "20"}${expiryYY}-${expiryMM}-${expiryDD}` : undefined,
    };
  }

  // TD1: three 30-char lines
  const td1 = lines.filter((l) => l.length >= 28 && l.length <= 30).slice(0, 3);
  if (td1.length === 3) {
    const l1 = td1[0].padEnd(30, "<");
    const l2 = td1[1].padEnd(30, "<");
    const l3 = td1[2].padEnd(30, "<");
    const docNum = l1.slice(5, 14).replace(/</g, "");
    const birthYY = l2.slice(0, 2);
    const birthMM = l2.slice(2, 4);
    const birthDD = l2.slice(4, 6);
    const sex = l2.slice(7, 8).replace(/</g, "") || "U";
    const expiryYY = l2.slice(8, 10);
    const expiryMM = l2.slice(10, 12);
    const expiryDD = l2.slice(12, 14);
    const nameBlock = l3.replace(/</g, " ").replace(/\s+/g, " ").trim();
    return {
      format: "TD1",
      documentNumber: docNum || undefined,
      name: nameBlock || undefined,
      birthDate: birthYY ? `${birthYY > "30" ? "19" : "20"}${birthYY}-${birthMM}-${birthDD}` : undefined,
      gender: sex === "M" ? "Male" : sex === "F" ? "Female" : undefined,
      expiryDate: expiryYY ? `${expiryYY > "30" ? "19" : "20"}${expiryYY}-${expiryMM}-${expiryDD}` : undefined,
    };
  }
  return null;
}

/** Strip non-alphanumeric, lowercase, for fuzzy comparison of two strings. */
export function fuzzyEqual(a?: string | null, b?: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return canonicalize(a) === canonicalize(b);
}

/**
 * Deep normalization for comparison:
 *  - lowercases Latin
 *  - strips ALL whitespace, punctuation, separators
 *  - removes Arabic Tatweel (ـ)
 *  - normalizes Alef variants (أ إ آ ٱ) → ا
 *  - normalizes Ya (ى) → ي
 *  - normalizes Ta Marbuta (ة) → ه (common OCR confusion)
 *  - normalizes Alef Maksura → ي
 *  - strips Arabic diacritics/tashkeel (harakat)
 *  - converts Arabic-Indic digits → Western
 *  - removes field labels like "الاسم:" or "Name:"
 */
function canonicalize(s: string): string {
  let r = String(s)
    // Remove Arabic diacritics (tashkeel/harakat) U+064B–U+0652, U+0670
    .replace(/[\u064B-\u0652\u0670]/g, "")
    // Remove Tatweel
    .replace(/\u0640/g, "")
    // Normalize Alef variants
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    // Normalize Ya/Alef Maksura
    .replace(/[\u0649\u0670]/g, "\u064A")
    // Normalize Ta Marbuta → Ha (very common OCR confusion: ة ↔ ه)
    .replace(/\u0629/g, "\u0647")
    // Arabic-Indic + Extended Arabic-Indic digits → Western
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    // Lowercase Latin
    .toLowerCase()
    // Remove field labels (Arabic + English) that the VLM sometimes includes
    .replace(/(الاسم|الرقم القومي|تاريخ الميلاد|النوع|الديانة|الوظيفة|العنوان|الجنسية|الحالة الاجتماعية|رقم المستند|تاريخ الانتهاء|name|national id|date of birth|gender|religion|profession|address|nationality|marital status|document no|expiry)\s*:?\s*/gi, "")
    // Remove ALL non-letter/non-digit characters (whitespace, punctuation, separators, slashes, hyphens)
    .replace(/[^\p{L}\p{N}]/gu, "");
  return r;
}

/**
 * Levenshtein edit distance between two strings.
 * Used to tolerate minor OCR errors (e.g. محمد vs محمود = distance 1).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * A field is "correct" vs ground truth using multi-tier matching:
 *  1. Exact match after canonicalization → pass
 *  2. One contains the other → pass (handles truncated names)
 *  3. Levenshtein distance within tolerance → pass (handles OCR single-char errors)
 *
 * The tolerance scales with string length:
 *  - strings ≤ 4 chars: allow 1 edit
 *  - strings 5–10 chars: allow 2 edits
 *  - strings > 10 chars: allow 3 edits
 */
export function fieldMatches(expected: string | null | undefined, actual: string | null | undefined): boolean {
  if (!expected) return true; // no ground truth → auto pass
  if (!actual) return false;

  const ce = canonicalize(expected);
  const ca = canonicalize(actual);

  // Tier 1: exact canonical match
  if (ce === ca) return true;

  // Tier 2: containment (one is a substring of the other — handles truncated reads)
  if (ce.includes(ca) || ca.includes(ce)) return true;

  // Tier 3: Levenshtein distance within tolerance (handles OCR single-char errors)
  const maxLen = Math.max(ce.length, ca.length);
  const tolerance = maxLen <= 4 ? 1 : maxLen <= 10 ? 2 : 3;
  const dist = levenshtein(ce, ca);
  return dist <= tolerance;
}

/** Get human-readable doc type label. */
export function docTypeLabel(t: DocType): string {
  return { national_id: "National ID", passport: "Passport", driver_license: "Driver License", residence: "Residence" }[t];
}
