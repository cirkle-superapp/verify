import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/verify/records/export?format=csv|json
// Downloads all verification records as CSV or JSON
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get("format") || "csv";

    const records = await db.verification.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
    });

    // Strip heavy image data for export
    const clean = records.map((r: any) => ({
      id: r.id,
      docType: r.docType,
      status: r.status,
      fullNameAr: r.fullNameAr || "",
      fullNameEn: r.fullNameEn || "",
      nationalId: r.nationalId || "",
      birthDate: r.birthDate || "",
      gender: r.gender || "",
      documentNo: r.documentNo || "",
      expiryDate: r.expiryDate || "",
      nationality: r.nationality || "",
      address: r.address || "",
      job: r.job || "",
      religion: r.religion || "",
      maritalStatus: r.maritalStatus || "",
      docConfidence: r.docConfidence,
      faceMatchScore: r.faceMatchScore,
      livenessScore: r.livenessScore,
      imageQuality: r.imageQuality,
      notes: r.notes || "",
      createdAt: r.createdAt,
    }));

    if (format === "json") {
      return new NextResponse(JSON.stringify(clean, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="cirkle-records-${Date.now()}.json"`,
        },
      });
    }

    // CSV format
    const headers = [
      "id", "docType", "status", "fullNameAr", "fullNameEn", "nationalId",
      "birthDate", "gender", "documentNo", "expiryDate", "nationality",
      "address", "job", "religion", "maritalStatus",
      "docConfidence", "faceMatchScore", "livenessScore", "imageQuality",
      "notes", "createdAt",
    ];

    const escapeCsv = (v: any) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const csvLines = [
      headers.join(","),
      ...clean.map((r: any) => headers.map((h) => escapeCsv(r[h])).join(",")),
    ];

    return new NextResponse(csvLines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="cirkle-records-${Date.now()}.csv"`,
      },
    });
  } catch (e: any) {
    console.error("[/api/verify/records/export] error", e);
    return NextResponse.json({ error: e?.message || "Export failed" }, { status: 500 });
  }
}
