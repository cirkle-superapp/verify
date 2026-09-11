import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";

interface SeedSample {
  docType: DocType;
  name: string;
  fullNameAr: string;
  fullNameEn: string;
  nationalId: string;
  birthDate: string;
  gender: string;
  address: string;
  documentNo: string;
  expiryDate: string;
  nationality: string;
  job: string;
  religion: string;
  maritalStatus: string;
  governorate: string;
  imageData: string;       // rendered front (data URL)
  backImageData?: string;  // rendered back (data URL)
}

// POST /api/verify/samples/seed — bulk insert synthetic samples (pre-rendered client-side)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const incoming: SeedSample[] = Array.isArray(body.samples) ? body.samples : [];

    if (incoming.length === 0) {
      return NextResponse.json({ error: "samples array is required" }, { status: 400 });
    }

    // Avoid duplicates by name
    const existing = await db.documentSample.findMany({
      where: { source: "synthetic" },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((s) => s.name));

    const toCreate = incoming
      .filter((s) => s.imageData && !existingNames.has(s.name))
      .map((s) => ({
        name: s.name,
        docType: s.docType as DocType,
        source: "synthetic" as const,
        imageData: s.imageData,
        backImageData: s.backImageData || null,
        fullNameAr: s.fullNameAr || null,
        fullNameEn: s.fullNameEn || null,
        nationalId: s.nationalId || null,
        birthDate: s.birthDate || null,
        address: s.address || null,
        gender: s.gender || null,
        documentNo: s.documentNo || null,
        expiryDate: s.expiryDate || null,
        nationality: s.nationality || null,
        job: s.job || null,
        religion: s.religion || null,
        maritalStatus: s.maritalStatus || null,
        notes: "Synthetic mock document for evaluation. Not a real ID.",
        tags: JSON.stringify(["synthetic", "mock", s.docType]),
      }));

    if (toCreate.length === 0) {
      return NextResponse.json({ created: 0, message: "All samples already exist" });
    }

    const result = await db.documentSample.createMany({ data: toCreate });
    return NextResponse.json({ created: result.count });
  } catch (e: any) {
    console.error("[/api/verify/samples/seed POST]", e);
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}

// DELETE /api/verify/samples/seed — wipe all synthetic samples
export async function DELETE() {
  try {
    const result = await db.documentSample.deleteMany({ where: { source: "synthetic" } });
    return NextResponse.json({ deleted: result.count });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
