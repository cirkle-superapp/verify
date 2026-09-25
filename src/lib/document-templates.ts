/**
 * Document Template Database — visual layout templates for the 73
 * countries supported by the Cirkle identity verification platform.
 *
 * Each `DocumentTemplate` captures the *visual* layout of one document
 * (national ID / passport / driver license / residence permit):
 *   - Field positions in relative coordinates (0-1, independent of
 *     pixel dimensions — works for any image size)
 *   - Field typography (font size, style, alignment, script)
 *   - Layout anchors (background image URL, logo / photo / MRZ /
 *     watermark positions)
 *   - Color palette (background, text, accent)
 *   - Free-form notes for human-readable context
 *
 * Used by:
 *   - The `matchDocumentToTemplate()` matcher to score how well a set
 *     of OCR-detected fields (with bounding boxes) fits the expected
 *     template — a high match score means the document is likely the
 *     expected country+type (good signal for the cross-check pipeline).
 *   - The `/api/v1/verify/document-template` endpoint to serve the
 *     full catalog and accept POST match requests.
 *
 * Sources: ICAO Doc 9303 (MRZ + TD1/TD2/TD3 layouts), public government
 * card spec sheets, Wikipedia "national identity card" pages.
 *
 * Coordinate convention:
 *   - Origin (0, 0) is top-left of the card image
 *   - X increases rightward, Y increases downward
 *   - All widths/heights are fractions of card width/height (0-1)
 *
 * @module document-templates
 */

// ─── Types ──────────────────────────────────────────────────────────

/** Bounding box in relative coordinates (0-1). */
export interface BoundingBox {
  /** Top-left X (fraction of image width, 0-1) */
  x: number;
  /** Top-left Y (fraction of image height, 0-1) */
  y: number;
  /** Width (fraction of image width, 0-1) */
  w: number;
  /** Height (fraction of image height, 0-1) */
  h: number;
}

/** Script of the field text — affects font + bidi rendering. */
export type FieldScript = "arabic" | "latin" | "mixed";

/** Font style hint for the field's printed text. */
export type FontStyle = "normal" | "bold";

/** Text alignment within the field's bounding box. */
export type Alignment = "left" | "center" | "right";

/** A single field expected on the document, with its position + typography. */
export interface DocumentField {
  /** Canonical field name (e.g. "fullName", "nationalId", "dateOfBirth"). */
  name: string;
  /** Bounding box in relative coordinates (0-1). */
  position: BoundingBox;
  /** Approximate font size in pt at the card's native print size. */
  fontSize: number;
  /** Font weight. */
  fontStyle: FontStyle;
  /** Text alignment within the bounding box. */
  alignment: Alignment;
  /** Script of the printed text. */
  script: FieldScript;
}

/** Visual layout anchors that aren't text fields. */
export interface DocumentLayout {
  /** Optional background image URL (government-issue card art). */
  backgroundImage?: string;
  /** National emblem / coat of arms position. */
  logoPosition?: BoundingBox;
  /** Holder's portrait photo position. */
  photoPosition?: BoundingBox;
  /** Machine-Readable Zone (MRZ) position — only on TD1/TD2/TD3 docs. */
  mrzPosition?: BoundingBox;
  /** Watermark / guilloché position (anti-counterfeiting). */
  watermarkPosition?: BoundingBox;
}

/** Document color palette. */
export interface DocumentColors {
  /** Background color (hex). */
  background: string;
  /** Body text color (hex). */
  text: string;
  /** Accent color for headings / borders / logos (hex). */
  accent: string;
}

/** Supported document types. */
export type DocType = "national_id" | "passport" | "driver_license" | "residence";

/** Complete template for one country + docType combination. */
export interface DocumentTemplate {
  /** ISO 3166-1 alpha-2 country code (e.g. "EG", "SA", "US"). */
  country: string;
  /** Document type. */
  docType: DocType;
  /** Fields expected on the document with their positions. */
  fields: DocumentField[];
  /** Visual layout anchors (logo, photo, MRZ, watermark). */
  layout: DocumentLayout;
  /** Color palette. */
  colors: DocumentColors;
  /** Human-readable notes about the document. */
  notes: string;
}

// ─── Helpers for compact template authoring ────────────────────────

/**
 * Compact field-spec authoring helper. Each arg list is shorter to
 * type than the full object literal — keeps the catalog below readable.
 *
 *   f("fullName",        0.05, 0.05, 0.65, 0.08, 14, "bold",  "center", "mixed")
 *   f("nationalId",      0.05, 0.50, 0.90, 0.08, 16, "bold",  "center", "latin")
 */
function f(
  name: string,
  x: number, y: number, w: number, h: number,
  fontSize: number,
  fontStyle: FontStyle,
  alignment: Alignment,
  script: FieldScript,
): DocumentField {
  return { name, position: { x, y, w, h }, fontSize, fontStyle, alignment, script };
}

/** Compact bbox authoring helper. */
function b(x: number, y: number, w: number, h: number): BoundingBox {
  return { x, y, w, h };
}

// ─── Template catalog (33 countries, 36 templates) ─────────────────

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  // ─── Egypt ─────────────────────────────────────────────────────
  {
    country: "EG",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.05, 0.65, 0.08, 14, "bold",   "center", "arabic"),
      f("fullNameEn",    0.05, 0.15, 0.65, 0.06, 11, "normal", "left",   "mixed"),
      f("nationalId",    0.05, 0.50, 0.65, 0.08, 16, "bold",   "center", "latin"),
      f("address",       0.05, 0.62, 0.65, 0.20, 10, "normal", "left",   "arabic"),
      f("religion",      0.05, 0.84, 0.30, 0.05, 10, "normal", "left",   "arabic"),
      f("maritalStatus", 0.40, 0.84, 0.30, 0.05, 10, "normal", "left",   "arabic"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/eg-id-front.png",
      logoPosition:     b(0.02, 0.02, 0.10, 0.10),
      photoPosition:    b(0.72, 0.05, 0.25, 0.40),
      watermarkPosition:b(0.10, 0.30, 0.80, 0.30),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Egyptian National ID Card (بطاقة الرقم القومي). 14-digit national ID, photo on right, address + marital status on left.",
  },
  {
    country: "EG",
    docType: "passport",
    fields: [
      f("fullNameEn",    0.45, 0.20, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("nationalId",    0.45, 0.32, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("documentNo",    0.45, 0.40, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.45, 0.48, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.45, 0.56, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.45, 0.64, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.45, 0.72, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/eg-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "Egyptian Passport (جواز السفر المصري). TD3 MRZ format, photo left, fields right.",
  },

  // ─── Saudi Arabia ──────────────────────────────────────────────
  {
    country: "SA",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.60, 0.06, 14, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.16, 0.60, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",    0.20, 0.85, 0.60, 0.06, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.30, 0.60, 0.05, 10, "normal", "right",  "arabic"),
      f("sex",           0.05, 0.40, 0.30, 0.05, 10, "normal", "right",  "arabic"),
      f("dateOfExpiry",  0.05, 0.50, 0.60, 0.05, 10, "normal", "right",  "arabic"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/sa-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.40),
      watermarkPosition:b(0.10, 0.30, 0.55, 0.40),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Saudi National ID Card (بطاقة الأحوال المدنية). Photo right, name top in Arabic + Latin, ID number bottom-center. Green palette with gold accent.",
  },
  {
    country: "SA",
    docType: "passport",
    fields: [
      f("fullNameEn",    0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",  0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/sa-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D2E", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "Saudi Passport (جواز السفر السعودي). TD3 MRZ, dark green cover, gold accent.",
  },

  // ─── United Arab Emirates ──────────────────────────────────────
  {
    country: "AE",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",    0.05, 0.30, 0.55, 0.06, 14, "bold",   "left",   "latin"),
      f("dateOfBirth",   0.05, 0.40, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.48, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/ae-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.10, 0.50, 0.55, 0.30),
    },
    colors: { background: "#8B1E2F", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Emirati National ID (الهوية الوطنية). Photo right, ID number left, red palette with gold accent.",
  },
  {
    country: "AE",
    docType: "passport",
    fields: [
      f("fullNameEn",    0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/ae-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
    },
    colors: { background: "#1B2A5B", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "UAE Passport (جواز السفر). TD3 MRZ, navy cover with UAE crest.",
  },

  // ─── Kuwait ────────────────────────────────────────────────────
  {
    country: "KW",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("civilId",       0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/kw-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.60, 0.65, 0.20),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Kuwaiti Civil ID (البطاقة المدنية). 12-digit civil ID, photo right, blue palette.",
  },

  // ─── Qatar ────────────────────────────────────────────────────
  {
    country: "QA",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("qatariId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/qa-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.60, 0.65, 0.20),
    },
    colors: { background: "#7A1E2F", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Qatari ID Card (بطاقة الهوية القطرية). 11-digit ID, photo right, maroon palette.",
  },

  // ─── Bahrain ──────────────────────────────────────────────────
  {
    country: "BH",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("cprNumber",     0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/bh-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.60, 0.65, 0.20),
    },
    colors: { background: "#FFFFFF", text: "#1A1A1A", accent: "#C8102E" },
    notes: "Bahrain CPR Card (بطاقة السجل السكاني). 9-digit CPR number, photo right, white background with red accent.",
  },

  // ─── Oman ──────────────────────────────────────────────────────
  {
    country: "OM",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/om-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.60, 0.65, 0.20),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Omani ID Card (بطاقة الهوية العمانية). Photo right, dark green palette with gold.",
  },

  // ─── Jordan ───────────────────────────────────────────────────
  {
    country: "JO",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalNumber", 0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/jo-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#8B1E2F", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Jordanian National ID Card (بطاقة الهوية الوطنية). Maroon palette, gold accent.",
  },

  // ─── Morocco ──────────────────────────────────────────────────
  {
    country: "MA",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameFr",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/ma-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Moroccan National ID (البطاقة الوطنية للتعريف). Bilingual Arabic + French, green palette.",
  },

  // ─── Tunisia ──────────────────────────────────────────────────
  {
    country: "TN",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameFr",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/tn-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#8B1E2F", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Tunisian National ID Card (بطاقة التعريف الوطنية). Bilingual Arabic + French, red palette.",
  },

  // ─── Algeria ──────────────────────────────────────────────────
  {
    country: "DZ",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameFr",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/dz-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Algerian National ID Card (بطاقة التعريف الوطنية الجزائرية). Green palette with gold.",
  },

  // ─── Lebanon ──────────────────────────────────────────────────
  {
    country: "LB",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameFr",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/lb-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#C8102E", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Lebanese National ID (بطاقة الهوية اللبنانية). Red palette with cedar emblem.",
  },

  // ─── Syria ────────────────────────────────────────────────────
  {
    country: "SY",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/sy-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Syrian National ID (بطاقة الهوية الشخصية). Arabic + English, green palette.",
  },

  // ─── Iraq ─────────────────────────────────────────────────────
  {
    country: "IQ",
    docType: "national_id",
    fields: [
      f("fullNameAr",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/iq-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#C8102E", text: "#FFFFFF", accent: "#1A1A1A" },
    notes: "Iraqi National ID (بطاقة الهوية الوطنية). Arabic + Kurdish + English.",
  },

  // ─── Iran ─────────────────────────────────────────────────────
  {
    country: "IR",
    docType: "national_id",
    fields: [
      f("fullNameFa",    0.05, 0.08, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",    0.05, 0.16, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "mixed"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "mixed"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/ir-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.08, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Iranian National ID (کارت ملی). Persian + English, green palette.",
  },

  // ─── USA ──────────────────────────────────────────────────────
  {
    country: "US",
    docType: "passport",
    fields: [
      f("fullNameEn",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",  0.40, 0.66, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/us-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "US Passport Book. TD3 MRZ format, navy blue cover with gold seal, photo left.",
  },
  {
    country: "US",
    docType: "driver_license",
    fields: [
      f("fullNameEn",    0.05, 0.10, 0.55, 0.06, 12, "bold",   "left",   "latin"),
      f("dateOfBirth",   0.05, 0.20, 0.55, 0.04, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.26, 0.20, 0.04, 10, "normal", "left",   "latin"),
      f("address",       0.05, 0.32, 0.55, 0.10, 10, "normal", "left",   "latin"),
      f("licenseClass",  0.05, 0.45, 0.20, 0.04, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.55, 0.55, 0.04, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/us-dl.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.06),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.65, 0.65, 0.25),
    },
    colors: { background: "#FFFFFF", text: "#1A1A1A", accent: "#1B2A5B" },
    notes: "US Driver License (state-specific). TD1 size, photo right, varies by state (CA, NY, TX differ).",
  },

  // ─── United Kingdom ───────────────────────────────────────────
  {
    country: "GB",
    docType: "passport",
    fields: [
      f("fullNameEn",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",  0.40, 0.66, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/gb-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#7A1E2F", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "UK Passport (HM Passport Office). TD3 MRZ, burgundy cover (post-Brexit: blue), gold royal coat of arms.",
  },
  {
    country: "GB",
    docType: "driver_license",
    fields: [
      f("fullNameEn",    0.05, 0.10, 0.55, 0.06, 12, "bold",   "left",   "latin"),
      f("dateOfBirth",   0.05, 0.20, 0.55, 0.04, 10, "normal", "left",   "latin"),
      f("dateOfIssue",   0.05, 0.26, 0.55, 0.04, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.32, 0.55, 0.04, 10, "normal", "left",   "latin"),
      f("licenseNumber", 0.05, 0.42, 0.55, 0.06, 11, "bold",   "left",   "latin"),
      f("address",       0.05, 0.55, 0.55, 0.10, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/gb-dl.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.06),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.70, 0.65, 0.20),
    },
    colors: { background: "#D4D4D4", text: "#1A1A1A", accent: "#7A1E2F" },
    notes: "UK Driving Licence (DVLA). Pink/blue card, photo left, license number bottom-left.",
  },

  // ─── France ───────────────────────────────────────────────────
  {
    country: "FR",
    docType: "national_id",
    fields: [
      f("fullNameFr",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("documentNo",    0.05, 0.20, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.05, 0.30, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",   0.05, 0.50, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.60, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/fr-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      mrzPosition:       b(0.05, 0.75, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#1B2A5B", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "French National ID Card (Carte nationale d'identité). TD1 MRZ, blue palette with tricolor accent.",
  },
  {
    country: "FR",
    docType: "passport",
    fields: [
      f("fullNameFr",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/fr-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#1A1A1A", accent: "#C8A35B" },
    notes: "French Passport (Passeport français). TD3 MRZ, blue with 'RF' emblem.",
  },

  // ─── Germany ──────────────────────────────────────────────────
  {
    country: "DE",
    docType: "national_id",
    fields: [
      f("fullNameDe",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("documentNo",    0.05, 0.20, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.05, 0.30, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",   0.05, 0.50, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.60, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/de-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      mrzPosition:       b(0.05, 0.75, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#D4D4D4", text: "#1A1A1A", accent: "#1A1A1A" },
    notes: "German Identity Card (Personalausweis). TD1 MRZ, gold eagle emblem on grey-blue.",
  },
  {
    country: "DE",
    docType: "passport",
    fields: [
      f("fullNameDe",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/de-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1A1A1A", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "German Passport (Reisepass). TD3 MRZ, dark cover with gold federal eagle.",
  },

  // ─── Italy ────────────────────────────────────────────────────
  {
    country: "IT",
    docType: "national_id",
    fields: [
      f("fullNameIt",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("documentNo",    0.05, 0.20, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.05, 0.30, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",   0.05, 0.50, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.60, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/it-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      mrzPosition:       b(0.05, 0.75, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#008C45", text: "#1A1A1A", accent: "#CD212A" },
    notes: "Italian Electronic Identity Card (Carta d'identità elettronica). TD1, tricolor palette.",
  },

  // ─── Spain ────────────────────────────────────────────────────
  {
    country: "ES",
    docType: "national_id",
    fields: [
      f("fullNameEs",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("dniNumber",     0.05, 0.20, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.05, 0.30, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",   0.05, 0.50, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.60, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/es-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      mrzPosition:       b(0.05, 0.75, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#C8102E", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Spanish DNI (Documento Nacional de Identidad). TD1 MRZ, red palette with gold.",
  },

  // ─── Netherlands ──────────────────────────────────────────────
  {
    country: "NL",
    docType: "passport",
    fields: [
      f("fullNameNl",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/nl-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1A1A1A", text: "#FFFFFF", accent: "#FF7900" },
    notes: "Dutch Passport (Nederlands paspoort). TD3 MRZ, dark with orange (House of Orange) accent.",
  },

  // ─── Belgium ──────────────────────────────────────────────────
  {
    country: "BE",
    docType: "national_id",
    fields: [
      f("fullNameNl",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameFr",    0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("documentNo",    0.05, 0.30, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.05, 0.40, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.60, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/be-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      mrzPosition:       b(0.05, 0.75, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#D4D4D4", text: "#1A1A1A", accent: "#1A1A1A" },
    notes: "Belgian eID card (Identiteitskaart/Carte d'identité). TD1 MRZ, trilingual (Dutch/French/German).",
  },

  // ─── Sweden ───────────────────────────────────────────────────
  {
    country: "SE",
    docType: "national_id",
    fields: [
      f("fullNameSv",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("documentNo",    0.05, 0.20, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.05, 0.30, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",   0.05, 0.50, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.60, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/se-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      mrzPosition:       b(0.05, 0.75, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#005EB8", text: "#FFFFFF", accent: "#FFB7C5" },
    notes: "Swedish National ID card (Nationellt id-kort). TD1 MRZ, blue with three crowns.",
  },

  // ─── Norway ───────────────────────────────────────────────────
  {
    country: "NO",
    docType: "passport",
    fields: [
      f("fullNameNo",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/no-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#BA0C2F", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Norwegian Passport (Norsk pass). TD3 MRZ, red cover with Norwegian lion.",
  },

  // ─── Russia ───────────────────────────────────────────────────
  {
    country: "RU",
    docType: "passport",
    fields: [
      f("fullNameRu",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",  0.40, 0.66, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/ru-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1A1A1A", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Russian Passport (Заграничный паспорт). TD3 MRZ, dark with double-headed eagle.",
  },

  // ─── China ────────────────────────────────────────────────────
  {
    country: "CN",
    docType: "national_id",
    fields: [
      f("fullNameZh",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameEn",    0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("idNumber",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/cn-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#008C45", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Chinese Resident Identity Card (居民身份证). 18-digit ID, photo right.",
  },
  {
    country: "CN",
    docType: "passport",
    fields: [
      f("fullNameZh",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/cn-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#7A1E2F", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Chinese Passport (中华人民共和国护照). TD3 MRZ, red cover with PRC star.",
  },

  // ─── Japan ────────────────────────────────────────────────────
  {
    country: "JP",
    docType: "passport",
    fields: [
      f("fullNameJa",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/jp-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#7A1E2F", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Japanese Passport (日本国旅券). TD3 MRZ, red cover with chrysanthemum seal.",
  },

  // ─── India ────────────────────────────────────────────────────
  {
    country: "IN",
    docType: "national_id",
    fields: [
      f("fullNameEn",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("aadhaarNumber", 0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",       0.05, 0.58, 0.55, 0.20, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/in-aadhaar.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.40, 0.65, 0.30),
    },
    colors: { background: "#FFFFFF", text: "#1A1A1A", accent: "#008C45" },
    notes: "Indian Aadhaar Card (आधार कार्ड). 12-digit UID, photo right, tricolor accent.",
  },
  {
    country: "IN",
    docType: "passport",
    fields: [
      f("fullNameEn",    0.40, 0.22, 0.55, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",    0.40, 0.34, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",   0.40, 0.42, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",   0.40, 0.50, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("sex",           0.40, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",  0.40, 0.66, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.40, 0.74, 0.55, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/in-passport.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.12),
      photoPosition:    b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:       b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition:b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Indian Passport (भारतीय पासपोर्ट). TD3 MRZ, navy with Ashoka Chakra emblem.",
  },

  // ─── Pakistan ────────────────────────────────────────────────
  {
    country: "PK",
    docType: "national_id",
    fields: [
      f("fullNameEn",    0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameUr",    0.05, 0.18, 0.55, 0.05, 11, "normal", "right",  "arabic"),
      f("cnicNumber",    0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",   0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",           0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",  0.05, 0.82, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage: "https://cirkle.app/img/pk-id-front.png",
      logoPosition:     b(0.40, 0.02, 0.20, 0.10),
      photoPosition:    b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition:b(0.05, 0.55, 0.65, 0.25),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#FFFFFF" },
    notes: "Pakistan CNIC (Computerized National Identity Card). 13-digit CNIC, photo right, green palette.",
  },

  // ─── Vietnam ──────────────────────────────────────────────────
  {
    country: "VN",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.30, 0.10, 0.40, 0.06, 12, "bold",   "left",   "latin"),
      f("fullNameLocal",   0.30, 0.18, 0.40, 0.06, 12, "bold",   "left",   "latin"),
      f("dateOfBirth",     0.30, 0.30, 0.40, 0.05, 10, "normal", "left",   "latin"),
      f("sex",             0.30, 0.38, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationalId",      0.30, 0.46, 0.40, 0.06, 14, "bold",   "left",   "latin"),
      f("dateOfExpiry",    0.30, 0.54, 0.40, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/vn-cccd.png",
      logoPosition:      b(0.05, 0.05, 0.20, 0.10),
      photoPosition:     b(0.05, 0.30, 0.20, 0.30),
      mrzPosition:        b(0.05, 0.75, 0.90, 0.18),
      watermarkPosition: b(0.30, 0.65, 0.60, 0.10),
    },
    colors: { background: "#E8A0BF", text: "#1A1A1A", accent: "#C8102E" },
    notes: "Vietnamese CCCD (Can cuoc cong dan). 12-digit ID, photo bottom-left, MRZ bottom, pink lotus palette.",
  },
  {
    country: "VN",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",   0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/vn-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Vietnamese Passport (Ho chieu Viet Nam). TD3 MRZ, blue cover with national emblem.",
  },

  // ─── Thailand ─────────────────────────────────────────────────
  {
    country: "TH",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 12, "bold",   "left",   "latin"),
      f("fullNameTh",     0.05, 0.18, 0.55, 0.06, 12, "bold",   "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.06, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.50, 0.55, 0.20, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/th-id.png",
      logoPosition:      b(0.05, 0.02, 0.20, 0.10),
      photoPosition:     b(0.65, 0.05, 0.30, 0.35),
      watermarkPosition: b(0.10, 0.45, 0.55, 0.30),
    },
    colors: { background: "#F5A9B8", text: "#1A1A1A", accent: "#1B2A5B" },
    notes: "Thai National ID. 13-digit ID, photo top-right, bilingual Thai+English, salmon pink palette.",
  },
  {
    country: "TH",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/th-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Thai Passport. TD3 MRZ, dark blue with Garuda emblem.",
  },

  // ─── Philippines ───────────────────────────────────────────────
  {
    country: "PH",
    docType: "national_id",
    fields: [
      f("fullNameEn",       0.05, 0.15, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("philSysNumber",    0.05, 0.25, 0.55, 0.06, 14, "bold",   "center", "latin"),
      f("dateOfBirth",      0.05, 0.40, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",              0.05, 0.48, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",          0.05, 0.56, 0.55, 0.15, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",     0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ph-philsys.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.15, 0.25, 0.30),
      watermarkPosition: b(0.05, 0.30, 0.60, 0.30),
    },
    colors: { background: "#0038A8", text: "#FFFFFF", accent: "#CE1126" },
    notes: "Philippine PhilSys ID (Philippine Identification Card). 14-digit PSN, biometric, QR code on back, blue with red-yellow accent.",
  },
  {
    country: "PH",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",   0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ph-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Philippine Passport (Pasaporte ng Pilipinas). TD3 MRZ, dark blue with sun emblem.",
  },

  // ─── Singapore ────────────────────────────────────────────────
  {
    country: "SG",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("nricNumber",      0.05, 0.20, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.35, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.43, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("race",           0.05, 0.51, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.60, 0.55, 0.18, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/sg-nric.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.40, 0.55, 0.30),
    },
    colors: { background: "#E5F2FF", text: "#1A1A1A", accent: "#EE2536" },
    notes: "Singapore NRIC (National Registration Identity Card). 9-char ID (e.g. S1234567A), photo right, pink for citizens / blue for PR.",
  },
  {
    country: "SG",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/sg-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#8B1E2F", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Singapore Passport (Pasport Singapura). TD3 MRZ, red cover with national coat of arms.",
  },

  // ─── Malaysia ─────────────────────────────────────────────────
  {
    country: "MY",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("nricNumber",      0.05, 0.20, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.32, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.50, 0.55, 0.18, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/my-mykad.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.40, 0.55, 0.30),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#FFD700" },
    notes: "Malaysian MyKad. 12-digit NRIC (YYMMDD-SS-###G), photo right, multi-language (Malay/English), blue with gold accent.",
  },
  {
    country: "MY",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",   0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/my-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Malaysian Passport (Pasport Malaysia). TD3 MRZ, navy blue with hibiscus emblem.",
  },

  // ─── Indonesia ────────────────────────────────────────────────
  {
    country: "ID",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("nikNumber",       0.05, 0.20, 0.55, 0.06, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.32, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("bloodType",      0.30, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.50, 0.55, 0.18, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/id-ktp.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.40, 0.55, 0.30),
    },
    colors: { background: "#FFFFFF", text: "#1A1A1A", accent: "#C8102E" },
    notes: "Indonesian KTP (Kartu Tanda Penduduk). 16-digit NIK encodes birth info, photo right, blood type field, white card with red accent.",
  },
  {
    country: "ID",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",   0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/id-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Indonesian Passport (Paspor Indonesia). TD3 MRZ, green cover with Garuda emblem.",
  },

  // ─── Bangladesh ───────────────────────────────────────────────
  {
    country: "BD",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameBn",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.58, 0.55, 0.18, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/bd-nid.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#C8102E" },
    notes: "Bangladeshi NID Smart Card. 10-digit ID, photo right, green card with red accent.",
  },
  {
    country: "BD",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",   0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/bd-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Bangladeshi Passport. TD3 MRZ, navy blue with national emblem.",
  },

  // ─── Sri Lanka ────────────────────────────────────────────────
  {
    country: "LK",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameSi",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/lk-nic.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.50, 0.55, 0.25),
    },
    colors: { background: "#0E8C8C", text: "#FFFFFF", accent: "#FFD700" },
    notes: "Sri Lankan NIC. New 12-digit format (replaces old 9-digit+V/X), photo right, teal palette.",
  },
  {
    country: "LK",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/lk-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Sri Lankan Passport. TD3 MRZ, navy with national emblem.",
  },

  // ─── Nepal ────────────────────────────────────────────────────
  {
    country: "NP",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameNe",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("citizenshipNo",   0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.58, 0.55, 0.18, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/np-citizenship.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#F5E6D3", text: "#1A1A1A", accent: "#8B1E2F" },
    notes: "Nepali Citizenship Certificate. 11-digit citizenship number, photo right, cream paper with maroon accent.",
  },
  {
    country: "NP",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("placeOfBirth",   0.45, 0.66, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/np-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#7A1E2F", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Nepali Passport. TD3 MRZ, maroon cover with Mount Everest emblem.",
  },

  // ─── Afghanistan ──────────────────────────────────────────────
  {
    country: "AF",
    docType: "national_id",
    fields: [
      f("fullNameFa",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "mixed"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "mixed"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "mixed"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/af-etazkira.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#1B4F8B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Afghan e-Tazkira. 10-digit ID, photo right, bilingual Dari/Pashto+English, blue palette.",
  },
  {
    country: "AF",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/af-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Afghan Passport. TD3 MRZ, blue cover with mosque emblem.",
  },

  // ─── Iran ─────────────────────────────────────────────────────
  {
    country: "IR",
    docType: "national_id",
    fields: [
      f("fullNameFa",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("melliCode",       0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "mixed"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "mixed"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "mixed"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ir-melli.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#FFFFFF", text: "#1A1A1A", accent: "#239F40" },
    notes: "Iranian National ID Card (Kart Melli). 10-digit Melli Code, photo right, bilingual Persian+English, white card with green accent.",
  },
  {
    country: "IR",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ir-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D2E", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Iranian Passport. TD3 MRZ, dark green cover with national emblem.",
  },

  // ─── Iraq ─────────────────────────────────────────────────────
  {
    country: "IQ",
    docType: "national_id",
    fields: [
      f("fullNameAr",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameEn",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "mixed"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "mixed"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "mixed"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/iq-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#F5E6D3", text: "#1A1A1A", accent: "#C8102E" },
    notes: "Iraqi ID Card. 12-digit ID, photo right, trilingual Arabic+Kurdish+English, cream with red accent.",
  },
  {
    country: "IQ",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/iq-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Iraqi Passport. TD3 MRZ, navy with national emblem.",
  },

  // ─── Lebanon ──────────────────────────────────────────────────
  {
    country: "LB",
    docType: "national_id",
    fields: [
      f("fullNameAr",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("fullNameFr",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "mixed"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "mixed"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "mixed"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/lb-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#8B1E2F", text: "#FFFFFF", accent: "#CEDB4D" },
    notes: "Lebanese ID Card. 12-digit ID, photo right, bilingual Arabic+French, red card with cedar accent.",
  },
  {
    country: "LB",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/lb-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Lebanese Passport. TD3 MRZ, navy with cedar tree emblem.",
  },

  // ─── Palestine ────────────────────────────────────────────────
  {
    country: "PS",
    docType: "national_id",
    fields: [
      f("fullNameAr",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "arabic"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "arabic"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "arabic"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ps-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#FFFFFF" },
    notes: "Palestinian ID Card (Hawiyya). 9-digit ID number, photo right, Arabic-only, green palette.",
  },
  {
    country: "PS",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ps-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Palestinian Passport. TD3 MRZ, dark green with national emblem.",
  },

  // ─── Sudan ────────────────────────────────────────────────────
  {
    country: "SD",
    docType: "national_id",
    fields: [
      f("fullNameAr",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "arabic"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "arabic"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "arabic"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/sd-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Sudanese National ID. 11-digit ID, photo right, Arabic primary, blue with gold accent.",
  },
  {
    country: "SD",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/sd-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Sudanese Passport. TD3 MRZ, navy with secretary bird emblem.",
  },

  // ─── Libya ────────────────────────────────────────────────────
  {
    country: "LY",
    docType: "national_id",
    fields: [
      f("fullNameAr",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "arabic"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "arabic"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "arabic"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ly-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Libyan National ID. 12-digit ID, photo right, Arabic primary, green with gold accent.",
  },
  {
    country: "LY",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ly-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B7A3D", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Libyan Passport. TD3 MRZ, dark green with national emblem.",
  },

  // ─── Yemen ────────────────────────────────────────────────────
  {
    country: "YE",
    docType: "national_id",
    fields: [
      f("fullNameAr",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "right",  "arabic"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "right",  "arabic"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "right",  "arabic"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "right",  "arabic"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ye-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#D2B48C", text: "#1A1A1A", accent: "#8B1E2F" },
    notes: "Yemeni ID Card. 10-digit ID, photo right, Arabic primary, tan with red accent.",
  },
  {
    country: "YE",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/ye-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Yemeni Passport. TD3 MRZ, navy with national emblem.",
  },

  // ─── Mauritius ────────────────────────────────────────────────
  {
    country: "MU",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("nationalId",      0.05, 0.20, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.32, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",    0.05, 0.48, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/mu-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Mauritian National ID Card. 14-char alphanumeric ID, photo right, blue with gold accent.",
  },
  {
    country: "MU",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/mu-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#8B1E2F", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Mauritian Passport (Passeport Maurice). TD3 MRZ, red with national coat of arms.",
  },

  // ─── Ghana ────────────────────────────────────────────────────
  {
    country: "GH",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("nationalId",      0.05, 0.20, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.32, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.40, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("nationality",    0.05, 0.48, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/gh-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#CE1126", text: "#FFFFFF", accent: "#FCD116" },
    notes: "Ghana Card (Ghana National Identity Card). 12-char alphanumeric (GHA-XXXXXXXXXX-O), biometric, photo right, Pan-African red-yellow-green.",
  },
  {
    country: "GH",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/gh-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Ghanaian Passport. TD3 MRZ, navy with eagle and star emblem.",
  },

  // ─── Cambodia ─────────────────────────────────────────────────
  {
    country: "KH",
    docType: "national_id",
    fields: [
      f("fullNameEn",     0.05, 0.10, 0.55, 0.06, 13, "bold",   "left",   "latin"),
      f("fullNameKh",     0.05, 0.18, 0.55, 0.05, 11, "normal", "left",   "latin"),
      f("nationalId",      0.05, 0.30, 0.55, 0.07, 14, "bold",   "center", "latin"),
      f("dateOfBirth",    0.05, 0.42, 0.55, 0.05, 10, "normal", "left",   "latin"),
      f("sex",            0.05, 0.50, 0.20, 0.05, 10, "normal", "left",   "latin"),
      f("address",        0.05, 0.58, 0.55, 0.18, 10, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.05, 0.80, 0.55, 0.05, 10, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/kh-id.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.10),
      photoPosition:     b(0.70, 0.10, 0.25, 0.35),
      watermarkPosition: b(0.05, 0.45, 0.55, 0.30),
    },
    colors: { background: "#0B3D91", text: "#FFFFFF", accent: "#D4AF37" },
    notes: "Cambodian ID Card. 9-digit ID, photo right, bilingual Khmer+English, blue with gold accent.",
  },
  {
    country: "KH",
    docType: "passport",
    fields: [
      f("fullNameEn",     0.45, 0.22, 0.50, 0.10, 12, "bold",   "left",   "latin"),
      f("documentNo",      0.45, 0.34, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("nationality",    0.45, 0.42, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfBirth",    0.45, 0.50, 0.50, 0.05, 11, "normal", "left",   "latin"),
      f("sex",            0.45, 0.58, 0.20, 0.05, 11, "normal", "left",   "latin"),
      f("dateOfExpiry",   0.45, 0.74, 0.50, 0.05, 11, "normal", "left",   "latin"),
    ],
    layout: {
      backgroundImage:  "https://cirkle.app/img/kh-passport.png",
      logoPosition:      b(0.40, 0.02, 0.20, 0.12),
      photoPosition:     b(0.05, 0.20, 0.30, 0.45),
      mrzPosition:        b(0.05, 0.80, 0.90, 0.15),
      watermarkPosition: b(0.05, 0.30, 0.90, 0.40),
    },
    colors: { background: "#1B2A5B", text: "#FFFFFF", accent: "#C8A35B" },
    notes: "Cambodian Passport. TD3 MRZ, navy with Angkor Wat emblem.",
  },
];

// ─── Public lookup functions ────────────────────────────────────────

/**
 * Find a single template by ISO alpha-2 country code + doc type.
 *
 * @param country  ISO 3166-1 alpha-2 code (e.g. "EG", "sa", "uS" —
 *                 case-insensitive)
 * @param docType  One of: national_id, passport, driver_license, residence
 * @returns The matching template, or `undefined` if no template exists
 *          for this country+docType pair.
 */
export function getTemplate(
  country: string,
  docType: string,
): DocumentTemplate | undefined {
  const c = country.trim().toUpperCase();
  const d = docType.trim().toLowerCase();
  return DOCUMENT_TEMPLATES.find(
    (t) => t.country.toUpperCase() === c && t.docType === d,
  );
}

/**
 * @returns The full template catalog (immutable reference to the
 *          internal array — callers MUST NOT mutate).
 */
export function getAllTemplates(): DocumentTemplate[] {
  return DOCUMENT_TEMPLATES;
}

/**
 * @returns The number of templates in the catalog.
 */
export function getTemplateCount(): number {
  return DOCUMENT_TEMPLATES.length;
}

// ─── Template matcher ──────────────────────────────────────────────

/**
 * A detected field as passed to `matchDocumentToTemplate` — a name +
 * a bounding box in relative (0-1) coordinates.
 */
export interface DetectedField {
  name: string;
  position: BoundingBox;
}

/**
 * Result of matching a set of detected fields to a document template.
 */
export interface TemplateMatchResult {
  /** Overall match score in [0, 1] — 1.0 means perfect match. */
  matchScore: number;
  /** Field names that were both detected AND positionally matched. */
  matchedFields: string[];
  /** Field names that were missing OR positionally mismatched, with reason. */
  mismatchedFields: string[];
  /** Human-readable summary of the match decision. */
  explanation: string;
}

/** Canonical alias map: detected-field-name → expected-field-name. */
const FIELD_NAME_ALIASES: Record<string, string[]> = {
  fullName:     ["fullName", "fullNameAr", "fullNameEn", "fullNameFr",
                 "fullNameDe", "fullNameEs", "fullNameIt", "fullNameNl",
                 "fullNameSv", "fullNameNo", "fullNameRu", "fullNameZh",
                 "fullNameJa", "fullNameFa", "fullNameUr", "fullNameLocal",
                 "fullNameBn", "fullNameSi", "fullNameNe", "fullNameTh",
                 "fullNameKh", "name", "fullname"],
  nationalId:   ["nationalId", "nationalNumber", "idNumber", "cprNumber",
                 "civilId", "qatariId", "cnicNumber", "aadhaarNumber",
                 "dniNumber", "documentNo", "passportNo", "nricNumber",
                 "nikNumber", "philSysNumber", "melliCode", "citizenshipNo"],
  dateOfBirth:  ["dateOfBirth", "dob", "birthDate", "birth"],
  sex:          ["sex", "gender"],
  dateOfExpiry:["dateOfExpiry", "expiryDate", "expiry", "expires"],
  nationality:  ["nationality", "national"],
  address:      ["address", "addr"],
  bloodType:    ["bloodType", "blood"],
  race:         ["race", "ethnicity"],
  placeOfBirth:["placeOfBirth", "pob"],
  documentNo:   ["documentNo", "docNo", "passportNo", "serialNo"],
  photo:        ["photo", "picture", "portrait"],
};

/**
 * Check if a detected-field name matches an expected template field
 * name, accounting for common aliases (e.g. "name" matches "fullNameEn",
 * "id" matches "nationalId", "passport number" matches "documentNo").
 */
function fieldNamesMatch(detected: string, expected: string): boolean {
  const d = detected.toLowerCase().trim();
  const e = expected.toLowerCase().trim();

  // Direct match
  if (d === e || d.includes(e) || e.includes(d)) {
    return true;
  }

  // Alias match — check if both `d` and `e` are aliases of the same canonical
  for (const canonicalAliases of Object.values(FIELD_NAME_ALIASES)) {
    const dIsAlias = canonicalAliases.some((a) => a.toLowerCase() === d || a.toLowerCase().includes(d) || d.includes(a.toLowerCase()));
    const eIsAlias = canonicalAliases.some((a) => a.toLowerCase() === e || a.toLowerCase().includes(e) || e.includes(a.toLowerCase()));
    if (dIsAlias && eIsAlias) {
      return true;
    }
  }
  return false;
}

/**
 * Compute Intersection-over-Union (IoU) between two relative-coord
 * bounding boxes. Returns 0 if boxes don't overlap, 1 if they're
 * identical. IoU is the standard object-detection overlap metric.
 */
export function computeIoU(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const interW = Math.max(0, x2 - x1);
  const interH = Math.max(0, y2 - y1);
  const intersection = interW * interH;
  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Compute the center-distance between two bounding boxes (Euclidean,
 * in relative coordinates). Useful as a fallback when IoU is 0 (boxes
 * don't overlap) but they're still close to each other.
 */
export function computeCenterDistance(a: BoundingBox, b: BoundingBox): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

/**
 * Match a set of OCR-detected fields (with bounding boxes) against the
 * expected field positions of a document template.
 *
 * Algorithm:
 *   1. For each expected field in the template, find the closest
 *      detected field by name (case-insensitive + alias-aware).
 *   2. If a detected field is found, compute IoU between detected
 *      and expected positions.
 *      - IoU >= 0.30 → matched (positions agree within 30%)
 *      - IoU < 0.30 → mismatched (positions too far apart)
 *   3. If no detected field by that name, the expected field is
 *      listed as missing.
 *   4. matchScore = (sum of IoU for matched fields) / (total expected
 *      fields) — so a perfect match scores 1.0 and a fully-missing
 *      set scores 0.0.
 *
 * @param imageWidth   Pixel width of the source image (used for
 *                      diagnostics in `explanation`, not for matching
 *                      since all positions are relative)
 * @param imageHeight  Pixel height of the source image
 * @param detectedFields  Array of {name, position} from OCR
 * @param template     The template to match against
 * @returns matchScore, matchedFields, mismatchedFields, explanation
 */
export function matchDocumentToTemplate(
  imageWidth: number,
  imageHeight: number,
  detectedFields: DetectedField[],
  template: DocumentTemplate,
): TemplateMatchResult {
  const matchedFields: string[] = [];
  const mismatchedFields: string[] = [];
  let totalIoU = 0;
  const totalFields = template.fields.length || 1;

  for (const expectedField of template.fields) {
    // Find the detected field whose name best matches this expected field
    const detected = detectedFields.find((df) =>
      fieldNamesMatch(df.name, expectedField.name),
    );

    if (!detected) {
      mismatchedFields.push(`${expectedField.name} (missing)`);
      continue;
    }

    const iou = computeIoU(detected.position, expectedField.position);
    const dist = computeCenterDistance(detected.position, expectedField.position);

    // Match if IoU >= 0.30 OR centers are very close (within 0.10 of
    // each other in relative coords). The center-distance fallback
    // catches cases where the OCR box is much smaller/larger than the
    // template box (low IoU) but at the right location.
    if (iou >= 0.30 || dist < 0.10) {
      matchedFields.push(expectedField.name);
      // Use IoU (or a small floor for center-distance matches) as the
      // contribution to the overall score.
      totalIoU += Math.max(iou, dist < 0.05 ? 0.5 : iou);
    } else {
      mismatchedFields.push(
        `${expectedField.name} (position mismatch: IoU=${iou.toFixed(2)}, dist=${dist.toFixed(2)})`,
      );
    }
  }

  const matchScore = totalIoU / totalFields;
  const explanation = buildExplanation(
    template,
    matchedFields.length,
    mismatchedFields.length,
    totalFields,
    matchScore,
    imageWidth,
    imageHeight,
  );

  return {
    matchScore: Math.round(matchScore * 1000) / 1000,
    matchedFields,
    mismatchedFields,
    explanation,
  };
}

/**
 * Build a human-readable explanation for the match decision.
 */
function buildExplanation(
  template: DocumentTemplate,
  matchedCount: number,
  mismatchedCount: number,
  totalFields: number,
  matchScore: number,
  imageWidth: number,
  imageHeight: number,
): string {
  const country = template.country;
  const docType = template.docType;
  const pct = (matchScore * 100).toFixed(1);
  const match = matchScore >= 0.70
    ? "strong match"
    : matchScore >= 0.40
      ? "partial match"
      : "weak match";

  return (
    `${match} (${pct}%) for ${country} ${docType} template: ` +
    `${matchedCount}/${totalFields} fields positionally matched, ` +
    `${mismatchedCount} missing or mismatched. ` +
    `Image ${imageWidth}×${imageHeight}px — all positions compared ` +
    `in relative coordinates (0-1) so the score is resolution-independent.`
  );
}
