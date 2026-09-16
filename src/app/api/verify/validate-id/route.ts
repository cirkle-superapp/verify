import { NextRequest, NextResponse } from "next/server";
import { validateNationalId, supportedCountries } from "@/lib/id-validators";

export const runtime = "nodejs";

/**
 * GET /api/verify/validate-id?country=EG&id=29501010123456
 * POST /api/verify/validate-id { country, id }
 *
 * Validates a national ID against the country-specific checksum algorithm.
 * Returns validity, checksum status, and extracted fields (birthDate, gender).
 *
 * This is the "knowledge" layer — 30+ country validators covering:
 *   Egypt, Saudi, UAE, Israel, Turkey, France, Spain, Portugal, Brazil,
 *   Germany, Italy, Netherlands, Belgium, Sweden, Norway, USA, UK, India,
 *   South Africa, Mexico, Pakistan.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const country = (url.searchParams.get("country") || "").toUpperCase();
  const id = url.searchParams.get("id") || "";
  if (!country || !id) {
    return NextResponse.json({
      supportedCountries: supportedCountries(),
      message: "Provide ?country=EG&id=<id> to validate",
    });
  }
  const result = validateNationalId(country, id);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const country = (body.country || "").toUpperCase();
  const id = body.id || "";
  if (!country || !id) {
    return NextResponse.json({ error: "country and id required" }, { status: 400 });
  }
  const result = validateNationalId(country, id);
  return NextResponse.json(result);
}
