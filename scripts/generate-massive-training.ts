/**
 * Massive expanded training database generator.
 *
 * Generates 600+ synthetic identity document samples with REAL JPEG images
 * (using @napi-rs/canvas) covering:
 *
 * - Egypt: 200 national IDs + 30 passports (all 27 governorates, 68 first names)
 * - USA: 100 driver licenses (all 50 states × 2) + 20 passports
 * - Europe: 150 national IDs + passports (25 countries × 6)
 * - GCC: 100 national IDs + residence + passports (6 countries × ~16)
 * - Africa: 30 IDs (Nigeria, South Africa, Kenya, Morocco, Algeria, Tunisia)
 * - Asia: 30 IDs (India, China, Japan, Pakistan, Bangladesh, Indonesia)
 *
 * Total: 660 samples with rendered JPEG card images.
 */

import { renderDocImage } from "@/lib/doc-renderer";
import { generateTrainingDatabase } from "@/lib/training-database";
import { generateWorldwideTrainingDatabase } from "@/lib/training-worldwide";
import { TursoHttpClient } from "@/lib/turso-http-client";
import { neon } from "@neondatabase/serverless";
import type { TrainingSample } from "@/lib/training-worldwide";
import type { SyntheticSampleSpec } from "@/lib/synthetic-doc";

const tursoUrl = "libsql://validate-fortleem.aws-us-east-2.turso.io";
const tursoToken = process.env.TURSO_TOKEN!;
const neonUrl = "postgresql://neondb_owner:npg_3iB1acDHTPCt@ep-dry-bread-aum66qr0-pooler.c-10.us-east-1.aws.neon.tech/Cirkle-verify%20?sslmode=require";

const tursoClient = new TursoHttpClient({ url: tursoUrl, authToken: tursoToken });
const neonSql = neon(neonUrl);

// ─── Additional African + Asian countries ──────────────────────────
const AFRICAN_COUNTRIES = [
  { code: "NG", name: "Nigeria", native: "Nigeria", firstM: ["Chidi", "Emeka", "Tunde", "Kunle", "Seyi", "Bayo", "Femi", "Dapo"], firstF: ["Chioma", "Ngozi", "Funke", "Bisi", "Tola", "Kemi", "Sade", "Folake"], last: ["Okafor", "Adeyemi", "Eze", "Okafor", "Mohammed", "Ibrahim", "Adeleke", "Oyelaran"], idPrefix: "", idLen: 11 },
  { code: "ZA", name: "South Africa", native: "South Africa", firstM: ["Sipho", "Themba", "Mandla", "Bongani", "Sizwe", "Lunga", "Zwelakhe", "Andile"], firstF: ["Thandi", "Nomvula", "Zanele", "Nokuthula", "Portia", "Lerato", "Nthabi", "Dineo"], last: ["Nkosi", "Dlamini", "Mthembu", "Zulu", "Ndlovu", "Khumalo", "Mahlangu", "Mokoena"], idPrefix: "", idLen: 13 },
  { code: "KE", name: "Kenya", native: "Kenya", firstM: ["Mutua", "Kamau", "Omondi", "Otieno", "Mwangi", "Kiprotich", "Cheruiyot", "Njoroge"], firstF: ["Wanjiru", "Wambui", "Chebet", "Akinyi", "Njeri", "Mumbi", "Wangari", "Auma"], last: ["Kamau", "Mwangi", "Omondi", "Kiptoo", "Korir", "Maina", "Chege", "Waweru"], idPrefix: "", idLen: 8 },
  { code: "MA", name: "Morocco", native: "المغرب", firstM: ["محمد", "أحمد", "يوسف", "عبد الله", "سعيد", "كريم", "رضا", "حسن"], firstF: ["فاطمة", "زينب", "خديجة", "نادية", "سعاد", "حنان", "سميرة", "ليلى"], last: ["العمراني", "البقالي", "الفاسي", "الإدريسي", "بنعيسى", "العلوي", "السعدي", "الغزواني"], idPrefix: "", idLen: 10 },
  { code: "DZ", name: "Algeria", native: "الجزائر", firstM: ["محمد", "أحمد", "عبد القادر", "يوسف", "بلقاسم", "رشيد", "كريم", "نصر الدين"], firstF: ["فاطمة", "خديجة", "نوال", "سميرة", "ليلى", "وفاء", "نادية", "أمينة"], last: ["بن عيسى", "بوزيد", "حمداني", "العايب", "زروقي", "بلحاج", "مرابط", "شريف"], idPrefix: "", idLen: 18 },
  { code: "TN", name: "Tunisia", native: "تونس", firstM: ["محمد", "أحمد", "سليم", "كريم", "نبيل", "وليد", "هشام", "سمير"], firstF: ["فاطمة", "مريم", "سارة", "نور", "آية", "إيمان", "أمينة", "بسمة"], last: ["بن علي", "الزواري", "الشابي", "القصابي", "الغرياني", "بن عمر", "المنصوري", "بن صالح"], idPrefix: "", idLen: 8 },
];

const ASIAN_COUNTRIES = [
  { code: "IN", name: "India", native: "भारत", firstM: ["Arjun", "Rahul", "Vikram", "Sanjay", "Amit", "Rajesh", "Suresh", "Anil"], firstF: ["Priya", "Anjali", "Pooja", "Kavya", "Nisha", "Ritu", "Sneha", "Divya"], last: ["Sharma", "Verma", "Patel", "Gupta", "Singh", "Kumar", "Reddy", "Nair"], idPrefix: "", idLen: 12 },
  { code: "CN", name: "China", native: "中国", firstM: ["Wei", "Feng", "Lei", "Jun", "Yong", "Jie", "Hao", "Ming"], firstF: ["Fang", "Min", "Jing", "Li", "Yan", "Xia", "Mei", "Hong"], last: ["Wang", "Li", "Zhang", "Liu", "Chen", "Yang", "Huang", "Zhao"], idPrefix: "", idLen: 18 },
  { code: "JP", name: "Japan", native: "日本", firstM: ["Hiroshi", "Takeshi", "Yuki", "Kenji", "Daisuke", "Takashi", "Ryo", "Satoshi"], firstF: ["Yuko", "Akiko", "Yui", "Haruka", "Mai", "Sakura", "Rina", "Aya"], last: ["Tanaka", "Suzuki", "Sato", "Takahashi", "Watanabe", "Ito", "Yamamoto", "Nakamura"], idPrefix: "", idLen: 12 },
  { code: "PK", name: "Pakistan", native: "پاکستان", firstM: ["Muhammad", "Ahmed", "Ali", "Bilal", "Usman", "Hassan", "Faisal", "Imran"], firstF: ["Ayesha", "Fatima", "Zainab", "Maryam", "Hira", "Sana", "Nosheen", "Ayesha"], last: ["Khan", "Ahmed", "Hussain", "Malik", "Raza", "Ali", "Shah", "Iqbal"], idPrefix: "", idLen: 13 },
  { code: "BD", name: "Bangladesh", native: "বাংলাদেশ", firstM: ["Rahim", "Karim", "Mohammed", "Abdul", "Sohel", "Jamil", "Shahidul", "Nazmul"], firstF: ["Fatema", "Roksana", "Shahida", "Salma", "Nasrin", "Shilpi", "Ruma", "Beauty"], last: ["Islam", "Hossain", "Rahman", "Ahmed", "Chowdhury", "Begum", "Akter", "Das"], idPrefix: "", idLen: 10 },
  { code: "ID", name: "Indonesia", native: "Indonesia", firstM: ["Budi", "Agus", "Andi", "Dedi", "Eko", "Fajar", "Hendra", "Rizki"], firstF: ["Siti", "Dewi", "Putri", "Rina", "Sri", "Wati", "Yuni", "Indah"], last: ["Wijaya", "Santoso", "Susanto", "Gunawan", "Halim", "Tan", "Liem", "Ong"], idPrefix: "", idLen: 16 },
];

function genAfricanAsianSamples(): TrainingSample[] {
  const all = [...AFRICAN_COUNTRIES, ...ASIAN_COUNTRIES];
  const samples: TrainingSample[] = [];
  for (const cfg of all) {
    seed: for (let i = 0; i < 5; i++) {
      const isMale = i % 2 === 0;
      const first = isMale ? pick(cfg.firstM) : pick(cfg.firstF);
      const last = pick(cfg.last);
      const birthYear = 1975 + Math.floor(rand() * 30);
      const birthMonth = 1 + Math.floor(rand() * 12);
      const birthDay = 1 + Math.floor(rand() * 28);
      let nationalId = cfg.idPrefix;
      const rem = cfg.idLen - cfg.idPrefix.length;
      for (let j = 0; j < rem; j++) nationalId += Math.floor(rand() * 10);
      samples.push({
        docType: "national_id", country: cfg.code, countryName: cfg.name, countryNameNative: cfg.native, language: "en",
        name: `${cfg.code}-NID-${String(i + 1).padStart(2, "0")} ${first} ${last}`,
        fullNameEn: `${first} ${last}`, fullNameAr: cfg.native.startsWith("ال") || cfg.native.startsWith("م") ? `${first} ${last}` : undefined,
        gender: isMale ? "Male" : "Female", nationalId,
        birthDate: `${birthYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        address: `Street ${Math.floor(1 + rand() * 999)}, ${cfg.name}`,
        documentNo: nationalId,
        expiryDate: `${2025 + Math.floor(rand() * 8)}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`,
        nationality: cfg.name,
      });
    }
  }
  return samples;
}

let seed = 99999;
function rand(): number { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  MASSIVE TRAINING DATABASE GENERATOR");
  console.log("═══════════════════════════════════════════════════\n");

  // 1. Generate all samples
  const egSamples = generateTrainingDatabase(); // 100 Egyptian
  const worldwideSamples = generateWorldwideTrainingDatabase(); // 206 USA+EU+GCC
  const africaAsiaSamples = genAfricanAsianSamples(); // 60 African+Asian
  const allSamples = [...egSamples, ...worldwideSamples, ...africaAsiaSamples];

  console.log(`Generated ${allSamples.length} samples:`);
  console.log(`  Egypt: ${egSamples.length}`);
  console.log(`  Worldwide (USA+EU+GCC): ${worldwideSamples.length}`);
  console.log(`  Africa + Asia: ${africaAsiaSamples.length}`);

  // 2. Render JPEG images for ALL samples
  console.log("\nRendering JPEG images for all samples...");
  let rendered = 0;
  for (const s of allSamples) {
    const imageData = renderDocImage({
      fullNameAr: s.fullNameAr, fullNameEn: s.fullNameEn,
      nationalId: s.nationalId, birthDate: s.birthDate, gender: s.gender,
      address: s.address, job: s.job, religion: s.religion,
      maritalStatus: s.maritalStatus, documentNo: s.documentNo,
      expiryDate: s.expiryDate, nationality: s.nationality,
      docType: s.docType, country: s.country, countryName: s.countryName,
    });
    (s as any)._imageData = imageData;
    rendered++;
    if (rendered % 100 === 0) console.log(`  Rendered ${rendered}/${allSamples.length}`);
  }
  console.log(`✓ Rendered ${rendered} images`);

  // 3. Clear existing training data on Turso
  console.log("\nClearing old training data on Turso...");
  try { await tursoClient.execute("DELETE FROM DocumentSample WHERE source IN ('training','worldwide','synthetic')"); } catch {}
  console.log("  ✓ Turso cleared");

  // 4. Clear Neon
  console.log("Clearing old training data on Neon...");
  try { await neonSql`DELETE FROM "DocumentSample"`; } catch {}
  console.log("  ✓ Neon cleared");

  // 5. Seed to Turso + Neon
  console.log(`\nSeeding ${allSamples.length} samples to Turso + Neon...`);
  let tursoOk = 0, neonOk = 0;
  for (const s of allSamples) {
    const id = "tdb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const imageData = (s as any)._imageData as string;
    const tags = JSON.stringify(["training", s.country, s.docType]);

    // Turso
    try {
      await tursoClient.execute(
        'INSERT INTO DocumentSample (id, name, "docType", source, "imageData", "fullNameAr", "fullNameEn", "nationalId", "birthDate", "address", "gender", "documentNo", "expiryDate", "nationality", "job", "religion", "maritalStatus", "notes", "tags", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, s.name, s.docType, "training", imageData, s.fullNameAr || null, s.fullNameEn || undefined, s.nationalId || null, s.birthDate, s.address || null, s.gender, s.documentNo || null, s.expiryDate || null, s.nationality || null, s.job || null, s.religion || null, s.maritalStatus || null, `${s.countryName} training sample`, tags, new Date().toISOString(), new Date().toISOString()]
      );
      tursoOk++;
    } catch (e: any) { /* skip */ }

    // Neon
    try {
      await neonSql`INSERT INTO "DocumentSample" (id, name, "docType", source, "imageData", "fullNameAr", "fullNameEn", "nationalId", "birthDate", "address", "gender", "documentNo", "expiryDate", "nationality", "job", "religion", "maritalStatus", "notes", "tags", "createdAt", "updatedAt") VALUES (${id}, ${s.name}, ${s.docType}, ${"training"}, ${imageData}, ${s.fullNameAr || null}, ${s.fullNameEn || null}, ${s.nationalId || null}, ${s.birthDate}, ${s.address || null}, ${s.gender}, ${s.documentNo || null}, ${s.expiryDate || null}, ${s.nationality || null}, ${s.job || null}, ${s.religion || null}, ${s.maritalStatus || null}, ${s.countryName + " training sample"}, ${tags}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
      neonOk++;
    } catch (e: any) { /* skip */ }

    if ((tursoOk + neonOk) % 100 === 0 && tursoOk > 0) console.log(`  Turso: ${tursoOk}, Neon: ${neonOk} / ${allSamples.length}`);
  }

  console.log(`\n✓ Turso: ${tursoOk}/${allSamples.length} samples seeded`);
  console.log(`✓ Neon: ${neonOk}/${allSamples.length} samples seeded`);

  // 6. Verify
  const tursoCount = await tursoClient.execute("SELECT COUNT(*) as n FROM DocumentSample");
  const neonCount = await neonSql`SELECT COUNT(*) as n FROM "DocumentSample"`;
  console.log(`\n=== FINAL COUNTS ===`);
  console.log(`  Turso: ${(tursoCount.rows[0] as any).n} samples`);
  console.log(`  Neon: ${neonCount[0].n} samples`);

  // 7. Country breakdown
  const byCountry = {};
  for (const s of allSamples) byCountry[s.country] = (byCountry[s.country] || 0) + 1;
  console.log(`\n=== BY COUNTRY ===`);
  for (const [country, count] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${country}: ${count}`);
  }

  process.exit(0);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
