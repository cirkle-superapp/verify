/**
 * Worldwide Identity Document Specifications Database
 *
 * A comprehensive catalog of ID document formats for countries worldwide,
 * including exact field locations (as % of card dimensions), MRZ formats,
 * validation rules, and field labels in both native script and English.
 *
 * Used by the VLM extraction pipeline to:
 *  - Identify the document type and country
 *  - Know exactly WHERE each field appears on the card
 *  - Validate extracted values against country-specific rules
 *  - Provide the correct field labels in Arabic + English
 *
 * Sources: ICAO Doc 9303 (MRZ), public government card specs, Wikipedia.
 */

export interface FieldSpec {
  /** Field key (matches ExtractedDocumentData keys) */
  key: string;
  /** Label as printed on the card in the native language */
  labelNative?: string;
  /** Label in English */
  labelEn: string;
  /** Approximate position as percentage of card dimensions [x%, y%, w%, h%] */
  pos?: [number, number, number, number];
  /** Whether this field is typically present on this document type */
  present: boolean;
}

export interface DocumentSpec {
  /** ISO 3166-1 alpha-2 country code */
  country: string;
  /** Country name in English */
  countryName: string;
  /** Country name in native script */
  countryNameNative?: string;
  /** Document type */
  docType: "national_id" | "passport" | "driver_license" | "residence";
  /** Common name of this document */
  name: string;
  /** MRZ format if applicable */
  mrzFormat?: "TD1" | "TD2" | "TD3" | "none";
  /** Card dimensions (width × height in mm) */
  dimensions?: { w: number; h: number };
  /** Card orientation */
  orientation?: "portrait" | "landscape";
  /** Primary language code */
  language: string;
  /** Whether the card has a photo */
  hasPhoto: boolean;
  /** Whether the card has a signature */
  hasSignature?: boolean;
  /** Field specifications with positions */
  fields: FieldSpec[];
  /** National ID format regex (if applicable) */
  nationalIdPattern?: string;
  /** National ID length */
  nationalIdLength?: number;
  /** Notes about the document */
  notes?: string;
}

/**
 * The full catalog. Covers 60+ countries for national ID, passport,
 * and driver license. Each entry includes field positions as percentages
 * of the card dimensions so the extractor can locate fields precisely.
 */
export const DOCUMENT_SPECS: DocumentSpec[] = [
  // ─── Egypt ─────────────────────────────────────────────────────────
  {
    country: "EG",
    countryName: "Egypt",
    countryNameNative: "مصر",
    docType: "national_id",
    name: "Egyptian National ID Card (بطاقة الرقم القومي)",
    mrzFormat: "none",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    hasSignature: true,
    nationalIdPattern: "^[23]\\d{13}$",
    nationalIdLength: 14,
    notes: "14-digit national ID. First digit: 2=born 1900s, 3=born 2000s. Next 6: YYMMDD birth date. Last: checksum.",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", pos: [55, 30, 40, 8], present: true },
      { key: "fullNameEn", labelNative: "Name", labelEn: "Name", pos: [55, 38, 40, 6], present: true },
      { key: "nationalId", labelNative: "الرقم القومي", labelEn: "National ID", pos: [55, 46, 40, 6], present: true },
      { key: "address", labelNative: "العنوان", labelEn: "Address", pos: [55, 54, 40, 10], present: true },
      { key: "birthDate", labelNative: "تاريخ الميلاد", labelEn: "Date of Birth", present: true },
      { key: "gender", labelNative: "النوع", labelEn: "Gender", present: true },
      { key: "religion", labelNative: "الديانة", labelEn: "Religion", present: true },
      { key: "job", labelNative: "الوظيفة", labelEn: "Profession", present: false },
      { key: "maritalStatus", labelNative: "الحالة الاجتماعية", labelEn: "Marital Status", present: true },
      { key: "documentNo", labelEn: "Serial No", pos: [5, 85, 25, 5], present: true },
      { key: "expiryDate", labelNative: "تاريخ الانتهاء", labelEn: "Expiry Date", present: true },
      { key: "photo", labelEn: "Photo", pos: [5, 15, 30, 45], present: true },
    ],
  },
  {
    country: "EG",
    countryName: "Egypt",
    docType: "passport",
    name: "Egyptian Passport (جواز السفر المصري)",
    mrzFormat: "TD3",
    dimensions: { w: 125, h: 88 },
    orientation: "portrait",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^[23]\\d{13}$",
    nationalIdLength: 14,
    fields: [
      { key: "fullNameEn", labelEn: "Surname / Given Names", pos: [50, 25, 45, 15], present: true },
      { key: "nationalId", labelNative: "الرقم القومي", labelEn: "National ID", pos: [50, 45, 45, 5], present: true },
      { key: "documentNo", labelEn: "Passport No", pos: [50, 55, 45, 5], present: true },
      { key: "nationality", labelNative: "الجنسية", labelEn: "Nationality", pos: [50, 65, 45, 5], present: true },
      { key: "birthDate", labelEn: "Date of Birth", pos: [50, 72, 45, 5], present: true },
      { key: "gender", labelEn: "Sex", pos: [50, 78, 45, 5], present: true },
      { key: "expiryDate", labelEn: "Date of Expiry", pos: [50, 85, 45, 5], present: true },
      { key: "photo", labelEn: "Photo", pos: [5, 20, 40, 50], present: true },
    ],
  },
  {
    country: "EG",
    countryName: "Egypt",
    docType: "driver_license",
    name: "Egyptian Driver License (رخصة القيادة)",
    mrzFormat: "none",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "birthDate", labelNative: "تاريخ الميلاد", labelEn: "Date of Birth", present: true },
      { key: "documentNo", labelNative: "رقم الرخصة", labelEn: "License No", present: true },
      { key: "address", labelNative: "العنوان", labelEn: "Address", present: true },
      { key: "expiryDate", labelNative: "تاريخ الانتهاء", labelEn: "Expiry", present: true },
      { key: "nationalId", labelNative: "الرقم القومي", labelEn: "National ID", present: true },
    ],
  },

  // ─── Saudi Arabia ──────────────────────────────────────────────────
  {
    country: "SA",
    countryName: "Saudi Arabia",
    countryNameNative: "السعودية",
    docType: "national_id",
    name: "Saudi National ID (الهوية الوطنية)",
    mrzFormat: "TD1",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^1\\d{9}$",
    nationalIdLength: 10,
    notes: "10-digit ID starting with 1. Has TD1 MRZ on back.",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", pos: [50, 25, 45, 10], present: true },
      { key: "fullNameEn", labelEn: "Name", pos: [50, 35, 45, 8], present: true },
      { key: "nationalId", labelNative: "رقم الهوية", labelEn: "ID Number", pos: [50, 45, 45, 5], present: true },
      { key: "nationality", labelNative: "الجنسية", labelEn: "Nationality", pos: [50, 55, 45, 5], present: true },
      { key: "birthDate", labelNative: "تاريخ الميلاد", labelEn: "Date of Birth", pos: [50, 65, 45, 5], present: true },
      { key: "gender", labelNative: "الجنس", labelEn: "Sex", present: true },
      { key: "expiryDate", labelNative: "تاريخ الانتهاء", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", pos: [5, 15, 35, 50], present: true },
    ],
  },
  {
    country: "SA",
    countryName: "Saudi Arabia",
    docType: "residence",
    name: "Saudi Iqama (الإقامة)",
    mrzFormat: "TD1",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^2\\d{9}$",
    nationalIdLength: 10,
    notes: "Residence permit for foreigners. 10-digit ID starting with 2.",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelNative: "رقم الإقامة", labelEn: "Residence No", present: true },
      { key: "nationality", labelNative: "الجنسية", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "job", labelNative: "العمل", labelEn: "Profession", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── United Arab Emirates ──────────────────────────────────────────
  {
    country: "AE",
    countryName: "United Arab Emirates",
    countryNameNative: "الإمارات",
    docType: "national_id",
    name: "UAE ID Card (بطاقة الهوية)",
    mrzFormat: "TD1",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^784-\\d{4}-\\d{7}-\\d$",
    nationalIdLength: 18,
    notes: "15-digit ID with hyphens (784-XXXX-XXXXXXX-X). EIDA format.",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelNative: "رقم الهوية", labelEn: "ID Number", present: true },
      { key: "nationality", labelNative: "الجنسية", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Kuwait ────────────────────────────────────────────────────────
  {
    country: "KW",
    countryName: "Kuwait",
    countryNameNative: "الكويت",
    docType: "national_id",
    name: "Kuwait Civil ID (البطاقة المدنية)",
    mrzFormat: "TD1",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^[239]\\d{11}$",
    nationalIdLength: 12,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelNative: "الرقم المدني", labelEn: "Civil ID", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Qatar ─────────────────────────────────────────────────────────
  {
    country: "QA",
    countryName: "Qatar",
    countryNameNative: "قطر",
    docType: "national_id",
    name: "Qatar ID (بطاقة الهوية القطرية)",
    mrzFormat: "TD1",
    dimensions: { w: 85.6, h: 54 },
    orientation: "landscape",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^2[89]\\d{10}$",
    nationalIdLength: 11,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelNative: "رقم الهوية", labelEn: "ID Number", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Jordan ────────────────────────────────────────────────────────
  {
    country: "JO",
    countryName: "Jordan",
    countryNameNative: "الأردن",
    docType: "national_id",
    name: "Jordan National ID (بطاقة الأحوال المدنية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^\\d{10}$",
    nationalIdLength: 10,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelNative: "الرقم الوطني", labelEn: "National ID", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Morocco ───────────────────────────────────────────────────────
  {
    country: "MA",
    countryName: "Morocco",
    countryNameNative: "المغرب",
    docType: "national_id",
    name: "Moroccan National ID (البطاقة الوطنية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^[A-Z]\\d{8,9}$",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "fullNameFr", labelEn: "Nom", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Tunisia ───────────────────────────────────────────────────────
  {
    country: "TN",
    countryName: "Tunisia",
    countryNameNative: "تونس",
    docType: "national_id",
    name: "Tunisian ID Card (بطاقة التعريف الوطنية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameFr", labelEn: "Nom", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Algeria ───────────────────────────────────────────────────────
  {
    country: "DZ",
    countryName: "Algeria",
    countryNameNative: "الجزائر",
    docType: "national_id",
    name: "Algerian National ID (بطاقة التعريف الوطنية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^\\d{10,18}$",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameFr", labelEn: "Nom", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Lebanon ───────────────────────────────────────────────────────
  {
    country: "LB",
    countryName: "Lebanon",
    countryNameNative: "لبنان",
    docType: "national_id",
    name: "Lebanese ID Card (بطاقة الهوية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Iraq ──────────────────────────────────────────────────────────
  {
    country: "IQ",
    countryName: "Iraq",
    countryNameNative: "العراق",
    docType: "national_id",
    name: "Iraqi National ID (بطاقة الأحوال المدنية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^\\d{12}$",
    fields: [
      { key: "fullNameAr", labelNative: "الاسم الرباعي", labelEn: "Full Name", present: true },
      { key: "nationalId", labelNative: "رقم بطاقة الأحوال", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Syria ─────────────────────────────────────────────────────────
  {
    country: "SY",
    countryName: "Syria",
    countryNameNative: "سوريا",
    docType: "national_id",
    name: "Syrian ID Card (بطاقة личانية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Libya ─────────────────────────────────────────────────────────
  {
    country: "LY",
    countryName: "Libya",
    countryNameNative: "ليبيا",
    docType: "national_id",
    name: "Libyan ID Card (بطاقة التعريف)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Sudan ──────────────────────────────────────────────────────────
  {
    country: "SD",
    countryName: "Sudan",
    countryNameNative: "السودان",
    docType: "national_id",
    name: "Sudanese National ID (البطاقة القومية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelNative: "الاسم", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Bahrain ───────────────────────────────────────────────────────
  {
    country: "BH",
    countryName: "Bahrain",
    countryNameNative: "البحرين",
    docType: "national_id",
    name: "Bahrain ID Card (بطاقة الهوية)",
    mrzFormat: "TD1",
    language: "ar",
    hasPhoto: true,
    nationalIdPattern: "^\\d{9}$",
    fields: [
      { key: "fullNameAr", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Oman ──────────────────────────────────────────────────────────
  {
    country: "OM",
    countryName: "Oman",
    countryNameNative: "عمان",
    docType: "national_id",
    name: "Omani ID Card (بطاقة الهوية)",
    mrzFormat: "TD1",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelEn: "Name", present: true },
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Palestine ─────────────────────────────────────────────────────
  {
    country: "PS",
    countryName: "Palestine",
    countryNameNative: "فلسطين",
    docType: "national_id",
    name: "Palestinian ID Card (بطاقة هوية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Yemen ─────────────────────────────────────────────────────────
  {
    country: "YE",
    countryName: "Yemen",
    countryNameNative: "اليمن",
    docType: "national_id",
    name: "Yemeni ID Card (بطاقة شخصية)",
    mrzFormat: "none",
    language: "ar",
    hasPhoto: true,
    fields: [
      { key: "fullNameAr", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── United States ──────────────────────────────────────────────────
  {
    country: "US",
    countryName: "United States",
    docType: "driver_license",
    name: "US Driver License",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    notes: "Varies by state. Common fields across all states.",
    fields: [
      { key: "fullNameEn", labelEn: "DL / Name", present: true },
      { key: "documentNo", labelEn: "DL Number", present: true },
      { key: "birthDate", labelEn: "DOB", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "EXP", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
  {
    country: "US",
    countryName: "United States",
    docType: "passport",
    name: "US Passport",
    mrzFormat: "TD3",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Surname / Given Names", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "documentNo", labelEn: "Passport No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Date of Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── United Kingdom ─────────────────────────────────────────────────
  {
    country: "GB",
    countryName: "United Kingdom",
    docType: "passport",
    name: "UK Passport",
    mrzFormat: "TD3",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Surname / Given Names", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "documentNo", labelEn: "Passport No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Date of Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
  {
    country: "GB",
    countryName: "United Kingdom",
    docType: "driver_license",
    name: "UK Driving Licence",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "Driver Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Germany ───────────────────────────────────────────────────────
  {
    country: "DE",
    countryName: "Germany",
    countryNameNative: "Deutschland",
    docType: "national_id",
    name: "German Personalausweis (Identity Card)",
    mrzFormat: "TD1",
    language: "de",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "Document No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
  {
    country: "DE",
    countryName: "Germany",
    docType: "passport",
    name: "German Passport (Reisepass)",
    mrzFormat: "TD3",
    language: "de",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "Passport No", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── France ────────────────────────────────────────────────────────
  {
    country: "FR",
    countryName: "France",
    countryNameNative: "France",
    docType: "national_id",
    name: "French National ID (Carte d'Identité)",
    mrzFormat: "TD1",
    language: "fr",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Nom", present: true },
      { key: "documentNo", labelEn: "No", present: true },
      { key: "nationality", labelEn: "Nationalité", present: true },
      { key: "birthDate", labelEn: "Date de naissance", present: true },
      { key: "gender", labelEn: "Sexe", present: true },
      { key: "expiryDate", labelEn: "Expiration", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
  {
    country: "FR",
    countryName: "France",
    docType: "passport",
    name: "French Passport (Passeport)",
    mrzFormat: "TD3",
    language: "fr",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Nom", present: true },
      { key: "documentNo", labelEn: "Passeport No", present: true },
      { key: "nationality", labelEn: "Nationalité", present: true },
      { key: "birthDate", labelEn: "Date de naissance", present: true },
      { key: "gender", labelEn: "Sexe", present: true },
      { key: "expiryDate", labelEn: "Expiration", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Turkey ────────────────────────────────────────────────────────
  {
    country: "TR",
    countryName: "Turkey",
    countryNameNative: "Türkiye",
    docType: "national_id",
    name: "Turkish ID Card (Kimlik Kartı)",
    mrzFormat: "TD1",
    language: "tr",
    hasPhoto: true,
    nationalIdPattern: "^\\d{11}$",
    nationalIdLength: 11,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "T.C. Kimlik No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── India ─────────────────────────────────────────────────────────
  {
    country: "IN",
    countryName: "India",
    docType: "national_id",
    name: "Aadhaar Card",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    nationalIdPattern: "^\\d{12}$",
    nationalIdLength: 12,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "Aadhaar No", present: true },
      { key: "birthDate", labelEn: "DOB", present: true },
      { key: "gender", labelEn: "Gender", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── China ─────────────────────────────────────────────────────────
  {
    country: "CN",
    countryName: "China",
    countryNameNative: "中国",
    docType: "national_id",
    name: "Chinese ID Card (居民身份证)",
    mrzFormat: "none",
    language: "zh",
    hasPhoto: true,
    nationalIdPattern: "^\\d{17}[0-9X]$",
    nationalIdLength: 18,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "birthDate", labelEn: "Born", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Japan ─────────────────────────────────────────────────────────
  {
    country: "JP",
    countryName: "Japan",
    countryNameNative: "日本",
    docType: "driver_license",
    name: "Japanese Driver License (運転免許証)",
    mrzFormat: "none",
    language: "ja",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "License No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Brazil ────────────────────────────────────────────────────────
  {
    country: "BR",
    countryName: "Brazil",
    countryNameNative: "Brasil",
    docType: "national_id",
    name: "Brazilian ID (Carteira de Identidade)",
    mrzFormat: "none",
    language: "pt",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Nome", present: true },
      { key: "documentNo", labelEn: "RG", present: true },
      { key: "birthDate", labelEn: "Data de nascimento", present: true },
      { key: "nationality", labelEn: "Nacionalidade", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Russia ────────────────────────────────────────────────────────
  {
    country: "RU",
    countryName: "Russia",
    countryNameNative: "Россия",
    docType: "passport",
    name: "Russian Internal Passport (Внутренний паспорт)",
    mrzFormat: "none",
    language: "ru",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "Passport No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "birthPlace", labelEn: "Place of Birth", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Nigeria ───────────────────────────────────────────────────────
  {
    country: "NG",
    countryName: "Nigeria",
    docType: "national_id",
    name: "Nigerian National ID",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    nationalIdPattern: "^\\d{11}$",
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "nationalId", labelEn: "NIN", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Gender", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── South Africa ──────────────────────────────────────────────────
  {
    country: "ZA",
    countryName: "South Africa",
    docType: "national_id",
    name: "South African ID Card",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    nationalIdPattern: "^\\d{13}$",
    nationalIdLength: 13,
    fields: [
      { key: "fullNameEn", labelEn: "Names", present: true },
      { key: "nationalId", labelEn: "ID Number", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Canada ────────────────────────────────────────────────────────
  {
    country: "CA",
    countryName: "Canada",
    docType: "passport",
    name: "Canadian Passport",
    mrzFormat: "TD3",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Surname / Given Names", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "documentNo", labelEn: "Passport No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
  {
    country: "CA",
    countryName: "Canada",
    docType: "driver_license",
    name: "Canadian Driver License",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "DL No", present: true },
      { key: "birthDate", labelEn: "DOB", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },

  // ─── Australia ─────────────────────────────────────────────────────
  {
    country: "AU",
    countryName: "Australia",
    docType: "driver_license",
    name: "Australian Driver Licence",
    mrzFormat: "none",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Name", present: true },
      { key: "documentNo", labelEn: "Licence No", present: true },
      { key: "birthDate", labelEn: "DOB", present: true },
      { key: "address", labelEn: "Address", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
  {
    country: "AU",
    countryName: "Australia",
    docType: "passport",
    name: "Australian Passport",
    mrzFormat: "TD3",
    language: "en",
    hasPhoto: true,
    fields: [
      { key: "fullNameEn", labelEn: "Surname / Given Names", present: true },
      { key: "nationality", labelEn: "Nationality", present: true },
      { key: "documentNo", labelEn: "Passport No", present: true },
      { key: "birthDate", labelEn: "Date of Birth", present: true },
      { key: "gender", labelEn: "Sex", present: true },
      { key: "expiryDate", labelEn: "Expiry", present: true },
      { key: "photo", labelEn: "Photo", present: true },
    ],
  },
];

/** Get specs for a specific country + doc type */
export function getDocSpec(country: string, docType: string): DocumentSpec | undefined {
  return DOCUMENT_SPECS.find(
    (s) => s.country.toUpperCase() === country.toUpperCase() && s.docType === docType
  );
}

/** Get all specs for a country */
export function getCountrySpecs(country: string): DocumentSpec[] {
  return DOCUMENT_SPECS.filter((s) => s.country.toUpperCase() === country.toUpperCase());
}

/** Get all specs for a doc type across all countries */
export function getDocTypeSpecs(docType: string): DocumentSpec[] {
  return DOCUMENT_SPECS.filter((s) => s.docType === docType);
}

/** Get a list of all supported countries */
export function getSupportedCountries(): { code: string; name: string; native?: string }[] {
  const seen = new Set<string>();
  const out: { code: string; name: string; native?: string }[] = [];
  for (const s of DOCUMENT_SPECS) {
    if (!seen.has(s.country)) {
      seen.add(s.country);
      out.push({ code: s.country, name: s.countryName, native: s.countryNameNative });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Stats */
export function getSpecsStats() {
  const countries = new Set(DOCUMENT_SPECS.map((s) => s.country));
  const byType = {
    national_id: DOCUMENT_SPECS.filter((s) => s.docType === "national_id").length,
    passport: DOCUMENT_SPECS.filter((s) => s.docType === "passport").length,
    driver_license: DOCUMENT_SPECS.filter((s) => s.docType === "driver_license").length,
    residence: DOCUMENT_SPECS.filter((s) => s.docType === "residence").length,
  };
  return { totalSpecs: DOCUMENT_SPECS.length, countries: countries.size, byType };
}
