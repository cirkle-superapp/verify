import { crossFieldValidate, type CrossFieldInput } from "../src/lib/cross-field-validation";
import { computeCheckDigit, parseMrz } from "../src/lib/mrz-parser";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ FAIL: " + msg); }
}

// Build a TD3 passport MRZ with valid check digits.
const nameLine1 = "P<EGYMOHAMED<<IBRAHIM<<<<<<<<<<<<<<<<<<<<<<<<<<<".padEnd(44, "<").slice(0, 44);
// Line 2 fields
const passNum = "A12345678"; // 9 chars
const nat = "EGY";
const birth = "950101"; // 6 chars
const sex = "M";
const expiry = "300101"; // 6 chars
const personal = "".padEnd(14, "<"); // 14 chars
const passCheck = String(computeCheckDigit(passNum));
const birthCheck = String(computeCheckDigit(birth));
const expiryCheck = String(computeCheckDigit(expiry));
// Composite = passNum + passCheck + nat + birth + birthCheck + sex + expiry + expiryCheck + personal
const compositeInput = passNum + passCheck + birth + birthCheck + sex + expiry + expiryCheck + personal;
const compositeCheck = String(computeCheckDigit(compositeInput));
const line2 = (passNum + passCheck + nat + birth + birthCheck + sex + expiry + expiryCheck + personal + compositeCheck).padEnd(44, "<").slice(0, 44);
const mrz = nameLine1 + "\n" + line2;
console.log("Constructed MRZ:");
console.log("  L1:", nameLine1, `(${nameLine1.length})`);
console.log("  L2:", line2, `(${line2.length})`);
const parsed = parseMrz(mrz);
console.log("Parse:", parsed ? `${parsed.format} nat=${parsed.nationality} docNum=${parsed.documentNumber} docValid=${parsed.documentNumberCheckValid} compValid=${parsed.compositeCheckValid}` : "null");

if (parsed) {
  // Test 1: MRZ matches extracted → no mismatch flags
  const goodInput: CrossFieldInput = {
    fullNameAr: "محمد إبراهيم",
    fullNameEn: "Mohamed Ibrahim",
    nationalId: "29501010123459",
    country: "EG",
    birthDate: "1995-01-01",
    gender: "Male",
    expiryDate: "2030-01-01",
    issueDate: "2020-01-01",
    nationality: "egyptian",
    documentNo: "A12345678",
    mrzText: mrz,
    docType: "passport",
    photoPresent: true,
    photoGender: "Male",
  };
  const r1 = crossFieldValidate(goodInput);
  console.log("\nTest: Good MRZ (no mismatches)");
  console.log("  Flags:", r1.flags.map(f => `${f.code}(${f.severity})`).join(", "));
  const mrzMismatchFlags = r1.flags.filter(f => f.code.startsWith("MRZ_") && f.code.endsWith("MISMATCH"));
  assert(mrzMismatchFlags.length === 0, `No MRZ mismatch flags for matching MRZ (got ${mrzMismatchFlags.length})`);

  // Test 2: MRZ nationality mismatch
  const badNatInput: CrossFieldInput = { ...goodInput, country: "SA" };
  const r2 = crossFieldValidate(badNatInput);
  console.log("\nTest: MRZ nationality mismatch (EGY vs SA)");
  console.log("  MRZ flags:", r2.flags.filter(f => f.code.startsWith("MRZ")).map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r2.flags.some(f => f.code === "MRZ_NATIONALITY_MISMATCH"), "MRZ_NATIONALITY_MISMATCH flag raised");

  // Test 3: MRZ docnum mismatch
  const badDocInput: CrossFieldInput = { ...goodInput, documentNo: "Z9999999" };
  const r3 = crossFieldValidate(badDocInput);
  console.log("\nTest: MRZ docnum mismatch");
  console.log("  MRZ flags:", r3.flags.filter(f => f.code === "MRZ_DOCNUM_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r3.flags.some(f => f.code === "MRZ_DOCNUM_MISMATCH"), "MRZ_DOCNUM_MISMATCH flag raised");

  // Test 4: MRZ gender mismatch
  const badGInput: CrossFieldInput = { ...goodInput, gender: "Female" };
  const r4 = crossFieldValidate(badGInput);
  console.log("\nTest: MRZ gender mismatch");
  console.log("  MRZ flags:", r4.flags.filter(f => f.code === "MRZ_GENDER_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r4.flags.some(f => f.code === "MRZ_GENDER_MISMATCH"), "MRZ_GENDER_MISMATCH flag raised");

  // Test 5: MRZ birth date mismatch (year)
  const badBInput: CrossFieldInput = { ...goodInput, birthDate: "1990-01-01" };
  const r5 = crossFieldValidate(badBInput);
  console.log("\nTest: MRZ birthdate mismatch");
  console.log("  MRZ flags:", r5.flags.filter(f => f.code === "MRZ_BIRTHDATE_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r5.flags.some(f => f.code === "MRZ_BIRTHDATE_MISMATCH"), "MRZ_BIRTHDATE_MISMATCH flag raised");

  // Test 6: MRZ expiry mismatch (year)
  const badEInput: CrossFieldInput = { ...goodInput, expiryDate: "2025-01-01" };
  const r6 = crossFieldValidate(badEInput);
  console.log("\nTest: MRZ expiry mismatch");
  console.log("  MRZ flags:", r6.flags.filter(f => f.code === "MRZ_EXPIRY_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r6.flags.some(f => f.code === "MRZ_EXPIRY_MISMATCH"), "MRZ_EXPIRY_MISMATCH flag raised");

  // Test 7: MRZ checksum failure (corrupt one check digit)
  const badMrz = nameLine1 + "\n" + (line2.slice(0, 9) + "0" + line2.slice(10)); // corrupt passCheck to '0'
  const badMrzInput: CrossFieldInput = { ...goodInput, mrzText: badMrz };
  const r7 = crossFieldValidate(badMrzInput);
  console.log("\nTest: MRZ checksum failure (corrupted passport check digit)");
  console.log("  MRZ flags:", r7.flags.filter(f => f.code.includes("CHECKSUM_FAIL")).map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r7.flags.some(f => f.code === "MRZ_DOCNUM_CHECKSUM_FAIL"), "MRZ_DOCNUM_CHECKSUM_FAIL flag raised");

  // Test 8: MRZ name near match (Levenshtein ≤ 2)
  const nameNearInput: CrossFieldInput = { ...goodInput, fullNameEn: "Mohamed Ibrahim" };
  const r8 = crossFieldValidate(nameNearInput);
  console.log("\nTest: MRZ name near-match");
  console.log("  Name flags:", r8.flags.filter(f => f.code.startsWith("MRZ_NAME")).map(f => `${f.code}(${f.severity})`).join(", "));
  assert(!r8.flags.some(f => f.code === "MRZ_NAME_MISMATCH"), "No MRZ_NAME_MISMATCH for near-matching name");
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
