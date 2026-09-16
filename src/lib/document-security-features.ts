/**
 * Document Security Features Database.
 *
 * Knowledge of physical security features on identity documents worldwide.
 * This lets the verification flow check if the AI-extracted fields align with
 * known security patterns (e.g., Egyptian IDs have a specific UV watermark
 * position, US passports have a chip icon at a specific location).
 *
 * Used by:
 *   - Cross-field validation (if image quality assessment flags missing UV marks)
 *   - Fraud detection (documents missing expected security features are suspicious)
 *   - UI (shows users what security features to look for)
 */

export interface DocumentSecurityFeature {
  feature: string;            // "UV watermark" | "hologram" | "microprint" | "ghost photo" | "laser engraving" | "chip" | "kinegram" | "thermochromic ink"
  position: string;           // "top-right" | "bottom-left" | "center" | "photo overlay" | ...
  description: string;
}

export interface DocumentSecuritySpec {
  country: string;            // ISO alpha-2
  countryName: string;
  docType: "national_id" | "passport" | "driver_license" | "residence";
  material: string;           // "polycarbonate" | "paper" | "composite"
  dimensions?: string;        // "85.6 × 54 mm (ID-1)"
  issuedSince?: string;      // "2012"
  features: DocumentSecurityFeature[];
  mrzFormat?: "TD1" | "TD2" | "TD3";
  hasChip?: boolean;
  notes?: string;
}

// ─── Catalog ─────────────────────────────────────────────────────

export const DOCUMENT_SECURITY_SPECS: DocumentSecuritySpec[] = [
  {
    country: "EG", countryName: "Egypt", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2012",
    features: [
      { feature: "ghost photo", position: "right side", description: "Semi-transparent photo visible under UV light" },
      { feature: "UV watermark", position: "center", description: "Republic of Egypt coat of arms visible under UV" },
      { feature: "microprint", position: "border", description: "Tiny text reading 'ARAB REPUBLIC OF EGYPT'" },
      { feature: "guilloche pattern", position: "background", description: "Security rosette pattern" },
      { feature: "laser engraving", position: "personal data", description: "Black laser-engraved text" },
    ],
    notes: "Front: photo, name, national ID. Back: address, job, religion, marital status",
  },
  {
    country: "EG", countryName: "Egypt", docType: "passport",
    material: "polycarbonate + paper",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2020",
    features: [
      { feature: "chip", position: "center", description: "e-Passport with biometric chip" },
      { feature: "hologram", position: "photo overlay", description: "Diffractive optically variable image" },
      { feature: "UV watermark", position: "page 1", description: "Pyramid + coat of arms under UV" },
      { feature: "microprint", position: "border", description: "Microscopic text in 0.2mm font" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
      { feature: "ghost photo", position: "bottom-right", description: "Secondary photo visible under UV" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "SA", countryName: "Saudi Arabia", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2017",
    features: [
      { feature: "hologram", position: "center", description: "3D holographic seal" },
      { feature: "UV watermark", position: "full card", description: "Saudi coat of arms under UV" },
      { feature: "ghost photo", position: "left side", description: "Secondary photo under UV" },
      { feature: "microprint", position: "border", description: "KSA security text" },
      { feature: "thermochromic ink", position: "photo", description: "Ink changes color with temperature" },
    ],
  },
  {
    country: "AE", countryName: "United Arab Emirates", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2017",
    features: [
      { feature: "chip", position: "center", description: "Smart card with Emirates ID chip" },
      { feature: "hologram", position: "photo overlay", description: "Diffractive seal" },
      { feature: "UV watermark", position: "full card", description: "UAE emblem under UV" },
      { feature: "ghost photo", position: "right side", description: "UV-visible secondary photo" },
      { feature: "laser engraving", position: "data", description: "Laser-engraved personal data" },
    ],
    hasChip: true,
  },
  {
    country: "US", countryName: "United States", docType: "passport",
    material: "paper + polycarbonate data page",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2007 (e-Passport)",
    features: [
      { feature: "chip", position: "back cover", description: "Contactless RFID biometric chip" },
      { feature: "hologram", position: "photo", description: "Eagle holographic seal over photo" },
      { feature: "UV watermark", position: "all pages", description: "USA pattern visible under UV on every page" },
      { feature: "microprint", position: "border", description: "Microscopic text in borders" },
      { feature: "intaglio printing", position: "data page", description: "Tactile raised printing" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil with USA seal" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "GB", countryName: "United Kingdom", docType: "passport",
    material: "paper + polycarbonate data page",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2010",
    features: [
      { feature: "chip", position: "data page", description: "Biometric chip embedded in page" },
      { feature: "hologram", position: "photo", description: "Royal coat of arms hologram" },
      { feature: "UV watermark", position: "all pages", description: "Page-specific UV patterns" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
      { feature: "intaglio printing", position: "borders", description: "Tactile borders" },
      { feature: "cross-page design", position: "pages", description: "Continuous design across spread" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "DE", countryName: "Germany", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2010 (neuer Personalausweis)",
    features: [
      { feature: "chip", position: "center", description: "eID chip with online identification function" },
      { feature: "hologram", position: "photo", description: "Bundesadler (federal eagle) hologram" },
      { feature: "UV watermark", position: "full card", description: "UV-reactive Brandenburg Gate" },
      { feature: "ghost photo", position: "left", description: "Secondary photo under UV" },
      { feature: "microprint", position: "border", description: "Microscopic text 'BUNDESREPUBLIK DEUTSCHLAND'" },
      { feature: "laser engraving", position: "data", description: "Black laser-engraved data" },
      { feature: "thermochromic ink", position: "photo", description: "Ink visible only at certain temperatures" },
    ],
    mrzFormat: "TD1",
    hasChip: true,
  },
  {
    country: "DE", countryName: "Germany", docType: "passport",
    material: "paper + polycarbonate",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2017",
    features: [
      { feature: "chip", position: "data page", description: "Biometric chip" },
      { feature: "hologram", position: "photo", description: "Bundesadler hologram" },
      { feature: "UV watermark", position: "pages", description: "UV patterns on all 32 pages" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
      { feature: "intaglio printing", position: "borders", description: "Tactile printing" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "FR", countryName: "France", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2021 (new format)",
    features: [
      { feature: "chip", position: "center", description: "Biometric chip" },
      { feature: "hologram", position: "photo", description: "Marianne (symbol of France) hologram" },
      { feature: "UV watermark", position: "full card", description: "Tricolor flag UV pattern" },
      { feature: "ghost photo", position: "left", description: "UV secondary photo" },
      { feature: "guilloche pattern", position: "background", description: "Security rosette" },
      { feature: "microprint", position: "border", description: "RÉPUBLIQUE FRANÇAISE in microtext" },
    ],
    mrzFormat: "TD1",
    hasChip: true,
  },
  {
    country: "TR", countryName: "Türkiye", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2017",
    features: [
      { feature: "chip", position: "center", description: "Smart card chip" },
      { feature: "hologram", position: "photo", description: "Crescent-star hologram" },
      { feature: "UV watermark", position: "full card", description: "T.R. emblem under UV" },
      { feature: "ghost photo", position: "right", description: "UV secondary photo" },
      { feature: "laser engraving", position: "data", description: "Laser-engraved data" },
    ],
    hasChip: true,
  },
  {
    country: "BR", countryName: "Brazil", docType: "national_id",
    material: "polycarbonate",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2022 (novo RG)",
    features: [
      { feature: "chip", position: "center", description: "Smart chip" },
      { feature: "hologram", position: "photo", description: "Brazilian flag hologram" },
      { feature: "UV watermark", position: "full card", description: "Republica emblem UV" },
      { feature: "ghost photo", position: "left", description: "UV secondary photo" },
      { feature: "microprint", position: "border", description: "REPÚBLICA FEDERATIVA DO BRASIL" },
    ],
    hasChip: true,
  },
  {
    country: "IN", countryName: "India", docType: "national_id",
    material: "paper + PVC",
    dimensions: "85.6 × 54 mm (ID-1)",
    issuedSince: "2016 (Aadhaar)",
    features: [
      { feature: "QR code", position: "front", description: "Secure QR code with demographic data" },
      { feature: "ghost photo", position: "back", description: "Ghost image of holder" },
      { feature: "UV pattern", position: "background", description: "Aadhaar logo under UV" },
      { feature: "guilloche", position: "background", description: "Security pattern" },
      { feature: "microprint", position: "border", description: "UIDAI microtext" },
    ],
    notes: "Aadhaar card — not strictly mandatory but widely used as national ID",
  },
  {
    country: "JP", countryName: "Japan", docType: "passport",
    material: "paper + polycarbonate",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2019 (G-series)",
    features: [
      { feature: "chip", position: "data page", description: "Biometric IC chip" },
      { feature: "hologram", position: "photo", description: "Cherry blossom hologram" },
      { feature: "UV watermark", position: "pages", description: "Mount Fuji UV patterns" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
      { feature: "intaglio printing", position: "borders", description: "Tactile printing" },
      { feature: "watermark", position: "pages", description: "Hold-to-light watermark" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "AU", countryName: "Australia", docType: "passport",
    material: "paper + polycarbonate",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2014 (P-series)",
    features: [
      { feature: "chip", position: "data page", description: "Biometric chip" },
      { feature: "hologram", position: "photo", description: "Kangaroo-emu crest hologram" },
      { feature: "UV watermark", position: "pages", description: "Wattle UV pattern" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
      { feature: "intaglio printing", position: "borders", description: "Tactile printing" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "CA", countryName: "Canada", docType: "passport",
    material: "paper + polycarbonate",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2013 (e-Passport)",
    features: [
      { feature: "chip", position: "back cover", description: "Biometric chip" },
      { feature: "hologram", position: "photo", description: "Maple leaf hologram" },
      { feature: "UV watermark", position: "pages", description: "Canadian scenes under UV" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
      { feature: "intaglio printing", position: "borders", description: "Tactile printing" },
      { feature: "watermark", position: "pages", description: "Hold-to-light watermark" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
  {
    country: "KR", countryName: "South Korea", docType: "passport",
    material: "paper + polycarbonate",
    dimensions: "125 × 88 mm (ID-3)",
    issuedSince: "2018",
    features: [
      { feature: "chip", position: "data page", description: "Biometric chip" },
      { feature: "hologram", position: "photo", description: "Taegeuk hologram" },
      { feature: "UV watermark", position: "pages", description: "Korean cultural symbols UV" },
      { feature: "kinegram", position: "data page", description: "Color-shifting foil" },
    ],
    mrzFormat: "TD3",
    hasChip: true,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────

/** Get the security spec for a country + doc type. */
export function getDocumentSecuritySpec(country: string, docType: string): DocumentSecuritySpec | undefined {
  return DOCUMENT_SECURITY_SPECS.find(
    (s) => s.country === country.toUpperCase() && s.docType === docType,
  );
}

/** List all countries with security specs. */
export function getSecuritySpecCountries(): { code: string; name: string }[] {
  const seen = new Set<string>();
  const out: { code: string; name: string }[] = [];
  for (const s of DOCUMENT_SECURITY_SPECS) {
    if (!seen.has(s.country)) {
      seen.add(s.country);
      out.push({ code: s.country, name: s.countryName });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Count of features per spec (for UI). */
export function getFeatureCount(country: string, docType: string): number {
  const spec = getDocumentSecuritySpec(country, docType);
  return spec?.features.length || 0;
}
