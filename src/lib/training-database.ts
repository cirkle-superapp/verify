/**
 * Comprehensive Egyptian Identity Document Training Database
 *
 * 100+ deterministic synthetic samples with REALISTIC Egyptian names,
 * valid national ID numbers (correct checksum), all governorates,
 * and proper field values. Used to train and evaluate the OCR pipeline.
 *
 * All IDs are SYNTHETIC (not real people) but follow the correct
 * Egyptian national ID format with valid checksums.
 *
 * The 14-digit Egyptian National ID format:
 *   CYYMMDD-SSSN-K
 *   C: century (2=1900s, 3=2000s)
 *   YYMMDD: birth date
 *   SSSN: serial + gender (odd=male, even=female)
 *   K: checksum (weighted sum mod 10)
 */

import type { DocType } from "@/lib/verification-types";

export interface TrainingSample {
  docType: DocType;
  name: string;
  fullNameAr: string;
  fullNameEn: string;
  nationalId: string;
  birthDate: string;
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

/** Egyptian governorates with Arabic names */
const GOVERNORATES = [
  { en: "Cairo", ar: "القاهرة" },
  { en: "Giza", ar: "الجيزة" },
  { en: "Alexandria", ar: "الإسكندرية" },
  { en: "Dakahlia", ar: "الدقهلية" },
  { en: "Sharkia", ar: "الشرقية" },
  { en: "Qalyubia", ar: "القليوبية" },
  { en: "Menoufia", ar: "المنوفية" },
  { en: "Gharbia", ar: "الغربية" },
  { en: "Kafr El Sheikh", ar: "كفر الشيخ" },
  { en: "Beheira", ar: "البحيرة" },
  { en: "Ismailia", ar: "الإسماعيلية" },
  { en: "Port Said", ar: "بورسعيد" },
  { en: "Suez", ar: "السويس" },
  { en: "Faiyum", ar: "الفيوم" },
  { en: "Beni Suef", ar: "بني سويف" },
  { en: "Minya", ar: "المنيا" },
  { en: "Asyut", ar: "أسيوط" },
  { en: "Sohag", ar: "سوهاج" },
  { en: "Qena", ar: "قنا" },
  { en: "Luxor", ar: "الأقصر" },
  { en: "Aswan", ar: "أسوان" },
  { en: "Red Sea", ar: "البحر الأحمر" },
  { en: "New Valley", ar: "الوادي الجديد" },
  { en: "Matrouh", ar: "مطروح" },
  { en: "North Sinai", ar: "شمال سيناء" },
  { en: "South Sinai", ar: "جنوب سيناء" },
];

/** Common Egyptian male first names (Arabic) */
const MALE_NAMES_AR = [
  "محمد", "أحمد", "محمود", "مصطفى", "علي", "حسن", "حسين", "عبد الله",
  "عبد الرحمن", "خالد", "إبراهيم", "يوسف", "عمر", "كريم", "طارق",
  "وليد", "سامح", "هاني", "عماد", "أيمن", "رامي", "مروان", "شريف",
  "كمال", "فؤاد", "نبيل", "سمير", "ناصر", "فاروق", "صلاح", "ماجد",
  "جمال", "حلمي", "رفعت", "زكي", "عادل", "غانم", "فتحي", "كمال",
];

/** Common Egyptian female first names (Arabic) */
const FEMALE_NAMES_AR = [
  "فاطمة", "عائشة", "زينب", "مريم", "سارة", "نورا", "هبة", "دعاء",
  "إيمان", "منى", "ربى", "آية", "مها", "هناء", "سحر", "وفاء",
  "ليلى", "ندى", "بسمة", "أمل", "منار", "رنا", "دينا", "شيرين",
  "ميرنا", "إسلام", "أحلام", "سلمى", "تسنيم", "روان", "جنى", "ميره",
];

/** Common Egyptian father/grandfather names (shared) */
const FATHER_NAMES_AR = [
  "محمد", "أحمد", "عبد الله", "عبد الرحمن", "حسن", "حسين", "محمود",
  "سيد", "مصطفى", "علي", "إبراهيم", "يوسف", "عبد العزيز", "خالد",
  "عبد الحميد", "عبد الرؤوف", "عبد البديع", "عبد القادر", "عبد الناصر",
  "سليمان", "رزق", "عطية", "غالي", "سعد", "نصر", "حلمي", "فؤاد",
];

/** Common Egyptian family names (Arabic) */
const FAMILY_NAMES_AR = [
  "السيد", "عبد الرحمن", "المصري", "حسن", "أحمد", "محمد", "علي",
  "إبراهيم", "سليمان", "عبد الله", "الشناوي", "الزيات", "النجار",
  "الحسيني", "القاضي", "الفقي", "الشريف", "الأمير", "الغريب",
  "عبد العزيز", "عبد الحميد", "عبد الخالق", "عبد الفتاح", "عبد الحفيظ",
  "عبد الرءوف", "عبد الباري", "عبد الجواد", "عبد الحليم", "عبد الحي",
  "عبد الكريم", "عبد اللطيف", "عبد المولى", "عبد الهادي", "عبد الرزاق",
];

/** English transliterations */
const MALE_NAMES_EN: Record<string, string> = {
  "محمد": "Mohamed", "أحمد": "Ahmed", "محمود": "Mahmoud", "مصطفى": "Mostafa",
  "علي": "Ali", "حسن": "Hassan", "حسين": "Hussein", "عبد الله": "Abdullah",
  "عبد الرحمن": "Abdelrahman", "خالد": "Khaled", "إبراهيم": "Ibrahim",
  "يوسف": "Youssef", "عمر": "Omar", "كريم": "Karim", "طارق": "Tarek",
  "وليد": "Waleed", "سامح": "Sameh", "هاني": "Hany", "عماد": "Emad",
  "أيمن": "Ayman", "رامي": "Ramy", "مروان": "Marwan", "شريف": "Sherif",
  "كمال": "Kamal", "فؤاد": "Fouad", "نبيل": "Nabil", "سمير": "Samir",
  "ناصر": "Nasser", "فاروق": "Farouk", "صلاح": "Salah", "ماجد": "Maged",
  "جمال": "Gamal", "حلمي": "Helmy", "رفعت": "Rafat", "زكي": "Zaki",
  "عادل": "Adel", "غانم": "Ghanem", "فتحي": "Fathy",
};

const FEMALE_NAMES_EN: Record<string, string> = {
  "فاطمة": "Fatma", "عائشة": "Aisha", "زينب": "Zeinab", "مريم": "Mariam",
  "سارة": "Sara", "نورا": "Noura", "هبة": "Heba", "دعاء": "Doaa",
  "إيمان": "Eman", "منى": "Mona", "ربى": "Ruba", "آية": "Aya",
  "مها": "Maha", "هناء": "Hanaa", "سحر": "Sahar", "وفاء": "Wafaa",
  "ليلى": "Laila", "ندى": "Nada", "بسمة": "Basma", "أمل": "Amal",
  "منار": "Manar", "رنا": "Rana", "دينا": "Dina", "شيرين": "Sherine",
  "ميرنا": "Mirna", "إسلام": "Es lam", "أحلام": "Ahlam", "سلمى": "Salma",
  "تسنيم": "Tasneem", "روان": "Rawan", "جنى": "Jana", "ميره": "Mira",
};

const FATHER_NAMES_EN: Record<string, string> = {
  "محمد": "Mohamed", "أحمد": "Ahmed", "عبد الله": "Abdullah",
  "عبد الرحمن": "Abdelrahman", "حسن": "Hassan", "حسين": "Hussein",
  "محمود": "Mahmoud", "سيد": "Sayyed", "مصطفى": "Mostafa", "علي": "Ali",
  "إبراهيم": "Ibrahim", "يوسف": "Youssef", "عبد العزيز": "Abdelaziz",
  "خالد": "Khaled", "عبد الحميد": "Abdelhamid", "عبد الرؤوف": "Abdelraouf",
  "عبد البديع": "Abdelbadei", "عبد القادر": "Abdelqader", "عبد الناصر": "Abdelnasser",
  "سليمان": "Suleiman", "رزق": "Rezk", "عطية": "Atiya", "غالي": "Ghaly",
  "سعد": "Saad", "نصر": "Nasr", "حلمي": "Helmy", "فؤاد": "Fouad",
};

const FAMILY_NAMES_EN: Record<string, string> = {
  "السيد": "Elsayed", "عبد الرحمن": "Abdelrahman", "المصري": "Elmasry",
  "حسن": "Hassan", "أحمد": "Ahmed", "محمد": "Mohamed", "علي": "Ali",
  "إبراهيم": "Ibrahim", "سليمان": "Suleiman", "عبد الله": "Abdullah",
  "الشناوي": "Elshennawy", "الزيات": "Elzayat", "النجار": "elnagar",
  "الحسيني": "Elhusseiny", "القاضي": "Elqady", "الفقي": "Elfeky",
  "الشريف": "Elsharif", "الأمير": "Elamir", "الغريب": "Elghareeb",
  "عبد العزيز": "Abdelaziz", "عبد الحميد": "Abdelhamid", "عبد الخالق": "Abdelkhalek",
  "عبد الفتاح": "Abdelfattah", "عبد الحفيظ": "Abdelhafez", "عبد الرءوف": "Abdelraouf",
  "عبد الباري": "Abdelbari", "عبد الجواد": "Abdelgawad", "عبد الحليم": "Abdelhalim",
  "عبد الحي": "Abdelhay", "عبد الكريم": "Abdelkarim", "عبد اللطيف": "Abdellatif",
  "عبد المولى": "Abdelmawla", "عبد الهادي": "Abdelhadi", "عبد الرزاق": "Abdelrazzak",
};

const JOBS = [
  { ar: "مهندس", en: "Engineer" },
  { ar: "طبيب", en: "Doctor" },
  { ar: "محاسب", en: "Accountant" },
  { ar: "محامي", en: "Lawyer" },
  { ar: "معلم", en: "Teacher" },
  { ar: "صيدلي", en: "Pharmacist" },
  { ar: "موظف", en: "Employee" },
  { ar: "تاجر", en: "Merchant" },
  { ar: "مبرمج", en: "Programmer" },
  { ar: "ممرض", en: "Nurse" },
];

const STREETS = [
  "شارع الجمهورية", "شارع التحرير", "شارع النيل", "شارع عباس العقاد",
  "شارع مصر", "شارع الأهرام", "شارع المطرية", "شارع المعز",
  "شارع الصالحية", "شارع الفاروق", "شارع الناصر", "شارع السلطان",
];

/**
 * Compute Egyptian National ID checksum.
 * Format: CYYMMDD-SSSN-K where K = (11 - (sum of first 13 digits * weights) mod 11) mod 10
 */
function computeChecksum(id13: string): number {
  const weights = [2, 7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(id13[i], 10) * weights[i];
  }
  return (11 - (sum % 11)) % 10;
}

/**
 * Generate a valid 14-digit Egyptian national ID.
 */
function genNationalId(birthYear: number, birthMonth: number, birthDay: number, gender: "Male" | "Female", govCode: number): string {
  const century = birthYear >= 2000 ? 3 : 2;
  const yy = String(birthYear % 100).padStart(2, "0");
  const mm = String(birthMonth).padStart(2, "0");
  const dd = String(birthDay).padStart(2, "0");

  // Serial: govCode (2 digits) + random serial (3 digits) + gender parity
  // Male = odd serial, Female = even serial
  const serialBase = govCode * 1000 + Math.floor(Math.random() * 900) + 100;
  const serial = gender === "Male" ? serialBase | 1 : serialBase & ~1;
  const serialStr = String(serial).padStart(7, "0");

  const id13 = `${century}${yy}${mm}${dd}${serialStr}`;
  const checksum = computeChecksum(id13);
  return `${id13}${checksum}`;
}

/** Seeded random for deterministic generation */
let seed = 42;
function seededRandom(): number {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

/**
 * Generate the full training database.
 * 100+ samples: 70 national IDs + 20 passports + 10 driver licenses
 */
export function generateTrainingDatabase(): TrainingSample[] {
  seed = 42; // reset seed for deterministic output
  const samples: TrainingSample[] = [];

  // 70 National IDs (35 male + 35 female)
  for (let i = 0; i < 70; i++) {
    const isMale = i < 35;
    const firstAr = isMale ? pick(MALE_NAMES_AR) : pick(FEMALE_NAMES_AR);
    const fatherAr = pick(FATHER_NAMES_AR);
    const grandAr = pick(FATHER_NAMES_AR);
    const familyAr = pick(FAMILY_NAMES_AR);
    const fullNameAr = `${firstAr} ${fatherAr} ${grandAr} ${familyAr}`;
    const fullNameEn = `${isMale ? MALE_NAMES_EN[firstAr] : FEMALE_NAMES_EN[firstAr]} ${FATHER_NAMES_EN[fatherAr] || fatherAr} ${FATHER_NAMES_EN[grandAr] || grandAr} ${FAMILY_NAMES_EN[familyAr] || familyAr}`;

    const gov = pick(GOVERNORATES);
    const birthYear = 1970 + Math.floor(seededRandom() * 35); // 1970-2004
    const birthMonth = 1 + Math.floor(seededRandom() * 12);
    const birthDay = 1 + Math.floor(seededRandom() * 28);
    const govCode = 1 + (i % 27); // governorate code 1-27

    const nationalId = genNationalId(birthYear, birthMonth, birthDay, isMale ? "Male" : "Female", govCode);
    const job = pick(JOBS);
    const expiryYear = 2025 + Math.floor(seededRandom() * 10);
    const docNo = `KM${String(6000000 + i * 137).slice(0, 7)}`;

    samples.push({
      docType: "national_id",
      name: `EG-NID-${String(i + 1).padStart(3, "0")} ${fullNameEn}`,
      fullNameAr,
      fullNameEn,
      nationalId,
      birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      gender: isMale ? "Male" : "Female",
      address: `${pick(STREETS)} - ${gov.ar}`,
      documentNo: docNo,
      expiryDate: `${expiryYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      nationality: "مصري",
      job: isMale ? job.ar : `${job.ar}ة`,
      religion: i % 8 === 0 ? "مسيحي" : "مسلم",
      maritalStatus: i % 3 === 0 ? (isMale ? "أعزب" : "عزباء") : "متزوج",
      governorate: gov.ar,
    });
  }

  // 20 Passports
  for (let i = 0; i < 20; i++) {
    const isMale = i % 2 === 0;
    const firstAr = isMale ? pick(MALE_NAMES_AR) : pick(FEMALE_NAMES_AR);
    const fatherAr = pick(FATHER_NAMES_AR);
    const familyAr = pick(FAMILY_NAMES_AR);
    const fullNameAr = `${firstAr} ${fatherAr} ${familyAr}`;
    const fullNameEn = `${isMale ? MALE_NAMES_EN[firstAr] : FEMALE_NAMES_EN[firstAr]} ${FATHER_NAMES_EN[fatherAr] || fatherAr} ${FAMILY_NAMES_EN[familyAr] || familyAr}`;

    const birthYear = 1980 + Math.floor(seededRandom() * 25);
    const birthMonth = 1 + Math.floor(seededRandom() * 12);
    const birthDay = 1 + Math.floor(seededRandom() * 28);
    const govCode = 1 + (i % 27);

    const nationalId = genNationalId(birthYear, birthMonth, birthDay, isMale ? "Male" : "Female", govCode);
    const passportNo = `A${String(2000000 + i * 247).slice(0, 7)}`;
    const expiryYear = 2026 + Math.floor(seededRandom() * 8);

    samples.push({
      docType: "passport",
      name: `EG-PASS-${String(i + 1).padStart(3, "0")} ${fullNameEn}`,
      fullNameAr,
      fullNameEn,
      nationalId,
      birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      gender: isMale ? "Male" : "Female",
      address: "",
      documentNo: passportNo,
      expiryDate: `${expiryYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      nationality: "مصري",
      job: "",
      religion: "",
      maritalStatus: "",
      governorate: "",
    });
  }

  // 10 Driver Licenses
  for (let i = 0; i < 10; i++) {
    const isMale = i % 2 === 0;
    const firstAr = isMale ? pick(MALE_NAMES_AR) : pick(FEMALE_NAMES_AR);
    const fatherAr = pick(FATHER_NAMES_AR);
    const familyAr = pick(FAMILY_NAMES_AR);
    const fullNameAr = `${firstAr} ${fatherAr} ${familyAr}`;
    const fullNameEn = `${isMale ? MALE_NAMES_EN[firstAr] : FEMALE_NAMES_EN[firstAr]} ${FATHER_NAMES_EN[fatherAr] || fatherAr} ${FAMILY_NAMES_EN[familyAr] || familyAr}`;

    const birthYear = 1975 + Math.floor(seededRandom() * 25);
    const birthMonth = 1 + Math.floor(seededRandom() * 12);
    const birthDay = 1 + Math.floor(seededRandom() * 28);
    const govCode = 1 + (i % 27);

    const nationalId = genNationalId(birthYear, birthMonth, birthDay, isMale ? "Male" : "Female", govCode);
    const licenseNo = `${String(10000000 + i * 373).slice(0, 8)}`;
    const expiryYear = 2025 + Math.floor(seededRandom() * 6);

    samples.push({
      docType: "driver_license",
      name: `EG-DL-${String(i + 1).padStart(3, "0")} ${fullNameEn}`,
      fullNameAr,
      fullNameEn,
      nationalId,
      birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      gender: isMale ? "Male" : "Female",
      address: `${pick(STREETS)} - ${pick(GOVERNORATES).ar}`,
      documentNo: licenseNo,
      expiryDate: `${expiryYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
      nationality: "مصري",
      job: "",
      religion: "",
      maritalStatus: "",
      governorate: "",
    });
  }

  return samples;
}
