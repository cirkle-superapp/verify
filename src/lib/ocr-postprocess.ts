/**
 * OCR Post-Processing Engine.
 *
 * Corrects common OCR errors using:
 *   1. Levenshtein distance against known vocabularies (Arabic names, country names, field labels)
 *   2. Country-specific name dictionaries (most common names per region)
 *   3. Common OCR confusion patterns (0↔O, 1↔l/I, 5↔S, 8↔B, etc.)
 *   4. Field label normalization (الاسم → fullNameAr, الرقم القومي → nationalId, etc.)
 *   5. Digit extraction and cleanup (remove spaces/dashes from IDs)
 *
 * This runs AFTER the AI consensus extraction, before cross-field validation.
 * It catches errors that even multi-provider consensus might agree on
 * (e.g., all 3 vision providers misread "محمد" as "محماد" — Levenshtein
 * corrects it back to the canonical form).
 */

import { stringSimilarity } from "@/lib/ai-consensus";

// ─── Common Arabic names (for Levenshtein correction) ────────────
const ARABIC_MALE_NAMES = [
  "محمد", "أحمد", "عبدالله", "عبدالرحمن", "خالد", "عمر", "يوسف", "إبراهيم", "علي", "حسن",
  "كريم", "سعيد", "ناصر", "فهد", "ماجد", "طارق", "وليد", "زياد", "بدر", "سلمان",
  "صلاح", "مصطفى", "رضا", "عماد", "فواز", "هاني", "وليد", "ياسر", "أيمن", "إسلام",
  "حمزة", "زيد", "صبري", "عبدالعزيز", "عبدالحميد", "عبدالقادر", "عبدالكريم", "عبدالمجيد",
  "عبدالناصر", "عبدالهادي", "عبدالوهاب", "عز الدين", "فاروق", "فيصل", "كمال", "ليث",
  "ماهر", "مجدي", "منصف", "منير", "نبيل", "نزار", "هشام", "وحيد", "يحيى", "يونس",
];

const ARABIC_FEMALE_NAMES = [
  "فاطمة", "عائشة", "نورة", "سارة", "هند", "ريم", "ليلى", "مريم", "سمية", "نادية",
  "هالة", "منى", "دانة", "أمل", "أسماء", "زينب", "رقية", "صفية", "خديجة", "حواء",
  "عبير", "بثينة", "جمانة", "دعاء", "رنا", "روان", "سلمى", "شيماء", "علا", "غادة",
  "لمى", "ميرا", "نورة", "وفاء", "ياسمين", "آية", "بسمة", "تالا", "جنى", "حبيبة",
];

const ARABIC_SURNAMES = [
  "القحطاني", "العتيبي", "الغامدي", "الزهراني", "الحربي", "المطيري", "الدوسري",
  "الشهري", "البلوي", "الحازمي", "السيد", "الجزايري", "المغربي", "التونسي",
  "المصري", "الشامي", "العراقي", "اللبناني", "الأردني", "السوداني", "الليبي",
  "اليمني", "العماني", "القطري", "البحريني", "الكويتي", "الإماراتي",
];

const ARABIC_NAME_DICTIONARY = new Set([
  ...ARABIC_MALE_NAMES,
  ...ARABIC_FEMALE_NAMES,
  ...ARABIC_SURNAMES,
]);

// ─── Common Western names (for English field correction) ──────────
const WESTERN_NAMES = [
  "James", "John", "Robert", "Michael", "William", "David", "Thomas", "Daniel",
  "Andrew", "Christopher", "Liam", "Noah", "Lucas", "Mason", "Ethan", "Logan",
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Susan", "Karen",
  "Nancy", "Lisa", "Sarah", "Emma", "Olivia", "Sophia", "Isabella",
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson",
  // Common Arabic-origin names transliterated to English (prevent false corrections)
  "Mohamed", "Mohammad", "Muhammad", "Ahmed", "Ahmad", "Ali", "Hassan", "Hussein",
  "Hussain", "Ibrahim", "Omar", "Omar", "Yusuf", "Yousef", "Yousuf", "Ismail",
  "Ismail", "Salah", "Salaheddin", "Khaled", "Khalid", "Tarek", "Tariq", "Karim",
  "Kareem", "Nabil", "Nabil", "Amir", "Ameer", "Rami", "Ramy", "Sami", "Samer",
  "Wael", "Wael", "Hany", "Hani", "Aymen", "Ayman", "Islam", "Eslam", "Shadi",
  "Mahmoud", "Mahmoud", "Mostafa", "Mustafa", "Moustafa", "Rashad", "Rifaat",
  "Talaat", "Farouk", "Faisal", "Fayez", "Maged", "Majed", "Walid", "Waleed",
  "Ziad", "Ziad", "Bilal", "Bilal", "Said", "Saeed", "Saber", "Sabry",
  "Adel", "Adeel", "Akram", "Assem", "Asem", "Ehab", "Emad", "Amal",
  "Iman", "Hala", "Huda", "Mona", "Maha", "Dina", "Dalia", "Dalia",
  "Reem", "Rania", "Ranya", "Heba", "Hiba", "Nour", "Noor", "Yara",
  "Farah", "Lina", "Linaa", "Maya", "Mirna", "Nada", "Nagham", "Rita",
  "Rola", "Sara", "Serene", "Sherine", "Yara", "Zahra", "Aya", "Aisha",
  "Ayesha", "Fatma", "Fatima", "Khadija", "Khadeeja", "Maryam", "Mariam",
  "Asmaa", "Asma", "Eman", "Iman", "Mervat", "Nawal", "Nawal", "Sahar",
  "Souad", "Suad", "Wafa", "Wafa", "Wala", "Yasmine", "Yasmin",
  // Common surnames (Arabic-origin in English)
  "El-Sayed", "ElSayed", "Ghonem", "Ghanem", "Mansour", "Mansour", "Nasser",
  "Naser", "Abbas", "Abbas", "Saleh", "Saleh", "Salem", "Salem", "Shalan",
  "Tawfik", "Tawfiq", "Zaki", "Zakaria", "Zakaria", "Abdullah", "Abdallah",
  "Abdul", "Abd El-Rahman", "Abdelrahman", "Abdulrahman", "Abdulaziz",
  "Abdulkareem", "Abdul Kareem", "Abdulhamid", "Abd El-Hamid",
];

const WESTERN_NAME_DICTIONARY = new Set(WESTERN_NAMES);

// ─── Country names (Arabic + English) ─────────────────────────────
const COUNTRY_NAMES_AR = [
  "مصر", "السعودية", "الإمارات", "الكويت", "قطر", "الأردن", "المغرب", "تونس",
  "الجزائر", "لبنان", "العراق", "سوريا", "ليبيا", "السودان", "البحرين", "عمان",
  "اليمن", "فلسطين", "تركيا", "إيران", "الولايات المتحدة", "المملكة المتحدة",
  "فرنسا", "ألمانيا", "إسبانيا", "إيطاليا", "هولندا", "بلجيكا", "السويد", "النرويج",
];

const COUNTRY_NAMES_EN = [
  "Egypt", "Saudi Arabia", "United Arab Emirates", "Kuwait", "Qatar", "Jordan",
  "Morocco", "Tunisia", "Algeria", "Lebanon", "Iraq", "Syria", "Libya", "Sudan",
  "Bahrain", "Oman", "Yemen", "Palestine", "Türkiye", "Iran", "United States",
  "United Kingdom", "France", "Germany", "Spain", "Italy", "Netherlands",
  "Belgium", "Sweden", "Norway",
];

// ─── Field labels (for label→field mapping) ──────────────────────
const FIELD_LABELS: { label: string; field: string; lang: "ar" | "en" }[] = [
  { label: "الاسم", field: "fullNameAr", lang: "ar" },
  { label: "الاسم رباعي", field: "fullNameAr", lang: "ar" },
  { label: "الرقم القومي", field: "nationalId", lang: "ar" },
  { label: "تاريخ الميلاد", field: "birthDate", lang: "ar" },
  { label: "النوع", field: "gender", lang: "ar" },
  { label: "الجنسية", field: "nationality", lang: "ar" },
  { label: "الديانة", field: "religion", lang: "ar" },
  { label: "الوظيفة", field: "job", lang: "ar" },
  { label: "العنوان", field: "address", lang: "ar" },
  { label: "الحالة الاجتماعية", field: "maritalStatus", lang: "ar" },
  { label: "Name", field: "fullNameEn", lang: "en" },
  { label: "National ID", field: "nationalId", lang: "en" },
  { label: "Date of Birth", field: "birthDate", lang: "en" },
  { label: "Gender", field: "gender", lang: "en" },
  { label: "Nationality", field: "nationality", lang: "en" },
  { label: "Expiry", field: "expiryDate", lang: "en" },
  { label: "Document No", field: "documentNo", lang: "en" },
];

// ─── Common OCR confusion patterns ────────────────────────────────
// Map of frequently-confused character pairs (bidirectional)
const OCR_CONFUSIONS: Record<string, string[]> = {
  "0": ["O", "D", "Q"],
  "O": ["0", "D", "Q"],
  "1": ["l", "I", "|"],
  "l": ["1", "I", "|"],
  "I": ["1", "l", "|"],
  "5": ["S", "s"],
  "S": ["5", "s"],
  "8": ["B"],
  "B": ["8"],
  "2": ["Z"],
  "Z": ["2"],
  "6": ["G"],
  "G": ["6"],
  "rn": ["m"],
  "vv": ["w"],
  "cl": ["d"],
  "ni": ["m"],
};

// ─── Levenshtein distance ─────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

/** Find closest match in a dictionary using Levenshtein distance. */
function closestMatch(
  input: string,
  dictionary: Iterable<string>,
  maxDistance: number = 2,
): { match: string; distance: number } | null {
  let best: { match: string; distance: number } | null = null;
  for (const word of dictionary) {
    if (word.length < 2) continue;
    const d = levenshtein(input, word);
    if (!best || d < best.distance) {
      best = { match: word, distance: d };
      if (d === 0) break; // exact match
    }
  }
  if (best && best.distance <= maxDistance) return best;
  return null;
}

// ─── Public API ──────────────────────────────────────────────────

export interface OcrCorrectionResult {
  original: string;
  corrected: string;
  changed: boolean;
  corrections: { original: string; corrected: string; reason: string }[];
}

/**
 * Correct a name field using the appropriate dictionary.
 * - Arabic names: corrects against ARABIC_NAME_DICTIONARY
 * - English names: corrects against WESTERN_NAME_DICTIONARY
 *
 * Each token (word) in the name is corrected independently.
 * Arabic names: maxDistance=2 (dictionary is comprehensive, 100+ names)
 * English names: maxDistance=1 (conservative — English has more valid variations,
 *   and false corrections like "Salah"→"Sarah" would be worse than no correction)
 */
export function correctNameField(name: string, isArabic: boolean): OcrCorrectionResult {
  if (!name || name.trim().length === 0) {
    return { original: name, corrected: name, changed: false, corrections: [] };
  }

  const dictionary = isArabic ? ARABIC_NAME_DICTIONARY : WESTERN_NAME_DICTIONARY;
  const maxDistance = isArabic ? 2 : 1; // English: conservative (distance 1 only)
  const tokens = name.trim().split(/\s+/);
  const corrections: { original: string; corrected: string; reason: string }[] = [];
  const correctedTokens: string[] = [];

  for (const token of tokens) {
    if (token.length < 2) {
      correctedTokens.push(token);
      continue;
    }

    // Skip if token is already in dictionary (exact match)
    if (dictionary.has(token)) {
      correctedTokens.push(token);
      continue;
    }

    // Find closest match (English: distance 1 only, Arabic: distance 2)
    const match = closestMatch(token, dictionary, maxDistance);
    if (match && match.distance > 0 && match.distance <= maxDistance) {
      correctedTokens.push(match.match);
      corrections.push({
        original: token,
        corrected: match.match,
        reason: `Levenshtein distance ${match.distance} → closest dictionary match`,
      });
    } else {
      correctedTokens.push(token); // keep original if no good match
    }
  }

  const corrected = correctedTokens.join(" ");
  return {
    original: name,
    corrected,
    changed: corrected !== name,
    corrections,
  };
}

/**
 * Clean a national ID / document number:
 *   - Remove spaces, dashes, dots
 *   - Keep only digits (and letters for passport numbers)
 *   - Correct common OCR confusions (O→0, l→1, etc.) for digit-only IDs
 */
export function cleanIdField(id: string, isNumeric: boolean = true): OcrCorrectionResult {
  if (!id) return { original: id, corrected: id, changed: false, corrections: [] };

  const corrections: { original: string; corrected: string; reason: string }[] = [];
  let cleaned = id;

  // Remove spaces, dashes, dots, slashes
  const noSpaces = cleaned.replace(/[\s\-./]/g, "");
  if (noSpaces !== cleaned) {
    corrections.push({
      original: cleaned,
      corrected: noSpaces,
      reason: "Removed spaces/dashes/dots/slashes",
    });
    cleaned = noSpaces;
  }

  if (isNumeric) {
    // Correct common OCR confusions for digit-only IDs
    let corrected = "";
    let hadConfusion = false;
    for (const ch of cleaned) {
      if (/[0-9]/.test(ch)) {
        corrected += ch;
      } else {
        // Try to correct: O→0, l→1, S→5, B→8, Z→2, G→6, etc.
        const upper = ch.toUpperCase();
        const mapped =
          upper === "O" ? "0" :
          upper === "l" || upper === "I" || upper === "|" ? "1" :
          upper === "S" ? "5" :
          upper === "B" ? "8" :
          upper === "Z" ? "2" :
          upper === "G" ? "6" :
          upper === "D" ? "0" :
          upper === "Q" ? "0" :
          null;
        if (mapped !== null) {
          corrected += mapped;
          hadConfusion = true;
        }
        // else: drop the character (non-digit, non-correctable)
      }
    }
    if (hadConfusion && corrected !== cleaned) {
      corrections.push({
        original: cleaned,
        corrected,
        reason: "Corrected OCR confusions (O→0, l→1, S→5, B→8, etc.)",
      });
      cleaned = corrected;
    }
  } else {
    // Passport: keep alphanumerics, uppercase
    const alnum = cleaned.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (alnum !== cleaned) {
      corrections.push({
        original: cleaned,
        corrected: alnum,
        reason: "Uppercased + removed non-alphanumeric chars",
      });
      cleaned = alnum;
    }
  }

  return {
    original: id,
    corrected: cleaned,
    changed: cleaned !== id,
    corrections,
  };
}

/**
 * Correct a country name (Arabic or English) using the country dictionary.
 */
export function correctCountryName(name: string): OcrCorrectionResult {
  if (!name || name.trim().length === 0) {
    return { original: name, corrected: name, changed: false, corrections: [] };
  }

  const isArabic = /[\u0600-\u06FF]/.test(name);
  const dictionary = isArabic ? COUNTRY_NAMES_AR : COUNTRY_NAMES_EN;
  const match = closestMatch(name.trim(), dictionary, 3);

  if (match && match.distance > 0 && match.distance <= 3) {
    return {
      original: name,
      corrected: match.match,
      changed: true,
      corrections: [{
        original: name,
        corrected: match.match,
        reason: `Levenshtein distance ${match.distance} → closest country match`,
      }],
    };
  }

  return { original: name, corrected: name, changed: false, corrections: [] };
}

/**
 * Strip a field label from a value.
 * E.g., "الاسم: محمد صلاح" → "محمد صلاح"
 *        "National ID: 29501010123456" → "29501010123456"
 */
export function stripFieldLabel(value: string): string {
  if (!value) return value;
  for (const { label } of FIELD_LABELS) {
    if (value.startsWith(label)) {
      return value.slice(label.length).replace(/^[\s:：]+\s*/, "").trim();
    }
  }
  return value;
}

/**
 * Full OCR post-processing pipeline for a single extracted field.
 * Runs: label strip → ID cleaning (if ID) → name correction (if name)
 */
export function postProcessField(
  field: string,
  value: string,
): OcrCorrectionResult {
  if (!value) return { original: value, corrected: value, changed: false, corrections: [] };

  // Step 1: strip label
  const stripped = stripFieldLabel(value);
  let result = stripped;
  const corrections: { original: string; corrected: string; reason: string }[] = [];
  if (stripped !== value) {
    corrections.push({ original: value, corrected: stripped, reason: "Stripped field label" });
  }

  // Step 2: field-specific correction
  if (field === "nationalId") {
    const idResult = cleanIdField(result, true);
    if (idResult.changed) {
      result = idResult.corrected;
      corrections.push(...idResult.corrections);
    }
  } else if (field === "documentNo") {
    const docResult = cleanIdField(result, false);
    if (docResult.changed) {
      result = docResult.corrected;
      corrections.push(...docResult.corrections);
    }
  } else if (field === "fullNameAr" || field === "fullNameEn") {
    const nameResult = correctNameField(result, field === "fullNameAr");
    if (nameResult.changed) {
      result = nameResult.corrected;
      corrections.push(...nameResult.corrections);
    }
  } else if (field === "nationality") {
    const countryResult = correctCountryName(result);
    if (countryResult.changed) {
      result = countryResult.corrected;
      corrections.push(...countryResult.corrections);
    }
  }

  return {
    original: value,
    corrected: result,
    changed: result !== value,
    corrections,
  };
}

/**
 * Post-process ALL extracted document fields at once.
 * Returns a map of field → OcrCorrectionResult.
 */
export function postProcessExtractedFields(fields: Record<string, string | undefined>): Record<string, OcrCorrectionResult> {
  const results: Record<string, OcrCorrectionResult> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value) {
      results[field] = postProcessField(field, value);
    }
  }
  return results;
}

/** Apply corrections and return the cleaned field map. */
export function applyCorrections(fields: Record<string, string | undefined>): Record<string, string | undefined> {
  const corrected: Record<string, string | undefined> = {};
  const postProcess = postProcessExtractedFields(fields);
  for (const [field, result] of Object.entries(postProcess)) {
    corrected[field] = result.corrected;
  }
  return corrected;
}
