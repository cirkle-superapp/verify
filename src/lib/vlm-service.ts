import ZAI from "z-ai-web-dev-sdk";
import type {
  ExtractedDocumentData,
  FaceMatchResult,
  LivenessResult,
  DocType,
  LivenessAction,
  ImageQualityAssessment,
  FieldConfidence,
} from "@/lib/verification-types";
import {
  normalizeArabic,
  normalizeLatin,
  normalizeGender,
  normalizeDate,
  digitsOnly,
  parseEgyptianNationalId,
  parseMrz,
} from "@/lib/doc-validators";
import { normalizeForVlm, isLikelyTooLarge } from "@/lib/image-server";

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

interface ImageContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

function buildContent(prompt: string, images: string[]): ImageContent[] {
  const content: ImageContent[] = [{ type: "text", text: prompt }];
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img } });
  }
  return content;
}

/** Detect the VLM "image format/parse error" (code 1210) from any error shape. */
function isImageFormatError(e: any): boolean {
  const msg = String(e?.message || e?.toString?.() || "");
  return (
    msg.includes("1210") ||
    msg.includes("图片输入格式") ||
    msg.includes("图片解析错误") ||
    /image.*(format|parse|invalid)/i.test(msg)
  );
}

/**
 * Call the vision API with automatic image normalization + retry.
 * If the first call fails with an image-format error (1210), we re-compress
 * the images server-side and retry once. This fixes the common case where a
 * user uploads a large phone photo (HEIC, multi-MB JPEG) that the VLM rejects.
 */
async function callVision(prompt: string, images: string[]): Promise<string> {
  const zai = await getZai();

  // Pre-emptively normalize any obviously-too-large images to avoid a wasted round-trip.
  const prepared: string[] = [];
  for (const img of images) {
    if (isLikelyTooLarge(img)) {
      prepared.push(await normalizeForVlm(img));
    } else {
      prepared.push(img);
    }
  }

  const doCall = async (imgs: string[]) => {
    const response = await zai.chat.completions.createVision({
      messages: [
        {
          role: "user",
          content: buildContent(prompt, imgs),
        },
      ],
      thinking: { type: "disabled" },
    } as any);
    return response.choices[0]?.message?.content ?? "";
  };

  try {
    return await doCall(prepared);
  } catch (e: any) {
    if (isImageFormatError(e)) {
      // Re-compress ALL images (not just the big ones) and retry once
      const recompressed: string[] = [];
      for (const img of prepared) {
        try {
          recompressed.push(await normalizeForVlm(img));
        } catch {
          recompressed.push(img);
        }
      }
      return await doCall(recompressed);
    }
    throw e;
  }
}

function tryParseJson(text: string): any | null {
  if (!text) return null;
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const DOC_LABELS: Record<DocType, string> = {
  national_id: "Egyptian National ID card (بطاقة الرقم القومي)",
  passport: "Egyptian / Arab passport (جواز السفر)",
  driver_license: "Egyptian driver license (رخصة قيادة)",
  residence: "Residence card for foreigners (بطاقة إقامة)",
};

/* ────────────────────────────────────────────────────────────────────────────
 * PASS 4: Arabic → English translation (using LLM, not VLM)
 * Translates Arabic names/fields to English for cross-validation.
 * ──────────────────────────────────────────────────────────────────────── */
async function translateArabicToEnglish(arabicText: string): Promise<string> {
  if (!arabicText || arabicText.trim().length === 0) return "";
  const zai = await getZai();
  try {
    const response = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a professional Arabic-to-English translator specializing in personal names and identity document fields. Translate the given Arabic text to English. For names, use the most common transliteration (e.g. محمد → Mohamed, أحمد → Ahmed, عبد الرحمن → Abdelrahman). Return ONLY the English translation, nothing else.",
        },
        { role: "user", content: arabicText },
      ],
      thinking: { type: "disabled" },
    } as any);
    return (response.choices[0]?.message?.content ?? "").trim();
  } catch {
    return "";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * PASS 5: English → Arabic transliteration (reverse direction)
 * ──────────────────────────────────────────────────────────────────────── */
async function transliterateEnglishToArabic(englishText: string): Promise<string> {
  if (!englishText || englishText.trim().length === 0) return "";
  const zai = await getZai();
  try {
    const response = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a professional English-to-Arabic transliterator specializing in personal names. Transliterate the given English name to Arabic script. Use standard transliteration (e.g. Mohamed → محمد, Ahmed → أحمد). Return ONLY the Arabic text, nothing else.",
        },
        { role: "user", content: englishText },
      ],
      thinking: { type: "disabled" },
    } as any);
    return (response.choices[0]?.message?.content ?? "").trim();
  } catch {
    return "";
  }
}

/** Check if a string contains Arabic characters */
function containsArabic(s?: string | null): boolean {
  if (!s) return false;
  return /[\u0600-\u06FF\u0750-\u077F]/.test(s);
}

/** Check if a string contains Latin characters */
function containsLatin(s?: string | null): boolean {
  if (!s) return false;
  return /[a-zA-Z]/.test(s);
}

/* ────────────────────────────────────────────────────────────────────────────
 * PASS 1: Image quality assessment (fast pre-check)
 * ──────────────────────────────────────────────────────────────────────── */
export async function assessImageQuality(
  frontImage: string,
  docType: DocType
): Promise<ImageQualityAssessment> {
  const prompt = `You are a document image quality auditor for ${DOC_LABELS[docType]}.

Analyze this document photo and assess its quality for automated OCR. Return STRICT JSON only:
{
  "overallQuality": 0.0-1.0,
  "isDocument": boolean — is this actually a photo of an identity document (not random image)?
  "isBlurry": boolean — is text blurry / out of focus?
  "hasGlare": boolean — are there light reflections / glare hiding text?
  "isFramedWell": boolean — is the document well-centered with margin around it?
  "rotation": "none" | "slight" | "significant" — is the document rotated?
  "lighting": "good" | "too_dark" | "too_bright" | "poor",
  "isFullFrame": boolean — is the ENTIRE document visible (not cropped at edges)?
  "issues": ["short list of detected problems"],
  "suggestions": ["short actionable tips for the user to retake"]
}
Be concise. Be honest — if the image is poor, say so.`;

  const raw = await callVision(prompt, [frontImage]);
  const parsed = tryParseJson(raw);
  if (!parsed) {
    return {
      overallQuality: 0.5,
      isDocument: true,
      isBlurry: false,
      hasGlare: false,
      isFramedWell: true,
      rotation: "none",
      lighting: "good",
      isFullFrame: true,
      issues: [],
      suggestions: [],
    };
  }
  return {
    overallQuality: typeof parsed.overallQuality === "number" ? parsed.overallQuality : 0.5,
    isDocument: parsed.isDocument ?? true,
    isBlurry: !!parsed.isBlurry,
    hasGlare: !!parsed.hasGlare,
    isFramedWell: !!parsed.isFramedWell,
    rotation: parsed.rotation ?? "none",
    lighting: parsed.lighting ?? "good",
    isFullFrame: parsed.isFullFrame ?? true,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * PASS 2: Arabic-first OCR — read every Arabic glyph on the document
 * ──────────────────────────────────────────────────────────────────────── */
export async function ocrArabicText(
  frontImage: string,
  backImage: string | null,
  docType: DocType
): Promise<string> {
  const prompt = `You are an expert Arabic OCR engine specialized in ${DOC_LABELS[docType]}.

Read EVERY piece of ARABIC text visible on this document. Preserve:
- Exact Arabic characters including diacritics (تشكيل) if present
- Reading order (right-to-left, top-to-bottom)
- Numbers in Arabic-Indic form (٠١٢٣) if printed that way, otherwise Western
- Field labels AND their values (e.g. "الاسم: محمد أحمد")
- The machine-readable zone if present (transcribe the < characters too)

Output ONLY the raw Arabic text, line by line. Do NOT translate. Do NOT add English. Do NOT add commentary or markdown.`;
  const images = [frontImage];
  if (backImage) images.push(backImage);
  return (await callVision(prompt, images)).trim();
}

/* ────────────────────────────────────────────────────────────────────────────
 * PASS 3: Structured field extraction (uses Arabic text as context)
 * ──────────────────────────────────────────────────────────────────────── */
interface RawStructuredFields {
  fullNameAr?: string;
  fullNameEn?: string;
  nationalId?: string;
  birthDate?: string;
  address?: string;
  gender?: string;
  documentNo?: string;
  expiryDate?: string;
  nationality?: string;
  job?: string;
  religion?: string;
  maritalStatus?: string;
  extraFields?: Record<string, string>;
  rawText?: string;
  hasPhoto?: boolean;
  fieldConfidence?: FieldConfidence;
  mrzLine1?: string;
  mrzLine2?: string;
  mrzLine3?: string;
}

async function extractStructuredFields(
  frontImage: string,
  backImage: string | null,
  docType: DocType,
  arabicText: string
): Promise<RawStructuredFields> {
  const prompt = `You are a forensic KYC field extractor for ${DOC_LABELS[docType]}.

I already ran an Arabic OCR pass on this document. Here is the raw Arabic text I read:
"""
${arabicText}
"""

Now combine this Arabic text with what you can see in the image, and extract STRUCTURED fields with high precision.

Return STRICT JSON only (no markdown) with this exact schema:
{
  "fullNameAr": "الاسم الكامل بالعربية as printed (4 names: first father grandfather family). Preserve exact spelling. Empty string if absent.",
  "fullNameEn": "Full name in English/Latin letters as printed. Empty string if absent.",
  "nationalId": "الرقم القومي — the 14-digit Egyptian national number. ONLY DIGITS, no spaces. Empty string if this document type does not have one.",
  "birthDate": "تاريخ الميلاد as printed. Prefer ISO YYYY-MM-DD if you can infer the year; otherwise keep the printed format.",
  "address": "العنوان as printed (governorate, district, street). Empty string if absent.",
  "gender": "Male/Female/ذكر/أنثى as printed.",
  "documentNo": "رقم المستند — the document's own serial number (passport number, license number, residence number). NOT the national ID.",
  "expiryDate": "تاريخ الانتهاء as printed, ISO YYYY-MM-DD if possible. Empty string if absent.",
  "nationality": "الجنسية as printed (e.g. مصري / Egyptian). Empty string if absent.",
  "job": "الوظيفة / المهنة as printed. Empty string if absent.",
  "religion": "الديانة as printed — ONLY include if this document type shows it (Egyptian national ID has it; passports do not). Empty string otherwise.",
  "maritalStatus": "الحالة الاجتماعية as printed. Empty string if absent.",
  "extraFields": { "field_name": "value" } for any other readable fields,
  "rawText": "full OCR dump of every readable line (Arabic + English + numbers) separated by newlines",
  "hasPhoto": true if a person photo is visible,
  "fieldConfidence": {
    "fullNameAr": 0.0-1.0, "fullNameEn": 0.0-1.0, "nationalId": 0.0-1.0,
    "birthDate": 0.0-1.0, "address": 0.0-1.0, "gender": 0.0-1.0,
    "documentNo": 0.0-1.0, "expiryDate": 0.0-1.0, "nationality": 0.0-1.0,
    "job": 0.0-1.0, "religion": 0.0-1.0, "maritalStatus": 0.0-1.0
  },
  "mrzLine1": "the first line of the MRZ if present, exactly 44 or 30 chars",
  "mrzLine2": "the second line of the MRZ if present",
  "mrzLine3": "the third line of the MRZ if present (TD1 format only)"
}

Rules:
- For each field, only fill it if you are CONFIDENT it is actually printed and readable on the document. Otherwise return an empty string.
- IMPORTANT: If a field is blank/empty/not printed on the document, you MUST return an empty string "". Do NOT guess, hallucinate, or infer a value. An empty field is a valid and common state.
- Do NOT generate single-word values for the job/profession field. If the الوظيفة field is blank on the card, return "". If it has multi-word text like "حاصل على بكالوريوس صيدلة", return that exact text.
- The nationalId MUST be exactly 14 digits for an Egyptian ID.
- Preserve Arabic diacritics and exact letter forms.
- fieldConfidence must reflect how clearly you could read each field (low for blurry/partial, and 0 for fields that are empty/absent).`;

  const images = [frontImage];
  if (backImage) images.push(backImage);
  const raw = await callVision(prompt, images);
  const parsed = tryParseJson(raw);
  if (!parsed) return { rawText: raw };
  return parsed as RawStructuredFields;
}

/**
 * Full multi-pass document extraction: quality + Arabic OCR + structured → validate.
 *
 * Passes 1 (quality) and 2 (Arabic OCR) run in PARALLEL since they don't depend
 * on each other. Pass 3 (structured) runs after, using the Arabic text as context.
 * This cuts total latency by ~30% vs sequential execution.
 */
export async function extractDocumentData(
  frontImage: string,
  backImage: string | null,
  docType: DocType
): Promise<ExtractedDocumentData> {
  // Pass 1 + 2 in parallel (no dependency between them)
  const [qualityResult, arabicResult] = await Promise.allSettled([
    assessImageQuality(frontImage, docType),
    ocrArabicText(frontImage, backImage, docType),
  ]);

  const imageQuality: ImageQualityAssessment | undefined =
    qualityResult.status === "fulfilled" ? qualityResult.value : undefined;
  const arabicText: string = arabicResult.status === "fulfilled" ? arabicResult.value : "";

  // Pass 3: structured extraction (depends on arabicText for context)
  let raw: RawStructuredFields;
  try {
    raw = await extractStructuredFields(frontImage, backImage, docType, arabicText);
  } catch (e) {
    raw = { rawText: arabicText };
  }

  // Post-process & validate
  const nationalId = digitsOnly(raw.nationalId);
  const idInfo = docType === "national_id" ? parseEgyptianNationalId(nationalId) : null;
  const mrzText = [raw.mrzLine1, raw.mrzLine2, raw.mrzLine3].filter(Boolean).join("\n");
  const mrzInfo = mrzText ? parseMrz(mrzText) : null;

  // Strip field labels that the VLM sometimes includes in values (e.g. "الاسم: أحمد")
  const stripLabel = (s?: string) => {
    if (!s) return undefined;
    return s.replace(/^(الاسم|الرقم القومي|تاريخ الميلاد|النوع|الديانة|الوظيفة|العنوان|الجنسية|الحالة الاجتماعية|رقم المستند|تاريخ الانتهاء|name|national id|date of birth|gender|religion|profession|address|nationality|marital status|document no|expiry)\s*:?\s*/i, "").trim() || undefined;
  };

  const fullNameAr = normalizeArabic(stripLabel(raw.fullNameAr)) || undefined;
  const fullNameEn = normalizeLatin(stripLabel(raw.fullNameEn)) || undefined;
  const gender = normalizeGender(stripLabel(raw.gender)) || mrzInfo?.gender || idInfo?.gender;
  const birthDate = normalizeDate(stripLabel(raw.birthDate)) || idInfo?.birthDate || mrzInfo?.birthDate;
  const expiryDate = normalizeDate(stripLabel(raw.expiryDate)) || mrzInfo?.expiryDate;

  // Document number: prefer the VLM's read of the printed field, fall back to MRZ.
  // (MRZ document number is sometimes truncated/placeholder; the printed serial is primary.)
  const documentNo = normalizeLatin(stripLabel(raw.documentNo)) || mrzInfo?.documentNumber;
  const nationality = normalizeLatin(stripLabel(raw.nationality)) || mrzInfo?.nationality;

  // average of field confidences as overall
  const fc: FieldConfidence = raw.fieldConfidence || {};
  const fcValues = Object.values(fc).filter((v): v is number => typeof v === "number");
  const avgFieldConf = fcValues.length ? fcValues.reduce((a, b) => a + b, 0) / fcValues.length : 0.7;

  const confidence = imageQuality
    ? Math.min(avgFieldConf, 0.4 + imageQuality.overallQuality * 0.6)
    : avgFieldConf;

  const resultBase: ExtractedDocumentData = {
    fullNameAr,
    fullNameEn,
    nationalId,
    birthDate,
    address: normalizeArabic(stripLabel(raw.address)) || undefined,
    gender,
    documentNo,
    expiryDate,
    nationality,
    // Job: if the field confidence is very low AND the value is a single short word,
    // it's likely a hallucination. Drop it (return undefined) so the UI shows "—".
    job: (() => {
      const jobVal = normalizeArabic(stripLabel(raw.job)) || undefined;
      const jobConf = raw.fieldConfidence?.job;
      if (jobVal && typeof jobConf === "number" && jobConf < 0.5) {
        const wordCount = jobVal.trim().split(/\s+/).length;
        if (wordCount <= 1) return undefined; // likely hallucinated single word
      }
      return jobVal;
    })(),
    religion: normalizeArabic(stripLabel(raw.religion)) || undefined,
    maritalStatus: normalizeArabic(stripLabel(raw.maritalStatus)) || undefined,
    extraFields: raw.extraFields || undefined,
    rawText: raw.rawText || arabicText,
    arabicText: arabicText || undefined,
    hasPhoto: raw.hasPhoto ?? true,
    confidence,
    fieldConfidence: fc,
    imageQuality,
    mrzParsed: !!mrzInfo,
    validationFlags: {
      nationalIdValid: idInfo?.isValid,
      nationalIdChecksumValid: idInfo?.checksumValid,
      genderInferred: idInfo?.gender,
    },
    passes: 4, // now 4 passes: quality + Arabic OCR + structured + translation
  };

  // ─── PASS 4: Cross-validation + translation ────────────────────────────
  // If we have Arabic name but no English, translate it.
  // If we have English name but no Arabic, transliterate it.
  // Cross-validate: if both present, check they match (via reverse translation).
  const result: ExtractedDocumentData = { ...resultBase };

  // Fill missing fullNameEn by translating Arabic → English
  if (containsArabic(result.fullNameAr) && !containsLatin(result.fullNameEn)) {
    const translated = await translateArabicToEnglish(result.fullNameAr);
    if (translated && containsLatin(translated)) {
      result.fullNameEn = normalizeLatin(translated);
    }
  }
  // Fill missing fullNameAr by transliterating English → Arabic
  if (containsLatin(result.fullNameEn) && !containsArabic(result.fullNameAr)) {
    const transliterated = await transliterateEnglishToArabic(result.fullNameEn);
    if (transliterated && containsArabic(transliterated)) {
      result.fullNameAr = normalizeArabic(transliterated);
    }
  }
  // Cross-validate: if both present, check consistency via reverse translation
  if (containsArabic(result.fullNameAr) && containsLatin(result.fullNameEn)) {
    const arToEn = await translateArabicToEnglish(result.fullNameAr);
    // Store the cross-validated translations in extraFields for audit
    if (!result.extraFields) result.extraFields = {};
    if (arToEn) result.extraFields["_nameEn_fromArabic"] = arToEn;
    // If the VLM's English name doesn't match the translated Arabic, prefer the
    // translated-from-Arabic version (Arabic is usually the primary on the card)
    if (arToEn && containsLatin(arToEn) && result.fullNameEn) {
      const { fieldMatches } = await import("@/lib/doc-validators");
      if (!fieldMatches(arToEn, result.fullNameEn)) {
        result.extraFields["_nameEn_original"] = result.fullNameEn;
        result.fullNameEn = normalizeLatin(arToEn);
      }
    }
  }

  // ─── PASS 5: Country detection + spec validation ──────────────────────
  // Use the worldwide document specs catalog to:
  //  - Detect the issuing country from the national ID format
  //  - Validate the national ID against the country's pattern
  //  - Store detected country + validation flags in extraFields
  try {
    const { DOCUMENT_SPECS } = await import("@/lib/doc-specs/catalog");
    if (result.nationalId) {
      // Find a spec whose nationalIdPattern matches
      for (const spec of DOCUMENT_SPECS) {
        if (spec.nationalIdPattern && spec.docType === docType) {
          try {
            const re = new RegExp(spec.nationalIdPattern);
            if (re.test(result.nationalId)) {
              if (!result.extraFields) result.extraFields = {};
              result.extraFields["_detectedCountry"] = spec.country;
              result.extraFields["_detectedCountryName"] = spec.countryName;
              result.extraFields["_idPatternMatched"] = "true";
              result.extraFields["_idExpectedLength"] = String(spec.nationalIdLength || "?");
              break;
            }
          } catch {
            // invalid regex → skip
          }
        }
      }
    }
  } catch {
    // catalog import is optional
  }

  return result;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Face match (unchanged signature)
 * ──────────────────────────────────────────────────────────────────────── */
export async function matchFace(
  selfieImage: string,
  documentImage: string
): Promise<FaceMatchResult> {
  const prompt = `You are a forensic face-comparison expert.

I am giving you TWO images:
- Image 1: a selfie photo of a person taken live.
- Image 2: an identity document containing a passport-style photo of the claimed person.

Compare the face in the selfie with the face photo embedded in the document.

Return STRICT JSON only (no markdown) with this exact schema:
{
  "isMatch": boolean — true if you are reasonably confident it is the SAME person,
  "samePerson": boolean — same as isMatch (duplicate for clarity),
  "similarity": number 0-100 — your estimated visual similarity score,
  "reasoning": "short explanation of facial features compared (eyes, nose, mouth, jaw, ears, skin tone, hair). Mention any anti-spoofing concerns (e.g. photo of a screen)."
}

Be strict but fair. Account for lighting, angle, and minor appearance changes. A genuine match should score 70+. If faces are clearly different people, return isMatch=false, similarity below 50.`;

  const raw = await callVision(prompt, [selfieImage, documentImage]);
  const parsed = tryParseJson(raw);
  if (!parsed) {
    return {
      isMatch: false,
      samePerson: false,
      similarity: 0,
      reasoning: raw || "Could not analyze face match.",
    };
  }
  return {
    isMatch: !!parsed.isMatch,
    samePerson: !!parsed.samePerson,
    similarity: typeof parsed.similarity === "number" ? parsed.similarity : 0,
    reasoning: parsed.reasoning || "",
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Liveness check (unchanged)
 * ──────────────────────────────────────────────────────────────────────── */
export async function checkLiveness(
  frames: string[],
  performedActions: LivenessAction[]
): Promise<LivenessResult> {
  const actionLabels = performedActions
    .map((a) => {
      const map: Record<LivenessAction, string> = {
        turn_left: "turned head LEFT",
        turn_right: "turned head RIGHT",
        look_up: "looked UP",
        blink: "blinked their eyes",
        smile: "smiled",
      };
      return map[a];
    })
    .join(", then ");

  const prompt = `You are a liveness / anti-spoofing detection system.

You are given a sequence of webcam frames captured in order while the user was asked to perform these live movements: ${actionLabels}.

Analyze the sequence for:
1. Real human head and facial movement between frames (NOT a static photo held up to the camera).
2. Whether the requested movements are visible in the frame sequence.
3. Signs of spoofing: printed photo, screen replay, mask, deepfake artifacts, no movement between frames.

Return STRICT JSON only (no markdown):
{
  "isLive": boolean — true if you are confident this is a real live human performing the movements,
  "score": number 0-100 — liveness confidence score,
  "detectedActions": ["list of action labels you actually observed among: turn_left, turn_right, look_up, blink, smile"],
  "reasoning": "short explanation: what movement you saw, any spoofing indicators, image quality notes."
}

A genuine live session with visible movement should score 70+. A single static face across all frames should score < 40.`;

  const raw = await callVision(prompt, frames);
  const parsed = tryParseJson(raw);
  if (!parsed) {
    return {
      isLive: false,
      score: 0,
      detectedActions: [],
      reasoning: raw || "Could not analyze liveness.",
    };
  }
  return {
    isLive: !!parsed.isLive,
    score: typeof parsed.score === "number" ? parsed.score : 0,
    detectedActions: Array.isArray(parsed.detectedActions) ? parsed.detectedActions : [],
    reasoning: parsed.reasoning || "",
  };
}

export async function detectFacePresence(image: string): Promise<{ hasFace: boolean; isLikelyLive: boolean; reasoning: string }> {
  const prompt = `Analyze this webcam frame. Return STRICT JSON:
{
  "hasFace": boolean — is a single clear human face visible and centered?
}
Also briefly (in "reasoning") note if it looks like a real webcam shot vs a photo of a photo / screen.`;
  const raw = await callVision(prompt, [image]);
  const parsed = tryParseJson(raw);
  return {
    hasFace: !!parsed?.hasFace,
    isLikelyLive: !!parsed?.hasFace,
    reasoning: parsed?.reasoning || (parsed ? "Face detected." : "No parseable response."),
  };
}
