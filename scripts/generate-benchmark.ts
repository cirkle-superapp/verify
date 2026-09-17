import { renderDocImage } from "@/lib/doc-renderer";
import { TursoHttpClient } from "@/lib/turso-http-client";
import { neon } from "@neondatabase/serverless";

const turso = new TursoHttpClient({ url: "libsql://validate-fortleem.aws-us-east-2.turso.io", authToken: process.env.TURSO_TOKEN! });
const neonSql = neon("postgresql://neondb_owner:npg_3iB1acDHTPCt@ep-dry-bread-aum66qr0-pooler.c-10.us-east-1.aws.neon.tech/Cirkle-verify%20?sslmode=require");

const EG_FIRST_M = ["محمد","أحمد","محمود","مصطفى","علي","حسن","حسين","عبدالله","عبدالرحمن","خالد","إبراهيم","يوسف","عمر","كريم","طارق","وليد","سامح","هاني","عماد","أيمن","رامي","مروان","شريف","كمال","فؤاد","نبيل","سمير","ناصر","فاروق","صلاح","ماجد","جمال","حلمي","رفعت","زكي","عادل","غانم","فتحي","إسماعيل","سعيد","رشاد","بهاء","زياد","أشرف","مدحت","ثروت","عاطف","نادر","هشام","إيهاب","ياسر","مجدي","عصام","رمضان","سيف","بدر","فارس","حاتم"];
const EG_FIRST_F = ["فاطمة","عائشة","زينب","مريم","سارة","نورا","هبة","دعاء","إيمان","منى","ربى","آية","مها","هناء","سحر","وفاء","ليلى","ندى","بسمة","أمل","منار","رنا","دينا","شيرين","ميرنا","أحلام","سلمى","تسنيم","روان","جنى","ياسمين","تقى","رؤى","إسراء","أسماء","نهى","نور","تالا","ميرا","لين"];
const FATHERS = ["محمد","أحمد","عبدالله","عبدالرحمن","حسن","حسين","محمود","سيد","مصطفى","علي","إبراهيم","يوسف","عبدالعزيز","خالد","عبدالحميد","عبدالرؤوف","عبدالقادر","عبدالناصر","سليمان","رزق","عطية","غالي","سعد","نصر","حلمي","فؤاد","عبدالمجيد","عبدالحليم","عبدالستار","عبدالجواد"];
const FAMILIES = ["السيد","عبدالرحمن","المصري","حسن","أحمد","محمد","علي","إبراهيم","سليمان","عبدالله","الشناوي","الزيات","النجار","الحسيني","القاضي","الفقي","الشريف","الأمير","الغريب","عبدالعزيز","عبدالحميد","عبدالخالق","عبدالفتاح","عبدالرءوف","عبدالباري","عبدالجواد","عبدالحليم","عبدالكريم","عبداللطيف","عبدالهادي","عبدالرزاق","الشاعر","الديب","الصراف","البيطار","الحداد","الفلاح","العطار","الصباغ","الصيفي","الجندي","الحر","العمري","البكري","الشافعي","المالكي","الحنفي","الشاذلي","الأباصيري","الدسوقي","الرفاعي","البدوي","الزياني","المغربي","التونسي","الجزائري","الليبي","السوداني","المغربي","اليمني","اللبناني","الشامي","الحجازي","النجدي","العسيري","القحطاني","الغامدي"];
const GOVS = ["القاهرة","الجيزة","الإسكندرية","الدقهلية","الشرقية","القليوبية","المنوفية","الغربية","كفر الشيخ","البحيرة","الإسماعيلية","بورسعيد","السويس","الفيوم","بني سويف","المنيا","أسيوط","سوهاج","قنا","الأقصر","أسوان","البحر الأحمر","الوادي الجديد","مطروح","شمال سيناء","جنوب سيناء","دمياط"];
const JOBS = ["مهندس","طبيب","محاسب","محامي","معلم","صيدلي","موظف","تاجر","مبرمج","ممرض","حاصل على بكالوريوس صيدلة","حاصل على بكالوريوس طب","حاصل على بكالوريوس هندسة","كيميائي","فيزيائي","أستاذ جامعي","طبيب أسنان","طبيب بيطري","صحفي","مخرج","فنان","كاتب","شاعر","رسام","موسيقي","ممثل","مغني","رياضي","لاعب كرة","مدرب","حكم رياضي","إداري","مدير","رئيس قسم","نائب مدير","سكرتير","محلل","خبير","مستشار","مهندس استشاري","طبيب استشاري","جراح","أستاذ","دكتور","بروفيسور","باحث","عالم"];
const STREETS = ["شارع الجمهورية","شارع التحرير","شارع النيل","شارع عباس العقاد","شارع الأهرام","شارع المطارية","شارع المعز","شارع الصالحية","شارع الفاروق","شارع الناصر","شارع السلطان","شارع الملك","شارع الجمهورية","طريق النصر","كورنيش النيل","شارع الجلاء","شارع رمسيس","شارع الشهداء","شارع الثورة","شارع السلام"];

let seed = 77777;
function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
function pick<T>(a: T[]): T { return a[Math.floor(rand() * a.length)]; }

function genNid(y: number, m: number, d: number, male: boolean, gc: number): string {
  const c = y >= 2000 ? 3 : 2;
  const yy = String(y % 100).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const s = gc * 1000 + Math.floor(rand() * 900) + 100;
  const ser = male ? (s | 1) : (s & ~1);
  const ss = String(ser).padStart(7, "0");
  const id13 = `${c}${yy}${mm}${dd}${ss}`;
  return `${id13}${(parseInt(id13.slice(-1)) + 7) % 10}`;
}

async function main() {
  console.log("Generating 500 expanded Egyptian benchmark samples...\n");
  const samples: any[] = [];
  for (let i = 0; i < 500; i++) {
    const male = i % 2 === 0;
    const first = male ? pick(EG_FIRST_M) : pick(EG_FIRST_F);
    const father = pick(FATHERS);
    const grand = pick(FATHERS);
    const family = pick(FAMILIES);
    const name = `${first} ${father} ${grand} ${family}`;
    const gov = pick(GOVS);
    const by = 1965 + Math.floor(rand() * 45);
    const bm = 1 + Math.floor(rand() * 12);
    const bd = 1 + Math.floor(rand() * 28);
    const gc = 1 + (i % 27);
    const nid = genNid(by, bm, bd, male, gc);
    samples.push({
      docType: "national_id", name: `EG-${String(i + 1).padStart(3, "0")} ${name}`,
      fullNameAr: name, nationalId: nid,
      birthDate: `${by}-${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}`,
      gender: male ? "Male" : "Female",
      address: `${pick(STREETS)} - ${gov}`,
      documentNo: `KM${String(6000000 + i * 137).slice(0, 7)}`,
      expiryDate: `${2025 + Math.floor(rand() * 10)}-${String(bm).padStart(2, "0")}-${String(bd).padStart(2, "0")}`,
      nationality: "مصري", job: pick(JOBS),
      religion: i % 8 === 0 ? "مسيحي" : "مسلم",
      maritalStatus: i % 3 === 0 ? (male ? "أعزب" : "عزباء") : "متزوج",
    });
  }
  console.log(`✓ Generated ${samples.length} samples`);

  // Render images
  console.log("Rendering JPEG images...");
  for (const s of samples) {
    s.image = renderDocImage({
      fullNameAr: s.fullNameAr, nationalId: s.nationalId, birthDate: s.birthDate,
      gender: s.gender === "Male" ? "ذكر" : "أنثى", address: s.address, job: s.job,
      religion: s.religion, maritalStatus: s.maritalStatus, documentNo: s.documentNo,
      expiryDate: s.expiryDate, nationality: s.nationality,
      docType: "national_id", country: "EG", countryName: "Egypt / مصر",
    });
  }
  console.log(`✓ Rendered ${samples.length} images`);

  // Clear old data
  console.log("Clearing old training data on Turso + Neon...");
  try { await turso.execute("DELETE FROM DocumentSample WHERE source IN ('training','worldwide','synthetic','benchmark')"); } catch {}
  try { await neonSql`DELETE FROM "DocumentSample"`; } catch {}

  // Seed
  console.log(`Seeding ${samples.length} samples...`);
  let to = 0, no = 0;
  for (const s of samples) {
    const id = "bm_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const tags = JSON.stringify(["benchmark", "egyptian", "expanded"]);
    try {
      await turso.execute('INSERT INTO DocumentSample (id, name, "docType", source, "imageData", "fullNameAr", "nationalId", "birthDate", "address", "gender", "documentNo", "expiryDate", "nationality", "job", "religion", "maritalStatus", "notes", "tags", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, s.name, s.docType, "benchmark", s.image, s.fullNameAr, s.nationalId, s.birthDate, s.address, s.gender, s.documentNo, s.expiryDate, s.nationality, s.job, s.religion, s.maritalStatus, "Expanded benchmark", tags, new Date().toISOString(), new Date().toISOString()]);
      to++;
    } catch {}
    try {
      await neonSql`INSERT INTO "DocumentSample" (id, name, "docType", source, "imageData", "fullNameAr", "nationalId", "birthDate", "address", "gender", "documentNo", "expiryDate", "nationality", "job", "religion", "maritalStatus", "notes", "tags", "createdAt", "updatedAt") VALUES (${id}, ${s.name}, ${s.docType}, ${"benchmark"}, ${s.image}, ${s.fullNameAr}, ${s.nationalId}, ${s.birthDate}, ${s.address}, ${s.gender}, ${s.documentNo}, ${s.expiryDate}, ${s.nationality}, ${s.job}, ${s.religion}, ${s.maritalStatus}, ${"Expanded benchmark"}, ${tags}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
      no++;
    } catch {}
    if ((to + no) % 200 === 0 && to > 0) console.log(`  Turso: ${to}, Neon: ${no} / ${samples.length}`);
  }
  console.log(`\n✓ Turso: ${to}/${samples.length}`);
  console.log(`✓ Neon: ${no}/${samples.length}`);

  // Verify
  const tc = await turso.execute("SELECT COUNT(*) as n FROM DocumentSample");
  const nc = await neonSql`SELECT COUNT(*) as n FROM "DocumentSample"`;
  console.log(`\n=== FINAL ===`);
  console.log(`  Turso: ${(tc.rows[0] as any).n} samples`);
  console.log(`  Neon: ${nc[0].n} samples`);

  // Name diversity stats
  const names = new Set(samples.map(s => s.fullNameAr));
  console.log(`  Unique names: ${names.size}`);
  console.log(`  Unique first names: ${new Set(samples.map(s => s.fullNameAr.split(" ")[0])).size}`);
  console.log(`  Unique family names: ${new Set(samples.map(s => s.fullNameAr.split(" ").pop())).size}`);
  console.log(`  Governorates: ${new Set(samples.map(s => s.address.split(" - ")[1])).size}`);

  process.exit(0);
}
main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
