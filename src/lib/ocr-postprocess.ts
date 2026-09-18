/**
 * OCR Post-Processing Engine.
 *
 * Corrects common OCR errors using:
 *   1. Levenshtein distance against known vocabularies (Arabic names, country names, field labels)
 *   2. Country-specific name dictionaries (most common names per region)
 *   3. Common OCR confusion patterns (0↔O, 1↔l/I, 5↔S, 8↔B, etc.)
 *   4. Field label normalization (الاسم → fullNameAr, الرقم القومي → nationalId, etc.)
 *   5. Digit extraction and cleanup (remove spaces/dashes from IDs)
 *
 * This runs AFTER the AI consensus extraction, before cross-field validation.
 * It catches errors that even multi-provider consensus might agree on
 * (e.g., all 3 vision providers misread "محمد" as "محماد" — Levenshtein
 * corrects it back to the canonical form).
 */

import { stringSimilarity } from "@/lib/ai-consensus";

// ─── Common Arabic names (for Levenshtein correction) ────────────
// Covers male + female given names and family (tribal/regional) surnames from
// across the Arab world: Egypt, Gulf (KSA, UAE, Kuwait, Qatar, Bahrain, Oman),
// Levant (Jordan, Palestine, Lebanon, Syria), Iraq, Yemen, Sudan, Maghreb
// (Morocco, Algeria, Tunisia, Libya). The combined Set deduplicates entries.
const ARABIC_MALE_NAMES = [
  // Existing core set
  "محمد", "أحمد", "عبدالله", "عبدالرحمن", "خالد", "عمر", "يوسف", "إبراهيم", "علي", "حسن",
  "كريم", "سعيد", "ناصر", "فهد", "ماجد", "طارق", "وليد", "زياد", "بدر", "سلمان",
  "صلاح", "مصطفى", "رضا", "عماد", "فواز", "هاني", "ياسر", "أيمن", "إسلام", "حمزة",
  "زيد", "صبري", "عبدالعزيز", "عبدالحميد", "عبدالقادر", "عبدالكريم", "عبدالمجيد",
  "عبدالناصر", "عبدالهادي", "عبدالوهاب", "عز الدين", "فاروق", "فيصل", "كمال", "ليث",
  "ماهر", "مجدي", "منصف", "منير", "نبيل", "نزار", "هشام", "وحيد", "يحيى", "يونس",
  // Extended — additional common Arabic male names across the Arab world
  "برهان", "جمال", "جاسم", "حاتم", "حبيب", "خيري", "درويش", "راشد", "ربيع", "زاهر",
  "زكريا", "سعد", "سعود", "سيف", "شريف", "صالح", "صقر", "ضياء", "عادل", "عامر",
  "عثمان", "عزيز", "عصام", "عفيف", "عوض", "غسان", "فاخر", "فخري", "فراس", "فؤاد",
  "قاسم", "كاظم", "كنانة", "لؤي", "مازن", "متعب", "مختار", "مدحت", "مراد", "مروان",
  "مسلم", "مصعب", "معاذ", "موسى", "نوري", "هارون", "هزاع", "واصف", "وسام", "وفائي",
  "يعقوب", "يسري", "أنس", "أسامة", "أنور", "إياد", "بلال", "بكر", "ثابت", "ثامر",
  "جابر", "جعفر", "حارث", "حارس", "حذيفة", "خليل", "داوود", "ذياب", "رأفت", "راغب",
  "رامي", "رشاد", "رشيد", "رفعت", "رياض", "زهير", "زين", "سرحان", "سرمد", "سليم",
  "سمير", "سهل", "سهيل", "شادي", "شاكر", "شاهين", "شعبان", "شهاب", "صهيب", "طالب",
  "طلعت", "طه", "عارف", "عباس", "عبدالباقي", "عبدالجليل", "عبدالحفيظ", "عبدالحق",
  "عبدالرؤوف", "عبدالرسول", "عبدالسميع", "عبدالشكور", "عبدالصمد", "عبدالعليم",
  "عبدالغفور", "عبدالفتاح", "عبدالقوي", "عبداللطيف", "عبدالمؤمن", "عبدالمحسن",
  "عبدالنور", "عبدالواحد", "عبدربه", "عرفات", "عروة", "عزمي", "عطا", "عطية", "عوف",
  "غانم", "غازي", "فائق", "فتحي", "فهمي", "قيس", "كامل", "لبيب", "لطفي", "مأمون",
  "مرسي", "مشاري", "مشعل", "معتصم", "مقدام", "منصور", "ممدوح", "مهدي", "مهند",
  "نائل", "ناجي", "نشأت", "نعيم", "نعمان", "هادي", "هاشم", "هلال", "همام", "وهيب",
  "يمان", "حسام", "حليم", "حكيم", "خيرالله", "سامي", "سلطان", "شجاع", "عاصم",
  "عبدالباري", "فوزي", "قائد", "مكرم", "ملهم", "نواف", "هيثم", "ياسين", "بسام",
  "تامر", "غالب", "نديم",
];

const ARABIC_FEMALE_NAMES = [
  // Existing core set
  "فاطمة", "عائشة", "نورة", "سارة", "هند", "ريم", "ليلى", "مريم", "سمية", "نادية",
  "هالة", "منى", "دانة", "أمل", "أسماء", "زينب", "رقية", "صفية", "خديجة", "حواء",
  "عبير", "بثينة", "جمانة", "دعاء", "رنا", "روان", "سلمى", "شيماء", "علا", "غادة",
  "لمى", "ميرا", "وفاء", "ياسمين", "آية", "بسمة", "تالا", "جنى", "حبيبة",
  // Extended — additional common Arabic female names
  "آلاء", "أجوان", "أروى", "أسيل", "أشواق", "إصالة", "أماني", "أمينة", "إيمان",
  "بشرى", "تماضر", "ثريا", "جواهر", "حلا", "حورية", "خلد", "رامة", "رميا", "ريماس",
  "زهرة", "سنا", "شادية", "شهد", "صبا", "عالية", "عهد", "غيداء", "كوثر", "لجين",
  "ميس", "ميسان", "ناردين", "نوال", "نور", "هنادي", "وعد", "وردة", "يسرى",
  "أفنان", "ألين", "أمنية", "إنتصار", "إسراء", "بيسان", "تالين", "تهاني", "جنان",
  "حصة", "خلود", "رؤى", "رابعة", "رزان", "رشا", "رغد", "رفيف", "رنيم", "رواء",
  "رودينا", "روزانا", "ريما", "زاهية", "زبيدة", "زكية", "زهيرة", "زينة", "سارية",
  "سلمة", "سلسبيل", "سما", "سماح", "سامية", "سناء", "سهر", "سهام", "سوسن", "سيما",
  "شذا", "شذى", "شريفة", "شيرين", "صفا", "ضحى", "عبلة", "عرب", "غالية", "غدير",
  "فاديا", "فدوى", "فرح", "فريدة", "فريال", "فيروز", "قمر", "قمرية", "كبرى",
  "كريمة", "لبنى", "لطيفة", "لميس", "ليان", "لين", "لينة", "ماريتا", "ماريا",
  "مزنة", "ملك", "منة", "منال", "مها", "ميساء", "ميسون", "نائلة", "نبراس", "نجاة",
  "نجاح", "نجلاء", "نجوى", "ندى", "نرمين", "نسرين", "نسمة", "نضال", "نعمة", "نوار",
  "نوران", "نيفين", "هدى", "هديل", "هيفاء", "وئام", "ولاء", "يارا", "يسرا",
  "آمنة", "أفراح", "ألهام", "إخلاص", "بيان", "جود", "حياة", "راما", "ريتا",
];

const ARABIC_SURNAMES = [
  // Existing core set — Saudi tribal + Arab nationalities
  "القحطاني", "العتيبي", "الغامدي", "الزهراني", "الحربي", "المطيري", "الدوسري",
  "الشهري", "البلوي", "الحازمي", "السيد", "الجزايري", "المغربي", "التونسي",
  "المصري", "الشامي", "العراقي", "اللبناني", "الأردني", "السوداني", "الليبي",
  "اليمني", "العماني", "القطري", "البحريني", "الكويتي", "الإماراتي",
  // Extended — Gulf tribal surnames (KSA, UAE, Kuwait, Qatar, Bahrain, Oman)
  "الشمري", "العنزي", "البقمي", "السبيعي", "العسيري", "القرني", "المالكي",
  "اليامي", "الأنصاري", "المهاجر", "الحسيني", "البخاري", "النووي", "الصديق",
  "العبيدي", "الجبوري", "التميمي", "الدليمي", "الزيدي", "العامري", "الساعدي",
  "الموسوي", "الكاظمي", "النصيري", "الحمداني", "الراوي", "العزاوي", "الرشيد",
  "الخالدي", "العمري", "الناصري", "المهيزع", "الكواري", "الفهيد", "العلي",
  "الزعبي", "الحوراني", "الحديدي", "الرفاعي", "الشجري", "الهاجري", "البريكي",
  "الكعبي", "الفلاسي", "المرزوقي", "الحسون", "النعيمي", "الفلاجي", "الشطي",
  "الجارالله", "السالم", "السالمي", "القنيعب", "الماضي", "القضاة", "الحجايا",
  "الزغبي", "الياسين",
  // Extended — Levant (Palestine, Jordan, Lebanon, Syria)
  "الفلسطيني", "السوري", "السعودي", "العشماوي", "الشافعي", "البكري", "الصاوي",
  "الجندي", "الحلبي", "البيانوني", "الحمصي", "الدمشقي", "الطرابلسي", "الصيداوي",
  "البيروتي", "النابلسي", "الخليلي", "القدسي", "الجولاوي", "العاملي", "الهرري",
  "الخطيب", "الصباغ", "العبدالله", "الراشد", "الحدّاد", "الزيات", "النجار",
  "العطار", "الجزار", "الخراز", "الكواز", "الحلاق", "الفقي", "الشاعر", "الأديب",
  "الكاتب", "النقيب", "الطيار", "الحسام", "العش", "العدّاس",
  // Extended — Maghreb (Morocco, Algeria, Tunisia, Libya)
  "الأندلسي", "الفاسي", "المكناسي", "الرباطي", "البيضاوي", "الحسني", "الإدريسي",
  "العلوي", "السباعي", "الوزاني", "الفهري",
  // Extended — Iraq
  "الجنابي", "الشمراني", "الكردي", "الطائي", "الأنباري", "الموصللي", "البصري",
  "البقاري", "الكاشف", "الزبير", "المهدي", "الميرغني", "الشريف", "النور",
  // Extended — Yemen
  "الإرياني", "المقطري", "المخلافي", "الزبيري", "الإبي", "الأهدل", "باعباد",
  "باذيب",
  // Extended — Arabic-origin common family names (without definite article)
  "عبدالصبور", "عبدالعزيز", "عبدالرحمن", "عبدالكريم", "عبدالحليم", "عبدالرزاق",
  "عبدالجليل", "عبدالخالق", "عبدالمجيد", "عبدالجواد", "عبدالحفيظ", "عبدالستار",
  "عبدالمطلب", "عبدالحق", "عبدالرؤوف", "عبدالسميع", "عبدالشكور", "عبدالصمد",
  "عبدالعليم", "عبدالغفور", "عبدالفتاح", "عبدالقوي", "عبداللطيف", "عبدالمؤمن",
  "عبدالنور", "عبدالواحد", "شعبان", "رمضان", "سليمان", "حسين", "إبراهيم",
  "عثمان", "زكريا", "ياسين", "حمزة", "صالح", "إسماعيل", "داوود", "يوسف",
  "محمود", "مصطفى", "أحمد", "محمد", "علي", "حسن", "حامد", "سعيد", "فؤاد",
  "فاروق", "نبيل", "هاني", "عماد", "أيمن", "وائل", "وليد", "محسن", "مختار",
  "مرسي", "بكري", "الحصري",
];

export const ARABIC_NAME_DICTIONARY = new Set<string>([
  ...ARABIC_MALE_NAMES,
  ...ARABIC_FEMALE_NAMES,
  ...ARABIC_SURNAMES,
]);

/**
 * Normalize Arabic alef/hamza variants to bare alef for alef-insensitive
 * matching. Used by `correctNameField` to map OCR output with the wrong alef
 * variant (e.g., "آحمد" with madda, "احمد" with bare alef) back to the
 * canonical diacritized dictionary form ("أحمد" with hamza above).
 *
 * Only alef variants are normalized — ة, ى, ؤ, ئ are left alone (they're
 * already handled by `applyConfusionPatterns`).
 */
function normalizeArabicAlef(s: string): string {
  return s
    .replace(/\u0623/g, "\u0627") // أ (alef hamza above) → ا
    .replace(/\u0625/g, "\u0627") // إ (alef hamza below) → ا
    .replace(/\u0622/g, "\u0627") // آ (alef madda) → ا
    .replace(/\u0621/g, "\u0627"); // ء (standalone hamza) → ا
}

// Precomputed map: normalized Arabic name → diacritized form (first wins on
// collisions). Used for alef/hamza-insensitive lookup in `correctNameField`
// before falling back to Levenshtein.
const ARABIC_NAME_DICTIONARY_NORMALIZED: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const name of ARABIC_NAME_DICTIONARY) {
    const normalized = normalizeArabicAlef(name);
    if (!m.has(normalized)) {
      m.set(normalized, name);
    }
  }
  return m;
})();

// ─── Common Western names (for English field correction) ──────────
const WESTERN_NAMES = [
  "James", "John", "Robert", "Michael", "William", "David", "Thomas", "Daniel",
  "Andrew", "Christopher", "Liam", "Noah", "Lucas", "Mason", "Ethan", "Logan",
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Susan", "Karen",
  "Nancy", "Lisa", "Sarah", "Emma", "Olivia", "Sophia", "Isabella",
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson",
  // Common Arabic-origin names transliterated to English (prevent false corrections)
  "Mohamed", "Mohammad", "Muhammad", "Ahmed", "Ahmad", "Ali", "Hassan", "Hussein",
  "Hussain", "Ibrahim", "Omar", "Yusuf", "Yousef", "Yousuf", "Ismail",
  "Salah", "Salaheddin", "Khaled", "Khalid", "Tarek", "Tariq", "Karim",
  "Kareem", "Nabil", "Amir", "Ameer", "Rami", "Ramy", "Sami", "Samer",
  "Wael", "Hany", "Hani", "Aymen", "Ayman", "Islam", "Eslam", "Shadi",
  "Mahmoud", "Mostafa", "Mustafa", "Moustafa", "Rashad", "Rifaat",
  "Talaat", "Farouk", "Faisal", "Fayez", "Maged", "Majed", "Walid", "Waleed",
  "Ziad", "Bilal", "Said", "Saeed", "Saber", "Sabry",
  "Adel", "Adeel", "Akram", "Assem", "Asem", "Ehab", "Emad", "Amal",
  "Iman", "Hala", "Huda", "Mona", "Maha", "Dina", "Dalia",
  "Reem", "Rania", "Ranya", "Heba", "Hiba", "Nour", "Noor", "Yara",
  "Farah", "Lina", "Linaa", "Maya", "Mirna", "Nada", "Nagham", "Rita",
  "Rola", "Sara", "Serene", "Sherine", "Zahra", "Aya", "Aisha",
  "Ayesha", "Fatma", "Fatima", "Khadija", "Khadeeja", "Maryam", "Mariam",
  "Asmaa", "Asma", "Eman", "Mervat", "Nawal", "Sahar",
  "Souad", "Suad", "Wafa", "Wala", "Yasmine", "Yasmin",
  // Common surnames (Arabic-origin in English)
  "El-Sayed", "ElSayed", "Ghonem", "Ghanem", "Mansour", "Nasser",
  "Naser", "Abbas", "Saleh", "Salem", "Shalan",
  "Tawfik", "Tawfiq", "Zaki", "Zakaria", "Abdullah", "Abdallah",
  "Abdul", "Abd El-Rahman", "Abdelrahman", "Abdulrahman", "Abdulaziz",
  "Abdulkareem", "Abdul Kareem", "Abdulhamid", "Abd El-Hamid",
  // Extended — additional common English / European names found on passports
  "Benjamin", "Henry", "Jack", "Samuel", "Joseph", "Charles", "Matthew",
  "Anthony", "Mark", "Donald", "Steven", "Paul", "Joshua", "Kenneth", "Kevin",
  "Brian", "George", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan",
  "Jacob", "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin",
  "Scott", "Brandon", "Gregory", "Frank", "Alexander", "Tyler", "Aaron", "Adam",
  "Zachary", "Patrick", "Victor", "Christian", "Douglas", "Peter", "Dennis",
  "Jerry", "Bruce", "Ralph", "Roy", "Eugene", "Wayne", "Vincent", "Philip",
  "Harry", "Albert", "Johnny", "Willie", "Lawrence", "Terry",
  "Sean", "Jesse", "Dylan", "Owen", "Jose", "Jesus",
  "Barbara", "Shirley", "Angela", "Helen", "Sandra", "Nicole", "Emily",
  "Rachel", "Catherine", "Virginia", "Deborah", "Jane", "Ann", "Tiffany",
  "Jenna", "Maria", "Betty", "Ruth", "Sharon", "Michelle", "Laura", "Kimberly",
  "Carolyn", "Marie", "Janet", "Beverly", "Katherine", "Christine", "Lauren",
  "Hannah", "Samantha", "Diane", "Julie", "Joyce", "Victoria", "Kelly", "Rebecca",
  "Andrea", "Megan", "Donna", "Carol", "Martha", "Heather",
  // Extended — European male names (French, Italian, Spanish, German, Nordic, Slavic)
  "Pierre", "Jean", "Michel", "Philippe", "Andre", "Marco", "Giovanni",
  "Antonio", "Giuseppe", "Sergio", "Hans", "Franz", "Josef", "Lars", "Sven",
  "Anders", "Bjorn", "Nikolai", "Vladimir", "Dimitri", "Mikhail", "Sergei",
  "Igor", "Pavel", "Piotr", "Tomas", "Carlos", "Miguel", "Manuel",
  "Diego", "Alejandro", "Joaquin", "Hernan", "Thiago", "Bruno", "Mateo",
  "Santiago", "Francois", "Louis", "Felipe", "Roberto", "Massimo",
  // Extended — European female names
  "Sophie", "Margaret", "Anne", "Claire", "Julia", "Anna", "Marta", "Elena",
  "Cristina", "Francesca", "Giovanna", "Sofia", "Lena", "Helga", "Ingrid",
  "Astrid", "Nina", "Olga", "Tatiana", "Anastasia", "Irena", "Mila", "Nadia",
  "Lucia", "Beatrice", "Eva", "Lara", "Mia", "Lola", "Carmen", "Isabel",
  // Extended — additional Arabic-origin surnames in English
  "Al-Qahtani", "Al-Otaibi", "Al-Ghamdi", "Al-Harbi", "Al-Mutairi", "Al-Dosari",
  "Al-Shehri", "Al-Balawi", "Al-Ansari", "Al-Hashimi", "Al-Husseini", "Al-Bukhari",
  "Al-Nawawi", "Al-Siddiq", "Al-Obaidi", "Al-Jubouri", "Al-Tamimi", "Al-Dulaimi",
  "Al-Zaidi", "Al-Amri", "Al-Saadi", "Al-Mousawi", "Al-Kadhimi", "Al-Maliki",
  "Al-Yamani", "Al-Qarni", "Al-Subaie", "Al-Asiri", "Al-Shammari", "Al-Anzi",
  "Al-Baqmi", "Al-Mansouri", "Al-Rashid", "Al-Saud", "Al-Nahyan", "Al-Thani",
  "Al-Sabah", "Al-Khalifa", "Al-Said", "Al-Junaidi", "Al-Rifai"
];

const WESTERN_NAME_DICTIONARY = new Set(WESTERN_NAMES);

// ─── Country names (Arabic + English) ─────────────────────────────
const COUNTRY_NAMES_AR = [
  "مصر", "السعودية", "الإمارات", "الكويت", "قطر", "الأردن", "المغرب", "تونس",
  "الجزائر", "لبنان", "العراق", "سوريا", "ليبيا", "السودان", "البحرين", "عمان",
  "اليمن", "فلسطين", "تركيا", "إيران", "الولايات المتحدة", "المملكة المتحدة",
  "فرنسا", "ألمانيا", "إسبانيا", "إيطاليا", "هولندا", "بلجيكا", "السويد", "النرويج",
];

const COUNTRY_NAMES_EN = [
  "Egypt", "Saudi Arabia", "United Arab Emirates", "Kuwait", "Qatar", "Jordan",
  "Morocco", "Tunisia", "Algeria", "Lebanon", "Iraq", "Syria", "Libya", "Sudan",
  "Bahrain", "Oman", "Yemen", "Palestine", "Türkiye", "Iran", "United States",
  "United Kingdom", "France", "Germany", "Spain", "Italy", "Netherlands",
  "Belgium", "Sweden", "Norway",
];

// ─── Field labels (for label→field mapping) ──────────────────────
const FIELD_LABELS: { label: string; field: string; lang: "ar" | "en" }[] = [
  { label: "الاسم", field: "fullNameAr", lang: "ar" },
  { label: "الاسم رباعي", field: "fullNameAr", lang: "ar" },
  { label: "الرقم القومي", field: "nationalId", lang: "ar" },
  { label: "تاريخ الميلاد", field: "birthDate", lang: "ar" },
  { label: "النوع", field: "gender", lang: "ar" },
  { label: "الجنسية", field: "nationality", lang: "ar" },
  { label: "الديانة", field: "religion", lang: "ar" },
  { label: "الوظيفة", field: "job", lang: "ar" },
  { label: "العنوان", field: "address", lang: "ar" },
  { label: "الحالة الاجتماعية", field: "maritalStatus", lang: "ar" },
  { label: "Name", field: "fullNameEn", lang: "en" },
  { label: "National ID", field: "nationalId", lang: "en" },
  { label: "Date of Birth", field: "birthDate", lang: "en" },
  { label: "Gender", field: "gender", lang: "en" },
  { label: "Nationality", field: "nationality", lang: "en" },
  { label: "Expiry", field: "expiryDate", lang: "en" },
  { label: "Document No", field: "documentNo", lang: "en" },
];

// ─── Comprehensive field-label patterns (Arabic + English) ──────────
// Maps each normalized field name to the list of field-label strings that
// may precede it in raw OCR output (either Arabic or English). Used by
// `extractFieldByLabel` to slice a value out of the raw OCR text. Within
// each field, longer/more-specific labels come first so they win the
// regex alternation (e.g., "Date of Birth" before "DOB").
export const FIELD_LABEL_PATTERNS: Record<string, { label: string; lang: "ar" | "en" }[]> = {
  fullNameAr: [
    { label: "الاسم رباعي", lang: "ar" },
    { label: "الاسم الكامل", lang: "ar" },
    { label: "الاسم", lang: "ar" },
    { label: "اسم رباعي", lang: "ar" },
    { label: "اسم", lang: "ar" },
  ],
  fullNameEn: [
    { label: "Holder's Name", lang: "en" },
    { label: "Full Name", lang: "en" },
    { label: "Given Names", lang: "en" },
    { label: "Surname", lang: "en" },
    { label: "Name", lang: "en" },
  ],
  nationalId: [
    { label: "الرقم القومي", lang: "ar" },
    { label: "الرقم القوم", lang: "ar" },
    { label: "رقم البطاقة", lang: "ar" },
    { label: "رقم الهوية", lang: "ar" },
    { label: "Identity Number", lang: "en" },
    { label: "Identity No", lang: "en" },
    { label: "National ID", lang: "en" },
    { label: "ID Number", lang: "en" },
    { label: "ID No", lang: "en" },
    { label: "Personal No", lang: "en" },
  ],
  birthDate: [
    { label: "تاريخ الميلاد", lang: "ar" },
    { label: "الميلاد", lang: "ar" },
    { label: "Date of Birth", lang: "en" },
    { label: "Birth Date", lang: "en" },
    { label: "DOB", lang: "en" },
  ],
  nationality: [
    { label: "الجنسية", lang: "ar" },
    { label: "Nationality", lang: "en" },
  ],
  gender: [
    { label: "النوع", lang: "ar" },
    { label: "الجنس", lang: "ar" },
    { label: "Sex", lang: "en" },
    { label: "Gender", lang: "en" },
  ],
  birthPlace: [
    { label: "محل الميلاد", lang: "ar" },
    { label: "مكان الميلاد", lang: "ar" },
    { label: "Place of Birth", lang: "en" },
    { label: "Birth Place", lang: "en" },
  ],
  serialNumber: [
    { label: "الرقم التسلسلي", lang: "ar" },
    { label: "Serial Number", lang: "en" },
    { label: "Serial No", lang: "en" },
  ],
  issueDate: [
    { label: "تاريخ الإصدار", lang: "ar" },
    { label: "الإصدار", lang: "ar" },
    { label: "Date of Issue", lang: "en" },
    { label: "Issue Date", lang: "en" },
  ],
  expiryDate: [
    { label: "تاريخ الانتهاء", lang: "ar" },
    { label: "الانتهاء", lang: "ar" },
    { label: "المدة", lang: "ar" },
    { label: "Date of Expiry", lang: "en" },
    { label: "Date of Expiration", lang: "en" },
    { label: "Expiry Date", lang: "en" },
    { label: "Expiration Date", lang: "en" },
    { label: "Expiry", lang: "en" },
    { label: "Expiration", lang: "en" },
  ],
  issuePlace: [
    { label: "جهة الإصدار", lang: "ar" },
    { label: "مكان الإصدار", lang: "ar" },
    { label: "Issuing Authority", lang: "en" },
    { label: "Place of Issue", lang: "en" },
    { label: "Authority", lang: "en" },
  ],
  documentNo: [
    { label: "رقم الجواز", lang: "ar" },
    { label: "رقم الوثيقة", lang: "ar" },
    { label: "Passport No", lang: "en" },
    { label: "Document No", lang: "en" },
    { label: "Doc No", lang: "en" },
  ],
  religion: [
    { label: "الديانة", lang: "ar" },
    { label: "Religion", lang: "en" },
  ],
  job: [
    { label: "الوظيفة", lang: "ar" },
    { label: "Profession", lang: "en" },
    { label: "Occupation", lang: "en" },
  ],
  address: [
    { label: "العنوان", lang: "ar" },
    { label: "Address", lang: "en" },
  ],
  maritalStatus: [
    { label: "الحالة الاجتماعية", lang: "ar" },
    { label: "Marital Status", lang: "en" },
  ],
};

// ─── Comprehensive OCR confusion patterns ───────────────────────────
// Map of frequently-confused character pairs (bidirectional). Covers both
// Latin digit↔letter and letter↔letter confusions plus Arabic letter↔letter
// confusions common in low-resolution OCR of ID cards, passports, and other
// identity documents. The map is a reference of known confusions; the
// `applyConfusionPatterns` function below applies only the asymmetric,
// conservative subset (e.g., alef/hamza normalization in Arabic, rn→m /
// vv→w in Latin). Levenshtein-based correctors (`closestMatch`,
// `correctNameField`) handle the symmetric pairs implicitly via edit
// distance (e.g., ت↔ث, س↔ش, ص↔ض each contribute 1 to the distance).
export const OCR_CONFUSION_MAP: Record<string, string[]> = {
  // ── Latin: digit ↔ letter confusions ──
  "0": ["O", "D", "Q"],
  "O": ["0", "D", "Q"],
  "D": ["0", "O"],
  "Q": ["0", "O"],
  "1": ["l", "I", "|", "i"],
  "l": ["1", "I", "|"],
  "I": ["1", "l", "|"],
  "i": ["1", "l"],
  "|": ["1", "l", "I"],
  "5": ["S", "s"],
  "S": ["5", "s"],
  "s": ["5", "S"],
  "8": ["B"],
  "B": ["8"],
  "2": ["Z"],
  "Z": ["2"],
  "6": ["G"],
  "G": ["6"],
  "4": ["A"],
  "A": ["4"],
  "9": ["g", "q"],
  "g": ["9", "q"],
  "q": ["9", "g"],

  // ── Latin: multi-character letter ↔ letter confusions ──
  "rn": ["m"],
  "m": ["rn"],
  "vv": ["w"],
  "w": ["vv"],
  "cl": ["d"],
  "d": ["cl"],
  "ni": ["m"],
  "IJ": ["U"],
  "U": ["IJ"],

  // ── Arabic: alef / hamza variants ──
  "ا": ["ل", "أ", "إ", "آ", "ى", "ء"],
  "ل": ["ا", "ك"],
  "أ": ["ا", "إ", "آ"],
  "إ": ["ا", "أ", "آ"],
  "آ": ["ا", "أ", "إ"],
  "ى": ["ي", "ا"],
  "ي": ["ى", "ئ"],
  "ء": ["ا"],

  // ── Arabic: ta-marbuta / ha / ta ──
  "ة": ["ه", "ت"],
  "ه": ["ة"],
  "ت": ["ث", "ة", "ن"],
  "ث": ["ت"],

  // ── Arabic: dotted / undotted letter pairs ──
  "د": ["ذ"],
  "ذ": ["د"],
  "ر": ["ز"],
  "ز": ["ر"],
  "س": ["ش"],
  "ش": ["س"],
  "ص": ["ض"],
  "ض": ["ص"],
  "ط": ["ظ"],
  "ظ": ["ط"],
  "ع": ["غ"],
  "غ": ["ع"],
  "ف": ["ق"],
  "ق": ["ف"],
  "ك": ["ل"],
  "م": ["ن"],
  "ن": ["م", "ت"],

  // ── Arabic: waw / ya with hamza ──
  "و": ["ؤ"],
  "ؤ": ["و", "ئ"],
  "ئ": ["ؤ", "ي"],
};

// ─── Levenshtein distance ─────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

/** Find closest match in a dictionary using Levenshtein distance. */
function closestMatch(
  input: string,
  dictionary: Iterable<string>,
  maxDistance: number = 2,
): { match: string; distance: number } | null {
  let best: { match: string; distance: number } | null = null;
  for (const word of dictionary) {
    if (word.length < 2) continue;
    const d = levenshtein(input, word);
    if (!best || d < best.distance) {
      best = { match: word, distance: d };
      if (d === 0) break; // exact match
    }
  }
  if (best && best.distance <= maxDistance) return best;
  return null;
}

/** Escape a literal string for safe use as a regex pattern source. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── OCR confusion-pattern application ───────────────────────────

/**
 * Apply OCR confusion patterns to clean common OCR errors in a text value.
 *
 * Arabic: applies conservative Arabic NLP normalizations that are
 *   asymmetric and meaning-preserving — ta-marbuta → ha (ة → ه),
 *   alif-maqsura → ya (ى → ي), waw-hamza → waw (ؤ → و), ya-hamza → ya
 *   (ئ → ي). Alef/hamza variants (أ, إ, آ, ء) are intentionally NOT
 *   normalized to bare alef because (a) the Levenshtein-based
 *   `correctNameField` already handles them as distance-1 substitutions,
 *   and (b) normalizing them would erase the dictionary's ability to
 *   distinguish "أحمد" (closer to "أحمد" than to "محمد") from "احمد"
 *   (equidistant between "أحمد" and "محمد"). The symmetric Arabic letter
 *   pairs (ت↔ث, س↔ش, ص↔ض, etc.) are also NOT applied here — they are
 *   handled implicitly via Levenshtein in `correctNameField`, since
 *   applying them blindly would corrupt valid Arabic words.
 *
 * Latin: applies multi-character visual confusions (rn→m, vv→w, cl→d,
 *   IJ→U, ni→m). Single-character digit↔letter conversions are
 *   intentionally NOT applied here — they are handled by `cleanIdField`
 *   (for numeric IDs) and `correctDigits` (for country-specific ID
 *   correction) where the surrounding context (numeric vs. alphanumeric)
 *   is known. This prevents false corrections like "Osama" → "0sama".
 *
 * The function is idempotent — applying it twice yields the same result
 * as applying it once.
 */
export function applyConfusionPatterns(text: string, isArabic: boolean): string {
  if (!text) return text;

  if (isArabic) {
    // Conservative Arabic letter normalization (asymmetric, meaning-preserving).
    // Note: alef/hamza variants (أ, إ, آ, ء) are intentionally preserved so the
    // Levenshtein corrector in correctNameField can match the diacritized
    // dictionary entries directly (e.g., "آحمد" → "أحمد" distance 1, NOT
    // "محمد" distance 1).
    return text
      .replace(/\u0629/g, "\u0647") // ة (ta marbuta) → ه
      .replace(/\u0649/g, "\u064A") // ى (alif maqsura) → ي
      .replace(/\u0624/g, "\u0648") // ؤ (waw hamza) → و
      .replace(/\u0626/g, "\u064A"); // ئ (ya hamza) → ي
  }

  // Latin — apply multi-character letter↔letter visual confusions only.
  // Single-character digit↔letter conversions are intentionally NOT applied
  // here; they are handled by `cleanIdField` (for numeric IDs) and
  // `correctDigits` (for country-specific ID correction) where the
  // surrounding context (numeric vs. alphanumeric) is known.
  return text
    .replace(/rn/g, "m")
    .replace(/vv/g, "w")
    .replace(/cl/g, "d")
    .replace(/IJ/g, "U")
    .replace(/ni/g, "m");
}

// ─── Country-specific digit correction ────────────────────────────

/**
 * Compute the Egyptian national-ID checksum. The Egyptian national ID
 * (14 digits) uses a weighted-sum mod-11 check digit at position 13:
 *   sum = Σ (digit[i] * (i + 1)) for i = 0..12
 *   expectedCheck = (11 - (sum % 11)) % 11
 *   valid when expectedCheck === checkDigit OR (sum % 11) === checkDigit
 *
 * (Mirrors the algorithm in `validateEgyptianId` in `src/lib/id-validators.ts`.)
 */
function egyptianIdChecksumValid(id: string): boolean {
  if (id.length !== 14 || !/^\d{14}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(id[i], 10) * (i + 1);
  }
  const expectedCheck = (11 - (sum % 11)) % 11;
  const check = parseInt(id[13], 10);
  return expectedCheck === check || (sum % 11) === check;
}

/**
 * Validate the structural fields of a 14-digit Egyptian national ID:
 *   - 14 digits total
 *   - Century digit (first char) is "2" or "3"
 *   - Year (chars 1–2) is 00–99
 *   - Month (chars 3–4) is 01–12
 *   - Day (chars 5–6) is 01–31
 *   - Governorate code (chars 7–8) is in range 01–88
 *   - Serial + check digit (chars 9–14) is any digits
 *
 * When `requireChecksum` is true, also verifies the mod-11 checksum digit.
 */
function isValidEgyptianId(id: string, requireChecksum = false): boolean {
  if (id.length !== 14 || !/^\d{14}$/.test(id)) return false;
  const century = id[0];
  if (century !== "2" && century !== "3") return false;
  const year = parseInt(id.slice(1, 3), 10);
  const month = parseInt(id.slice(3, 5), 10);
  const day = parseInt(id.slice(5, 7), 10);
  if (year < 0 || year > 99) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Governorate code: Egyptian IDs use 01–35 (with some larger codes for
  // expat issuance). Allow 01–88 for safety.
  const gov = parseInt(id.slice(7, 9), 10);
  if (gov < 1 || gov > 88) return false;
  if (requireChecksum) {
    return egyptianIdChecksumValid(id);
  }
  return true;
}

/**
 * Try to repair an Egyptian national ID whose length is 13 or 15 by
 * inserting/removing a single digit at every position. Returns the first
 * candidate that passes both structural validation AND the mod-11
 * checksum, or — if no checksum-valid candidate exists — the first
 * structurally-valid candidate, or null if no candidate works.
 *
 * The checksum-first pass yields the highest-confidence fix; the
 * structural-only fallback handles the case where the OCR corruption
 * affected the check digit itself (so no repaired candidate can have a
 * valid checksum).
 */
function fixEgyptianIdLength(id: string): string | null {
  const allDigits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

  // First pass: require BOTH structural validity AND checksum validity.
  if (id.length === 13) {
    for (const ch of allDigits) {
      for (let i = 0; i <= id.length; i++) {
        const candidate = id.slice(0, i) + ch + id.slice(i);
        if (isValidEgyptianId(candidate, true)) return candidate;
      }
    }
  }
  if (id.length === 15) {
    for (let i = 0; i < id.length; i++) {
      const candidate = id.slice(0, i) + id.slice(i + 1);
      if (isValidEgyptianId(candidate, true)) return candidate;
    }
  }

  // Second pass: fall back to structural-validity only.
  if (id.length === 13) {
    for (const ch of allDigits) {
      for (let i = 0; i <= id.length; i++) {
        const candidate = id.slice(0, i) + ch + id.slice(i);
        if (isValidEgyptianId(candidate, false)) return candidate;
      }
    }
  }
  if (id.length === 15) {
    for (let i = 0; i < id.length; i++) {
      const candidate = id.slice(0, i) + id.slice(i + 1);
      if (isValidEgyptianId(candidate, false)) return candidate;
    }
  }
  return null;
}

/**
 * Fix an IBAN's check digits: preserve the 2-letter country code at the
 * start and ensure the 2 check digits (positions 2–3) are numeric,
 * converting common letter-digit confusions (O→0, I→1, etc.) inside the
 * check-digit positions only. The remainder of the IBAN (BBAN portion) is
 * left untouched because its interpretation is country-specific.
 */
function fixIban(iban: string): string {
  if (iban.length < 22 || iban.length > 34) return iban;
  if (!/^[A-Z]{2}/.test(iban)) return iban;

  // Fix the 2 check digits (positions 2-3) in the digit direction.
  let checkDigits = iban.slice(2, 4);
  checkDigits = checkDigits
    .replace(/[OoDQ]/g, "0")
    .replace(/[Iil|]/g, "1")
    .replace(/S/g, "5")
    .replace(/s/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/G/g, "6")
    .replace(/A/g, "4")
    .replace(/[gq]/g, "9");

  // If still non-numeric, return the original IBAN (avoid guessing).
  if (!/^\d{2}$/.test(checkDigits)) return iban;

  return iban.slice(0, 2) + checkDigits + iban.slice(4);
}

/**
 * Fix a passport number's letter-digit confusions while preserving the
 * leading 1–2 country-code letters (which are conventionally alphabetic).
 */
function fixPassportDigits(passport: string): string {
  // Determine country-code prefix length: leading letters, up to 2.
  const leadingMatch = passport.match(/^[A-Z]+/);
  const prefixLen = leadingMatch ? Math.min(leadingMatch[0].length, 2) : 0;
  const prefix = passport.slice(0, prefixLen);
  const rest = passport.slice(prefixLen);

  const fixed = rest
    .replace(/[OoDQ]/g, "0")
    .replace(/[Iil|]/g, "1")
    .replace(/S/g, "5")
    .replace(/s/g, "5")
    .replace(/B/g, "8")
    .replace(/Z/g, "2")
    .replace(/G/g, "6")
    .replace(/A/g, "4")
    .replace(/[gq]/g, "9");

  return prefix + fixed;
}

/**
 * Correct common OCR digit errors in ID numbers based on country-specific
 * structural rules.
 *
 * - Egyptian national IDs (14 digits, country = "eg"): if the cleaned
 *   length is 13 or 15, attempt to insert/remove a confused digit and
 *   pick the first candidate that passes Egyptian-ID structural validation
 *   (century digit is 2 or 3, month is 01–12, day is 01–31, governorate
 *   is 01–88).
 *
 * - IBANs (length 22–34): preserve the 2-letter country code at the start
 *   and ensure the 2 check digits are numeric, converting common
 *   letter-digit confusions (O→0, I→1, etc.) inside the check-digit
 *   positions only.
 *
 * - Passport numbers (8–9 alphanumeric chars, uppercase): preserve the
 *   leading 1–2 country-code letters and convert obvious letter-digit
 *   confusions (O→0, I→1, S→5, B→8, Z→2, G→6, A→4, D→0, Q→0, g→9,
 *   q→9) in the remainder.
 *
 * The function is conservative: if no candidate passes validation, the
 * original (whitespace-stripped) value is returned unchanged.
 */
export function correctDigits(id: string, country?: string): string {
  if (!id) return id;

  // Strip whitespace, dashes, dots, slashes
  const cleaned = id.replace(/[\s\-./]/g, "");

  const isEgyptian = Boolean(country) && country!.toLowerCase() === "eg";

  // Egyptian national ID — try length repair if off by one digit.
  if (isEgyptian && /^\d{13,15}$/.test(cleaned) && cleaned.length !== 14) {
    const fixed = fixEgyptianIdLength(cleaned);
    if (fixed) return fixed;
  }
  if (isEgyptian && /^\d{14}$/.test(cleaned)) {
    return cleaned; // already valid length
  }

  // IBAN — ensure country code + numeric check digits.
  if (/^[A-Z]{2}.{2,32}$/.test(cleaned) && cleaned.length >= 22 && cleaned.length <= 34) {
    return fixIban(cleaned);
  }

  // Passport number (8–9 alphanumeric, uppercase) — fix letter-digit
  // confusions in the value while preserving the country-code prefix.
  if (cleaned.length >= 8 && cleaned.length <= 9 && /^[A-Za-z0-9]+$/.test(cleaned)) {
    return fixPassportDigits(cleaned.toUpperCase());
  }

  return cleaned;
}

// ─── Field extraction by label ────────────────────────────────────

/**
 * Extract a specific field value from raw OCR text by matching one of its
 * known field labels (from `FIELD_LABEL_PATTERNS`) in either the Arabic or
 * English text.
 *
 * For each label pattern (in declared order), searches the corresponding
 * language text for the label followed by optional whitespace/colons (incl.
 * newlines, so the value may live on the next line), then captures the
 * value up to end-of-line. The captured value is then trimmed at the
 * start of the next known field label (so values that run into the next
 * field are cleanly cut off).
 *
 * Returns the first non-empty match found across all label patterns for
 * the field, or undefined if no match.
 *
 * Example:
 *   extractFieldByLabel(
 *     "الرقم القومي: 29501010123456\nالاسم: محمد أحمد",
 *     "",
 *     "nationalId",
 *   ) → "29501010123456"
 */
export function extractFieldByLabel(
  arabicText: string,
  englishText: string,
  fieldName: string,
): string | undefined {
  const patterns = FIELD_LABEL_PATTERNS[fieldName];
  if (!patterns || patterns.length === 0) return undefined;

  // Collect all known labels across all fields to use as stop tokens
  // (so a captured value that runs into the next field is cleanly cut off).
  // Sort by length descending so longer labels are tried first in the
  // alternation — avoids "Date" matching the prefix of "Date of Birth".
  const allLabels: string[] = [];
  for (const fieldPatterns of Object.values(FIELD_LABEL_PATTERNS)) {
    for (const { label } of fieldPatterns) {
      const trimmed = label.trim();
      if (trimmed.length >= 2) allLabels.push(trimmed);
    }
  }
  // De-duplicate (case-sensitive)
  const uniqueLabels = Array.from(new Set(allLabels));
  uniqueLabels.sort((a, b) => b.length - a.length);
  const stopPattern = uniqueLabels.map(escapeRegex).join("|");

  for (const { label, lang } of patterns) {
    const text = lang === "ar" ? arabicText : englishText;
    if (!text) continue;

    const escapedLabel = escapeRegex(label.trim());
    // Match: label, optional whitespace/colons (incl. newlines), then capture
    // value up to end of line.
    const re = new RegExp(
      `${escapedLabel}[\\s\\u00A0:：]*([^\\n\\r]+)`,
      lang === "ar" ? "" : "i",
    );
    const match = text.match(re);
    if (match && match[1]) {
      let value = match[1].trim();
      // Trim the value at the first occurrence of any known stop label.
      if (stopPattern) {
        const stopRe = new RegExp(
          `(?:${stopPattern})[\\s\\u00A0:：]*`,
          lang === "ar" ? "" : "i",
        );
        const stopMatch = value.match(stopRe);
        if (stopMatch && stopMatch.index !== undefined) {
          value = value.slice(0, stopMatch.index).trim();
        }
      }
      if (value.length > 0) return value;
    }
  }
  return undefined;
}

// ─── Public API ──────────────────────────────────────────────────

export interface OcrCorrectionResult {
  original: string;
  corrected: string;
  changed: boolean;
  corrections: { original: string; corrected: string; reason: string }[];
}

/**
 * Correct a name field using the appropriate dictionary.
 * - Arabic names: corrects against ARABIC_NAME_DICTIONARY
 * - English names: corrects against WESTERN_NAME_DICTIONARY
 *
 * Each token (word) in the name is corrected independently.
 * Arabic names: maxDistance=2 (dictionary is comprehensive, 600+ entries covering
 *   male + female given names and surnames from across the Arab world)
 * English names: maxDistance=1 (conservative — English has more valid variations,
 *   and false corrections like "Salah"→"Sarah" would be worse than no correction)
 */
export function correctNameField(name: string, isArabic: boolean): OcrCorrectionResult {
  if (!name || name.trim().length === 0) {
    return { original: name, corrected: name, changed: false, corrections: [] };
  }

  const dictionary = isArabic ? ARABIC_NAME_DICTIONARY : WESTERN_NAME_DICTIONARY;
  const maxDistance = isArabic ? 2 : 1; // English: conservative (distance 1 only)
  const tokens = name.trim().split(/\s+/);
  const corrections: { original: string; corrected: string; reason: string }[] = [];
  const correctedTokens: string[] = [];

  for (const token of tokens) {
    if (token.length < 2) {
      correctedTokens.push(token);
      continue;
    }

    // Skip if token is already in dictionary (exact match)
    if (dictionary.has(token)) {
      correctedTokens.push(token);
      continue;
    }

    // For Arabic: try alef/hamza-insensitive lookup by normalizing both the
    // input token and the dictionary entries. This catches OCR errors where
    // the wrong alef variant was emitted (e.g., "آحمد" with madda → "أحمد"
    // with hamza above), which would otherwise be ambiguous between multiple
    // distance-1 Levenshtein candidates.
    if (isArabic) {
      const normalizedToken = normalizeArabicAlef(token);
      const alefInsensitiveMatch = ARABIC_NAME_DICTIONARY_NORMALIZED.get(normalizedToken);
      if (alefInsensitiveMatch && alefInsensitiveMatch !== token) {
        correctedTokens.push(alefInsensitiveMatch);
        corrections.push({
          original: token,
          corrected: alefInsensitiveMatch,
          reason: "Alef/hamza-insensitive dictionary match (normalized alef variants)",
        });
        continue;
      }
    }

    // Find closest match (English: distance 1 only, Arabic: distance 2)
    const match = closestMatch(token, dictionary, maxDistance);
    if (match && match.distance > 0 && match.distance <= maxDistance) {
      correctedTokens.push(match.match);
      corrections.push({
        original: token,
        corrected: match.match,
        reason: `Levenshtein distance ${match.distance} → closest dictionary match`,
      });
    } else {
      correctedTokens.push(token); // keep original if no good match
    }
  }

  const corrected = correctedTokens.join(" ");
  return {
    original: name,
    corrected,
    changed: corrected !== name,
    corrections,
  };
}

/**
 * Clean a national ID / document number:
 *   - Remove spaces, dashes, dots
 *   - Keep only digits (and letters for passport numbers)
 *   - Correct common OCR confusions (O→0, l→1, etc.) for digit-only IDs
 */
export function cleanIdField(id: string, isNumeric: boolean = true): OcrCorrectionResult {
  if (!id) return { original: id, corrected: id, changed: false, corrections: [] };

  const corrections: { original: string; corrected: string; reason: string }[] = [];
  let cleaned = id;

  // Remove spaces, dashes, dots, slashes
  const noSpaces = cleaned.replace(/[\s\-./]/g, "");
  if (noSpaces !== cleaned) {
    corrections.push({
      original: cleaned,
      corrected: noSpaces,
      reason: "Removed spaces/dashes/dots/slashes",
    });
    cleaned = noSpaces;
  }

  if (isNumeric) {
    // Correct common OCR confusions for digit-only IDs
    let corrected = "";
    let hadConfusion = false;
    for (const ch of cleaned) {
      if (/[0-9]/.test(ch)) {
        corrected += ch;
      } else {
        // Try to correct: O→0, l→1, S→5, B→8, Z→2, G→6, etc.
        const upper = ch.toUpperCase();
        const mapped =
          upper === "O" ? "0" :
          upper === "l" || upper === "I" || upper === "|" ? "1" :
          upper === "S" ? "5" :
          upper === "B" ? "8" :
          upper === "Z" ? "2" :
          upper === "G" ? "6" :
          upper === "D" ? "0" :
          upper === "Q" ? "0" :
          null;
        if (mapped !== null) {
          corrected += mapped;
          hadConfusion = true;
        }
        // else: drop the character (non-digit, non-correctable)
      }
    }
    if (hadConfusion && corrected !== cleaned) {
      corrections.push({
        original: cleaned,
        corrected,
        reason: "Corrected OCR confusions (O→0, l→1, S→5, B→8, etc.)",
      });
      cleaned = corrected;
    }
  } else {
    // Passport: keep alphanumerics, uppercase
    const alnum = cleaned.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    if (alnum !== cleaned) {
      corrections.push({
        original: cleaned,
        corrected: alnum,
        reason: "Uppercased + removed non-alphanumeric chars",
      });
      cleaned = alnum;
    }
  }

  return {
    original: id,
    corrected: cleaned,
    changed: cleaned !== id,
    corrections,
  };
}

/**
 * Correct a country name (Arabic or English) using the country dictionary.
 */
export function correctCountryName(name: string): OcrCorrectionResult {
  if (!name || name.trim().length === 0) {
    return { original: name, corrected: name, changed: false, corrections: [] };
  }

  const isArabic = /[\u0600-\u06FF]/.test(name);
  const dictionary = isArabic ? COUNTRY_NAMES_AR : COUNTRY_NAMES_EN;
  const match = closestMatch(name.trim(), dictionary, 3);

  if (match && match.distance > 0 && match.distance <= 3) {
    return {
      original: name,
      corrected: match.match,
      changed: true,
      corrections: [{
        original: name,
        corrected: match.match,
        reason: `Levenshtein distance ${match.distance} → closest country match`,
      }],
    };
  }

  return { original: name, corrected: name, changed: false, corrections: [] };
}

/**
 * Strip a field label from a value.
 * E.g., "الاسم: محمد صلاح" → "محمد صلاح"
 *        "National ID: 29501010123456" → "29501010123456"
 */
export function stripFieldLabel(value: string): string {
  if (!value) return value;
  for (const { label } of FIELD_LABELS) {
    if (value.startsWith(label)) {
      return value.slice(label.length).replace(/^[\s:：]+\s*/, "").trim();
    }
  }
  return value;
}

/**
 * Full OCR post-processing pipeline for a single extracted field.
 * Runs: label strip → OCR confusion-pattern application → ID cleaning (if ID)
 * → name correction (if name)
 *
 * The confusion-pattern step applies conservative Arabic letter normalization
 * (alef/hamza variants, ta-marbuta→ha, etc.) for values that contain Arabic
 * Unicode characters, and Latin multi-character visual confusions
 * (rn→m, vv→w, cl→d, IJ→U, ni→m) otherwise. It is skipped for ID / document
 * numbers so that `cleanIdField` (and `correctDigits` when called explicitly)
 * can handle digit↔letter conversions with full knowledge of the surrounding
 * numeric/alphanumeric context.
 */
export function postProcessField(
  field: string,
  value: string,
): OcrCorrectionResult {
  if (!value) return { original: value, corrected: value, changed: false, corrections: [] };

  // Step 1: strip label
  const stripped = stripFieldLabel(value);
  let result = stripped;
  const corrections: { original: string; corrected: string; reason: string }[] = [];
  if (stripped !== value) {
    corrections.push({ original: value, corrected: stripped, reason: "Stripped field label" });
  }

  // Step 1.5: apply OCR confusion patterns for non-ID fields. Detect Arabic
  // vs Latin script by checking for Arabic Unicode characters in the value.
  // For pure-ID fields (nationalId, documentNo) we skip this step so the
  // digit↔letter conversions remain under the control of cleanIdField /
  // correctDigits where the numeric/alphanumeric context is known.
  const isIdField = field === "nationalId" || field === "documentNo";
  if (!isIdField) {
    const isArabicField = /[\u0600-\u06FF]/.test(result);
    const confusionFixed = applyConfusionPatterns(result, isArabicField);
    if (confusionFixed !== result) {
      corrections.push({
        original: result,
        corrected: confusionFixed,
        reason: "Applied OCR confusion patterns (alef/hamza normalization for Arabic, rn→m / vv→w / cl→d for Latin)",
      });
      result = confusionFixed;
    }
  }

  // Step 2: field-specific correction
  if (field === "nationalId") {
    const idResult = cleanIdField(result, true);
    if (idResult.changed) {
      result = idResult.corrected;
      corrections.push(...idResult.corrections);
    }
  } else if (field === "documentNo") {
    const docResult = cleanIdField(result, false);
    if (docResult.changed) {
      result = docResult.corrected;
      corrections.push(...docResult.corrections);
    }
  } else if (field === "fullNameAr" || field === "fullNameEn") {
    const nameResult = correctNameField(result, field === "fullNameAr");
    if (nameResult.changed) {
      result = nameResult.corrected;
      corrections.push(...nameResult.corrections);
    }
  } else if (field === "nationality") {
    const countryResult = correctCountryName(result);
    if (countryResult.changed) {
      result = countryResult.corrected;
      corrections.push(...countryResult.corrections);
    }
  }

  return {
    original: value,
    corrected: result,
    changed: result !== value,
    corrections,
  };
}

/**
 * Post-process ALL extracted document fields at once.
 * Returns a map of field → OcrCorrectionResult.
 */
export function postProcessExtractedFields(fields: Record<string, string | undefined>): Record<string, OcrCorrectionResult> {
  const results: Record<string, OcrCorrectionResult> = {};
  for (const [field, value] of Object.entries(fields)) {
    if (value) {
      results[field] = postProcessField(field, value);
    }
  }
  return results;
}

/** Apply corrections and return the cleaned field map. */
export function applyCorrections(fields: Record<string, string | undefined>): Record<string, string | undefined> {
  const corrected: Record<string, string | undefined> = {};
  const postProcess = postProcessExtractedFields(fields);
  for (const [field, result] of Object.entries(postProcess)) {
    corrected[field] = result.corrected;
  }
  return corrected;
}
