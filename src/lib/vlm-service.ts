import ZAI from "z-ai-web-dev-sdk";
import type {
  ExtractedDocumentData,
  FaceMatchResult,
  LivenessResult,
  DocType,
  LivenessAction,
} from "@/lib/verification-types";

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

async function callVision(prompt: string, images: string[]): Promise<string> {
  const zai = await getZai();
  const response = await zai.chat.completions.createVision({
    messages: [
      {
        role: "user",
        content: buildContent(prompt, images),
      },
    ],
    thinking: { type: "disabled" },
  } as any);
  return response.choices[0]?.message?.content ?? "";
}

function tryParseJson(text: string): any | null {
  if (!text) return null;
  // Strip markdown code fences if present
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to find first { ... last }
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

/**
 * Extract structured data from an Egyptian/Arabic ID document image.
 * Supports national ID, passport, driver license, residence card.
 */
export async function extractDocumentData(
  frontImage: string,
  backImage: string | null,
  docType: DocType
): Promise<ExtractedDocumentData> {
  const typeLabel: Record<DocType, string> = {
    national_id: "Egyptian National ID card (بطاقة الرقم القومي)",
    passport: "Egyptian / Arab passport (جواز السفر)",
    driver_license: "Egyptian driver license (رخصة قيادة)",
    residence: "Residence card for foreigners (بطاقة إقامة)",
  };

  const prompt = `You are a professional OCR + KYC document reader specialized in Egyptian and Arabic identity documents.

Document type: ${typeLabel[docType]}

Carefully read BOTH Arabic and English text on this ${docType.replace("_", " ")}. Extract every visible field with high accuracy, preserving Arabic characters exactly as printed.

Return STRICT JSON only (no markdown, no commentary) with this exact schema:
{
  "fullNameAr": "الاسم بالعربية (full name in Arabic) or empty string",
  "fullNameEn": "Full name in English/Latin or empty string",
  "nationalId": "National ID number (الرقم القومي) if present, digits only, or empty string",
  "birthDate": "Date of birth as printed, e.g. 1990-01-15 or 15/01/1990",
  "address": "Address (العنوان) if present, otherwise empty string",
  "gender": "Male / Female / ذكر / أنثى as printed",
  "documentNo": "Document / passport / license number (the document's own serial number, NOT the national id)",
  "expiryDate": "Expiry date if present, otherwise empty string",
  "nationality": "Nationality (الجنسية) if present",
  "job": "Profession (الوظيفة) if present",
  "religion": "Religion (الديانة) field — ONLY if this document type normally shows it (Egyptian national ID has it). Otherwise empty string.",
  "maritalStatus": "Marital status (الحالة الاجتماعية) if present",
  "extraFields": { "field_name": "value" } for any other fields you can read,
  "rawText": "Full OCR dump of every readable line, preserving Arabic and English, separated by newlines",
  "hasPhoto": true if a person photo is visible on the document, else false,
  "confidence": 0.0 to 1.0 — your confidence that the extraction is accurate (image quality, clarity, completeness)
}

Rules:
- If a field is not present on this document type, return empty string, NOT null.
- Keep Arabic text in Arabic script (do not transliterate).
- The nationalId field is the 14-digit Egyptian national number when present.
- Be conservative with confidence — only give >0.85 for clear, well-lit, fully visible documents.`;

  const images = [frontImage];
  if (backImage) images.push(backImage);

  const raw = await callVision(prompt, images);
  const parsed = tryParseJson(raw);

  if (!parsed) {
    return {
      rawText: raw,
      confidence: 0,
    };
  }

  return {
    fullNameAr: parsed.fullNameAr || undefined,
    fullNameEn: parsed.fullNameEn || undefined,
    nationalId: parsed.nationalId || undefined,
    birthDate: parsed.birthDate || undefined,
    address: parsed.address || undefined,
    gender: parsed.gender || undefined,
    documentNo: parsed.documentNo || undefined,
    expiryDate: parsed.expiryDate || undefined,
    nationality: parsed.nationality || undefined,
    job: parsed.job || undefined,
    religion: parsed.religion || undefined,
    maritalStatus: parsed.maritalStatus || undefined,
    extraFields: parsed.extraFields || undefined,
    rawText: parsed.rawText || raw,
    hasPhoto: parsed.hasPhoto ?? true,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
  };
}

/**
 * Compare a live selfie with the photo on the document.
 */
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

/**
 * Analyze a sequence of webcam frames captured during a liveness challenge.
 * Verifies the user performed the requested head/face movements in real time.
 */
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

/**
 * Quick single-frame liveness / face presence check used as a pre-check.
 */
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
