import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { DocType } from "@/lib/verification-types";

export const runtime = "nodejs";

// GET /api/verify/samples — list all training samples
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const withImage = url.searchParams.get("withImage") !== "0";
    const samples = await db.documentSample.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    // strip heavy images unless requested
    const out = samples.map((s) =>
      withImage ? s : { ...s, imageData: undefined, backImageData: undefined }
    );
    return NextResponse.json({ samples: out });
  } catch (e: any) {
    console.error("[/api/verify/samples GET]", e);
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}

// POST /api/verify/samples — create a new training sample
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.imageData || !body.docType || !body.name) {
      return NextResponse.json({ error: "name, docType, imageData are required" }, { status: 400 });
    }
    const created = await db.documentSample.create({
      data: {
        name: String(body.name).slice(0, 200),
        docType: body.docType as DocType,
        source: body.source || "manual",
        imageData: body.imageData,
        backImageData: body.backImageData || null,
        fullNameAr: body.fullNameAr || null,
        fullNameEn: body.fullNameEn || null,
        nationalId: body.nationalId || null,
        birthDate: body.birthDate || null,
        address: body.address || null,
        gender: body.gender || null,
        documentNo: body.documentNo || null,
        expiryDate: body.expiryDate || null,
        nationality: body.nationality || null,
        job: body.job || null,
        religion: body.religion || null,
        maritalStatus: body.maritalStatus || null,
        notes: body.notes || null,
        tags: body.tags ? JSON.stringify(body.tags) : null,
      },
    });
    return NextResponse.json({ sample: created });
  } catch (e: any) {
    console.error("[/api/verify/samples POST]", e);
    return NextResponse.json({ error: e?.message || "DB error" }, { status: 500 });
  }
}
