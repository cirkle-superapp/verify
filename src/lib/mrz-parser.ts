/**
 * ICAO 9303 Machine Readable Zone (MRZ) Parser.
 *
 * The MRZ is the standardized machine-readable text at the bottom of
 * passports, ID cards, and residence permits. Parsing it gives us
 * authoritative structured data that doesn't depend on OCR accuracy.
 *
 * Three formats:
 *   TD1 (ID cards, residence permits): 3 lines × 30 chars
 *   TD2 (passport cards):              2 lines × 36 chars
 *   TD3 (passport booklets):           2 lines × 44 chars
 *
 * Each uses check digits (mod-10 weighted by 7,3,1) for validation.
 * Country codes are ISO 3166-1 alpha-3.
 */

// ─── Check digit computation (ICAO 9303) ────────────────────────
// Weights: 7, 3, 1 repeating. Values: 0-9 → 0-9, A-Z → 10-35, < → 0.
function charValue(c: string): number {
  if (c === "<" || c === " " || c === "") return 0;
  if (/[0-9]/.test(c)) return parseInt(c, 10);
  if (/[A-Z]/.test(c)) return c.charCodeAt(0) - 55; // A=10, B=11, ...Z=35
  return 0;
}

export function computeCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    sum += charValue(input[i]) * weights[i % 3];
  }
  return sum % 10;
}

export function verifyCheckDigit(input: string, expected: string | number): boolean {
  const expectedNum = typeof expected === "number" ? expected : parseInt(expected, 10);
  return computeCheckDigit(input) === expectedNum;
}

// ─── Format text fields (< → space, trim trailing) ──────────────
function formatField(s: string): string {
  return s.replace(/</g, " ").replace(/\s+/g, " ").trim();
}

// ─── Parse name (surname<<given names) ────────────────────────────
function parseNameField(s: string): { primary: string; secondary: string; full: string } {
  const parts = s.split("<<");
  const surname = formatField(parts[0] || "");
  const given = formatField(parts.slice(1).join("<<") || "");
  return {
    primary: surname,
    secondary: given,
    full: `${given} ${surname}`.trim(),
  };
}

// ─── Parse date (YYMMDD) ─────────────────────────────────────────
function parseDate(s: string): { iso: string | null; year: number; month: number; day: number } {
  if (s.length < 6) return { iso: null, year: 0, month: 0, day: 0 };
  const yy = parseInt(s.slice(0, 2), 10);
  const mm = parseInt(s.slice(2, 4), 10);
  const dd = parseInt(s.slice(4, 6), 10);
  // Year pivot: 00-30 → 2000s, 31-99 → 1900s (configurable)
  const year = yy <= 30 ? 2000 + yy : 1900 + yy;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return { iso: null, year, month: mm, day: dd };
  }
  return {
    iso: `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
    year, month: mm, day: dd,
  };
}

// ─── ISO 3166-1 alpha-3 → country name (subset) ─────────────────
const COUNTRY_NAMES: Record<string, string> = {
  EGY: "Egypt", SAU: "Saudi Arabia", ARE: "United Arab Emirates", KWT: "Kuwait",
  QAT: "Qatar", JOR: "Jordan", MAR: "Morocco", TUN: "Tunisia", DZA: "Algeria",
  LBN: "Lebanon", IRQ: "Iraq", SYR: "Syria", LBY: "Libya", SDN: "Sudan",
  BHR: "Bahrain", OMN: "Oman", YEM: "Yemen", PSE: "Palestine", ISR: "Israel",
  TUR: "Türkiye", IRN: "Iran", USA: "United States", GBR: "United Kingdom",
  FRA: "France", DEU: "Germany", ESP: "Spain", ITA: "Italy", NLD: "Netherlands",
  BEL: "Belgium", SWE: "Sweden", NOR: "Norway", DNK: "Denmark", FIN: "Finland",
  POL: "Poland", CZ: "Czech Republic", CZE: "Czech Republic", GRC: "Greece",
  ROU: "Romania", PRT: "Portugal", IRL: "Ireland", AUT: "Austria", CHE: "Switzerland",
  HUN: "Hungary", BGR: "Bulgaria", HRV: "Croatia", SRB: "Serbia", SVK: "Slovakia",
  SVN: "Slovenia", EST: "Estonia", LVA: "Latvia", LTU: "Lithuania", ISL: "Iceland",
  LUX: "Luxembourg", MLT: "Malta", CYP: "Cyprus", RUS: "Russia", UKR: "Ukraine",
  BLR: "Belarus", GEO: "Georgia", ARM: "Armenia", AZE: "Azerbaijan", KAZ: "Kazakhstan",
  UZB: "Uzbekistan", IND: "India", PAK: "Pakistan", BGD: "Bangladesh", LKA: "Sri Lanka",
  NPL: "Nepal", AFG: "Afghanistan", JPN: "Japan", KOR: "South Korea", CHN: "China",
  TWN: "Taiwan", HKG: "Hong Kong", MAC: "Macao", SGP: "Singapore", MYS: "Malaysia",
  THA: "Thailand", IDN: "Indonesia", PHL: "Philippines", VNM: "Vietnam", KHM: "Cambodia",
  LAO: "Laos", MMR: "Myanmar", AUS: "Australia", NZL: "New Zealand", CAN: "Canada",
  BRA: "Brazil", ARG: "Argentina", CHL: "Chile", COL: "Colombia", PER: "Peru",
  VEN: "Venezuela", ECU: "Ecuador", BOL: "Bolivia", PRY: "Paraguay", URY: "Uruguay",
  MEX: "Mexico", CUB: "Cuba", DOM: "Dominican Republic", GTM: "Guatemala", HND: "Honduras",
  NIC: "Nicaragua", CRI: "Costa Rica", PAN: "Panama", SLV: "El Salvador", ZAF: "South Africa",
  NGA: "Nigeria", KEN: "Kenya", ETH: "Ethiopia", TZA: "Tanzania", UGA: "Uganda",
  GHA: "Ghana", SEN: "Senegal", CIV: "Ivory Coast", CMR: "Cameroon", AGO: "Angola",
  MOZ: "Mozambique", ZMB: "Zambia", ZWE: "Zimbabwe", NAM: "Namibia", BWA: "Botswana",
  UNK: "Unknown", UNO: "Stateless", "D<<": "Germany (old)",
};

export function countryFromAlpha3(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] || code;
}

// ─── TD1 format (ID cards, 3×30) ─────────────────────────────────
// Line 1: I[document_code](9) + ISO3(3) + doc_number(14) + check(1) + optional(3)
// Line 2: YYMMDD(6) + check(1) + sex(1) + YYMMDD(6) + check(1) + nationality(3) + optional(2)
// Line 3: name field (30)

export interface MrzResult {
  format: "TD1" | "TD2" | "TD3";
  documentCode: string;
  issuingCountry: string;
  issuingCountryName: string;
  documentNumber: string;
  documentNumberCheckValid: boolean;
  optionalData1?: string;
  optionalData2?: string;
  birthDate?: string;
  birthDateCheckValid: boolean;
  sex: "Male" | "Female" | "Unspecified";
  expiryDate?: string;
  expiryDateCheckValid: boolean;
  nationality: string;
  nationalityName: string;
  name: { primary: string; secondary: string; full: string };
  compositeCheckValid: boolean;
  rawText: string;
  valid: boolean;
  errors: string[];
}

function parseSex(c: string): "Male" | "Female" | "Unspecified" {
  if (c === "M") return "Male";
  if (c === "F") return "Female";
  return "Unspecified";
}

export function parseTD1(lines: string[]): MrzResult {
  const errors: string[] = [];
  const l1 = lines[0].padEnd(30, "<").slice(0, 30);
  const l2 = lines[1].padEnd(30, "<").slice(0, 30);
  const l3 = lines[2].padEnd(30, "<").slice(0, 30);

  const documentCode = l1.slice(0, 2).replace(/</g, "");
  const issuingCountry = l1.slice(2, 5);
  const docNumber = formatField(l1.slice(5, 14));
  const docCheck = l1[14];
  const optional1 = formatField(l1.slice(15, 30));

  const birthDateStr = l2.slice(0, 6);
  const birthCheck = l2[6];
  const sex = parseSex(l2[7]);
  const expiryStr = l2.slice(8, 14);
  const expiryCheck = l2[14];
  const nationality = l2.slice(15, 18);
  const optional2 = formatField(l2.slice(18, 29));
  const compositeCheck = l2[29];

  const nameField = l3;

  const birth = parseDate(birthDateStr);
  const expiry = parseDate(expiryStr);

  const docNumCheckValid = verifyCheckDigit(l1.slice(5, 14), docCheck);
  const birthCheckValid = verifyCheckDigit(birthDateStr, birthCheck);
  const expiryCheckValid = verifyCheckDigit(expiryStr, expiryCheck);
  // Composite: doc_number + check + optional1 + birth + check + sex + expiry + check + nationality + optional2
  const compositeInput = l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(15, 29);
  const compositeCheckValid = verifyCheckDigit(compositeInput, compositeCheck);

  if (!docNumCheckValid) errors.push("document number check digit mismatch");
  if (!birthCheckValid) errors.push("birth date check digit mismatch");
  if (!expiryCheckValid) errors.push("expiry date check digit mismatch");
  if (!compositeCheckValid) errors.push("composite check digit mismatch");

  const name = parseNameField(nameField);

  return {
    format: "TD1",
    documentCode,
    issuingCountry,
    issuingCountryName: countryFromAlpha3(issuingCountry),
    documentNumber: docNumber,
    documentNumberCheckValid: docNumCheckValid,
    optionalData1: optional1 || undefined,
    optionalData2: optional2 || undefined,
    birthDate: birth.iso || undefined,
    birthDateCheckValid: birthCheckValid,
    sex,
    expiryDate: expiry.iso || undefined,
    expiryDateCheckValid: expiryCheckValid,
    nationality,
    nationalityName: countryFromAlpha3(nationality),
    name,
    compositeCheckValid,
    rawText: lines.join("\n"),
    valid: errors.length === 0,
    errors,
  };
}

// ─── TD2 format (passport cards, 2×36) ──────────────────────────
// Line 1: I[doc_code](2) + ISO3(3) + name field (optional, 27)... actually
// Line 1: I[doc_code](2) + ISO3(3) + surname<<given (28)... no
// TD2 line 1: I[2] + ISO3[3] + names (all caps, << separator, 31 chars)... 
// Actually TD2:
//   Line 1: I[doc_code](2) + issuing(3) + surname+given (31)
//   Line 2: doc_number( up to 9) + check(1) + nationality(3) + birth(6)+check(1)+sex(1)+expiry(6)+check(1)+optional(4)+compositeCheck(1)

export function parseTD2(lines: string[]): MrzResult {
  const errors: string[] = [];
  const l1 = lines[0].padEnd(36, "<").slice(0, 36);
  const l2 = lines[1].padEnd(36, "<").slice(0, 36);

  const documentCode = l1.slice(0, 2).replace(/</g, "");
  const issuingCountry = l1.slice(2, 5);
  const nameField = l1.slice(5, 36);

  // Line 2: doc_number can vary; usually chars 0-9, check at 9
  const docNumber = formatField(l2.slice(0, 9));
  const docCheck = l2[9];
  const nationality = l2.slice(10, 13);
  const birthStr = l2.slice(13, 19);
  const birthCheck = l2[19];
  const sex = parseSex(l2[20]);
  const expiryStr = l2.slice(21, 27);
  const expiryCheck = l2[27];
  const optional = formatField(l2.slice(28, 35));
  const compositeCheck = l2[35];

  const birth = parseDate(birthStr);
  const expiry = parseDate(expiryStr);

  const docNumCheckValid = verifyCheckDigit(l2.slice(0, 9), docCheck);
  const birthCheckValid = verifyCheckDigit(birthStr, birthCheck);
  const expiryCheckValid = verifyCheckDigit(expiryStr, expiryCheck);
  const compositeInput = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 28) + l2.slice(28, 35);
  const compositeCheckValid = verifyCheckDigit(compositeInput, compositeCheck);

  if (!docNumCheckValid) errors.push("document number check digit mismatch");
  if (!birthCheckValid) errors.push("birth date check digit mismatch");
  if (!expiryCheckValid) errors.push("expiry date check digit mismatch");
  if (!compositeCheckValid) errors.push("composite check digit mismatch");

  const name = parseNameField(nameField);

  return {
    format: "TD2",
    documentCode,
    issuingCountry,
    issuingCountryName: countryFromAlpha3(issuingCountry),
    documentNumber: docNumber,
    documentNumberCheckValid: docNumCheckValid,
    optionalData1: optional || undefined,
    birthDate: birth.iso || undefined,
    birthDateCheckValid: birthCheckValid,
    sex,
    expiryDate: expiry.iso || undefined,
    expiryDateCheckValid: expiryCheckValid,
    nationality,
    nationalityName: countryFromAlpha3(nationality),
    name,
    compositeCheckValid,
    rawText: lines.join("\n"),
    valid: errors.length === 0,
    errors,
  };
}

// ─── TD3 format (passport booklets, 2×44) ───────────────────────
// Line 1: P< + ISO3(3) + name field (surname<<given, 39)
// Line 2: passport_number(9) + check(1) + nationality(3) + birth(6)+check(1)+sex(1)+expiry(6)+check(1)+personal_number(14)+compositeCheck(1)

export function parseTD3(lines: string[]): MrzResult {
  const errors: string[] = [];
  const l1 = lines[0].padEnd(44, "<").slice(0, 44);
  const l2 = lines[1].padEnd(44, "<").slice(0, 44);

  const documentCode = l1.slice(0, 2).replace(/</g, "");
  const issuingCountry = l1.slice(2, 5);
  const nameField = l1.slice(5, 44);

  const passportNumber = formatField(l2.slice(0, 9));
  const passportCheck = l2[9];
  const nationality = l2.slice(10, 13);
  const birthStr = l2.slice(13, 19);
  const birthCheck = l2[19];
  const sex = parseSex(l2[20]);
  const expiryStr = l2.slice(21, 27);
  const expiryCheck = l2[27];
  const personalNumber = formatField(l2.slice(28, 42));
  const compositeCheck = l2[42];

  const birth = parseDate(birthStr);
  const expiry = parseDate(expiryStr);

  const passportCheckValid = verifyCheckDigit(l2.slice(0, 9), passportCheck);
  const birthCheckValid = verifyCheckDigit(birthStr, birthCheck);
  const expiryCheckValid = verifyCheckDigit(expiryStr, expiryCheck);
  // Composite: passport_number + check + birth + check + sex + expiry + check + personal_number
  // (ICAO 9303 TD3: covers positions 1-10, 14-21, 22-42 of line 2 — NOT the composite
  // check digit itself at position 43.)
  // Previous code used slice(21, 43) which included the compositeCheck digit (l2[42]) and
  // omitted sex (l2[20]) — fixed in Task 9-a so composite validation actually works.
  const compositeInput = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(20, 42);
  const compositeCheckValid = verifyCheckDigit(compositeInput, compositeCheck);

  if (!passportCheckValid) errors.push("passport number check digit mismatch");
  if (!birthCheckValid) errors.push("birth date check digit mismatch");
  if (!expiryCheckValid) errors.push("expiry date check digit mismatch");
  if (!compositeCheckValid) errors.push("composite check digit mismatch");

  const name = parseNameField(nameField);

  return {
    format: "TD3",
    documentCode,
    issuingCountry,
    issuingCountryName: countryFromAlpha3(issuingCountry),
    documentNumber: passportNumber,
    documentNumberCheckValid: passportCheckValid,
    optionalData1: personalNumber || undefined,
    birthDate: birth.iso || undefined,
    birthDateCheckValid: birthCheckValid,
    sex,
    expiryDate: expiry.iso || undefined,
    expiryDateCheckValid: expiryCheckValid,
    nationality,
    nationalityName: countryFromAlpha3(nationality),
    name,
    compositeCheckValid,
    rawText: lines.join("\n"),
    valid: errors.length === 0,
    errors,
  };
}

/** Detect MRZ format from raw text (lines). */
export function detectMrzFormat(lines: string[]): "TD1" | "TD2" | "TD3" | null {
  const cleanLines = lines.filter((l) => l.length >= 25);
  if (cleanLines.length === 3 && cleanLines.every((l) => l.length >= 28 && l.length <= 30)) return "TD1";
  if (cleanLines.length === 2 && cleanLines.every((l) => l.length >= 34 && l.length <= 36)) return "TD2";
  if (cleanLines.length === 2 && cleanLines.every((l) => l.length >= 42 && l.length <= 44)) return "TD3";
  return null;
}

/** Parse any MRZ format. Auto-detects TD1/TD2/TD3. */
export function parseMrz(text: string): MrzResult | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && /^[A-Z0-9<]+$/.test(l.toUpperCase()));
  if (lines.length < 2) return null;
  const format = detectMrzFormat(lines);
  if (!format) return null;
  switch (format) {
    case "TD1": return parseTD1(lines);
    case "TD2": return parseTD2(lines);
    case "TD3": return parseTD3(lines);
  }
}
