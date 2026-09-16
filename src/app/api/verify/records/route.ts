import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sanitizeForDb, validateDataUrl, validateNationalId } from "@/lib/security";
import { runFraudChecks, imageHash } from "@/lib/fraud-detection";
import type { DocType, ExtractedDocumentData, FaceMatchResult, LivenessAction, LivenessResult, VerificationStatus } from "@/lib/verification-types";
import { db as platformDb, type OutboxEventInput } from "@/lib/platform";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/verify/records — list all
export async function GET() {
  try {
    const records = await db.verification.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return NextResponse.json({ records });
  } catch (e: any) {
    console.error("[/api/verify/records GET] error", e);
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}

// POST /api/verify/records — create a verification record
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const docType: DocType = body.docType || "national_id";
    const docSide: string = String(body.docSide || "front").slice(0, 20);
    // Validate image data URLs (size + format)
    let docImageFront: string | null = body.docImageFront ?? null;
    let docImageBack: string | null = body.docImageBack ?? null;
    let selfieImage: string | null = body.selfieImage ?? null;
    for (const [k, v] of Object.entries({ docImageFront, docImageBack, selfieImage })) {
      if (v) {
        const check = validateDataUrl(v);
        if (!check.ok) {
          // Drop oversized/invalid images rather than failing
          console.warn(`[/api/verify/records] ${k} invalid: ${check.reason}`);
          if (k === "docImageFront") docImageFront = null;
          if (k === "docImageBack") docImageBack = null;
          if (k === "selfieImage") selfieImage = null;
        }
      }
    }

    const extracted: ExtractedDocumentData | undefined = body.docExtracted;
    const livenessFrames: string[] = body.livenessFrames ?? [];
    const livenessActions: LivenessAction[] = body.livenessActions ?? [];
    const faceMatch: FaceMatchResult | null = body.faceMatch ?? null;
    const liveness: LivenessResult | null = body.liveness ?? null;

    const docConfidence = extracted?.confidence ?? 0;
    const faceMatchScore = faceMatch?.similarity ?? 0;
    const livenessScore = liveness?.score ?? 0;
    const imageQuality = extracted?.imageQuality?.overallQuality ?? 0;
    const fieldConfidence = extracted?.fieldConfidence ? JSON.stringify(extracted.fieldConfidence) : null;

    // decide status
    let status: VerificationStatus = "pending";
    const notes: string[] = [];
    if (docConfidence < 0.6) notes.push("Low document extraction confidence");
    if (faceMatch && !faceMatch.isMatch) notes.push("Face does not match document");
    if (liveness && !liveness.isLive) notes.push("Liveness check failed");

    const allPassed =
      docConfidence >= 0.6 &&
      (!faceMatch || faceMatch.isMatch) &&
      (!liveness || liveness.isLive);
    status = allPassed ? "verified" : notes.length > 0 ? "failed" : "pending";

    const livenessFrameCount = livenessFrames.length;

    // ─── Fraud Detection ─────────────────────────────────────────────
    // Run anti-fraud checks (duplicate ID, velocity, blacklist, age, expiry)
    let fraudResult = null;
    try {
      // Get known IDs for duplicate check
      const existingRecords = await db.verification.findMany({ take: 500 });
      const knownIds = new Set(existingRecords.map((r: any) => r.nationalId).filter(Boolean));
      const knownHashes = new Set(
        existingRecords.map((r: any) => r.docImageFront).filter(Boolean).map((h: string) => imageHash(h))
      );

      fraudResult = runFraudChecks({
        ip: req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown",
        fullNameAr: extracted?.fullNameAr,
        fullNameEn: extracted?.fullNameEn,
        nationalId: extracted?.nationalId,
        birthDate: extracted?.birthDate,
        expiryDate: extracted?.expiryDate,
        imageHash: docImageFront ? imageHash(docImageFront) : undefined,
        knownIds,
        knownHashes,
      });

      // If blocked by fraud, override status
      if (fraudResult.risk === "blocked") {
        status = "rejected";
        notes.push(`FRAUD: ${fraudResult.summary}`);
      } else if (fraudResult.flags.length > 0) {
        notes.push(`FRAUD FLAGS: ${fraudResult.flags.map(f => f.code).join(", ")}`);
      }
    } catch (e) {
      // fraud check is best-effort — don't block the save
    }

    // ─── Cross-Field Validation ──────────────────────────────────────
    // Catches inconsistencies between extracted fields that fraud detection
    // and AI consensus might miss (e.g., nationalId encodes Male but
    // extracted gender = Female, nationalId checksum invalid, MRZ mismatch).
    let crossFieldResult = null;
    try {
      const { crossFieldValidate } = await import("@/lib/cross-field-validation");
      crossFieldResult = crossFieldValidate({
        fullNameAr: extracted?.fullNameAr,
        fullNameEn: extracted?.fullNameEn,
        nationalId: extracted?.nationalId,
        country: docType === "national_id" ? "EG" : undefined, // future: detect from spec catalog
        birthDate: extracted?.birthDate,
        gender: extracted?.gender,
        expiryDate: extracted?.expiryDate,
        nationality: extracted?.nationality,
        documentNo: extracted?.documentNo,
        docType,
      });
      if (crossFieldResult.hasCritical) {
        status = "rejected";
        notes.push(`CROSS-FIELD CRITICAL: ${crossFieldResult.flags.filter(f => f.severity === "critical").map(f => f.code).join(", ")}`);
      } else if (crossFieldResult.hasErrors) {
        notes.push(`CROSS-FIELD ERRORS: ${crossFieldResult.flags.filter(f => f.severity === "error").map(f => f.code).join(", ")}`);
      }
      // Adjust confidence based on consistency score
      if (crossFieldResult.consistencyScore < 0.5) {
        notes.push(`LOW CONSISTENCY: ${(crossFieldResult.consistencyScore * 100).toFixed(0)}% — fields disagree`);
      }
    } catch (e) {
      // cross-field is best-effort
    }

    const created = await db.verification.create({
      data: {
        docType,
        docSide,
        docImageFront,
        docImageBack,
        // Sanitize all text fields before storing (prevents log injection, truncates oversized)
        fullNameAr: sanitizeForDb(extracted?.fullNameAr),
        fullNameEn: sanitizeForDb(extracted?.fullNameEn),
        nationalId: sanitizeForDb(extracted?.nationalId),
        birthDate: sanitizeForDb(extracted?.birthDate),
        address: sanitizeForDb(extracted?.address),
        gender: sanitizeForDb(extracted?.gender),
        documentNo: sanitizeForDb(extracted?.documentNo),
        expiryDate: sanitizeForDb(extracted?.expiryDate),
        nationality: sanitizeForDb(extracted?.nationality),
        job: sanitizeForDb(extracted?.job),
        religion: sanitizeForDb(extracted?.religion),
        maritalStatus: sanitizeForDb(extracted?.maritalStatus),
        extraFields: extracted?.extraFields ? JSON.stringify(extracted.extraFields).slice(0, 2000) : null,
        imageQuality,
        fieldConfidence,
        selfieImage,
        livenessFrames: JSON.stringify({ count: livenessFrameCount, note: "frames analyzed live, not persisted" }),
        livenessActions: livenessActions.length ? JSON.stringify(livenessActions) : null,
        docConfidence,
        faceMatchScore,
        livenessScore,
        status,
        notes: notes.length ? sanitizeForDb(notes.join("; ")) : null,
      },
    });

    // ─── Transactional Outbox ────────────────────────────────────────
    // Per architecture mandate: NEVER dual-write to Neon directly.
    // Instead, append an outbox event AFTER the Turso commit. The outbox
    // is drained by Inngest relay → Neon (recovery projection, idempotent).
    // Email notification (P2 transactional) is also triggered via Inngest.
    //
    // NOTE: ideal atomicity requires the verification insert + outbox insert
    // in the SAME transaction. Prisma manages its own connection, so we do
    // best-effort here: append outbox immediately after commit. A crash
    // between the two leaves a verification with no outbox event —
    // detectable via reconciliation cron (future enhancement).
    const outboxEvent: OutboxEventInput = {
      aggregateType: "verification",
      aggregateId: created.id,
      eventType: status === "verified" ? "verification.completed" : status === "rejected" ? "verification.rejected" : "verification.saved",
      payload: {
        verificationId: created.id,
        docType,
        status,
        docConfidence,
        faceMatchScore,
        livenessScore,
        nationalId: extracted?.nationalId ? sanitizeForDb(extracted.nationalId) : null,
        fullNameAr: extracted?.fullNameAr ? sanitizeForDb(extracted.fullNameAr) : null,
        fullNameEn: extracted?.fullNameEn ? sanitizeForDb(extracted.fullNameEn) : null,
        fraudFlags: fraudResult?.flags?.map((f: any) => f.code) || [],
        _epoch: "auto", // adapter stamps current epoch
      },
      idempotencyKey: `verify:${created.id}`,
      correlationId: created.id,
    };

    try {
      await platformDb.transaction(async (tx) => {
        await tx.appendOutbox(outboxEvent);
      });
    } catch (outboxErr: any) {
      // Outbox failure does NOT roll back the business transaction (verification is saved).
      // The record exists; the event will be reconciled by a future cron.
      console.error("[/api/verify/records] outbox append failed (verification still saved):", outboxErr?.message?.slice(0, 120));
    }

    // ─── Trigger durable workflow (Inngest) ────────────────────────
    // Enqueue the verification event for async processing:
    //   - verification.completed → P2 transactional email (Brevo)
    //   - verification.rejected  → P1 security alert email
    //   - verification.saved     → no email (pending state)
    //
    // This is fire-and-forget: workflow failure NEVER rolls back the record.
    // The Inngest SDK dedupes by idempotencyKey, so multiple triggers are safe.
    let workflowEnqueued = false;
    try {
      const { workflow } = await import("@/lib/platform");
      const eventName = status === "verified" ? "verification.completed" : status === "rejected" ? "verification.rejected" : null;
      if (eventName) {
        await workflow.enqueue({
          name: eventName,
          data: { ...outboxEvent.payload, verificationId: created.id },
          idempotencyKey: `wf:${created.id}`,
          correlationId: created.id,
          causationId: outboxEvent.idempotencyKey,
        });
        workflowEnqueued = true;
      }
    } catch (wfErr: any) {
      // Workflow enqueue failure does NOT fail the request.
      // The outbox event still exists and will be drained by the scheduled relay.
      console.error("[/api/verify/records] workflow enqueue failed (outbox will retry):", wfErr?.message?.slice(0, 120));
    }

    return NextResponse.json({
      record: created,
      fraudCheck: fraudResult,
      crossField: crossFieldResult,
      outboxQueued: true,
      workflowEnqueued,
      // Neon receives this via outbox → Inngest relay, NOT direct dual-write
      neonMirrored: "deferred-to-outbox",
    });
  } catch (e: any) {
    console.error("[/api/verify/records POST] error", e);
    return NextResponse.json(
      { error: e?.message || "Failed to save verification record", code: "save_failed" },
      { status: 500 }
    );
  }
}
