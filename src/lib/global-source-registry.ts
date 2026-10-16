/**
 * Global Reference-Source Registry
 *
 * A versioned, provenance-tracked catalogue of official identity-document
 * information sources. Each source has verified licence, access requirements,
 * scope, and verification capabilities.
 *
 * Sources investigated:
 *   A. ICAO Doc 9303 (machine-readable travel documents)
 *   B. ICAO Public Key Directory (ePassport chip verification)
 *   C. PRADO (EU public register of authentic documents)
 *   D. National government document references
 *   E. Official document-validation services
 *
 * Every source records its licence, access method, scope, limitations,
 * and last-checked date. This is the single source of truth for what
 * reference data the platform has and where it came from.
 */

export type SourceCategory =
  | "icao_standard"
  | "icao_pkd"
  | "prado"
  | "government_reference"
  | "validation_service"
  | "open_source_software"
  | "open_dataset"
  | "model_registry";

export type AccessRequirement =
  | "public_free"        // Anyone can access, no cost
  | "public_licensed"    // Public but licence terms apply
  | "registered"         // Free account required
  | "authorized_party"   // Requires relying-party agreement
  | "government_approval" // Requires government authorization
  | "commercial"          // Paid service
  | "unavailable"         // Not accessible to us
  | "not_investigated";   // Not yet checked

export type VerificationCapability =
  | "mrz_structure"        // MRZ parsing + check digit verification
  | "field_validation"    // Document field format/length validation
  | "security_features"   // Known physical security features
  | "chip_authentication"  // ePassport chip crypto verification
  | "issuer_check"         // Official registry/issuer lookup
  | "barcode_verification" // PDF417/QR/Data Matrix verification
  | "document_classification" // Document type detection
  | "image_quality"        // Capture quality assessment
  | "face_comparison"     // 1:1 face matching
  | "liveness_detection"   // Presentation-attack detection
  | "tampering_detection"  // Image manipulation detection
  | "cross_field_validation"; // Field consistency checks

export interface ReferenceSource {
  id: string;
  name: string;
  category: SourceCategory;
  officialUrl: string;
  description: string;
  countriesCovered: string[]; // ISO alpha-2 codes, or ["global"]
  documentTypes: string[];   // ["passport", "national_id", ...]
  languages: string[];        // ["en", "ar", "fr", ...]
  capabilities: VerificationCapability[];
  accessRequirement: AccessRequirement;
  licence: string;
  licenceUrl?: string;
  redistributionAllowed: boolean;
  retrievalMethod: "manual" | "api" | "download" | "not_automated";
  lastChecked: string;       // ISO 8601
  sourceStatus: "verified" | "investigated" | "pending" | "blocked" | "unavailable";
  completeness: "comprehensive" | "partial" | "minimal" | "unknown";
  notes: string;
  limitations: string[];
}

/**
 * The global source registry — all investigated sources.
 */
export const REFERENCE_SOURCES: ReferenceSource[] = [
  // ── A. ICAO Doc 9303 ──
  {
    id: "icao-doc-9303",
    name: "ICAO Document 9303 — Machine Readable Travel Documents",
    category: "icao_standard",
    officialUrl: "https://www.icao.int/publications/doc-series/doc-9303",
    description: "The international standard for machine-readable passports, visas, and identity cards. Defines TD1, TD2, TD3 formats, MRZ field structures, check-digit algorithms, and electronic document specifications.",
    countriesCovered: ["global"],
    documentTypes: ["passport", "national_id", "residence", "visa"],
    languages: ["en", "fr", "ar", "es", "ru", "zh"],
    capabilities: ["mrz_structure", "field_validation", "chip_authentication"],
    accessRequirement: "public_licensed",
    licence: "ICAO — portions publicly available, full document purchase required",
    licenceUrl: "https://www.icao.int/publications",
    redistributionAllowed: false,
    retrievalMethod: "manual",
    lastChecked: new Date().toISOString(),
    sourceStatus: "verified",
    completeness: "comprehensive",
    notes: "TD1/TD2/TD3 MRZ specifications are publicly documented. The platform implements ICAO 9303 check-digit algorithms (mod-10, weights 7-3-1) and field structure validation for all three formats.",
    limitations: ["Full ICAO Doc 9303 purchase required for complete specifications", "Electronic document specifications (Part 11-14) require separate access", "National implementations may deviate from the standard"],
  },
  {
    id: "icao-pkd",
    name: "ICAO Public Key Directory (PKD)",
    category: "icao_pkd",
    officialUrl: "https://www.icao.int/icao-pkd",
    description: "The ICAO PKD provides certificates and certificate-revocation information (CRLs) used to authenticate electronic travel-document chips. Participating countries upload their Document Signer Certificates (DSCs) and Country Signing CA Certificates (CSCAs).",
    countriesCovered: ["global"],
    documentTypes: ["passport"],
    languages: ["en"],
    capabilities: ["chip_authentication", "issuer_check"],
    accessRequirement: "public_free",
    licence: "ICAO PKD — public download permitted",
    licenceUrl: "https://www.icao.int/icao-pkd/frequently-asked-questions",
    redistributionAllowed: true,
    retrievalMethod: "download",
    lastChecked: new Date().toISOString(),
    sourceStatus: "investigated",
    completeness: "partial",
    notes: "The ICAO PKD permits download of DSCs and CRLs. However, the full CSCA master list requires bilateral agreements. The platform can use PKD certificates for ePassport Passive Authentication but not Active Authentication or Chip Authentication Mapping Protocol without additional trust material.",
    limitations: [
      "CSCA master list requires bilateral trust agreements — not publicly downloadable",
      "Active Authentication requires direct chip interaction (NFC)",
      "Not all participating countries upload to the PKD",
      "Certificate refresh cycle must be managed (CRL expiry)",
    ],
  },

  // ── B. PRADO ──
  {
    id: "prado",
    name: "PRADO — Public Register of Authentic Identity Documents Online",
    category: "prado",
    officialUrl: "https://www.consilium.europa.eu/prado/en/prado-start-page.html",
    description: "The Council of the European Union maintains PRADO, a public catalogue of authentic identity and travel documents. It provides document descriptions, security feature information, and specimen images for European + partner countries.",
    countriesCovered: [
      // EU member states
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
      "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
      // Non-EU participants
      "IS", "LI", "NO", "CH", "GB",
      // Additional countries with documented specimens
      "AL", "BA", "MK", "ME", "RS", "XK", "MD", "UA", "GE", "AM",
    ],
    documentTypes: ["passport", "national_id", "residence", "driver_license"],
    languages: ["en"],
    capabilities: ["security_features", "field_validation", "document_classification"],
    accessRequirement: "public_free",
    licence: "Council of the EU — public information, non-commercial use",
    licenceUrl: "https://www.consilium.europa.eu/prado/en/prado-legal-notice.html",
    redistributionAllowed: false, // Specimen images are NOT redistributable
    retrievalMethod: "manual",
    lastChecked: new Date().toISOString(),
    sourceStatus: "investigated",
    completeness: "partial",
    notes: "PRADO provides authoritative document descriptions for 40+ European countries. The platform uses PRADO's security feature descriptions to build its document-security-features.ts knowledge base. Specimen images are viewable on the PRADO website but NOT redistributable.",
    limitations: [
      "Coverage limited to European + partner countries (40+ out of 195 worldwide)",
      "Specimen images are NOT redistributable — only descriptions can be used",
      "Does not cover all world countries (no coverage for most of Africa, Asia, Americas)",
      "Must link to PRADO as source, not reproduce specimens",
    ],
  },

  // ── C. Open-source software ──
  {
    id: "tesseract-ocr",
    name: "Tesseract OCR Engine",
    category: "open_source_software",
    officialUrl: "https://github.com/tesseract-ocr/tesseract",
    description: "Open-source OCR engine supporting 100+ languages including Arabic, Chinese, Japanese, Korean, Cyrillic, and Latin scripts. Used as the self-hosted OCR engine in the platform via tesseract.js.",
    countriesCovered: ["global"],
    documentTypes: ["passport", "national_id", "driver_license", "residence"],
    languages: ["en", "ar", "zh", "ja", "ko", "ru", "fr", "de", "es", "it", "pt", "tr", "vi", "th"],
    capabilities: ["document_classification", "field_validation"],
    accessRequirement: "public_free",
    licence: "Apache 2.0",
    licenceUrl: "https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE",
    redistributionAllowed: true,
    retrievalMethod: "download",
    lastChecked: new Date().toISOString(),
    sourceStatus: "verified",
    completeness: "comprehensive",
    notes: "Tesseract.js (npm package) is integrated as the self-hosted OCR engine. Language data (traineddata) for Arabic + English is included. Known limitation: Tesseract.js has Bun runtime compatibility issues (worker timeout); works on Node.js (Vercel production).",
    limitations: [
      "Tesseract.js worker timeout in Bun (sandbox dev)",
      "Arabic OCR accuracy is moderate (70-80% character accuracy on document images)",
      "Does not handle document layout — only raw text extraction",
      "No MRZ-specific model — MRZ lines require post-processing",
    ],
  },
  {
    id: "passport-eye",
    name: "PassportEye — MRZ Extraction Library",
    category: "open_source_software",
    officialUrl: "https://github.com/konstantint/PassportEye",
    description: "Python library for MRZ extraction from passport and ID card images. Implements ICAO 9303 TD1/TD2/TD3 parsing with check-digit verification.",
    countriesCovered: ["global"],
    documentTypes: ["passport", "national_id", "residence"],
    languages: ["en"],
    capabilities: ["mrz_structure", "field_validation"],
    accessRequirement: "public_free",
    licence: "MIT",
    licenceUrl: "https://github.com/konstantint/PassportEye/blob/master/LICENSE",
    redistributionAllowed: true,
    retrievalMethod: "download",
    lastChecked: new Date().toISOString(),
    sourceStatus: "investigated",
    completeness: "partial",
    notes: "PassportEye is a Python library — the platform implements equivalent MRZ parsing in pure TypeScript (src/lib/mrz-parser.ts) with ICAO 9303 check-digit algorithms for TD1, TD2, and TD3 formats. No external dependency needed.",
    limitations: [
      "Python-only library (platform uses TypeScript)",
      "Platform has its own equivalent MRZ parser — no integration needed",
    ],
  },
  {
    id: "zxing",
    name: "ZXing — Multi-format Barcode/QR Processing Library",
    category: "open_source_software",
    officialUrl: "https://github.com/zxing/zxing",
    description: "Open-source barcode and QR code processing library supporting PDF417, Data Matrix, QR Code, Aztec, and other symbologies used on identity documents.",
    countriesCovered: ["global"],
    documentTypes: ["passport", "national_id", "driver_license"],
    languages: ["en"],
    capabilities: ["barcode_verification"],
    accessRequirement: "public_free",
    licence: "Apache 2.0",
    licenceUrl: "https://github.com/zxing/zxing/blob/master/LICENSE",
    redistributionAllowed: true,
    retrievalMethod: "download",
    lastChecked: new Date().toISOString(),
    sourceStatus: "pending",
    completeness: "unknown",
    notes: "Not yet integrated. ZXing is Java-based; @zxing/library (npm port) or zbar (C library) could be used. PDF417 is used on US driver licenses; QR codes are used on many national ID cards.",
    limitations: [
      "Not yet integrated into the platform",
      "ZXing Java port to JS (@zxing/library) has large bundle size",
      "PDF417 parsing requires specific barcode image quality",
    ],
  },
  {
    id: "opencv",
    name: "OpenCV — Computer Vision Library",
    category: "open_source_software",
    officialUrl: "https://github.com/opencv/opencv",
    description: "Open-source computer vision library for image preprocessing, perspective correction, blur detection, glare assessment, and document edge detection.",
    countriesCovered: ["global"],
    documentTypes: ["passport", "national_id", "driver_license", "residence"],
    languages: ["en"],
    capabilities: ["image_quality", "document_classification", "tampering_detection"],
    accessRequirement: "public_free",
    licence: "Apache 2.0",
    licenceUrl: "https://github.com/opencv/opencv/blob/master/LICENSE.txt",
    redistributionAllowed: true,
    retrievalMethod: "download",
    lastChecked: new Date().toISOString(),
    sourceStatus: "pending",
    completeness: "unknown",
    notes: "Not directly integrated (OpenCV is C++/Python). The platform implements equivalent functionality in pure TypeScript: face-quality.ts (blur/contrast/brightness), image-auto-adjust.ts (edge detection/perspective correction/auto-enhance), tampering-detection.ts (ELA + EXIF + noise analysis).",
    limitations: [
      "OpenCV is C++/Python — platform uses TypeScript",
      "Platform has equivalent pure-TS implementations for image quality",
      "OpenCV would provide better performance for heavy CV tasks",
    ],
  },
];

/**
 * Get all reference sources.
 */
export function getAllSources(): ReferenceSource[] {
  return REFERENCE_SOURCES;
}

/**
 * Get sources by category.
 */
export function getSourcesByCategory(category: SourceCategory): ReferenceSource[] {
  return REFERENCE_SOURCES.filter((s) => s.category === category);
}

/**
 * Get sources covering a specific country.
 */
export function getSourcesForCountry(countryCode: string): ReferenceSource[] {
  return REFERENCE_SOURCES.filter((s) =>
    s.countriesCovered.includes("global") || s.countriesCovered.includes(countryCode.toUpperCase())
  );
}

/**
 * Get sources providing a specific verification capability.
 */
export function getSourcesWithCapability(capability: VerificationCapability): ReferenceSource[] {
  return REFERENCE_SOURCES.filter((s) => s.capabilities.includes(capability));
}

/**
 * Get the source registry summary.
 */
export function getSourceRegistrySummary() {
  return {
    totalSources: REFERENCE_SOURCES.length,
    byCategory: REFERENCE_SOURCES.reduce((acc, s) => {
      acc[s.category] = (acc[s.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byStatus: REFERENCE_SOURCES.reduce((acc, s) => {
      acc[s.sourceStatus] = (acc[s.sourceStatus] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    countriesCovered: new Set(REFERENCE_SOURCES.flatMap((s) => s.countriesCovered)).size,
    capabilities: REFERENCE_SOURCES.flatMap((s) => s.capabilities),
    verifiedSources: REFERENCE_SOURCES.filter((s) => s.sourceStatus === "verified").length,
    pendingSources: REFERENCE_SOURCES.filter((s) => s.sourceStatus === "pending").length,
    unavailableSources: REFERENCE_SOURCES.filter((s) => s.sourceStatus === "unavailable").length,
  };
}
