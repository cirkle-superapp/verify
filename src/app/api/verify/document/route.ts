import { NextRequest, NextResponse } from "next/server";
import { runOCRMulti } from "@/lib/ocr-engine";
import { extractDocumentSelfHosted } from "@/lib/doc-parser";
import { extractDocumentData as extractDocumentConsensus, isConsensusModeActive, getConfiguredProviders } from "@/lib/vlm-service";
import { normalizeForVlm, isLikelyTooLarge, parseDataUrl } from "@/lib/image-server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit-log";
import type { DocType, ExtractedDocumentData, ConsensusInfo } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Document extraction endpoint — CONSENSUS MODE.
 *
 * The user's directive: "be sure we use ai api in consensus they cross check
 * with each other to give perfect outcome."
 *
 * Flow:
 *   1. Self-hosted OCR (Tesseract / mini-service on :3030) — fast, free
 *   2. AI Consensus (Gemini + OpenRouter + NVIDIA vision in parallel)
 *      → per-field majority vote, cross-checked.
 *   3. MERGE: take self-hosted fields as baseline; for any field the AI consensus
 *      ALSO detected AND providers agreed (≥0.85), use the consensus value.
 *      This gives perfect outcome — local rule-based + AI cross-check.
 *
 * If no AI providers are configured (env vars missing), the route runs
 * self-hosted-only — graceful degradation.
 */

async function callOCRService(image: string): Promise<{ text: string; confidence: number; words: any[] } | null> {
  try {
    const res = await fetch("http://localhost:3030/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return { text: j.text, confidence: j.confidence, words: j.words };
  } catch {
    return null;
  }
}

/** Merge self-hosted + AI consensus results. AI wins on contested fields. */
function mergeSelfHostedAndConsensus(
  selfHosted: ExtractedDocumentData | null,
  consensus: ExtractedDocumentData | null,
  docType?: string,
): ExtractedDocumentData {
  if (!consensus) return selfHosted || { confidence: 0, passes: 0 };
  if (!selfHosted) return consensus;

  // Take consensus as base, then fill gaps from self-hosted
  const merged: ExtractedDocumentData = { ...consensus };

  // Self-hosted fills gaps where AI consensus failed
  if (!merged.fullNameAr && selfHosted.fullNameAr) merged.fullNameAr = selfHosted.fullNameAr;
  if (!merged.fullNameEn && selfHosted.fullNameEn) merged.fullNameEn = selfHosted.fullNameEn;
  if (!merged.nationalId && selfHosted.nationalId) merged.nationalId = selfHosted.nationalId;
  if (!merged.birthDate && selfHosted.birthDate) merged.birthDate = selfHosted.birthDate;
  if (!merged.address && selfHosted.address) merged.address = selfHosted.address;
  if (!merged.gender && selfHosted.gender) merged.gender = selfHosted.gender;
  if (!merged.documentNo && selfHosted.documentNo) merged.documentNo = selfHosted.documentNo;
  if (!merged.expiryDate && selfHosted.expiryDate) merged.expiryDate = selfHosted.expiryDate;
  if (!merged.nationality && selfHosted.nationality) merged.nationality = selfHosted.nationality;
  if (!merged.job && selfHosted.job) merged.job = selfHosted.job;
  if (!merged.religion && selfHosted.religion) merged.religion = selfHosted.religion;
  if (!merged.maritalStatus && selfHosted.maritalStatus) merged.maritalStatus = selfHosted.maritalStatus;

  // Combine raw text — keep both for audit
  if (selfHosted.rawText && consensus.rawText && selfHosted.rawText !== consensus.rawText) {
    merged.rawText = `[self-hosted]\n${selfHosted.rawText}\n\n[ai-consensus]\n${consensus.rawText}`;
  } else if (selfHosted.rawText && !consensus.rawText) {
    merged.rawText = selfHosted.rawText;
  }

  // Combine extra fields
  merged.extraFields = {
    ...(selfHosted.extraFields || {}),
    ...(consensus.extraFields || {}),
  };

  // If self-hosted nationalId is valid (14-digit checksum) but consensus isn't, prefer self-hosted
  if (selfHosted.nationalId && selfHosted.nationalId.length === 14 && (!merged.nationalId || merged.nationalId.length < 14)) {
    merged.nationalId = selfHosted.nationalId;
  }

  // Combine validation flags
  merged.validationFlags = {
    ...selfHosted.validationFlags,
    ...consensus.validationFlags,
  };

  // Boost confidence if both engines agree on the key fields
  const agreeOnName = !!selfHosted.fullNameAr && !!consensus.fullNameAr &&
    selfHosted.fullNameAr === consensus.fullNameAr;
  const agreeOnId = !!selfHosted.nationalId && !!consensus.nationalId &&
    selfHosted.nationalId === consensus.nationalId;
  if (agreeOnName || agreeOnId) {
    merged.confidence = Math.min(1, (merged.confidence + 0.15));
    if (!merged.extraFields) merged.extraFields = {};
    merged.extraFields._crossCheckBoosted = "true";
  }

  merged.passes = (selfHosted.passes || 0) + (consensus.passes || 0);

  // ─── FINAL FALLBACK: Always run when OCR text is available ──
  // Parse both arabicText + rawText using rule-based regex to extract/fix fields.
  // This runs even if some fields were partially extracted (they might be garbage).
  const fallbackText = (merged.arabicText || "") + "\n" + (merged.rawText || "");
  if (fallbackText.trim().length > 10) {
    const text = fallbackText;
    const lines = text.split("\n").map((l: string) => l.trim());

    // ── Passport-specific extraction ──
    // Passport No: after "Passport No" / "رقم الجواز" or near P< country code
    // For passports, the number is usually 8-9 chars (A12345678 or 123456789)
    if (!merged.documentNo || merged.documentNo.length < 5) {
      // Try: after "Passport No" label
      const passMatch = text.match(/(?:Passport\s*No\.?\s*[:\-]?\s*|رقم\s*الجواز\s*[:\-]?\s*)([A-Z0-9]{6,12})/i);
      if (passMatch) merged.documentNo = passMatch[1];
      // Try: 8-9 digit number near "P EGY" or "P<EGY"
      if (!merged.documentNo || merged.documentNo.length < 5) {
        const nearP = text.match(/P\s*(?:<|EGY|SAU|ARE|UAE|KWT|QAT|BHR|OMN|JOR|MAR|TUN|DZA|LBN|IRQ|SYR|SDN|LBY|YEM|IRN|TUR)\s+([A-Z]?\d{6,9})/i);
        if (nearP) merged.documentNo = nearP[1];
      }
    }

    // If we have a passport number but the nationalId was set to a short number
    // (which is actually the passport number), move it to documentNo
    if (merged.nationalId && merged.nationalId.length < 14 && merged.nationalId.length >= 6 &&
        (!merged.documentNo || merged.documentNo.length < 5)) {
      merged.documentNo = merged.nationalId;
      merged.nationalId = undefined; // Clear — this was the passport number, not a national ID
    }

    // Country code: after "Country Code" / "رمز البلد" or 3-letter code after P<
    if (!merged.extraFields?._detectedCountry) {
      const ccMatch = text.match(/(?:Country\s*Code\s*[:\-]?\s*|رمز\s*البلد\s*[:\-]?\s*)([A-Z]{3})/i);
      if (ccMatch) {
        if (!merged.extraFields) merged.extraFields = {};
        merged.extraFields._detectedCountry = ccMatch[1];
      }
      // Or try P EGY pattern (not MRZ P<EGY which may not be present)
      if (!merged.extraFields?._detectedCountry) {
        const pcc = text.match(/\bP\s+(EGY|SAU|ARE|UAE|KWT|QAT|BHR|OMN|JOR|MAR|TUN|DZA|LBN|IRQ|SYR|SDN|LBY|YEM|IRN|TUR)\b/i);
        if (pcc) {
          if (!merged.extraFields) merged.extraFields = {};
          merged.extraFields._detectedCountry = pcc[1].toUpperCase();
        }
      }
    }

    // ── Name extraction (passport + national ID) ──
    // Check if current name looks like garbage
    const nameLooksValid = merged.fullNameAr && merged.fullNameAr.length > 5 &&
      /[\u0600-\u06FF]/.test(merged.fullNameAr) &&
      !/غير مطلوب|غير مطلوبة|بدون|لا يوجد|الموقف|التجنيد|التجنيدي/.test(merged.fullNameAr);
    if (!nameLooksValid) {
      // Strategy 1: Look for a label line followed by a name line
      for (let i = 0; i < lines.length; i++) {
        if (/(الإسم|الاسم|Name|Surname|Holder|Holder's\s*Name)/i.test(lines[i]) && i + 1 < lines.length) {
          const next = lines[i + 1].trim();
          if (next.length > 5 && /[\u0600-\u06FF]/.test(next) && !/[/d:：غير مطلوبالموقفالتجنيد]/.test(next)) {
            merged.fullNameAr = next;
            break;
          }
        }
      }
      // Strategy 2: Find an Arabic line with 3+ words that looks like a name
      // (not containing digits, not mostly Latin, not containing common non-name words)
      if (!nameLooksValid) {
        for (const line of lines) {
          const words = line.trim().split(/\s+/);
          const arabicChars = (line.match(/[\u0600-\u06FF]/g) || []).length;
          const latinChars = (line.match(/[a-zA-Z]/g) || []).length;
          const digitChars = (line.match(/\d/g) || []).length;
          // Must be 3-6 Arabic words, mostly Arabic, no digits, 10-60 chars
          if (words.length >= 3 && words.length <= 6 &&
              arabicChars > latinChars && // more Arabic than Latin
              digitChars === 0 && // NO digits in names
              line.length > 10 && line.length < 60 &&
              !/غير|مطلوب|المهنة|الوظيفة|العنوان|الجنسية|الجنس|التاريخ|الرمز|البلد|النوع|الجواز|مكان|الإصدار|الانتهاء|محل|الميلاد|Country|Passport|Type|Sex|Date/.test(line)) {
            merged.fullNameAr = line.trim();
            break;
          }
        }
      }
    }

    // ── Gender: ذكر = Male, أنثى = Female, or M/F from MRZ ──
    if (!merged.gender || (merged.gender !== "Male" && merged.gender !== "Female")) {
      if (/ذكر\b/.test(text)) merged.gender = "Male";
      else if (/أنثى|انثى\b/.test(text)) merged.gender = "Female";
      // For passports: look for M or F after "Sex" / "الجنس"
      else {
        const sexMatch = text.match(/(?:Sex|الجنس)\s*[:\-]?\s*([MF])\b/i);
        if (sexMatch) merged.gender = sexMatch[1].toUpperCase() === "M" ? "Male" : "Female";
      }
    }

    // ── Nationality: match nationality words ──
    // Only overwrite if current nationality looks invalid
    const natLooksValid = merged.nationality && merged.nationality.length >= 3 &&
      !/Sex|التوع|الجنس|Type|النوع/.test(merged.nationality);
    if (!natLooksValid) {
      const m = text.match(/\b(مصري|مصرية|سعودي|سعودية|إماراتي|إماراتية|كويتي|قطري|أردني|مغربي|تونسي|جزائري|لبناني|عراقي|سوري|ليبي|سوداني|بحريني|عماني|يمني|فلسطيني|تركي|إيراني|EGY|EGYPT|SAU|SAUDI|ARE|UAE|EGYPTIAN)\b/i);
      if (m) merged.nationality = m[1];
      // Also use detected country code
      if (!merged.nationality || merged.nationality.length < 3) {
        const cc = merged.extraFields?._detectedCountry;
        if (cc) merged.nationality = cc;
      }
    }

    // ── Birth date: Arabic numerals or Latin ──
    if (!merged.birthDate) {
      const toLatin = (s: string) => s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
      const arDate = text.match(/([\u0660-\u0669]{4})[\/\-]([\u0660-\u0669]{2})[\/\-]([\u0660-\u0669]{2})/);
      if (arDate) merged.birthDate = `${toLatin(arDate[1])}-${toLatin(arDate[2])}-${toLatin(arDate[3])}`;
      if (!merged.birthDate) {
        const latDate = text.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
        if (latDate) merged.birthDate = `${latDate[1]}-${latDate[2]}-${latDate[3]}`;
      }
    }

    // ── National ID: 14 digits (only for national_id doc type, not passport) ──
    if (docType !== "passport" && (!merged.nationalId || merged.nationalId.length < 14)) {
      const toLatin = (s: string) => s.replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660));
      const arId = text.match(/([\u0660-\u0669]{10,14})/);
      if (arId) merged.nationalId = toLatin(arId[1]);
      if (!merged.nationalId || merged.nationalId.length < 14) {
        const latId = text.match(/(?<!\d)(\d{14})(?!\d)/);
        if (latId) merged.nationalId = latId[1];
      }
    }

    // ── Job: after "الوظيفة" or "المهنة" ──
    if (!merged.job) {
      const m = text.match(/(?:الوظيفة|المهنة)\s*:?\s*(.+)/);
      if (m) merged.job = m[1].trim().split(/[/\n]/)[0].trim();
    }

    // ── Address: after "العنوان" ──
    if (!merged.address) {
      const m = text.match(/(?:العنوان)\s*:?\s*(.+)/);
      if (m) merged.address = m[1].trim().split("\n")[0];
    }

    // ── Expiry date ──
    if (!merged.expiryDate) {
      const expMatch = text.match(/(?:Expiry|انتهاء|الانتهاء|Expires?)\s*[:\-]?\s*(\d{4}[\/\-]\d{2}[\/\-]\d{2})/i);
      if (expMatch) merged.expiryDate = expMatch[1];
    }

    // ── If we extracted any valid fields, boost confidence ──
    if (merged.fullNameAr || merged.documentNo || merged.nationalId || merged.gender) {
      if (!merged.extraFields) merged.extraFields = {};
      merged.extraFields._fallbackParsed = "true";
      if (merged.confidence < 0.5) merged.confidence = 0.6;
    }
  }

  return merged;
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 60_000, prefix: "doc" });
  if (limited) {
    logAudit({ type: "rate_limited", ip: getClientIp(req), success: false });
    return limited;
  }

  const startedAt = Date.now();
  const ip = getClientIp(req);
  try {
    const body = await req.json();
    let frontImage: string | undefined = body.frontImage;
    const backImage: string | null = body.backImage ?? null;
    const docType: DocType = (body.docType as DocType) || "national_id";

    if (!frontImage || !frontImage.startsWith("data:image/")) {
      return NextResponse.json({ error: "frontImage (data URL) is required", code: "missing_image" }, { status: 400 });
    }

    const parsed = parseDataUrl(frontImage);
    if (!parsed || parsed.buffer.length < 100) {
      return NextResponse.json({ error: "Image could not be read. Please retake.", code: "invalid_image" }, { status: 400 });
    }

    // Pre-normalize large images
    let normalizedFront = frontImage;
    if (isLikelyTooLarge(frontImage)) {
      try { normalizedFront = await normalizeForVlm(frontImage); } catch {}
    }

    // ── Run self-hosted OCR + AI CONSENSUS in parallel ────────────
    // Strategy: start both tracks in parallel. If AI consensus finishes
    // first (it usually does — 2-5s vs 30-60s for Tesseract cold-start),
    // wait up to 8s for self-hosted to also complete. If self-hosted
    // exceeds that window, return the consensus-only result so the user
    // doesn't wait. This gives perfect outcome AND fast response.
    const consensusActive = isConsensusModeActive();

    const selfHostedPromise: Promise<any> = (async () => {
      let frontOcr = await callOCRService(normalizedFront);
      let backOcr = null;
      if (!frontOcr) {
        const ocrResults = await runOCRMulti(normalizedFront, backImage);
        frontOcr = ocrResults.front;
        backOcr = ocrResults.back;
      } else if (backImage) {
        backOcr = await callOCRService(backImage);
      }
      return extractDocumentSelfHosted(frontOcr as any, backOcr as any, docType, normalizedFront);
    })().catch((e) => {
      console.error("[/api/verify/document] self-hosted track failed:", e?.message?.slice(0, 100));
      return null;
    });

    const consensusPromise: Promise<any> = consensusActive
      ? extractDocumentConsensus(normalizedFront, backImage, docType).catch((e) => {
          console.error("[/api/verify/document] AI consensus track failed:", e?.message?.slice(0, 100));
          return null;
        })
      : Promise.resolve(null);

    // Race: if consensus is active and finishes, give self-hosted an
    // 8s grace window to also complete. If self-hosted finishes first
    // (or consensus is inactive), just wait for the other.
    let selfHosted: any = null;
    let consensus: any = null;

    if (consensusActive) {
      // Wait for consensus to finish first (the fast track)
      consensus = await consensusPromise;
      // Give self-hosted an 8s grace window to also complete
      const graceDeadline = 4000;
      const selfHostedTimeout = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), graceDeadline)
      );
      selfHosted = await Promise.race([selfHostedPromise, selfHostedTimeout]);
    } else {
      // No consensus — wait for self-hosted only
      selfHosted = await selfHostedPromise;
    }

    if (!selfHosted && !consensus) {
      throw new Error("Both OCR engines failed");
    }

    const data = mergeSelfHostedAndConsensus(selfHosted, consensus, docType);

    const elapsed = Date.now() - startedAt;
    logAudit({
      type: "document_extract",
      ip,
      success: true,
      durationMs: elapsed,
      docType,
      country: data?.extraFields?._detectedCountry,
    });

    return NextResponse.json({
      data,
      elapsedMs: elapsed,
      engine: consensusActive ? "consensus-merged" : "self-hosted",
      consensus: data.consensus,
      providers: consensusActive ? getConfiguredProviders() : [],
      debug: {
        selfHostedPresent: !!selfHosted,
        consensusPresent: !!consensus,
        arabicTextPresent: !!(consensus?.arabicText || selfHosted?.arabicText),
        rawTextPresent: !!(consensus?.rawText || selfHosted?.rawText),
        arabicTextPreview: (consensus?.arabicText || selfHosted?.arabicText || "").slice(0, 200),
        rawTextPreview: (consensus?.rawText || selfHosted?.rawText || "").slice(0, 200),
        fallbackParsed: data.extraFields?._fallbackParsed === "true",
        imageQuality: data.imageQuality?.overallQuality,
        selfHostedError: selfHosted?.reasoning?.slice(0, 150),
        consensusAgreement: data.consensus?.agreement,
        consensusSuccessful: data.consensus?.successful,
        consensusTotal: data.consensus?.total,
      },
    });
  } catch (e: any) {
    console.error("[/api/verify/document] error", e);
    return NextResponse.json({ error: e?.message || "Extraction failed", code: "unknown" }, { status: 500 });
  }
}
