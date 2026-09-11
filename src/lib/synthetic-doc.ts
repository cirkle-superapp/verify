"use client";

import type { DocType } from "@/lib/verification-types";

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

/** A small bank of synthetic Egyptian-ID-like samples with known ground truth.
 *  These are deterministic so evaluation is meaningful.
 *  NOTE: These are MOCK documents (not real), used only to test the OCR pipeline.
 */
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

/**
 * Render a synthetic Egyptian-ID-like card to a data URL using canvas.
 * The text on the card EXACTLY matches the spec — so OCR evaluation is meaningful.
 */
export function renderSyntheticDoc(spec: SyntheticSampleSpec, side: "front" | "back" = "front"): string {
  const W = 1000;
  const H = 640;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // background card
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#f8f5e9");
  grad.addColorStop(1, "#eef0e0");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // border
  ctx.strokeStyle = "#1a6b3a";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, W - 16, H - 16);

  if (side === "front") {
    // header
    ctx.fillStyle = "#1a6b3a";
    ctx.fillRect(20, 20, W - 40, 80);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 30px Arial";
    ctx.fillText("جمهورية مصر العربية", W / 2, 55);
    ctx.font = "bold 22px Arial";
    ctx.fillText("ARE — Republic of Egypt", W / 2, 85);

    // title
    ctx.fillStyle = "#1a6b3a";
    ctx.font = "bold 26px Arial";
    ctx.textAlign = "right";
    ctx.fillText("بطاقة الرقم القومي", W - 30, 140);
    ctx.font = "16px Arial";
    ctx.fillText("National ID Card", W - 30, 165);

    // photo placeholder box
    ctx.strokeStyle = "#1a6b3a";
    ctx.lineWidth = 3;
    ctx.strokeRect(50, 130, 180, 220);
    ctx.fillStyle = "#d4d0c0";
    ctx.fillRect(52, 132, 176, 216);
    ctx.fillStyle = "#888";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText("PHOTO", 140, 245);

    // fields
    ctx.textAlign = "right";
    ctx.fillStyle = "#222";
    const fields: [string, string][] = [
      ["الاسم:", spec.fullNameAr],
      ["Name:", spec.fullNameEn],
      ["الرقم القومي / National ID:", spec.nationalId],
      ["تاريخ الميلاد:", spec.birthDate],
      ["النوع:", spec.gender === "Male" ? "ذكر / Male" : "أنثى / Female"],
      ["الديانة:", spec.religion],
      ["الوظيفة:", spec.job],
      ["الحالة الاجتماعية:", spec.maritalStatus],
    ];
    let y = 175;
    ctx.font = "bold 18px Arial";
    for (const [label, value] of fields) {
      ctx.fillStyle = "#1a6b3a";
      ctx.fillText(label, W - 30, y);
      ctx.fillStyle = "#111";
      ctx.font = "20px Arial";
      ctx.fillText(value, 260, y);
      ctx.font = "bold 18px Arial";
      y += 38;
    }

    // footer with national id big
    ctx.fillStyle = "#1a6b3a";
    ctx.fillRect(20, H - 60, W - 40, 50);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.fillText(spec.nationalId, W / 2, H - 25);
  } else {
    // back side
    ctx.fillStyle = "#1a6b3a";
    ctx.fillRect(20, 20, W - 40, 50);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 22px Arial";
    ctx.fillText("بيانات إضافية — Back Side", W / 2, 52);

    ctx.textAlign = "right";
    ctx.fillStyle = "#222";
    const backFields: [string, string][] = [
      ["العنوان:", spec.address],
      ["المحافظة:", spec.governorate],
      ["الجنسية:", spec.nationality],
      ["رقم المستند:", spec.documentNo],
      ["تاريخ الانتهاء:", spec.expiryDate],
    ];
    let y = 110;
    for (const [label, value] of backFields) {
      ctx.fillStyle = "#1a6b3a";
      ctx.font = "bold 18px Arial";
      ctx.fillText(label, W - 30, y);
      ctx.fillStyle = "#111";
      ctx.font = "20px Arial";
      ctx.fillText(value, 260, y);
      y += 40;
    }

    // fake MRZ for passports / TD1
    if (spec.docType === "passport") {
      const mrz1 = `P<EGY${spec.fullNameEn.padEnd(39, "<").slice(0, 39)}`.slice(0, 44);
      const yy = spec.birthDate.slice(2, 4);
      const mm = spec.birthDate.slice(5, 7);
      const dd = spec.birthDate.slice(8, 10);
      const eyy = spec.expiryDate.slice(2, 4);
      const emm = spec.expiryDate.slice(5, 7);
      const edd = spec.expiryDate.slice(8, 10);
      const sex = spec.gender === "Male" ? "M" : "F";
      const doc = spec.documentNo.padEnd(9, "<").slice(0, 9);
      const mrz2 = `${doc}0EGY${yy}${mm}${dd}${sex}${eyy}${emm}${edd}`.padEnd(44, "<").slice(0, 44);
      ctx.fillStyle = "#111";
      ctx.font = "20px monospace";
      ctx.textAlign = "left";
      ctx.fillText(mrz1, 40, H - 90);
      ctx.fillText(mrz2, 40, H - 60);
    }
  }

  return canvas.toDataURL("image/jpeg", 0.92);
}
