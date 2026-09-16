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
 */

import { validateNationalId } from "@/lib/id-validators";
import { parseMrz } from "@/lib/mrz-parser";

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
}

export interface CrossFieldInput {
  fullNameAr?: string;
  fullNameEn?: string;
  nationalId?: string;
  country?: string; // ISO 3166-1 alpha-2
  birthDate?: string; // ISO YYYY-MM-DD
  gender?: string; // "Male" | "Female"
  expiryDate?: string;
  nationality?: string;
  documentNo?: string;
  mrzText?: string;
  docType?: string;
}

function normalizeGender(s?: string): "Male" | "Female" | null {
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

/**
 * Run cross-field validation on extracted document data.
 * Returns flags + consistency score + fraud probability.
 */
export function crossFieldValidate(input: CrossFieldInput): CrossFieldResult {
  const flags: CrossFieldFlag[] = [];
  const { fullNameAr, fullNameEn, nationalId, country, birthDate, gender, expiryDate, nationality, documentNo, mrzText, docType } = input;

  // ─── 1. National ID consistency checks ─────────────────────────
  if (nationalId && country) {
    const idValidation = validateNationalId(country, nationalId);
    if (!idValidation.isValid) {
      flags.push({
        code: "ID_FORMAT_INVALID",
        field: "nationalId",
        severity: "error",
        message: `National ID format invalid for ${country}: ${idValidation.reasoning}`,
      });
    } else if (!idValidation.checksumValid) {
      flags.push({
        code: "ID_CHECKSUM_MISMATCH",
        field: "nationalId",
        severity: "critical",
        message: `National ID checksum failed for ${country} — possible fabrication`,
      });
    }

    // Cross-check: ID-encoded gender vs extracted gender
    if (idValidation.extractedFields?.gender && gender) {
      const idGender = idValidation.extractedFields.gender;
      const extGender = normalizeGender(gender);
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
    }

    // Cross-check: ID-encoded birth date vs extracted birth date
    if (idValidation.extractedFields?.birthDate && birthDate) {
      const idBirth = idValidation.extractedFields.birthDate;
      const extBirth = birthDate.slice(0, 10);
      if (idBirth !== extBirth) {
        // Check if at least year matches (some extraction loses precision)
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
      }
    }
  }

  // ─── 2. Name script consistency ────────────────────────────────
  if (fullNameAr && containsLatin(fullNameAr)) {
    flags.push({
      code: "ARABIC_NAME_HAS_LATIN",
      field: "fullNameAr",
      severity: "warning",
      message: "Arabic name field contains Latin characters — possible OCR confusion",
    });
  }
  if (fullNameEn && containsArabic(fullNameEn)) {
    flags.push({
      code: "ENGLISH_NAME_HAS_ARABIC",
      field: "fullNameEn",
      severity: "warning",
      message: "English name field contains Arabic characters — possible OCR confusion",
    });
  }

  // ─── 3. Date sanity checks ─────────────────────────────────────
  const today = new Date();
  const birth = parseIsoDate(birthDate);
  if (birth) {
    if (birth > today) {
      flags.push({
        code: "BIRTHDATE_FUTURE",
        field: "birthDate",
        severity: "error",
        message: "Birth date is in the future — invalid",
      });
    } else {
      const ageYears = (today.getTime() - birth.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears > 120) {
        flags.push({
          code: "BIRTHDATE_TOO_OLD",
          field: "birthDate",
          severity: "warning",
          message: `Birth date implies age ${Math.round(ageYears)} — implausibly old`,
        });
      } else if (ageYears < 0) {
        flags.push({
          code: "BIRTHDATE_FUTURE",
          field: "birthDate",
          severity: "error",
          message: "Birth date is in the future",
        });
      }
    }
  }

  const expiry = parseIsoDate(expiryDate);
  if (expiry) {
    if (expiry < today) {
      flags.push({
        code: "DOCUMENT_EXPIRED",
        field: "expiryDate",
        severity: "error",
        message: `Document expired on ${expiryDate} (today is ${today.toISOString().slice(0, 10)})`,
      });
    } else {
      const daysUntilExpiry = (expiry.getTime() - today.getTime()) / (24 * 3600 * 1000);
      if (daysUntilExpiry < 30) {
        flags.push({
          code: "DOCUMENT_EXPIRING_SOON",
          field: "expiryDate",
          severity: "info",
          message: `Document expires in ${Math.round(daysUntilExpiry)} days`,
        });
      }
    }
  }

  // ─── 4. Nationality vs country consistency ─────────────────────
  if (country && nationality) {
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
        message: `Country is ${country} but nationality is "${nationality}" — mismatch`,
        expected: country,
        actual: nationality,
      });
    }
  }

  // ─── 5. MRZ consistency (if present) ──────────────────────────
  if (mrzText && mrzText.length > 30) {
    const mrz = parseMrz(mrzText);
    if (mrz) {
      // MRZ name vs extracted name
      if (mrz.name?.full && fullNameEn) {
        const mrzName = mrz.name.full.toUpperCase().replace(/[^A-Z ]/g, "");
        const extName = fullNameEn.toUpperCase().replace(/[^A-Z ]/g, "");
        // Check if names share tokens (last name at least)
        const mrzTokens = mrzName.split(/\s+/).filter(Boolean);
        const extTokens = extName.split(/\s+/).filter(Boolean);
        const shared = mrzTokens.some((t) => extTokens.includes(t) && t.length > 2);
        if (!shared && mrzTokens.length > 0 && extTokens.length > 0) {
          flags.push({
            code: "MRZ_NAME_MISMATCH",
            field: "fullNameEn",
            severity: "error",
            message: `MRZ name "${mrz.name.full}" doesn't match extracted "${fullNameEn}"`,
          });
        }
      }

      // MRZ birth date vs extracted
      if (mrz.birthDate && birthDate) {
        const mrzYear = mrz.birthDate.slice(0, 4);
        const extYear = birthDate.slice(0, 4);
        if (mrzYear !== extYear) {
          flags.push({
            code: "MRZ_BIRTHDATE_MISMATCH",
            field: "birthDate",
            severity: "error",
            message: `MRZ birth year ${mrzYear} ≠ extracted ${extYear}`,
          });
        }
      }

      // MRZ sex vs extracted gender
      if (mrz.sex !== "Unspecified" && gender) {
        const extGender = normalizeGender(gender);
        if (extGender && mrz.sex !== extGender) {
          flags.push({
            code: "MRZ_GENDER_MISMATCH",
            field: "gender",
            severity: "critical",
            message: `MRZ sex "${mrz.sex}" ≠ extracted gender "${extGender}"`,
          });
        }
      }

      // MRZ document number vs extracted
      if (mrz.documentNumber && documentNo) {
        const mrzDoc = mrz.documentNumber.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const extDoc = documentNo.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        if (mrzDoc && extDoc && mrzDoc !== extDoc && !mrzDoc.includes(extDoc) && !extDoc.includes(mrzDoc)) {
          flags.push({
            code: "MRZ_DOCNUM_MISMATCH",
            field: "documentNo",
            severity: "error",
            message: `MRZ document number "${mrz.documentNumber}" ≠ extracted "${documentNo}"`,
          });
        }
      }

      // MRZ expiry vs extracted
      if (mrz.expiryDate && expiryDate) {
        const mrzExpYear = mrz.expiryDate.slice(0, 4);
        const extExpYear = expiryDate.slice(0, 4);
        if (mrzExpYear !== extExpYear) {
          flags.push({
            code: "MRZ_EXPIRY_MISMATCH",
            field: "expiryDate",
            severity: "warning",
            message: `MRZ expiry year ${mrzExpYear} ≠ extracted ${extExpYear}`,
          });
        }
      }
    }
  }

  // ─── 6. Compute scores ─────────────────────────────────────────
  const hasCritical = flags.some((f) => f.severity === "critical");
  const hasErrors = flags.some((f) => f.severity === "error" || f.severity === "critical");

  // Consistency score: start at 1.0, subtract per flag
  let consistencyScore = 1.0;
  for (const flag of flags) {
    const deduction =
      flag.severity === "critical" ? 0.4 :
      flag.severity === "error" ? 0.2 :
      flag.severity === "warning" ? 0.1 :
      0.02;
    consistencyScore -= deduction;
  }
  consistencyScore = Math.max(0, consistencyScore);

  // Fraud probability: weighted sum of critical/error flags
  let fraudWeight = 0;
  for (const flag of flags) {
    if (flag.severity === "critical") fraudWeight += 0.3;
    else if (flag.severity === "error") fraudWeight += 0.15;
    else if (flag.severity === "warning") fraudWeight += 0.05;
  }
  const fraudProbability = Math.min(1, fraudWeight);

  return {
    flags,
    consistencyScore: Math.round(consistencyScore * 1000) / 1000,
    hasCritical,
    hasErrors,
    fraudProbability: Math.round(fraudProbability * 1000) / 1000,
  };
}
