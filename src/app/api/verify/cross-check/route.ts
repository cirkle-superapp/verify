import { NextRequest, NextResponse } from "next/server";
import { crossFieldValidate, type CrossFieldInput } from "@/lib/cross-field-validation";
import { getDocumentSecuritySpec, getSecuritySpecCountries } from "@/lib/document-security-features";

export const runtime = "nodejs";

/**
 * POST /api/verify/cross-check
 *
 * Cross-field validation: checks consistency between extracted document fields.
 * Catches fraud that AI consensus might miss:
 *   - nationalId encodes Male but extracted gender = Female → critical
 *   - nationalId birthDate ≠ extracted birthDate → error/warning
 *   - nationalId checksum invalid → critical
 *   - MRZ data ≠ extracted fields → error
 *   - Arabic name has Latin chars → warning
 *   - English name has Arabic chars → warning
 *   - Birth date in future → error
 *   - Document expired → error
 *   - Nationality ≠ country → warning
 *
 * Body: CrossFieldInput
 *   { fullNameAr, fullNameEn, nationalId, country, birthDate, gender,
 *     expiryDate, nationality, documentNo, mrzText, docType }
 *
 * Returns: { flags, consistencyScore, hasCritical, hasErrors, fraudProbability }
 *          + securitySpec (if country + docType match a known document)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CrossFieldInput;
    const result = crossFieldValidate(body);

    // Also return the document security spec if country + docType match
    let securitySpec = null;
    if (body.country && body.docType) {
      securitySpec = getDocumentSecuritySpec(body.country, body.docType) || null;
    }

    return NextResponse.json({
      ...result,
      securitySpec,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "cross-check failed" }, { status: 500 });
  }
}

/** GET — returns supported countries for security specs + examples. */
export async function GET() {
  return NextResponse.json({
    description: "Cross-field validation — POST extracted fields to check consistency",
    securitySpecCountries: getSecuritySpecCountries(),
    example: {
      fullNameAr: "محمد صلاح",
      fullNameEn: "Mohamed Salah",
      nationalId: "29501010123456",
      country: "EG",
      birthDate: "1995-01-01",
      gender: "Male",
      expiryDate: "2028-12-31",
      nationality: "Egyptian",
      docType: "national_id",
    },
  });
}
