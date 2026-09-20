import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * CORS headers — synthetic-data endpoint is cross-origin accessible.
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * OPTIONS /api/v1/verify/synthetic-data
 * Cross-origin preflight — responds 204 No Content.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ─── Seedable PRNG (mulberry32) ──────────────────────────────────────────
//
// Deterministic per-seed RNG so callers can reproduce training runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [lo, hi] inclusive. */
function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

/** Pick a random element from an array. */
function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Random base36 alphanumeric string of given length. */
function randomAlpha(rng: () => number, len: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(rng() * chars.length)];
  return out;
}

// ─── Country subset (73 in Python; here a representative 30) ──────────────
//
// The Python script's full 73-country table is in
// training/synthetic_generator.py. This endpoint ships a representative
// subset (MENA + EU + Americas + Asia-Pacific) — the Python pipeline
// is the canonical source for full 73-country coverage.

interface CountrySpec {
  alpha3: string;
  name: string;
  region: string;
  script: "arabic" | "latin";
  id_format: "luhn" | "iso7064_11_2" | "generic_numeric";
  id_len: number;
  id_prefix?: string;
}

const COUNTRIES: CountrySpec[] = [
  { alpha3: "EGY", name: "Egypt", region: "MENA", script: "arabic", id_format: "generic_numeric", id_len: 14 },
  { alpha3: "SAU", name: "Saudi Arabia", region: "MENA", script: "arabic", id_format: "generic_numeric", id_len: 10 },
  { alpha3: "ARE", name: "United Arab Emirates", region: "MENA", script: "arabic", id_format: "generic_numeric", id_len: 15 },
  { alpha3: "JOR", name: "Jordan", region: "MENA", script: "arabic", id_format: "generic_numeric", id_len: 10 },
  { alpha3: "MAR", name: "Morocco", region: "MENA", script: "arabic", id_format: "generic_numeric", id_len: 9 },
  { alpha3: "TUR", name: "Turkey", region: "MENA", script: "latin", id_format: "luhn", id_len: 11 },
  { alpha3: "ISR", name: "Israel", region: "MENA", script: "latin", id_format: "luhn", id_len: 9 },
  { alpha3: "USA", name: "United States", region: "NA", script: "latin", id_format: "luhn", id_len: 9 },
  { alpha3: "GBR", name: "United Kingdom", region: "EU", script: "latin", id_format: "generic_numeric", id_len: 9, id_prefix: "AB" },
  { alpha3: "FRA", name: "France", region: "EU", script: "latin", id_format: "iso7064_11_2", id_len: 15 },
  { alpha3: "DEU", name: "Germany", region: "EU", script: "latin", id_format: "iso7064_11_2", id_len: 10 },
  { alpha3: "ESP", name: "Spain", region: "EU", script: "latin", id_format: "luhn", id_len: 9 },
  { alpha3: "ITA", name: "Italy", region: "EU", script: "latin", id_format: "luhn", id_len: 10 },
  { alpha3: "NLD", name: "Netherlands", region: "EU", script: "latin", id_format: "iso7064_11_2", id_len: 9 },
  { alpha3: "BEL", name: "Belgium", region: "EU", script: "latin", id_format: "iso7064_11_2", id_len: 11 },
  { alpha3: "SWE", name: "Sweden", region: "EU", script: "latin", id_format: "luhn", id_len: 10 },
  { alpha3: "NOR", name: "Norway", region: "EU", script: "latin", id_format: "iso7064_11_2", id_len: 11 },
  { alpha3: "DNK", name: "Denmark", region: "EU", script: "latin", id_format: "luhn", id_len: 10 },
  { alpha3: "POL", name: "Poland", region: "EU", script: "latin", id_format: "iso7064_11_2", id_len: 11 },
  { alpha3: "CZE", name: "Czech Republic", region: "EU", script: "latin", id_format: "luhn", id_len: 10 },
  { alpha3: "BGR", name: "Bulgaria", region: "EU", script: "latin", id_format: "luhn", id_len: 10 },
  { alpha3: "CHE", name: "Switzerland", region: "EU", script: "latin", id_format: "generic_numeric", id_len: 13 },
  { alpha3: "AUT", name: "Austria", region: "EU", script: "latin", id_format: "generic_numeric", id_len: 9 },
  { alpha3: "BRA", name: "Brazil", region: "Americas", script: "latin", id_format: "luhn", id_len: 11 },
  { alpha3: "MEX", name: "Mexico", region: "Americas", script: "latin", id_format: "luhn", id_len: 10 },
  { alpha3: "ARG", name: "Argentina", region: "Americas", script: "latin", id_format: "generic_numeric", id_len: 8 },
  { alpha3: "CHL", name: "Chile", region: "Americas", script: "latin", id_format: "generic_numeric", id_len: 9 },
  { alpha3: "JPN", name: "Japan", region: "Asia-Pacific", script: "latin", id_format: "luhn", id_len: 12 },
  { alpha3: "KOR", name: "South Korea", region: "Asia-Pacific", script: "latin", id_format: "luhn", id_len: 13 },
  { alpha3: "IND", name: "India", region: "Asia-Pacific", script: "latin", id_format: "luhn", id_len: 12 },
];

// ─── Name pools (subset of the Python generator) ─────────────────────────

const ARABIC_MALE = ["Ahmed", "Mohamed", "Khaled", "Omar", "Mostafa", "Youssef", "Karim", "Hassan", "Ibrahim", "Tarek"];
const ARABIC_FEMALE = ["Fatma", "Mariam", "Salma", "Nour", "Heba", "Mona", "Yasmin", "Reem", "Dina", "Hala"];
const ARABIC_SURNAMES = ["Ali", "Hassan", "Ibrahim", "Saleh", "Mostafa", "Elsayed", "Mahmoud", "Abdelrahman", "Elsherif", "Fouad"];
const LATIN_MALE = ["James", "John", "Robert", "Michael", "David", "William", "Thomas", "Daniel", "Matthew", "Andrew"];
const LATIN_FEMALE = ["Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Susan", "Karen", "Jessica", "Sarah", "Nancy"];
const LATIN_SURNAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Davis", "Miller", "Wilson", "Anderson", "Taylor"];

const ARABIC_MALE_NATIVE = ["أحمد", "محمد", "خالد", "عمر", "مصطفى", "يوسف", "كريم", "حسن", "إبراهيم", "طارق"];
const ARABIC_FEMALE_NATIVE = ["فاطمة", "مريم", "سلمى", "نور", "هبة", "منى", "ياسمين", "ريم", "دينا", "هالة"];
const ARABIC_SURNAMES_NATIVE = ["علي", "حسن", "إبراهيم", "صالح", "مصطفى", "السيد", "محمود", "عبد الرحمن", "الشريف", "فؤاد"];

const ARABIC_CITIES = ["القاهرة", "الإسكندرية", "الجيزة", "المنصورة", "الزقازيق", "طنطا", "أسيوط", "أسوان"];
const EUROPEAN_CITIES = ["London", "Paris", "Berlin", "Madrid", "Rome", "Amsterdam", "Brussels", "Stockholm"];

// ─── Checksum algorithms ──────────────────────────────────────────────────

/** Luhn (mod-10) check digit. */
function luhnCheckDigit(numberStr: string): number {
  let sum = 0;
  let alt = true;
  for (let i = numberStr.length - 1; i >= 0; i--) {
    let n = parseInt(numberStr[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return (10 - (sum % 10)) % 10;
}

/** ISO 7064 MOD 11-2 check digit. */
function iso7064_11_2(numberStr: string): number {
  let sum = 0;
  for (let i = 0; i < numberStr.length; i++) {
    const n = parseInt(numberStr[i], 10);
    if (Number.isNaN(n)) continue;
    const weight = Math.pow(2, numberStr.length - i) % 11;
    sum += (n * weight) % 11;
  }
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 0 : check; // 'X' becomes 0 here for digit-only IDs
}

/** Build a checksum-valid national ID for the country's format. */
function buildNationalId(rng: () => number, country: CountrySpec): string {
  const prefix = country.id_prefix ?? "";
  const bodyLen = Math.max(0, country.id_len - prefix.length - 1);
  let body = prefix;
  for (let i = 0; i < bodyLen; i++) body += Math.floor(rng() * 10).toString();
  let check = 0;
  if (country.id_format === "luhn") {
    check = luhnCheckDigit(body);
  } else if (country.id_format === "iso7064_11_2") {
    check = iso7064_11_2(body);
  } else {
    // generic_numeric — last digit is random (no checksum enforced)
    return body + Math.floor(rng() * 10).toString();
  }
  return body + check.toString();
}

// ─── ICAO 9303 MRZ TD1/TD2/TD3 generators ─────────────────────────────────

/** ICAO 9303 check digit (weights 7,3,1 cyclic). */
function icaoCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i].toUpperCase();
    let v = chars.indexOf(c);
    if (v < 0) v = 0;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

/** Pad/truncate a string to fixed length using '<' filler. */
function padField(s: string, len: number): string {
  const t = s.toUpperCase().replace(/\s/g, "<").slice(0, len);
  return t + "<".repeat(Math.max(0, len - t.length));
}

function generateTD1(rng: () => number, country: CountrySpec): string {
  // TD1: 3 lines × 30 chars
  // Line 1: I<country(3) + 9-char doc number + check + optional data + check
  // Line 2: YYYYMMDD(birth) + check + sex + YYYYMMDD(expiry) + check + nationality + optional + check
  // Line 3: surname<<given<<<< 30 chars
  const doc = randomAlpha(rng, 9);
  const docCheck = icaoCheckDigit(doc);
  const line1 = `I<${country.alpha3}${doc}${docCheck}${"<".repeat(18)}`.slice(0, 30);
  const isMale = rng() < 0.5;
  const sex = isMale ? "M" : "F";
  const year = randInt(rng, 60, 99);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  const birth = `${year.toString().padStart(2, "0")}${month.toString().padStart(2, "0")}${day.toString().padStart(2, "0")}`;
  const birthCheck = icaoCheckDigit(birth);
  const expiryYear = randInt(rng, 26, 35);
  const expiry = `${expiryYear.toString().padStart(2, "0")}${month.toString().padStart(2, "0")}${day.toString().padStart(2, "0")}`;
  const expiryCheck = icaoCheckDigit(expiry);
  const line2 = `${birth}${birthCheck}${sex}${expiry}${expiryCheck}${country.alpha3}${"<".repeat(8)}`.slice(0, 30);
  const isArabic = country.script === "arabic";
  const surname = isArabic ? pick(rng, LATIN_SURNAMES) : pick(rng, LATIN_SURNAMES);
  const given = isMale ? pick(rng, LATIN_MALE) : pick(rng, LATIN_FEMALE);
  const namePart = `${surname}<<${given}`.replace(/\s/g, "<").toUpperCase();
  const line3 = padField(namePart, 30);
  return `${line1}\n${line2}\n${line3}`;
}

function generateTD2(rng: () => number, country: CountrySpec): string {
  // TD2: 2 lines × 36 chars
  const isMale = rng() < 0.5;
  const sex = isMale ? "M" : "F";
  const year = randInt(rng, 60, 99);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  const birth = `${year.toString().padStart(2, "0")}${month.toString().padStart(2, "0")}${day.toString().padStart(2, "0")}`;
  const birthCheck = icaoCheckDigit(birth);
  const expiryYear = randInt(rng, 26, 35);
  const expiry = `${expiryYear.toString().padStart(2, "0")}${month.toString().padStart(2, "0")}${day.toString().padStart(2, "0")}`;
  const expiryCheck = icaoCheckDigit(expiry);
  const doc = randomAlpha(rng, 9);
  const docCheck = icaoCheckDigit(doc);
  const surname = pick(rng, LATIN_SURNAMES);
  const given = isMale ? pick(rng, LATIN_MALE) : pick(rng, LATIN_FEMALE);
  const namePart = `${surname}<<${given}`.replace(/\s/g, "<").toUpperCase();
  const line1 = `I<${country.alpha3}${doc}${docCheck}<<<<<<<<<<<<<<<<<`.slice(0, 36);
  const line2 = `${birth}${birthCheck}${sex}${expiry}${expiryCheck}${country.alpha3}<<<<<<<<<<<<<<<<<`.slice(0, 36);
  const line3_2 = padField(namePart, 36);
  return `${line1}\n${line2}\n${line3_2}`;
}

function generateTD3(rng: () => number, country: CountrySpec): string {
  // TD3 (passport): 2 lines × 44 chars
  const isMale = rng() < 0.5;
  const sex = isMale ? "M" : "F";
  const year = randInt(rng, 60, 99);
  const month = randInt(rng, 1, 12);
  const day = randInt(rng, 1, 28);
  const birth = `${year.toString().padStart(2, "0")}${month.toString().padStart(2, "0")}${day.toString().padStart(2, "0")}`;
  const birthCheck = icaoCheckDigit(birth);
  const expiryYear = randInt(rng, 26, 35);
  const expiry = `${expiryYear.toString().padStart(2, "0")}${month.toString().padStart(2, "0")}${day.toString().padStart(2, "0")}`;
  const expiryCheck = icaoCheckDigit(expiry);
  const passport = randomAlpha(rng, 9);
  const passportCheck = icaoCheckDigit(passport);
  const surname = pick(rng, LATIN_SURNAMES);
  const given = isMale ? pick(rng, LATIN_MALE) : pick(rng, LATIN_FEMALE);
  const namePart = `${surname}<<${given}`.replace(/\s/g, "<").toUpperCase();
  const line1 = `P<${country.alpha3}${padField(namePart, 39)}`.slice(0, 44);
  const line2 = `${passport}${passportCheck}${country.alpha3}${birth}${birthCheck}${sex}${expiry}${expiryCheck}${"<".repeat(14)}`.slice(0, 44);
  return `${line1}\n${line2}`;
}

// ─── Adversarial attack signatures ────────────────────────────────────────

const ADVERSARIAL_ATTACK_TYPES = [
  "deepfake_gan",
  "deepfake_diffusion",
  "3d_mask_silicone",
  "3d_mask_rigid",
  "screen_replay_lcd",
  "screen_replay_oled",
  "print_attack_inkjet",
  "print_attack_laser",
  "silicone_finger",
  "hybrid_mask_replay",
];

const COLOR_CASTS = ["magenta", "cyan", "yellow", "gray", "warm", "cool"];

// ─── Generators ───────────────────────────────────────────────────────────

function genIdentity(rng: () => number, idx: number): any {
  const country = pick(rng, COUNTRIES);
  const isArabic = country.script === "arabic";
  const isMale = rng() < 0.5;
  const given = isArabic
    ? (isMale ? pick(rng, ARABIC_MALE) : pick(rng, ARABIC_FEMALE))
    : (isMale ? pick(rng, LATIN_MALE) : pick(rng, LATIN_FEMALE));
  const surname = isArabic ? pick(rng, ARABIC_SURNAMES) : pick(rng, LATIN_SURNAMES);
  const givenNative = isArabic
    ? (isMale ? pick(rng, ARABIC_MALE_NATIVE) : pick(rng, ARABIC_FEMALE_NATIVE))
    : given;
  const surnameNative = isArabic ? pick(rng, ARABIC_SURNAMES_NATIVE) : surname;
  const birthYear = randInt(rng, 1955, 2005);
  const birthMonth = randInt(rng, 1, 12);
  const birthDay = randInt(rng, 1, 28);
  const issueYear = randInt(rng, 2015, 2024);
  const expiryYear = randInt(rng, 2026, 2035);
  const city = isArabic ? pick(rng, ARABIC_CITIES) : pick(rng, EUROPEAN_CITIES);
  const id = buildNationalId(rng, country);
  return {
    id: `synid_${idx.toString().padStart(6, "0")}`,
    country_alpha3: country.alpha3,
    country_name: country.name,
    region: country.region,
    national_id: id,
    id_format: country.id_format,
    name_latin: `${given} ${surname}`,
    name_native: isArabic ? `${givenNative} ${surnameNative}` : `${given} ${surname}`,
    given_name_latin: given,
    surname_latin: surname,
    gender: isMale ? "M" : "F",
    birth_date: `${birthYear}-${birthMonth.toString().padStart(2, "0")}-${birthDay.toString().padStart(2, "0")}`,
    address_latin: `${randInt(rng, 1, 999)} Main St, ${city} ${randInt(rng, 10000, 99999)}`,
    address_native: isArabic ? `${randInt(rng, 1, 999)} Main St, ${city} ${randInt(rng, 10000, 99999)}` : null,
    document_number: randomAlpha(rng, 9),
    document_type: pick(rng, ["national_id", "passport", "driver_license", "residence"]),
    issue_date: `${issueYear}-${birthMonth.toString().padStart(2, "0")}-${birthDay.toString().padStart(2, "0")}`,
    expiry_date: `${expiryYear}-${birthMonth.toString().padStart(2, "0")}-${birthDay.toString().padStart(2, "0")}`,
    phone: `+${randInt(rng, 1, 99)}${randInt(rng, 100000000, 999999999)}`,
    email: `${given.toLowerCase()}.${surname.toLowerCase()}${randInt(rng, 100, 9999)}@example.com`,
  };
}

const FITZPATRICK = ["I", "II", "III", "IV", "V", "VI"];
const EYE_COLORS = ["brown", "blue", "green", "hazel", "gray", "black"];
const HAIR_COLORS = ["black", "brown", "blonde", "red", "gray", "white"];
const HAIR_STYLES = ["short", "medium", "long", "bald", "curly"];
const GLASSES = ["none", "reading", "sun", "prescription"];
const BEARDS = ["none", "stubble", "goatee", "full", "moustache"];
const POSES = ["frontal", "left_profile", "right_profile", "tilted_up", "tilted_down"];
const LIGHTING = ["top", "side", "front", "backlit", "ambient"];
const EXPRESSIONS = ["neutral", "smile", "frown", "surprised", "squinting"];
const OCCLUSIONS = ["none", "mask", "hand", "hair", "scarf"];
const FACE_ATTACKS = ["none", "print_attack", "screen_replay", "3d_mask", "deepfake"];

function genFace(rng: () => number, idx: number): any {
  const isMale = rng() < 0.5;
  const attackType = rng() < 0.7 ? "none" : pick(rng, FACE_ATTACKS.slice(1));
  // Fitzpatrick distribution weighted toward III/IV (real-world distribution).
  const fitz = (() => {
    const r = rng();
    if (r < 0.1) return "I";
    if (r < 0.25) return "II";
    if (r < 0.55) return "III";
    if (r < 0.85) return "IV";
    if (r < 0.95) return "V";
    return "VI";
  })();
  return {
    id: `synface_${idx.toString().padStart(6, "0")}`,
    age: randInt(rng, 18, 80),
    gender: isMale ? "M" : "F",
    fitzpatrick: fitz,
    eye_color: pick(rng, EYE_COLORS),
    hair_color: pick(rng, HAIR_COLORS),
    hair_style: pick(rng, HAIR_STYLES),
    glasses: pick(rng, GLASSES),
    beard: isMale ? pick(rng, BEARDS) : "none",
    pose: pick(rng, POSES),
    lighting: pick(rng, LIGHTING),
    expression: pick(rng, EXPRESSIONS),
    occlusion: pick(rng, OCCLUSIONS),
    attack_type: attackType,
    blur_score: Number(rng().toFixed(3)),
    lighting_score: Number(rng().toFixed(3)),
    resolution_score: Number((0.5 + rng() * 0.5).toFixed(3)),
    face_match_score: attackType === "none" ? Number((0.7 + rng() * 0.3).toFixed(3)) : Number(rng().toFixed(3)),
    liveness_score: attackType === "none" ? Number((0.7 + rng() * 0.3).toFixed(3)) : Number(rng().toFixed(3)),
    attack_signatures: attackType === "none" ? {} : {
      type: attackType,
      texture_variance: Number(rng().toFixed(3)),
      moire_frequency: Number(rng().toFixed(3)),
    },
    intended_use: rng() < 0.8 ? "train" : "test",
  };
}

const RING_TYPES = ["synthetic_id_factory", "mule_network", "account_takeover", "document_reuse", "device_reuse"];
const SHARED_ATTRS = ["ip", "device_id", "email", "phone", "document_image", "address"];
const MEMBER_ROLES = ["controller", "mule", "victim"];

function genFraudRing(rng: () => number, idx: number): any {
  const memberCount = randInt(rng, 3, 10);
  const muleCount = randInt(rng, 1, Math.min(5, memberCount - 1));
  const controllerCount = Math.max(1, Math.min(3, memberCount - muleCount));
  const sharedAttr = pick(rng, SHARED_ATTRS);
  let sharedValue: string;
  if (sharedAttr === "ip") {
    sharedValue = `${randInt(rng, 1, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}`;
  } else if (sharedAttr === "phone") {
    sharedValue = `+${randInt(rng, 1, 99)}${randInt(rng, 100000000, 999999999)}`;
  } else if (sharedAttr === "email") {
    sharedValue = `ring${idx}@example.com`;
  } else {
    sharedValue = randomAlpha(rng, 12);
  }
  const members: any[] = [];
  let roleIdx = 0;
  for (let i = 0; i < memberCount; i++) {
    const country = pick(rng, COUNTRIES);
    const isMale = rng() < 0.5;
    const given = isMale ? pick(rng, LATIN_MALE) : pick(rng, LATIN_FEMALE);
    const surname = pick(rng, LATIN_SURNAMES);
    let role: string;
    if (roleIdx < controllerCount) role = "controller";
    else if (roleIdx < controllerCount + muleCount) role = "mule";
    else role = "victim";
    roleIdx++;
    members.push({
      member_id: `ring${idx}_m${i}`,
      role,
      country_alpha3: country.alpha3,
      name_latin: `${given} ${surname}`,
      national_id: buildNationalId(rng, country),
      shared_attribute: sharedAttr,
      shared_value: sharedValue,
      enrollment_date: `${randInt(rng, 2022, 2024)}-${randInt(rng, 1, 12).toString().padStart(2, "0")}-${randInt(rng, 1, 28).toString().padStart(2, "0")}`,
      verification_count: randInt(rng, 1, 50),
      is_synthetic_id: role === "mule" ? rng() < 0.7 : false,
      bank_account: role === "mule" ? `BA${randomAlpha(rng, 8)}` : null,
      ip_used: sharedAttr === "ip" ? sharedValue : `${randInt(rng, 1, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}`,
    });
  }
  return {
    ring_id: `ring_${idx.toString().padStart(4, "0")}`,
    member_count: memberCount,
    mule_count: muleCount,
    controller_count: controllerCount,
    ring_type: pick(rng, RING_TYPES),
    shared_attribute: sharedAttr,
    shared_value: sharedValue,
    members,
  };
}

function genMrz(rng: () => number, idx: number): any {
  const country = pick(rng, COUNTRIES);
  const format = pick(rng, ["TD1", "TD2", "TD3"]);
  let mrz: string;
  if (format === "TD1") mrz = generateTD1(rng, country);
  else if (format === "TD2") mrz = generateTD2(rng, country);
  else mrz = generateTD3(rng, country);
  // 50% invalid by introducing a single-char swap or extra/missing char.
  const valid = rng() < 0.5;
  if (!valid) {
    const invalidityTypes = [
      "wrong_check_digit",
      "wrong_field_length",
      "mixed_scripts",
      "special_characters",
      "missing_newline",
      "extra_padding",
      "lowercase_letters",
      "missing_country",
    ];
    const invalidityType = pick(rng, invalidityTypes);
    const lines = mrz.split("\n");
    let modified = mrz;
    let detail = "";
    if (invalidityType === "wrong_check_digit" && lines[0].length > 5) {
      const charIdx = randInt(rng, 5, lines[0].length - 1);
      lines[0] = lines[0].slice(0, charIdx) + ((parseInt(lines[0][charIdx], 10) + 1) % 10).toString() + lines[0].slice(charIdx + 1);
      modified = lines.join("\n");
      detail = `swapped check digit at line 1 pos ${charIdx}`;
    } else if (invalidityType === "lowercase_letters") {
      lines[0] = lines[0].toLowerCase();
      modified = lines.join("\n");
      detail = "lowercased line 1";
    } else if (invalidityType === "missing_newline") {
      modified = lines.join("");
      detail = "removed newline between line 1 and line 2";
    } else if (invalidityType === "extra_padding") {
      lines[0] = lines[0] + "<<";
      modified = lines.join("\n");
      detail = "added 2 extra '<' to line 1";
    } else if (invalidityType === "wrong_field_length") {
      lines[1] = lines[1].slice(0, -1);
      modified = lines.join("\n");
      detail = "removed last char from line 2";
    } else if (invalidityType === "missing_country") {
      lines[0] = lines[0].slice(0, 3) + "<<<" + lines[0].slice(6);
      modified = lines.join("\n");
      detail = "replaced 3-char country code with '<<<'";
    } else if (invalidityType === "special_characters") {
      lines[1] = lines[1].slice(0, 5) + "@" + lines[1].slice(6);
      modified = lines.join("\n");
      detail = "inserted '@' at line 2 pos 5";
    } else if (invalidityType === "mixed_scripts") {
      const arabic = "أبتثجحخدذرزسشصضطظعغفقكلمنهوي";
      lines[1] = lines[1].slice(0, 10) + arabic[Math.floor(rng() * arabic.length)] + lines[1].slice(11);
      modified = lines.join("\n");
      detail = "inserted Arabic char at line 2 pos 10";
    }
    return {
      mrz: modified,
      format,
      country_alpha3: country.alpha3,
      valid: false,
      invalidity_type: invalidityType,
      detail,
      id: `synmrz_${idx.toString().padStart(6, "0")}`,
      country_name: country.name,
    };
  }
  return {
    mrz,
    format,
    country_alpha3: country.alpha3,
    valid: true,
    invalidity_type: null,
    detail: "ICAO 9303 check digits valid",
    id: `synmrz_${idx.toString().padStart(6, "0")}`,
    country_name: country.name,
  };
}

function genAdversarial(rng: () => number, idx: number): any {
  const attackType = pick(rng, ADVERSARIAL_ATTACK_TYPES);
  const record: any = {
    id: `synadv_${idx.toString().padStart(6, "0")}`,
    attack_type: attackType,
    intended_use: rng() < 0.8 ? "train" : "test",
    texture_variance: Number(rng().toFixed(3)),
    halftone_spacing_px: Number((8 + rng() * 6).toFixed(2)),
    color_cast: pick(rng, COLOR_CASTS),
    specular_highlight_score: Number(rng().toFixed(3)),
    paper_fiber_density: Number(rng().toFixed(3)),
    ink_dot_diameter_um: Number((20 + rng() * 50).toFixed(2)),
  };
  if (attackType.startsWith("deepfake")) {
    record.frequency_peak_count = randInt(rng, 1, 8);
    record.color_hist_anomaly = Number(rng().toFixed(3));
    record.gan_fingerprint_score = Number(rng().toFixed(3));
    record.print_tech_hint = "synthetic";
  } else if (attackType.startsWith("3d_mask")) {
    record.depth_micro_relief = Number(rng().toFixed(3));
    record.boundary_discontinuity = Number(rng().toFixed(3));
    record.pore_texture_uniformity = Number(rng().toFixed(3));
    record.print_tech_hint = attackType.includes("silicone") ? "silicone" : "rigid";
  } else if (attackType.startsWith("screen_replay")) {
    record.moire_frequency = Number(rng().toFixed(3));
    record.pixel_grid_artifact = Number(rng().toFixed(3));
    record.refresh_rate_hz = pick(rng, [60, 90, 120, 144]);
    record.print_tech_hint = attackType.includes("lcd") ? "lcd" : "oled";
  } else if (attackType.startsWith("print_attack")) {
    record.print_tech_hint = attackType.includes("laser") ? "laser" : "inkjet";
  } else if (attackType === "silicone_finger") {
    record.ridge_uniformity = Number(rng().toFixed(3));
    record.sweat_pore_count = randInt(rng, 0, 5);
    record.edge_artifact = Number(rng().toFixed(3));
    record.print_tech_hint = "silicone";
  } else if (attackType === "hybrid_mask_replay") {
    record.combined_signals = ["3d_mask_silicone", "screen_replay_lcd"];
    record.fusion_confidence = Number((0.6 + rng() * 0.4).toFixed(3));
    record.print_tech_hint = "hybrid";
  }
  return record;
}

// ─── API ───────────────────────────────────────────────────────────────────

/**
 * Synthetic Data API request payload.
 */
interface SyntheticDataRequest {
  /** Which generator to run. */
  type: "identity" | "face" | "fraud_rings" | "mrz" | "adversarial";
  /** Number of records to generate (default 100, max 1000). */
  count?: number;
  /** Random seed (default 42). */
  seed?: number;
}

/**
 * Synthetic Data API response payload.
 */
interface SyntheticDataResponse {
  /** Number of records actually generated. */
  count: number;
  /** Generator that was used. */
  type: string;
  /** Random seed used. */
  seed: number;
  /** Generated records (max 1000 per request). */
  records: any[];
  /** Human-readable summary. */
  summary: string;
  /** ISO-8601 timestamp of generation. */
  generatedAt: string;
}

/**
 * POST /api/v1/verify/synthetic-data
 *
 * Pure-TypeScript synthetic-data generator — produces edge-case training
 * records across 5 categories that real datasets systematically miss.
 *
 *   - `identity` — fake-but-format-valid national IDs across 30 countries
 *     (Luhn, ISO 7064 MOD 11-2, generic_numeric)
 *   - `face` — face-image descriptors with Fitzpatrick I-VI distribution
 *     weighted toward III/IV (real-world) + attack variants (print, replay,
 *     3D mask, deepfake)
 *   - `fraud_rings` — 3-10-node rings sharing device/IP/email/phone/doc
 *     with controllers + mules + victims
 *   - `mrz` — TD1/TD2/TD3 ICAO 9303 MRZ strings (50% valid + 50% invalid
 *     spanning 8 invalidity types)
 *   - `adversarial` — attack signatures for 10 attack types (deepfake GAN,
 *     diffusion, 3D mask silicone/rigid, screen replay LCD/OLED, print
 *     attack inkjet/laser, silicone finger, hybrid mask+replay)
 *
 * ## Why this endpoint exists
 *
 * Real datasets systematically oversample WEIRD populations and benign
 * presentations — exactly the kinds of samples that *aren't* the failure
 * modes. This generator produces the edge cases that real datasets miss:
 * dark skin tones (Fitzpatrick V-VI), 3D-mask attacks, fraud rings,
 * wrong-check-digit MRZs, and hybrid attacks.
 *
 * ## Vercel compatibility
 *
 * This endpoint is a pure-TypeScript reimplementation of the same
 * algorithms as `training/synthetic_generator.py`. It runs entirely
 * inside the Vercel serverless function (no Python spawn needed).
 * For full 73-country coverage and the canonical pipeline, run the
 * Python script directly:
 *
 *   python3 training/synthetic_generator.py --type all --count 10000
 *
 * @example
 * curl -X POST https://cirkle-verify.vercel.app/api/v1/verify/synthetic-data \
 *   -H "Content-Type: application/json" \
 *   -d '{"type":"identity","count":100,"seed":42}'
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SyntheticDataRequest;

    if (!body || typeof body.type !== "string") {
      return NextResponse.json(
        { error: "type (identity | face | fraud_rings | mrz | adversarial) is required", code: "INVALID_INPUT" },
        { status: 400, headers: CORS_HEADERS },
      );
    }
    const validTypes = ["identity", "face", "fraud_rings", "mrz", "adversarial"];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(", ")}`, code: "INVALID_TYPE" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const count = Math.max(1, Math.min(1000, typeof body.count === "number" ? body.count : 100));
    const seed = typeof body.seed === "number" ? body.seed : 42;
    const rng = mulberry32(seed);

    const records: any[] = [];
    for (let i = 0; i < count; i++) {
      switch (body.type) {
        case "identity":
          records.push(genIdentity(rng, i));
          break;
        case "face":
          records.push(genFace(rng, i));
          break;
        case "fraud_rings":
          records.push(genFraudRing(rng, i));
          break;
        case "mrz":
          records.push(genMrz(rng, i));
          break;
        case "adversarial":
          records.push(genAdversarial(rng, i));
          break;
      }
    }

    const summary =
      `Generated ${records.length} ${body.type} record(s) with seed ${seed}. ` +
      `Use seed=${seed + 1} for the next non-overlapping batch. ` +
      `For 73-country coverage, run the Python pipeline: python3 training/synthetic_generator.py --type ${body.type} --count ${count} --seed ${seed}`;

    const response: SyntheticDataResponse = {
      count: records.length,
      type: body.type,
      seed,
      records,
      summary,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json(
      {
        error: e?.message || "synthetic data generation failed",
        code: "SYNTHETIC_DATA_FAILURE",
      },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

/**
 * GET /api/v1/verify/synthetic-data
 *
 * Returns API documentation, the list of generators, and the supported
 * countries.
 */
export async function GET() {
  return NextResponse.json(
    {
      name: "Synthetic Data Generator API",
      version: "1.0.0",
      description:
        "Pure-TypeScript synthetic-data generator producing edge-case training records across 5 categories (identity, face, fraud_rings, mrz, adversarial). Designed to fill the gaps that real datasets leave: dark skin tones, 3D-mask attacks, fraud rings, wrong-check-digit MRZs, hybrid attacks. Runs entirely inside the Vercel serverless function — no Python needed.",
      competitiveAdvantage:
        "Real datasets systematically oversample WEIRD populations and benign presentations. This generator produces the edge cases that real datasets miss: Fitzpatrick V-VI skin tones, silicone 3D masks, fraud rings, malformed MRZ strings, and hybrid mask+replay attacks.",
      endpoints: {
        POST: "Submit { type, count, seed }, receive generated records.",
        GET: "This documentation + generator list + country list.",
        OPTIONS: "CORS preflight (204 No Content).",
      },
      generators: {
        identity: {
          description: "Fake-but-format-valid national IDs across 30 countries.",
          checksums: ["Luhn (mod-10)", "ISO 7064 MOD 11-2", "generic_numeric"],
          fields: [
            "id",
            "country_alpha3",
            "country_name",
            "region",
            "national_id",
            "id_format",
            "name_latin",
            "name_native",
            "given_name_latin",
            "surname_latin",
            "gender",
            "birth_date",
            "address_latin",
            "address_native",
            "document_number",
            "document_type",
            "issue_date",
            "expiry_date",
            "phone",
            "email",
          ],
        },
        face: {
          description: "Face-image descriptors with Fitzpatrick I-VI distribution weighted toward III/IV.",
          attackVariants: ["none", "print_attack", "screen_replay", "3d_mask", "deepfake"],
          fields: [
            "id",
            "age",
            "gender",
            "fitzpatrick",
            "eye_color",
            "hair_color",
            "hair_style",
            "glasses",
            "beard",
            "pose",
            "lighting",
            "expression",
            "occlusion",
            "attack_type",
            "blur_score",
            "lighting_score",
            "resolution_score",
            "face_match_score",
            "liveness_score",
            "attack_signatures",
            "intended_use",
          ],
        },
        fraud_rings: {
          description: "3-10-node fraud rings sharing device/IP/email/phone/document/address.",
          ringTypes: ["synthetic_id_factory", "mule_network", "account_takeover", "document_reuse", "device_reuse"],
          memberRoles: ["controller", "mule", "victim"],
          fields: ["ring_id", "member_count", "mule_count", "controller_count", "ring_type", "shared_attribute", "shared_value", "members[]"],
        },
        mrz: {
          description: "TD1/TD2/TD3 ICAO 9303 MRZ strings (50% valid + 50% invalid).",
          formats: ["TD1", "TD2", "TD3"],
          invalidityTypes: [
            "wrong_check_digit",
            "wrong_field_length",
            "mixed_scripts",
            "special_characters",
            "missing_newline",
            "extra_padding",
            "lowercase_letters",
            "missing_country",
          ],
          fields: ["mrz", "format", "country_alpha3", "valid", "invalidity_type", "detail", "id", "country_name"],
        },
        adversarial: {
          description: "Attack signatures for 10 attack types.",
          attackTypes: ADVERSARIAL_ATTACK_TYPES,
          fields: ["id", "attack_type", "intended_use", "texture_variance", "halftone_spacing_px", "color_cast", "specular_highlight_score", "paper_fiber_density", "ink_dot_diameter_um", "(+ attack-specific fields)"],
        },
      },
      countries: COUNTRIES.map(c => c.alpha3),
      limits: {
        maxCountPerRequest: 1000,
        defaultCount: 100,
        defaultSeed: 42,
      },
      note: "This endpoint uses pure TypeScript implementations of the same algorithms as training/synthetic_generator.py so it works on Vercel (no Python on Vercel). For full 73-country coverage and the canonical pipeline, run: python3 training/synthetic_generator.py --type all --count 10000 --seed 42",
      examplePayload: { type: "identity", count: 100, seed: 42 },
    },
    { headers: CORS_HEADERS },
  );
}
