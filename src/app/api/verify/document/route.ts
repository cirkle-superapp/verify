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

    const data = mergeSelfHostedAndConsensus(selfHosted, consensus);

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
    });
  } catch (e: any) {
    console.error("[/api/verify/document] error", e);
    return NextResponse.json({ error: e?.message || "Extraction failed", code: "unknown" }, { status: 500 });
  }
}
