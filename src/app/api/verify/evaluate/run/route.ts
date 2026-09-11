import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { extractDocumentData } from "@/lib/vlm-service";
import { fieldMatches, fuzzyEqual } from "@/lib/doc-validators";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";
export const maxDuration = 180;

interface FieldCheck {
  expected?: string | null;
  actual?: string | null;
  correct: boolean;
}

function check(expected: string | null | undefined, actual: string | null | undefined): FieldCheck {
  return { expected, actual, correct: fieldMatches(expected, actual) };
}

/**
 * POST /api/verify/evaluate/run
 * Body: { runId, sampleId }
 * Runs the full extraction pipeline on the sample, compares each field to ground truth,
 * persists an EvaluationResult, and updates the EvaluationRun aggregate.
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const body = await req.json();
    const { runId, sampleId } = body;
    if (!runId || !sampleId) {
      return NextResponse.json({ error: "runId and sampleId are required" }, { status: 400 });
    }

    const run = await db.evaluationRun.findUnique({ where: { id: runId } });
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    const sample = await db.documentSample.findUnique({ where: { id: sampleId } });
    if (!sample) return NextResponse.json({ error: "Sample not found" }, { status: 404 });

    let errorMessage: string | null = null;
    let actual: Awaited<ReturnType<typeof extractDocumentData>> | null = null;

    try {
      actual = await extractDocumentData(
        sample.imageData,
        sample.backImageData ?? null,
        sample.docType as DocType
      );
    } catch (e: any) {
      errorMessage = e?.message || "Extraction failed";
    }

    const responseTimeMs = Date.now() - startedAt;

    // Build per-field checks
    const checks = {
      nameAr: check(sample.fullNameAr, actual?.fullNameAr),
      nameEn: check(sample.fullNameEn, actual?.fullNameEn),
      nationalId: check(sample.nationalId, actual?.nationalId),
      documentNo: check(sample.documentNo, actual?.documentNo),
      birthDate: check(sample.birthDate, actual?.birthDate),
      gender: check(sample.gender, actual?.gender),
      expiry: check(sample.expiryDate, actual?.expiryDate),
    };

    const fieldsArr = Object.values(checks);
    const fieldsTotal = fieldsArr.filter((c) => c.expected).length;
    const fieldsCorrect = fieldsArr.filter((c) => c.expected && c.correct).length;
    const passed = fieldsTotal > 0 && fieldsCorrect === fieldsTotal && !errorMessage;

    // Persist the result
    const resultRow = await db.evaluationResult.create({
      data: {
        runId,
        sampleId: sample.id,
        sampleName: sample.name,
        docType: sample.docType,
        expectedNameAr: sample.fullNameAr || null,
        actualNameAr: actual?.fullNameAr || null,
        nameArCorrect: checks.nameAr.correct,
        expectedNameEn: sample.fullNameEn || null,
        actualNameEn: actual?.fullNameEn || null,
        nameEnCorrect: checks.nameEn.correct,
        expectedNationalId: sample.nationalId || null,
        actualNationalId: actual?.nationalId || null,
        nationalIdCorrect: checks.nationalId.correct,
        expectedDocumentNo: sample.documentNo || null,
        actualDocumentNo: actual?.documentNo || null,
        documentNoCorrect: checks.documentNo.correct,
        expectedBirthDate: sample.birthDate || null,
        actualBirthDate: actual?.birthDate || null,
        birthDateCorrect: checks.birthDate.correct,
        expectedGender: sample.gender || null,
        actualGender: actual?.gender || null,
        genderCorrect: checks.gender.correct,
        expectedExpiry: sample.expiryDate || null,
        actualExpiry: actual?.expiryDate || null,
        expiryCorrect: checks.expiry.correct,
        responseTimeMs,
        confidence: actual?.confidence ?? 0,
        imageQuality: actual?.imageQuality?.overallQuality ?? 0,
        fieldsTotal,
        fieldsCorrect,
        passed,
        error: errorMessage,
      },
    });

    // Update run aggregate
    const allResults = await db.evaluationResult.findMany({
      where: { runId },
      select: {
        responseTimeMs: true,
        imageQuality: true,
        passed: true,
        fieldsTotal: true,
        fieldsCorrect: true,
        nameArCorrect: true,
        nameEnCorrect: true,
        nationalIdCorrect: true,
        documentNoCorrect: true,
        birthDateCorrect: true,
        genderCorrect: true,
        expiryCorrect: true,
      },
    });
    const completed = allResults.length;
    const passedCount = allResults.filter((r) => r.passed).length;
    const avgTime = allResults.reduce((s, r) => s + r.responseTimeMs, 0) / (completed || 1);
    const avgQuality = allResults.reduce((s, r) => s + r.imageQuality, 0) / (completed || 1);

    // per-field accuracy
    const fieldStats: Record<string, { correct: number; total: number }> = {
      nameAr: { correct: 0, total: 0 },
      nameEn: { correct: 0, total: 0 },
      nationalId: { correct: 0, total: 0 },
      documentNo: { correct: 0, total: 0 },
      birthDate: { correct: 0, total: 0 },
      gender: { correct: 0, total: 0 },
      expiry: { correct: 0, total: 0 },
    };
    for (const r of allResults) {
      const expectedFields = [
        ["nameAr", r.nameArCorrect],
        ["nameEn", r.nameEnCorrect],
        ["nationalId", r.nationalIdCorrect],
        ["documentNo", r.documentNoCorrect],
        ["birthDate", r.birthDateCorrect],
        ["gender", r.genderCorrect],
        ["expiry", r.expiryCorrect],
      ] as [keyof typeof fieldStats, boolean][];
      for (const [k, ok] of expectedFields) {
        fieldStats[k].total += 1;
        if (ok) fieldStats[k].correct += 1;
      }
    }
    const overallAcc =
      allResults.reduce((s, r) => s + (r.fieldsTotal > 0 ? r.fieldsCorrect / r.fieldsTotal : 1), 0) /
      (completed || 1);

    const isDone = completed >= run.totalSamples;
    await db.evaluationRun.update({
      where: { id: runId },
      data: {
        completedSamples: completed,
        passedSamples: passedCount,
        avgDocTimeMs: avgTime,
        avgQualityScore: avgQuality,
        overallAccuracy: overallAcc,
        fieldAccuracy: JSON.stringify(fieldStats),
        status: isDone ? "completed" : "running",
        completedAt: isDone ? new Date() : null,
      },
    });

    return NextResponse.json({
      result: resultRow,
      run: {
        completedSamples: completed,
        passedSamples: passedCount,
        totalSamples: run.totalSamples,
        overallAccuracy: overallAcc,
        avgDocTimeMs: avgTime,
        status: isDone ? "completed" : "running",
      },
    });
  } catch (e: any) {
    console.error("[/api/verify/evaluate/run POST]", e);
    return NextResponse.json({ error: e?.message || "Evaluation error" }, { status: 500 });
  }
}
