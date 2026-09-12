import { NextRequest, NextResponse } from "next/server";
import {
  DOCUMENT_SPECS,
  getDocSpec,
  getCountrySpecs,
  getDocTypeSpecs,
  getSupportedCountries,
  getSpecsStats,
} from "@/lib/doc-specs/catalog";

export const runtime = "nodejs";

// GET /api/verify/specs — list all document specs or filter by country/docType
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const country = url.searchParams.get("country");
    const docType = url.searchParams.get("docType");
    const stats = url.searchParams.get("stats") === "1";

    if (stats) {
      return NextResponse.json(getSpecsStats());
    }

    if (country && docType) {
      const spec = getDocSpec(country, docType);
      if (!spec) return NextResponse.json({ error: "Spec not found" }, { status: 404 });
      return NextResponse.json({ spec });
    }

    if (country) {
      return NextResponse.json({ specs: getCountrySpecs(country), countries: getSupportedCountries() });
    }

    if (docType) {
      return NextResponse.json({ specs: getDocTypeSpecs(docType) });
    }

    // Return full catalog + stats + country list
    return NextResponse.json({
      specs: DOCUMENT_SPECS,
      stats: getSpecsStats(),
      countries: getSupportedCountries(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
