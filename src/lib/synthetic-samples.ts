import type { DocType } from "@/lib/verification-types";

/**
 * Synthetic Sample Bank (server-safe).
 *
 * A small bank of synthetic Egyptian-ID-like samples with known ground truth.
 * These are deterministic so evaluation is meaningful.
 *
 * NOTE: These are MOCK documents (not real), used only to test the OCR pipeline.
 *
 * This module is server-safe (no `"use client"` directive) so it can be
 * imported from API routes. The client-side `src/lib/synthetic-doc.ts` re-exports
 * the same data plus the canvas-based renderer for the browser.
 */

export interface SyntheticSampleSpec {
  docType: DocType;
  name: string;
  fullNameAr: string;
  fullNameEn: string;
  nationalId: string;
  birthDate: string; // ISO
  gender: "Male" | "Female";
  address: string;
  documentNo: string;
  expiryDate: string;
  nationality: string;
  job: string;
  religion: string;
  maritalStatus: string;
  governorate: string;
}

export const SYNTHETIC_SAMPLES: SyntheticSampleSpec[] = [
  {
    docType: "national_id",
    name: "Synthetic Sample 1 — Ahmed Mohamed",
    fullNameAr: "أحمد محمد عبد الرحمن السيد",
    fullNameEn: "Ahmed Mohamed Abdelrahman Elsayed",
    nationalId: "29001011234567",
    birthDate: "1990-01-01",
    gender: "Male",
    address: "محافظة القاهرة - مدينة نصر - شارع عباس العقاد",
    documentNo: "29501012345678",
    expiryDate: "2030-01-01",
    nationality: "مصري",
    job: "مهندس برمجيات",
    religion: "مسلم",
    maritalStatus: "أعزب",
    governorate: "القاهرة",
  },
  {
    docType: "national_id",
    name: "Synthetic Sample 2 — Fatma Ali",
    fullNameAr: "فاطمة علي حسن إبراهيم",
    fullNameEn: "Fatma Ali Hassan Ibrahim",
    nationalId: "29503072234588",
    birthDate: "1995-03-07",
    gender: "Female",
    address: "محافظة الإسكندرية - سيدي بشر - شارع فوزي معاذ",
    documentNo: "29503073456789",
    expiryDate: "2031-03-07",
    nationality: "مصرية",
    job: "طبيبة",
    religion: "مسلمة",
    maritalStatus: "متزوجة",
    governorate: "الإسكندرية",
  },
  {
    docType: "national_id",
    name: "Synthetic Sample 3 — Khaled Ibrahim",
    fullNameAr: "خالد إبراهيم محمود عبد الله",
    fullNameEn: "Khaled Ibrahim Mahmoud Abdullah",
    nationalId: "28809151122334",
    birthDate: "1988-09-15",
    gender: "Male",
    address: "محافظة الجيزة - الهرم - شارع فيصل",
    documentNo: "29809151234500",
    expiryDate: "2028-09-15",
    nationality: "مصري",
    job: "محاسب",
    religion: "مسيحي",
    maritalStatus: "متزوج",
    governorate: "الجيزة",
  },
  {
    docType: "passport",
    name: "Synthetic Sample 4 — Passport Omar",
    fullNameAr: "عمر خالد محمود السيد",
    fullNameEn: "OMAR KHALED MAHMOUD ELSAYED",
    nationalId: "",
    birthDate: "1992-06-12",
    gender: "Male",
    address: "",
    documentNo: "A12345678",
    expiryDate: "2029-06-12",
    nationality: "مصري",
    job: "",
    religion: "",
    maritalStatus: "",
    governorate: "",
  },
  {
    docType: "national_id",
    name: "Synthetic Sample 5 — Mariam Hassan",
    fullNameAr: "مريم حسن أحمد عبد العزيز",
    fullNameEn: "Mariam Hassan Ahmed Abdelaziz",
    nationalId: "29704203344556",
    birthDate: "1997-04-20",
    gender: "Female",
    address: "محافظة الدقهلية - المنصورة - شارع الجمهورية",
    documentNo: "29704204455667",
    expiryDate: "2032-04-20",
    nationality: "مصرية",
    job: "صيدلانية",
    religion: "مسلمة",
    maritalStatus: "عزباء",
    governorate: "الدقهلية",
  },
  {
    docType: "national_id",
    name: "Synthetic Sample 6 — Mostafa Tarek",
    fullNameAr: "مصطفى طارق فؤاد عبد الرحمن",
    fullNameEn: "Mostafa Tarek Fouad Abdelrahman",
    nationalId: "28512019876543",
    birthDate: "1985-12-01",
    gender: "Male",
    address: "محافظة الشرقية - الزقازيق - شارع الجلاء",
    documentNo: "29512018765432",
    expiryDate: "2027-12-01",
    nationality: "مصري",
    job: "محامي",
    religion: "مسلم",
    maritalStatus: "أعزب",
    governorate: "الشرقية",
  },
];
