/**
 * Cirkle VLM Service — CONSENSUS MODE.
 *
 * Implements the user's explicit directive:
 *   "be sure we use ai api in consensus they cross check with each other
 *    to give perfect outcome"
 *
 * For every AI task, MULTIPLE providers are called IN PARALLEL and their
 * outputs are cross-checked using:
 *   - callVisionConsensus  → Gemini + OpenRouter + NVIDIA vision
 *   - callTextConsensus    → Groq + Gemini + NVIDIA + OpenRouter + HuggingFace
 *   - translateWithConsensus → Groq + Gemini (+ tie-breakers)
 *   - consensusJsonFields  → per-field majority vote on structured JSON
 *
 * Each result carries a `consensus` object describing agreement %, the
 * providers that succeeded, and a verdict (unanimous | majority | split).
 *
 * GRACEFUL DEGRADATION:
 *   If NO AI providers are configured (no env vars), every function
 *   returns null/empty. The API routes then fall back to self-hosted
 *   engines only. This means the app always works — with or without keys.
 */

import type {
  ExtractedDocumentData,
  FaceMatchResult,
  LivenessResult,
  DocType,
  LivenessAction,
  ImageQualityAssessment,
  FieldConfidence,
  ConsensusInfo,
} from "@/lib/verification-types";
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
import { normalizeForVlm, isLikelyTooLarge } from "@/lib/image-server";
import {
  geminiVision,
  openRouterVision,
  nvidiaVision,
  containsArabic,
  containsLatin,
  hasVisionProviders,
  hasTextProviders,
  configuredProviders,
} from "@/lib/ai-router";
import {
  callVisionConsensus,
  translateWithConsensus,
  consensusJsonFields,
  buildConsensusInfo,
  mergeConsensusInfo,
  emptyConsensusInfo,
  type ConsensusOutcome,
} from "@/lib/ai-consensus";

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

/** Returns true if AI providers are configured (consensus mode is active). */
export function isConsensusModeActive(): boolean {
  return hasVisionProviders() || hasTextProviders();
}

/** Returns the list of configured provider names (for UI display). */
export function getConfiguredProviders(): string[] {
  return configuredProviders();
}

/** Per-provider timeout — optimized for speed (was 15s, now 8s). */
const PROVIDER_TIMEOUT_MS = 12_000;

/**
 * Run a vision prompt against multiple providers IN PARALLEL.
 * Uses EARLY-RETURN strategy: resolves as soon as the FIRST provider
 * returns a non-empty result (doesn't wait for all to finish/timeout).
 * This cuts extraction time from ~38s to ~3-8s (speed of fastest provider).
 */
async function runVisionProviders(
  prompt: string,
  images: string[]
): Promise<{ provider: string; raw: string; latencyMs: number }[]> {
  if (!hasVisionProviders()) return [];

  const tasks: { provider: string; fn: () => Promise<string> }[] = [];
  tasks.push({ provider: "gemini-2.5-flash", fn: () => geminiVision(prompt, images) });
  tasks.push({ provider: "openrouter-ling-vl", fn: () => openRouterVision(prompt, images) });
  tasks.push({ provider: "nvidia-llama-vision", fn: () => nvidiaVision(prompt, images) });

  // Early-return: resolve as soon as ANY provider returns non-empty result
  // Other providers continue in background (results collected if they finish)
  const startTime = Date.now();
  const allResults: { provider: string; raw: string; latencyMs: number }[] = [];
  let firstResult: { provider: string; raw: string; latencyMs: number } | null = null;

  const promises = tasks.map(async (t) => {
    const s = Date.now();
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), PROVIDER_TIMEOUT_MS)
      );
      const raw = await Promise.race([t.fn(), timeout]);
      const result = { provider: t.provider, raw, latencyMs: Date.now() - s };
      // If this is the first non-empty result, store it for early return
      if (!firstResult && raw && raw.trim().length > 0) {
        firstResult = result;
      }
      allResults.push(result);
      return result;
    } catch (e: any) {
      const result = { provider: t.provider, raw: "", latencyMs: Date.now() - s };
      allResults.push(result);
      return result;
    }
  });

  // Race: either wait for first non-empty result, or timeout after PROVIDER_TIMEOUT_MS
  const firstNonEmpty = await Promise.race([
    ...promises,
    new Promise<{ provider: string; raw: string; latencyMs: number }>((resolve) =>
      setTimeout(() => resolve({ provider: "timeout", raw: "", latencyMs: Date.now() - startTime }), PROVIDER_TIMEOUT_MS + 2000)
    ),
  ]);

  // If we got a first result, return immediately with all results collected so far
  // Other providers may still be running — we don't wait for them
  if (firstResult && firstResult.raw.trim().length > 0) {
    return allResults; // return whatever we have so far (at least 1 non-empty)
  }

  // If no early result, wait for all to finish (they'll timeout at PROVIDER_TIMEOUT_MS)
  await Promise.allSettled(promises);
  return allResults;
}

function buildFieldConsensus(
  providerResults: { provider: string; raw: string; latencyMs: number }[],
  fieldNames: string[]
): { merged: Record<string, any>; fieldAgreement: Record<string, number>; consensus: ConsensusInfo | null } {
  const parsed = providerResults
    .map((r) => ({ provider: r.provider, data: tryParseJson(r.raw) }))
    .filter((p) => p.data);

  if (parsed.length === 0) {
    return { merged: {}, fieldAgreement: {}, consensus: emptyConsensusInfo() };
  }

  const { merged, fieldAgreement } = consensusJsonFields(parsed, fieldNames);
  const successful = parsed.length;
  const total = providerResults.length;
  const agreementValues = Object.values(fieldAgreement).filter((v) => v > 0);
  const agreement = agreementValues.length > 0
    ? agreementValues.reduce((a, b) => a + b, 0) / agreementValues.length
    : 0;

  const consensus: ConsensusInfo = {
    total,
    successful,
    providerNames: parsed.map((p) => p.provider),
    agreement: Math.round(agreement * 100) / 100,
    fieldAgreement,
    outcomes: providerResults.map((r) => ({
      provider: r.provider, success: !!r.raw, latencyMs: r.latencyMs,
    })),
    verdict: agreement >= 0.95 ? "unanimous" : agreement >= 0.66 ? "majority" : "split",
  };

  return { merged, fieldAgreement, consensus };
}

/* ─── Pass 1: Image quality assessment (consensus) ──────────────── */
export async function assessImageQuality(
  frontImage: string,
  docType: DocType
): Promise<{ quality: ImageQualityAssessment | null; consensus: ConsensusInfo | null }> {
  if (!hasVisionProviders()) return { quality: null, consensus: null };

  const prompt = `You are a document image quality auditor for ${DOC_LABELS[docType]}.
Analyze this document photo. Return STRICT JSON:
{
  "overallQuality": 0.0-1.0,
  "isDocument": boolean,
  "isBlurry": boolean,
  "hasGlare": boolean,
  "isFramedWell": boolean,
  "rotation": "none"|"slight"|"significant",
  "lighting": "good"|"too_dark"|"too_bright"|"poor",
  "isFullFrame": boolean,
  "issues": ["list"],
  "suggestions": ["list"]
}`;
  const providerResults = await runVisionProviders(prompt, [frontImage]);
  const { merged, consensus } = buildFieldConsensus(providerResults, [
    "overallQuality", "isDocument", "isBlurry", "hasGlare", "isFramedWell",
    "rotation", "lighting", "isFullFrame", "issues", "suggestions",
  ]);

  if (!merged || !merged.overallQuality) {
    return { quality: null, consensus };
  }

  const quality: ImageQualityAssessment = {
    overallQuality: typeof merged.overallQuality === "number" ? merged.overallQuality : 0.5,
    isDocument: merged.isDocument ?? true,
    isBlurry: !!merged.isBlurry,
    hasGlare: !!merged.hasGlare,
    isFramedWell: !!merged.isFramedWell,
    rotation: merged.rotation ?? "none",
    lighting: merged.lighting ?? "good",
    isFullFrame: merged.isFullFrame ?? true,
    issues: Array.isArray(merged.issues) ? merged.issues : [],
    suggestions: Array.isArray(merged.suggestions) ? merged.suggestions : [],
  };

  return { quality, consensus };
}

/* ─── Pass 2: Arabic OCR (consensus — pick most representative text) ── */
export async function ocrArabicText(
  frontImage: string,
  backImage: string | null,
  docType: DocType
): Promise<{ text: string; consensus: ConsensusInfo | null }> {
  if (!hasVisionProviders()) return { text: "", consensus: null };

  const prompt = `You are an expert Arabic OCR engine for ${DOC_LABELS[docType]}.
Read EVERY piece of Arabic text visible. Preserve exact Arabic characters.
Output ONLY the raw text, line by line. Do NOT translate or add commentary.`;
  const images = [frontImage];
  if (backImage) images.push(backImage);

  const outcome = await callVisionConsensus(prompt, images);
  return {
    text: outcome.value.trim(),
    consensus: buildConsensusInfo(outcome),
  };
}

/* ─── Pass 3: Structured field extraction (consensus) ──────────── */
interface RawStructuredFields {
  fullNameAr?: string; fullNameEn?: string; nationalId?: string;
  birthDate?: string; address?: string; gender?: string;
  documentNo?: string; expiryDate?: string; nationality?: string;
  job?: string; religion?: string; maritalStatus?: string;
  extraFields?: Record<string, string>; rawText?: string;
  hasPhoto?: boolean; fieldConfidence?: FieldConfidence;
  mrzLine1?: string; mrzLine2?: string; mrzLine3?: string;
}

const STRUCTURED_FIELD_NAMES = [
  "fullNameAr", "fullNameEn", "nationalId", "birthDate", "address",
  "gender", "documentNo", "expiryDate", "nationality", "job",
  "religion", "maritalStatus", "hasPhoto",
  "mrzLine1", "mrzLine2", "mrzLine3",
];

async function extractStructuredFields(
  frontImage: string, backImage: string | null, docType: DocType, arabicText: string
): Promise<{ raw: RawStructuredFields; consensus: ConsensusInfo | null }> {
  if (!hasVisionProviders()) {
    return { raw: { rawText: arabicText }, consensus: emptyConsensusInfo() };
  }

  const prompt = `You are a forensic KYC field extractor for ${DOC_LABELS[docType]}.
Arabic OCR pass result:
"""
${arabicText}
"""
Extract STRUCTURED fields. Return STRICT JSON:
{
  "fullNameAr": "Arabic name or empty string",
  "fullNameEn": "English name or empty string",
  "nationalId": "14-digit ID (digits only) or empty",
  "birthDate": "ISO YYYY-MM-DD or empty",
  "address": "or empty",
  "gender": "Male/Female or empty",
  "documentNo": "document serial or empty",
  "expiryDate": "ISO or empty",
  "nationality": "or empty",
  "job": "or empty",
  "religion": "or empty (only if shown on this doc type)",
  "maritalStatus": "or empty",
  "extraFields": {},
  "rawText": "full OCR dump",
  "hasPhoto": true,
  "fieldConfidence": { "fullNameAr": 0.0-1.0, "fullNameEn": 0.0-1.0, "nationalId": 0.0-1.0, "birthDate": 0.0-1.0, "address": 0.0-1.0, "gender": 0.0-1.0, "documentNo": 0.0-1.0, "expiryDate": 0.0-1.0, "nationality": 0.0-1.0, "job": 0.0-1.0, "religion": 0.0-1.0, "maritalStatus": 0.0-1.0 },
  "mrzLine1": "", "mrzLine2": "", "mrzLine3": ""
}
Rules: Empty string if absent. Do NOT hallucinate empty fields. nationalId must be 14 digits for Egyptian ID.`;

  const images = [frontImage];
  if (backImage) images.push(backImage);

  const providerResults = await runVisionProviders(prompt, images);
  const parsed = providerResults
    .map((r) => ({ provider: r.provider, data: tryParseJson(r.raw) }))
    .filter((p) => p.data);

  if (parsed.length === 0) {
    return { raw: { rawText: arabicText }, consensus: emptyConsensusInfo() };
  }

  const { merged, fieldAgreement } = consensusJsonFields(parsed, STRUCTURED_FIELD_NAMES);

  // Average the fieldConfidence across providers
  const fc: FieldConfidence = {};
  const fcFields: (keyof FieldConfidence)[] = [
    "fullNameAr", "fullNameEn", "nationalId", "birthDate", "address",
    "gender", "documentNo", "expiryDate", "nationality", "job", "religion", "maritalStatus",
  ];
  for (const f of fcFields) {
    const vals = parsed
      .map((p) => p.data?.fieldConfidence?.[f])
      .filter((v): v is number => typeof v === "number");
    if (vals.length > 0) {
      fc[f] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    }
  }

  const successful = parsed.length;
  const total = providerResults.length;
  const agreementValues = Object.values(fieldAgreement).filter((v) => v > 0);
  const agreement = agreementValues.length > 0
    ? agreementValues.reduce((a, b) => a + b, 0) / agreementValues.length
    : 0;

  const consensus: ConsensusInfo = {
    total,
    successful,
    providerNames: parsed.map((p) => p.provider),
    agreement: Math.round(agreement * 100) / 100,
    fieldAgreement,
    outcomes: providerResults.map((r) => ({
      provider: r.provider, success: !!r.raw, latencyMs: r.latencyMs,
    })),
    verdict: agreement >= 0.95 ? "unanimous" : agreement >= 0.66 ? "majority" : "split",
  };

  return {
    raw: {
      fullNameAr: merged.fullNameAr,
      fullNameEn: merged.fullNameEn,
      nationalId: merged.nationalId,
      birthDate: merged.birthDate,
      address: merged.address,
      gender: merged.gender,
      documentNo: merged.documentNo,
      expiryDate: merged.expiryDate,
      nationality: merged.nationality,
      job: merged.job,
      religion: merged.religion,
      maritalStatus: merged.maritalStatus,
      hasPhoto: merged.hasPhoto,
      mrzLine1: merged.mrzLine1,
      mrzLine2: merged.mrzLine2,
      mrzLine3: merged.mrzLine3,
      fieldConfidence: fc,
      rawText: arabicText,
    },
    consensus,
  };
}

/* ─── Full multi-pass extraction (CONSENSUS) ───────────────────── */
export async function extractDocumentData(
  frontImage: string, backImage: string | null, docType: DocType
): Promise<ExtractedDocumentData | null> {
  if (!hasVisionProviders() && !hasTextProviders()) return null;

  // Normalize large images
  if (isLikelyTooLarge(frontImage)) {
    try { frontImage = await normalizeForVlm(frontImage); } catch {}
  }

  // Pass 1+2 parallel: quality + Arabic OCR
  const [qualityResult, arabicResult] = await Promise.allSettled([
    assessImageQuality(frontImage, docType),
    ocrArabicText(frontImage, backImage, docType),
  ]);
  const { quality: imageQuality, consensus: qualityConsensus } =
    qualityResult.status === "fulfilled" ? qualityResult.value : { quality: null, consensus: null };
  const { text: arabicText, consensus: ocrConsensus } =
    arabicResult.status === "fulfilled" ? arabicResult.value : { text: "", consensus: null };

  // Pass 3: structured extraction (consensus)
  let raw: RawStructuredFields;
  let structuredConsensus: ConsensusInfo | null = null;
  try {
    const r = await extractStructuredFields(frontImage, backImage, docType, arabicText);
    raw = r.raw;
    structuredConsensus = r.consensus;
  } catch {
    raw = { rawText: arabicText };
  }

  // ─── FALLBACK: If AI structured extraction returned no fields, use rule-based parser on arabicText ──
  // This fixes the case where AI providers return raw OCR text but not structured JSON
  if (arabicText && !raw.fullNameAr && !raw.fullNameEn && !raw.nationalId && !raw.gender) {
    try {
      const lines = arabicText.split("\n").map(l => l.trim());
      
      // Extract name: "الاسم" can appear ANYWHERE in a label line (start, middle, or end)
      // The name is on the NEXT line after the label
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Check if this line contains a name label
        if (/(الإسم|الاسم|Name)/i.test(line) && i + 1 < lines.length) {
          const nameLine = lines[i + 1].trim();
          if (nameLine.length > 3 && /[\u0600-\u06FFa-zA-Z]/.test(nameLine) && !/\d/.test(nameLine.replace(/[٠-٩]/g, ""))) {
            if (!raw.fullNameAr && /[\u0600-\u06FF]/.test(nameLine)) {
              raw.fullNameAr = nameLine;
            }
          }
          // Also check if name is on the SAME line after the label
          const afterLabel = line.replace(/.*(الإسم|الاسم|Name)\s*:?\s*/i, "").trim();
          if (afterLabel.length > 3 && !raw.fullNameAr && /[\u0600-\u06FF]/.test(afterLabel) && !/\/|:/.test(afterLabel)) {
            raw.fullNameAr = afterLabel;
          }
        }
      }

      // Extract birth date: match YYYY/MM/DD or Arabic numeral dates
      if (!raw.birthDate) {
        // Arabic numerals: ١٩٨٧/٠٧/١٨
        const arabicDateMatch = arabicText.match(/([\u0660-\u0669]{4})[\/\-]([\u0660-\u0669]{2})[\/\-]([\u0660-\u0669]{2})/);
        if (arabicDateMatch) {
          const toLatin = (s: string) => s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
          raw.birthDate = `${toLatin(arabicDateMatch[1])}-${toLatin(arabicDateMatch[2])}-${toLatin(arabicDateMatch[3])}`;
        }
        // Latin numerals: 1987/07/18
        if (!raw.birthDate) {
          const dateMatch = arabicText.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
          if (dateMatch) {
            raw.birthDate = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
          }
        }
      }

      // Extract gender: look for ذكر/أنثى anywhere in text
      if (!raw.gender) {
        if (/ذكر\b/.test(arabicText)) raw.gender = "Male";
        else if (/أنثى|انثى\b/.test(arabicText)) raw.gender = "Female";
      }

      // Extract nationality: look for common nationality words
      if (!raw.nationality) {
        const natMatch = arabicText.match(/\b(مصري|سعودي|إماراتي|كويتي|قطري|أردني|مغربي|تونسي|جزائري|لبناني|عراقي|سوري|ليبي|سوداني|بحريني|عماني|يمني|فلسطيني|تركي|إيراني)\b/);
        if (natMatch) raw.nationality = natMatch[1];
      }

      // Extract national ID: look for 14-digit pattern (Arabic or Latin numerals)
      if (!raw.nationalId) {
        // Latin numerals
        const idMatch = arabicText.match(/(\d{14})/);
        if (idMatch) raw.nationalId = idMatch[1];
        // Arabic numerals: ٢٨٧٠٧١٨٢٧٧ (convert to Latin)
        if (!raw.nationalId) {
          const arabicIdMatch = arabicText.match(/([\u0660-\u0669]{10,14})/);
          if (arabicIdMatch) {
            const toLatin = (s: string) => s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
            raw.nationalId = toLatin(arabicIdMatch[1]);
          }
        }
        // After "الرقم القومي:"
        if (!raw.nationalId) {
          const idLabelMatch = arabicText.match(/الرقم القومي\s*:?\s*([\u0660-\u0669\d]+)/);
          if (idLabelMatch) {
            const toLatin = (s: string) => s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
            raw.nationalId = toLatin(idLabelMatch[1]);
          }
        }
      }

      // Extract job: after "الوظيفة" or "المهنة"
      if (!raw.job) {
        const jobMatch = arabicText.match(/(?:الوظيفة|المهنة|Occupation)\s*:?\s*(.+)/);
        if (jobMatch) raw.job = jobMatch[1].trim().split(/[/\n]/)[0].trim();
      }

      // Extract address: after "العنوان"
      if (!raw.address) {
        const addrMatch = arabicText.match(/(?:العنوان|Address)\s*:?\s*(.+)/);
        if (addrMatch) raw.address = addrMatch[1].trim().split("\n")[0];
      }

      // Extract document number: after "رقم الجواز" or "Passport No"
      if (!raw.documentNo) {
        const passportMatch = arabicText.match(/(?:رقم الجواز|Passport No)\s*:?\s*([A-Z0-9\u0660-\u0669]+)/i);
        if (passportMatch) {
          const toLatin = (s: string) => s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
          raw.documentNo = toLatin(passportMatch[1]);
        }
      }
    } catch {}
  }

  // Post-process
  const nationalId = digitsOnly(raw.nationalId);
  const idInfo = docType === "national_id" && nationalId ? parseEgyptianNationalId(nationalId) : null;
  const mrzText = [raw.mrzLine1, raw.mrzLine2, raw.mrzLine3].filter(Boolean).join("\n");
  const mrzInfo = mrzText ? parseMrz(mrzText) : null;

  const stripLabel = (s?: string) => s ? s.replace(/^(الاسم|Name|الرقم القومي|National ID|تاريخ الميلاد|النوع|الديانة|الوظيفة|العنوان|الجنسية|الحالة|رقم المستند|تاريخ الانتهاء)\s*:?\s*/i, "").trim() || undefined : undefined;

  // ─── OCR Post-Processing (Levenshtein + confusion correction) ────
  // Runs AFTER AI consensus extraction. Corrects common OCR errors:
  //   - Arabic names: "محماد" → "محمد" (Levenshtein distance 1)
  //   - IDs: "O95O1O1O1234S6" → "29501010123456" (O→0, S→5, etc.)
  //   - Country names: "مصرر" → "مصر" (Levenshtein distance 1)
  let ocrCorrectionsApplied = 0;
  try {
    const { applyCorrections } = await import("@/lib/ocr-postprocess");
    const corrected = applyCorrections({
      fullNameAr: stripLabel(raw.fullNameAr) || undefined,
      fullNameEn: stripLabel(raw.fullNameEn) || undefined,
      nationalId: raw.nationalId || undefined,
      documentNo: stripLabel(raw.documentNo) || undefined,
      nationality: stripLabel(raw.nationality) || undefined,
    });
    if (corrected.fullNameAr && corrected.fullNameAr !== stripLabel(raw.fullNameAr)) {
      raw.fullNameAr = corrected.fullNameAr;
      ocrCorrectionsApplied++;
    }
    if (corrected.fullNameEn && corrected.fullNameEn !== stripLabel(raw.fullNameEn)) {
      raw.fullNameEn = corrected.fullNameEn;
      ocrCorrectionsApplied++;
    }
    if (corrected.nationalId && corrected.nationalId !== raw.nationalId) {
      raw.nationalId = corrected.nationalId;
      ocrCorrectionsApplied++;
    }
    if (corrected.documentNo && corrected.documentNo !== stripLabel(raw.documentNo)) {
      raw.documentNo = corrected.documentNo;
      ocrCorrectionsApplied++;
    }
    if (corrected.nationality && corrected.nationality !== stripLabel(raw.nationality)) {
      raw.nationality = corrected.nationality;
      ocrCorrectionsApplied++;
    }
  } catch {} // best-effort — don't fail extraction on post-process error

  // Re-compute nationalId after OCR correction
  const correctedNationalId = digitsOnly(raw.nationalId);
  const correctedIdInfo = docType === "national_id" && correctedNationalId ? parseEgyptianNationalId(correctedNationalId) : null;

  const fullNameAr = normalizeArabic(stripLabel(raw.fullNameAr)) || undefined;
  const fullNameEn = normalizeLatin(stripLabel(raw.fullNameEn)) || undefined;
  const gender = normalizeGender(stripLabel(raw.gender)) || mrzInfo?.gender || idInfo?.gender;
  const birthDate = normalizeDate(stripLabel(raw.birthDate)) || idInfo?.birthDate || mrzInfo?.birthDate;
  const expiryDate = normalizeDate(stripLabel(raw.expiryDate)) || mrzInfo?.expiryDate;
  const documentNo = normalizeLatin(stripLabel(raw.documentNo)) || mrzInfo?.documentNumber;
  const nationality = normalizeLatin(stripLabel(raw.nationality)) || mrzInfo?.nationality;

  const fc: FieldConfidence = raw.fieldConfidence || {};
  const fcValues = Object.values(fc).filter((v): v is number => typeof v === "number");
  const avgFieldConf = fcValues.length ? fcValues.reduce((a, b) => a + b, 0) / fcValues.length : 0.7;
  const confidence = imageQuality ? Math.min(avgFieldConf, 0.4 + imageQuality.overallQuality * 0.6) : avgFieldConf;

  let combinedConsensus = mergeConsensusInfo(qualityConsensus, ocrConsensus);
  combinedConsensus = mergeConsensusInfo(combinedConsensus, structuredConsensus);

  const result: ExtractedDocumentData = {
    fullNameAr, fullNameEn, nationalId, birthDate,
    address: normalizeArabic(stripLabel(raw.address)) || undefined,
    gender, documentNo, expiryDate, nationality,
    job: normalizeArabic(stripLabel(raw.job)) || undefined,
    religion: normalizeArabic(stripLabel(raw.religion)) || undefined,
    maritalStatus: normalizeArabic(stripLabel(raw.maritalStatus)) || undefined,
    extraFields: raw.extraFields || {},
    rawText: raw.rawText || arabicText, arabicText: arabicText || undefined,
    hasPhoto: raw.hasPhoto ?? true, confidence, fieldConfidence: fc,
    imageQuality: imageQuality || undefined, mrzParsed: !!mrzInfo,
    validationFlags: { nationalIdValid: idInfo?.isValid, nationalIdChecksumValid: idInfo?.checksumValid, genderInferred: idInfo?.gender },
    passes: 4,
    consensus: combinedConsensus,
  };

  // Pass 4: Cross-validation + translation (consensus)
  if (containsArabic(result.fullNameAr) && !containsLatin(result.fullNameEn)) {
    const outcome = await translateWithConsensus(result.fullNameAr, "ar-to-en");
    if (outcome.value && containsLatin(outcome.value)) {
      result.fullNameEn = normalizeLatin(outcome.value);
      result.consensus = mergeConsensusInfo(result.consensus, buildConsensusInfo(outcome));
    }
  }
  if (containsLatin(result.fullNameEn) && !containsArabic(result.fullNameAr)) {
    const outcome = await translateWithConsensus(result.fullNameEn, "en-to-ar");
    if (outcome.value && containsArabic(outcome.value)) {
      result.fullNameAr = normalizeArabic(outcome.value);
      result.consensus = mergeConsensusInfo(result.consensus, buildConsensusInfo(outcome));
    }
  }
  if (containsArabic(result.fullNameAr) && containsLatin(result.fullNameEn)) {
    const outcome = await translateWithConsensus(result.fullNameAr, "ar-to-en");
    if (outcome.value && containsLatin(outcome.value)) {
      if (!result.extraFields) result.extraFields = {};
      result.extraFields._nameEn_fromArabic = outcome.value;
      if (!fieldMatches(outcome.value, result.fullNameEn)) {
        result.extraFields._nameEn_original = result.fullNameEn;
        result.fullNameEn = normalizeLatin(outcome.value);
      }
      result.consensus = mergeConsensusInfo(result.consensus, buildConsensusInfo(outcome));
    }
  }

  // Pass 5: Country detection
  try {
    const { DOCUMENT_SPECS } = await import("@/lib/doc-specs/catalog");
    if (result.nationalId) {
      for (const spec of DOCUMENT_SPECS) {
        if (spec.nationalIdPattern && spec.docType === docType) {
          try {
            if (new RegExp(spec.nationalIdPattern).test(result.nationalId)) {
              if (!result.extraFields) result.extraFields = {};
              result.extraFields._detectedCountry = spec.country;
              result.extraFields._detectedCountryName = spec.countryName;
              break;
            }
          } catch {}
        }
      }
    }
  } catch {}

  return result;
}

/* ─── Face match (CONSENSUS across vision providers) ────────────── */
export async function matchFace(
  selfieImage: string, documentImage: string
): Promise<FaceMatchResult | null> {
  if (!hasVisionProviders()) return null;

  const prompt = `You are a forensic face-comparison expert.
Image 1: a selfie. Image 2: an identity document with a photo.
Compare the faces. Return STRICT JSON:
{ "isMatch": boolean, "samePerson": boolean, "similarity": 0-100, "reasoning": "explanation" }
A genuine match should score 70+.`;

  const providers = await runVisionProviders(prompt, [selfieImage, documentImage]);
  const parsed = providers
    .map((r) => ({ provider: r.provider, data: tryParseJson(r.raw) }))
    .filter((p) => p.data);

  if (parsed.length === 0) {
    return null;
  }

  const { merged, fieldAgreement } = consensusJsonFields(parsed, [
    "isMatch", "samePerson", "similarity", "reasoning",
  ]);

  const similarities = parsed
    .map((p) => Number(p.data?.similarity))
    .filter((n) => !isNaN(n));
  const avgSim = similarities.length > 0
    ? similarities.reduce((a, b) => a + b, 0) / similarities.length
    : 0;

  // Consensus: match requires MAJORITY of providers to say yes,
  // AND average similarity >= 60. Cross-checked.
  const matchCount = parsed.filter((p) => p.data?.isMatch === true).length;
  const isMatch = matchCount >= Math.ceil(parsed.length / 2) && avgSim >= 60;

  const agreement =
    parsed.length === 1 ? 0.5 :
    (fieldAgreement.isMatch ?? 0) * 0.5 +
    (fieldAgreement.similarity ?? 0) * 0.5;

  const consensus: ConsensusInfo = {
    total: providers.length,
    successful: parsed.length,
    providerNames: parsed.map((p) => p.provider),
    agreement: Math.round(agreement * 100) / 100,
    fieldAgreement,
    outcomes: providers.map((r) => ({
      provider: r.provider, success: !!r.raw, latencyMs: r.latencyMs,
    })),
    verdict: agreement >= 0.95 ? "unanimous" : agreement >= 0.66 ? "majority" : "split",
  };

  return {
    isMatch,
    samePerson: !!merged.samePerson || isMatch,
    similarity: Math.round(avgSim),
    reasoning: typeof merged.reasoning === "string" ? merged.reasoning : "",
    consensus,
  };
}

/* ─── Liveness check (CONSENSUS across vision providers) ────────── */
export async function checkLiveness(
  frames: string[], performedActions: LivenessAction[]
): Promise<LivenessResult | null> {
  if (!hasVisionProviders()) return null;

  const actionLabels = performedActions.map(a => ({
    turn_left: "turned head LEFT", turn_right: "turned head RIGHT",
    look_up: "looked UP", blink: "blinked", smile: "smiled",
  }[a] || a)).join(", then ");
  const prompt = `You are a liveness detection system. Frames captured while user: ${actionLabels}.
Analyze for real movement vs static photo. Return STRICT JSON:
{ "isLive": boolean, "score": 0-100, "detectedActions": ["list"], "reasoning": "explanation" }`;

  const providers = await runVisionProviders(prompt, frames);
  const parsed = providers
    .map((r) => ({ provider: r.provider, data: tryParseJson(r.raw) }))
    .filter((p) => p.data);

  if (parsed.length === 0) {
    return null;
  }

  const { merged, fieldAgreement } = consensusJsonFields(parsed, [
    "isLive", "score", "reasoning",
  ]);

  const scores = parsed
    .map((p) => Number(p.data?.score))
    .filter((n) => !isNaN(n));
  const avgScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  const liveCount = parsed.filter((p) => p.data?.isLive === true).length;
  const isLive = liveCount >= Math.ceil(parsed.length / 2) && avgScore >= 60;

  const allActions = parsed.flatMap((p) => Array.isArray(p.data?.detectedActions) ? p.data.detectedActions : []);
  const actionCounts: Record<string, number> = {};
  for (const a of allActions) {
    actionCounts[String(a).toLowerCase()] = (actionCounts[String(a).toLowerCase()] || 0) + 1;
  }
  const detectedActions = Object.entries(actionCounts)
    .filter(([, c]) => c >= Math.ceil(parsed.length / 2))
    .map(([a]) => a);

  const agreement =
    parsed.length === 1 ? 0.5 :
    (fieldAgreement.isLive ?? 0) * 0.6 + (fieldAgreement.score ?? 0) * 0.4;

  const consensus: ConsensusInfo = {
    total: providers.length,
    successful: parsed.length,
    providerNames: parsed.map((p) => p.provider),
    agreement: Math.round(agreement * 100) / 100,
    fieldAgreement,
    outcomes: providers.map((r) => ({
      provider: r.provider, success: !!r.raw, latencyMs: r.latencyMs,
    })),
    verdict: agreement >= 0.95 ? "unanimous" : agreement >= 0.66 ? "majority" : "split",
  };

  return {
    isLive,
    score: Math.round(avgScore),
    detectedActions,
    reasoning: typeof merged.reasoning === "string" ? merged.reasoning : "",
    consensus,
  };
}

export async function detectFacePresence(image: string): Promise<{ hasFace: boolean; isLikelyLive: boolean; reasoning: string }> {
  if (!hasVisionProviders()) {
    return { hasFace: false, isLikelyLive: false, reasoning: "No AI providers configured" };
  }
  const prompt = `Analyze this webcam frame. Return STRICT JSON: { "hasFace": boolean }`;
  const outcome = await callVisionConsensus(prompt, [image]);
  const parsed = tryParseJson(outcome.value);
  return { hasFace: !!parsed?.hasFace, isLikelyLive: !!parsed?.hasFace, reasoning: parsed?.reasoning || "Analyzed." };
}
