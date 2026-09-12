/**
 * Self-hosted document field parser.
 *
 * Takes raw OCR text from Tesseract.js and extracts structured fields
 * using the worldwide document specs catalog (field positions, labels,
 * and regex patterns).
 *
 * No external API calls — pure rule-based parsing.
 */

import type { DocType, ExtractedDocumentData, FieldConfidence, ImageQualityAssessment } from "@/lib/verification-types";
import { getDocSpec, DOCUMENT_SPECS } from "@/lib/doc-specs/catalog";
import {
  normalizeArabic,
  normalizeLatin,
  normalizeGender,
  normalizeDate,
  digitsOnly,
  parseEgyptianNationalId,
  parseMrz,
  fieldMatches,
} from "@/lib/doc-validators";
import type { OCRResult } from "@/lib/ocr-engine";

/**
 * Extract a field value from OCR text by looking for its label.
 *
 * Strategy:
 *  1. Find the label (e.g. "الاسم:" or "Name:") in the text
 *  2. Take the text on the same line AFTER the label
 *  3. Or take the next non-empty line if the value is on a separate line
 */
function extractField(
  ocrText: string,
  labels: string[],
  fallbackRegex?: RegExp
): { value: string; confidence: number } | null {
  const lines = ocrText.split("\n").map((l) => l.trim());

  // Strategy 1: find label on a line, take the rest of the line
  for (const label of labels) {
    for (const line of lines) {
      // Try "Label: value" or "Label value" patterns
      const labelIdx = line.indexOf(label);
      if (labelIdx >= 0) {
        let value = line.slice(labelIdx + label.length).trim();
        // Remove leading colon/space
        value = value.replace(/^[:\s]+/, "").trim();
        if (value.length > 0 && value.length < 200) {
          return { value, confidence: 0.8 };
        }
      }
    }
  }

  // Strategy 2: find label, take next line
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(label) && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (nextLine.length > 0 && nextLine.length < 200 && !isLabel(nextLine)) {
          return { value: nextLine, confidence: 0.7 };
        }
      }
    }
  }

  // Strategy 3: regex fallback
  if (fallbackRegex) {
    const m = ocrText.match(fallbackRegex);
    if (m && m[1]) {
      return { value: m[1].trim(), confidence: 0.6 };
    }
  }

  return null;
}

/** Check if a string looks like a field label (ends with : or is a known label) */
function isLabel(s: string): boolean {
  const labels = [
    "الاسم", "Name", "الرقم القومي", "National ID", "تاريخ الميلاد",
    "Date of Birth", "DOB", "النوع", "Gender", "Sex", "الديانة",
    "Religion", "الوظيفة", "Profession", "Job", "العنوان", "Address",
    "الجنسية", "Nationality", "الحالة", "Marital", "رقم المستند",
    "Document", "Passport", "تاريخ الانتهاء", "Expiry", "EXP",
  ];
  return labels.some((l) => s.includes(l)) || s.endsWith(":");
}

/** Extract the national ID number using multi-format regex.
 *  Supports:
 *  - Egyptian ID: 14 digits starting with 2 or 3
 *  - German ID: L + 7 digits (e.g. L1234567)
 *  - French ID: 10-12 digits
 *  - UK ID: AB1234567C (2 letters + 7 digits + 1 letter)
 *  - Italian ID: AB123456 (2 letters + 6 digits)
 *  - Spanish ID: 1 letter + 8 digits (e.g. X12345678)
 *  - Dutch ID: AAA1234567 (3-9 pattern, letters+digits)
 *  - Saudi ID: 1 + 9 digits (10 total)
 *  - UAE ID: 784-XXXX-XXXXXXX-X (15 chars with hyphens)
 *  - Kuwait ID: 2/3 + 11 digits (12 total)
 *  - Qatar ID: 2/8 + 10 digits (11 total)
 *  - Bahrain ID: 9 digits
 *  - Oman ID: 8 digits
 *  - Generic: any 8-18 digit or alphanumeric sequence
 */
function extractNationalId(ocrText: string): { value: string; confidence: number } | null {
  const western = ocrText.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));

  // Try label-based extraction first: "National ID:", "رقم الهوية:", "ID Number:", etc.
  const labelMatch = extractField(western, [
    "National ID", "nationalId", "ID Number", "الرقم القومي", "رقم الهوية",
    "رقم الإقامة", "ID:", "Personal No", "Personalausweis", "Numéro national",
    "Codice Fiscale", "DNI", "BSN", "PPS",
  ]);
  if (labelMatch && labelMatch.value) {
    return { value: labelMatch.value, confidence: 0.85 };
  }

  // Egyptian ID: 14 digits starting with 2 or 3
  const egMatch = western.match(/\b[23]\d{13}\b/g);
  if (egMatch) return { value: egMatch[0], confidence: 0.9 };
  const egBroad = western.match(/[23]\d{13}/g);
  if (egBroad) return { value: egBroad[0], confidence: 0.7 };

  // German ID: L + 7 digits
  const deMatch = western.match(/\b([A-Z]\d{7,8})\b/g);
  if (deMatch) return { value: deMatch[0], confidence: 0.8 };

  // UK ID: 2 letters + 6 digits + 1 letter (AB123456C)
  const ukMatch = western.match(/\b([A-Z]{2}\d{6}[A-Z])\b/g);
  if (ukMatch) return { value: ukMatch[0], confidence: 0.85 };

  // Italian ID: 2 letters + 6 digits
  const itMatch = western.match(/\b([A-Z]{2}\d{6})\b/g);
  if (itMatch) return { value: itMatch[0], confidence: 0.8 };

  // Spanish DNI: 1 letter + 8 digits
  const esMatch = western.match(/\b([A-Z]\d{8})\b/g);
  if (esMatch) return { value: esMatch[0], confidence: 0.8 };

  // Dutch BSN: 9 digits
  const nlMatch = western.match(/\b(\d{9})\b/g);
  if (nlMatch) return { value: nlMatch[0], confidence: 0.75 };

  // Saudi ID: 1 + 9 digits (10 total)
  const saMatch = western.match(/\b(1\d{9})\b/g);
  if (saMatch) return { value: saMatch[0], confidence: 0.85 };

  // UAE ID: 784-XXXX-XXXXXXX-X pattern
  const aeMatch = western.match(/\b(784-\d{4}-\d{7}-\d)\b/g);
  if (aeMatch) return { value: aeMatch[0], confidence: 0.9 };

  // Kuwait ID: 12 digits
  const kwMatch = western.match(/\b(\d{12})\b/g);
  if (kwMatch) return { value: kwMatch[0], confidence: 0.75 };

  // Qatar ID: 11 digits
  const qaMatch = western.match(/\b(\d{11})\b/g);
  if (qaMatch) return { value: qaMatch[0], confidence: 0.75 };

  // Generic fallback: any 8-18 digit sequence
  const genericMatch = western.match(/\b(\d{8,18})\b/g);
  if (genericMatch) return { value: genericMatch[0], confidence: 0.5 };

  // Alphanumeric fallback: letters+digits 6-15 chars
  const alphaMatch = western.match(/\b([A-Z0-9]{6,15})\b/g);
  if (alphaMatch) return { value: alphaMatch[0], confidence: 0.4 };

  return null;
}

/** Extract a document serial number (alphanumeric) */
function extractDocumentNo(ocrText: string): { value: string; confidence: number } | null {
  // Look for patterns like "KM1234567" or "A12345678"
  const m = ocrText.match(/\b([A-Z]{1,3}\d{6,9})\b/);
  if (m) return { value: m[1], confidence: 0.7 };
  return null;
}

/** Extract a date in various formats */
function extractDate(ocrText: string, labels: string[]): { value: string; confidence: number } | null {
  const result = extractField(ocrText, labels);
  if (result) {
    const normalized = normalizeDate(result.value);
    if (normalized) return { value: normalized, confidence: result.confidence };
  }
  // Fallback: find any date pattern
  const m = ocrText.match(/(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
  if (m) {
    const normalized = normalizeDate(m[1]);
    if (normalized) return { value: normalized, confidence: 0.5 };
  }
  return null;
}

/**
 * Assess image quality heuristically from the OCR confidence.
 */
function assessQualityFromOCR(ocrResult: OCRResult): ImageQualityAssessment {
  const conf = ocrResult.confidence;
  const wordCount = ocrResult.words.length;
  const lowConfWords = ocrResult.words.filter((w) => w.confidence < 50).length;
  const lowConfRatio = wordCount > 0 ? lowConfWords / wordCount : 1;

  return {
    overallQuality: Math.min(1, conf * (1 - lowConfRatio * 0.3)),
    isDocument: wordCount > 5,
    isBlurry: conf < 40,
    hasGlare: false, // can't detect from OCR alone
    isFramedWell: wordCount > 10,
    rotation: "none",
    lighting: conf < 30 ? "too_dark" : conf < 50 ? "poor" : "good",
    isFullFrame: wordCount > 15,
    issues: conf < 40 ? ["Low OCR confidence — image may be blurry or poorly lit"] : [],
    suggestions: conf < 40 ? ["Retake in better lighting", "Hold camera steady"] : [],
  };
}

/**
 * Full self-hosted document extraction pipeline.
 *
 * 1. Run Tesseract.js OCR (Arabic + English)
 * 2. Parse fields using labels + regex from the specs catalog
 * 3. Validate (Egyptian ID checksum, MRZ, etc.)
 * 4. Assess image quality from OCR confidence
 *
 * No external API calls. Runs anywhere (Vercel, on-premise, edge).
 */
export async function extractDocumentSelfHosted(
  frontOcr: OCRResult,
  backOcr: OCRResult | null,
  docType: DocType,
  frontDataUrl: string
): Promise<ExtractedDocumentData> {
  const fullText = frontOcr.text + (backOcr ? "\n" + backOcr.text : "");

  // Try to detect country from the national ID pattern
  let detectedCountry: string | undefined;
  let detectedCountryName: string | undefined;

  // Extract all fields using label-based parsing
  const nameResult = extractField(fullText, ["الاسم", "Name", "الاسم الرباعي", "Surname", "Nom"]);
  const nationalIdResult = extractNationalId(fullText);
  const birthDateResult = extractDate(fullText, ["تاريخ الميلاد", "Date of Birth", "DOB", "Date de naissance"]);
  const genderResult = extractField(fullText, ["النوع", "Gender", "Sex", "الجنس", "Sexe"]);
  const expiryResult = extractDate(fullText, ["تاريخ الانتهاء", "Expiry", "EXP", "Expiration", "سارية حتى"]);
  const nationalityResult = extractField(fullText, ["الجنسية", "Nationality", "Nationalité"]);
  const addressResult = extractField(fullText, ["العنوان", "Address"]);
  const jobResult = extractField(fullText, ["الوظيفة", "Profession", "Job", "العمل"]);
  const religionResult = extractField(fullText, ["الديانة", "Religion"]);
  const maritalResult = extractField(fullText, ["الحالة الاجتماعية", "Marital Status", "Marital"]);
  const docNoResult = extractDocumentNo(fullText);

  // Fallback: if no name found via label, find the longest Arabic-only line
  // (typically the name line on Egyptian IDs which don't have field labels)
  let fallbackName: string | undefined;
  if (!nameResult) {
    const lines = fullText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    let bestLine = "";
    for (const line of lines) {
      // Check if line is primarily Arabic (at least 60% Arabic chars)
      const arabicChars = (line.match(/[\u0600-\u06FF]/g) || []).length;
      const totalChars = line.replace(/\s/g, "").length;
      if (totalChars > 0 && arabicChars / totalChars > 0.6 && line.split(/\s+/).length >= 2 && line.length > bestLine.length) {
        // Exclude lines that look like addresses (contain numbers)
        if (!/\d{3,}/.test(line)) {
          bestLine = line;
        }
      }
    }
    if (bestLine) {
      // Clean up: remove non-Arabic noise
      bestLine = bestLine.replace(/[^\u0600-\u06FF\s]/g, "").trim();
      if (bestLine.split(/\s+/).length >= 2) {
        fallbackName = bestLine;
      }
    }
  }

  // Fallback: extract gender from Arabic keywords
  let fallbackGender: string | undefined;
  if (!genderResult) {
    if (/ذكر|ذكر/i.test(fullText)) fallbackGender = "Male";
    else if (/أنثى|انثى|أنث/i.test(fullText)) fallbackGender = "Female";
  }

  // Fallback: extract religion
  let fallbackReligion: string | undefined;
  if (!religionResult) {
    if (/مسلم/i.test(fullText)) fallbackReligion = "مسلم";
    else if (/مسيحي/i.test(fullText)) fallbackReligion = "مسيحي";
  }

  // Normalize values (use fallbacks when label-based extraction fails)
  const fullNameAr = nameResult ? normalizeArabic(nameResult.value) || undefined : (fallbackName ? normalizeArabic(fallbackName) || undefined : undefined);
  const fullNameEn = nameResult ? normalizeLatin(nameResult.value) || undefined : undefined;
  const nationalId = nationalIdResult ? digitsOnly(nationalIdResult.value) : undefined;
  const birthDate = birthDateResult?.value;
  const gender = genderResult ? normalizeGender(genderResult.value) : fallbackGender;
  const expiryDate = expiryResult?.value;
  const nationality = nationalityResult ? normalizeLatin(nationalityResult.value) || undefined : undefined;
  const address = addressResult ? normalizeArabic(addressResult.value) || undefined : undefined;
  const job = jobResult ? normalizeArabic(jobResult.value) || undefined : undefined;
  const religion = religionResult ? normalizeArabic(religionResult.value) || undefined : fallbackReligion;
  const maritalStatus = maritalResult ? normalizeArabic(maritalResult.value) || undefined : undefined;
  const documentNo = docNoResult ? normalizeLatin(docNoResult.value) || undefined : undefined;

  // Validate Egyptian National ID
  const idInfo = docType === "national_id" && nationalId ? parseEgyptianNationalId(nationalId) : null;

  // Try MRZ parsing
  const mrzInfo = parseMrz(fullText);

  // Detect country from ID pattern
  if (nationalId) {
    for (const spec of DOCUMENT_SPECS) {
      if (spec.nationalIdPattern && spec.docType === docType) {
        try {
          if (new RegExp(spec.nationalIdPattern).test(nationalId)) {
            detectedCountry = spec.country;
            detectedCountryName = spec.countryName;
            break;
          }
        } catch {}
      }
    }
  }

  // Build field confidence
  const fc: FieldConfidence = {
    fullNameAr: nameResult?.confidence,
    fullNameEn: nameResult?.confidence,
    nationalId: nationalIdResult?.confidence,
    birthDate: birthDateResult?.confidence,
    gender: genderResult?.confidence,
    documentNo: docNoResult?.confidence,
    expiryDate: expiryResult?.confidence,
    nationality: nationalityResult?.confidence,
    job: jobResult?.confidence,
    religion: religionResult?.confidence,
    maritalStatus: maritalResult?.confidence,
  };

  const fcValues = Object.values(fc).filter((v): v is number => typeof v === "number");
  const avgConf = fcValues.length ? fcValues.reduce((a, b) => a + b, 0) / fcValues.length : 0.5;

  const imageQuality = assessQualityFromOCR(frontOcr);

  // If we have ID info, use inferred gender/birthDate as fallback
  const finalGender = gender || mrzInfo?.gender || idInfo?.gender;
  const finalBirthDate = birthDate || idInfo?.birthDate || mrzInfo?.birthDate;
  const finalExpiryDate = expiryDate || mrzInfo?.expiryDate;
  const finalDocumentNo = documentNo || mrzInfo?.documentNumber;
  const finalNationality = nationality || mrzInfo?.nationality;

  const extraFields: Record<string, string> = {};
  if (detectedCountry) {
    extraFields._detectedCountry = detectedCountry;
    extraFields._detectedCountryName = detectedCountryName || "";
    extraFields._idPatternMatched = "true";
  }
  if (idInfo) {
    extraFields._nationalIdValid = idInfo.isValid ? "true" : "false";
    extraFields._nationalIdChecksumValid = idInfo.checksumValid ? "true" : "false";
  }
  if (mrzInfo) {
    extraFields._mrzFormat = mrzInfo.format;
  }

  return {
    fullNameAr,
    fullNameEn: fullNameAr && !fullNameEn ? fullNameEn : fullNameEn,
    nationalId,
    birthDate: finalBirthDate,
    address,
    gender: finalGender,
    documentNo: finalDocumentNo,
    expiryDate: finalExpiryDate,
    nationality: finalNationality,
    job,
    religion,
    maritalStatus,
    extraFields,
    rawText: fullText,
    arabicText: frontOcr.text,
    hasPhoto: true, // assume photo present
    confidence: Math.min(avgConf, 0.4 + imageQuality.overallQuality * 0.6),
    fieldConfidence: fc,
    imageQuality,
    mrzParsed: !!mrzInfo,
    validationFlags: {
      nationalIdValid: idInfo?.isValid,
      nationalIdChecksumValid: idInfo?.checksumValid,
      genderInferred: idInfo?.gender,
    },
    passes: 1, // single-pass OCR (no multi-pass VLM)
  };
}
