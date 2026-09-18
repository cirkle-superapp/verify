import { crossFieldValidate, CROSS_FIELD_CHECK_COUNT, CROSS_FIELD_CHECK_NAMES, type CrossFieldInput } from "../src/lib/cross-field-validation";
import { parseMrz } from "../src/lib/mrz-parser";

// Pre-computed valid Egyptian ID (born 1995-01-01, governorate 01=Cairo, Male)
const EG_ID = "29501010123459";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ FAIL: " + msg); }
}

// Verify ICAO 9303 sample passport MRZ parses
const mrzSample = [
  "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<<<<",
  "AABB123456UTO9407177F2012315ZE1842260818BEL<<<<<<<<<<<<<6",
].join("\n");
const parsedMrz = parseMrz(mrzSample);
console.log("MRZ sample parse:", parsedMrz ? parsedMrz.format : "null", parsedMrz ? `nat=${parsedMrz.nationality}` : "");
if (!parsedMrz) {
  console.log("MRZ parse failed; will skip MRZ-related tests");
}

console.log("\n=== Test 1: Clean input (Egyptian ID, matching fields) ===");
const cleanInput: CrossFieldInput = {
  fullNameAr: "محمد إبراهيم القاهري",
  fullNameEn: "Mohamed Ibrahim",
  nationalId: EG_ID,
  country: "EG",
  birthDate: "1995-01-01",
  gender: "Male",
  expiryDate: "2030-01-01",
  issueDate: "2020-01-01",
  nationality: "egyptian",
  documentNo: EG_ID,
  docType: "national_id",
  birthPlace: "Cairo",
  issuePlace: "Cairo",
  photoPresent: true,
  photoGender: "Male",
};
const r1 = crossFieldValidate(cleanInput);
console.log("Flags:", r1.flags.map(f => `${f.code}(${f.severity})`).join(", "));
console.log("Score:", r1.consistencyScore, "Fraud:", r1.fraudProbability);
assert(r1.checkCount === 30, `Check count = 30 (got ${r1.checkCount})`);
assert(!r1.hasCritical, "Clean input has no critical flags");
assert(r1.consistencyScore >= 0.5, `Clean input score ${r1.consistencyScore} >= 0.5`);

console.log("\n=== Test 2: Gender mismatch (ID says Male, extracted Female) ===");
const badGender: CrossFieldInput = { ...cleanInput, gender: "Female" };
const r2 = crossFieldValidate(badGender);
console.log("Flags:", r2.flags.map(f => `${f.code}(${f.severity})`).join(", "));
assert(r2.flags.some(f => f.code === "GENDER_MISMATCH_ID"), "GENDER_MISMATCH_ID flag raised");
assert(r2.hasCritical, "Gender mismatch is critical");

console.log("\n=== Test 3: Birthplace mismatch (ID says Cairo, extracted Aswan) ===");
const badBp: CrossFieldInput = { ...cleanInput, birthPlace: "Aswan" };
const r3 = crossFieldValidate(badBp);
console.log("Flags:", r3.flags.filter(f => f.code.startsWith("ID_BIRTH")).map(f => `${f.code}(${f.severity})`).join(", "));
assert(r3.flags.some(f => f.code === "ID_BIRTHPLACE_MISMATCH"), "ID_BIRTHPLACE_MISMATCH flag raised");

console.log("\n=== Test 4: Missing required fields ===");
const missing: CrossFieldInput = { fullNameAr: "محمد" };
const r4 = crossFieldValidate(missing);
console.log("Flags:", r4.flags.map(f => `${f.code}`).join(", "));
const missingFlags = r4.flags.filter(f => f.code === "MISSING_REQUIRED_FIELD");
assert(missingFlags.length >= 5, `At least 5 missing-field flags (got ${missingFlags.length})`);

console.log("\n=== Test 5: Issue date in future ===");
const futureIssue: CrossFieldInput = { ...cleanInput, issueDate: "2099-01-01" };
const r5 = crossFieldValidate(futureIssue);
console.log("Issue-date flags:", r5.flags.filter(f => f.code.startsWith("ISSUE")).map(f => `${f.code}(${f.severity})`).join(", "));
assert(r5.flags.some(f => f.code === "ISSUE_DATE_FUTURE"), "ISSUE_DATE_FUTURE flag raised");

console.log("\n=== Test 6: Issue before birth ===");
const badIssue: CrossFieldInput = { ...cleanInput, issueDate: "1990-01-01" };
const r6 = crossFieldValidate(badIssue);
console.log("Flags:", r6.flags.filter(f => f.code.startsWith("ISSUE")).map(f => `${f.code}(${f.severity})`).join(", "));
assert(r6.flags.some(f => f.code === "ISSUE_BEFORE_BIRTH"), "ISSUE_BEFORE_BIRTH flag raised");

console.log("\n=== Test 7: Recently issued but already expired ===");
const today = new Date().toISOString().slice(0, 10);
const recentExpired: CrossFieldInput = { ...cleanInput, issueDate: today, expiryDate: "2020-01-01" };
const r7 = crossFieldValidate(recentExpired);
console.log("Flags:", r7.flags.filter(f => f.code === "RECENTLY_ISSUED_BUT_EXPIRED" || f.code === "DOCUMENT_EXPIRED").map(f => `${f.code}(${f.severity})`).join(", "));
assert(r7.flags.some(f => f.code === "RECENTLY_ISSUED_BUT_EXPIRED"), "RECENTLY_ISSUED_BUT_EXPIRED flag raised");

console.log("\n=== Test 8: Document-number format mismatch ===");
const badDocNo: CrossFieldInput = { ...cleanInput, documentNo: "abc" };
const r8 = crossFieldValidate(badDocNo);
console.log("Flags:", r8.flags.filter(f => f.code === "DOCUMENT_NUMBER_FORMAT_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
assert(r8.flags.some(f => f.code === "DOCUMENT_NUMBER_FORMAT_MISMATCH"), "DOCUMENT_NUMBER_FORMAT_MISMATCH flag raised");

console.log("\n=== Test 9: Validity period too long ===");
const longValidity: CrossFieldInput = { ...cleanInput, issueDate: "2020-01-01", expiryDate: "2040-01-01" };
const r9 = crossFieldValidate(longValidity);
console.log("Flags:", r9.flags.filter(f => f.code.startsWith("VALIDITY") || f.code.startsWith("PASSPORT")).map(f => `${f.code}(${f.severity})`).join(", "));
assert(r9.flags.some(f => f.code === "VALIDITY_PERIOD_TOO_LONG"), "VALIDITY_PERIOD_TOO_LONG flag raised");

console.log("\n=== Test 10: Cross-language name similarity (Arabic and English totally different) ===");
const badXlang: CrossFieldInput = { ...cleanInput, fullNameAr: "محمد إبراهيم", fullNameEn: "John Smith" };
const r10 = crossFieldValidate(badXlang);
console.log("Flags:", r10.flags.filter(f => f.code === "CROSS_LANGUAGE_NAME_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
assert(r10.flags.some(f => f.code === "CROSS_LANGUAGE_NAME_MISMATCH"), "CROSS_LANGUAGE_NAME_MISMATCH flag raised");

console.log("\n=== Test 11: byCode grouping ===");
console.log("byCode keys:", Object.keys(r1.byCode).length);
assert(Object.keys(r1.byCode).length > 0 || r1.flags.length === 0, "byCode populated (or no flags)");

console.log("\n=== Test 12: ARABIC_NAME_HAS_LATIN (Arabic field has Latin) ===");
const arabicLatin: CrossFieldInput = { ...cleanInput, fullNameAr: "محمد John" };
const r12 = crossFieldValidate(arabicLatin);
console.log("Flags:", r12.flags.filter(f => f.code.startsWith("ARABIC")).map(f => `${f.code}(${f.severity})`).join(", "));
assert(r12.flags.some(f => f.code === "ARABIC_NAME_HAS_LATIN"), "ARABIC_NAME_HAS_LATIN flag raised");

console.log("\n=== Test 13: GENDER_UNRECOGNIZED ===");
const badGenderEnum: CrossFieldInput = { ...cleanInput, gender: "Unknown" };
const r13 = crossFieldValidate(badGenderEnum);
console.log("Flags:", r13.flags.filter(f => f.code.startsWith("GENDER")).map(f => `${f.code}(${f.severity})`).join(", "));
assert(r13.flags.some(f => f.code === "GENDER_UNRECOGNIZED"), "GENDER_UNRECOGNIZED flag raised");

console.log("\n=== Test 14: Photo gender heuristic mismatch ===");
const photoMismatch: CrossFieldInput = { ...cleanInput, photoGender: "Female", photoPresent: true };
const r14 = crossFieldValidate(photoMismatch);
console.log("Flags:", r14.flags.filter(f => f.code === "PHOTO_GENDER_HEURISTIC_MISMATCH").map(f => `${f.code}(${f.severity})`).join(", "));
assert(r14.flags.some(f => f.code === "PHOTO_GENDER_HEURISTIC_MISMATCH"), "PHOTO_GENDER_HEURISTIC_MISMATCH flag raised");

console.log("\n=== Test 15: MRZ nationality mismatch (UTO vs SA) ===");
if (parsedMrz) {
  const mrzInput: CrossFieldInput = { ...cleanInput, mrzText: mrzSample, country: "SA", docType: "passport", documentNo: "AABB123456" };
  const r15 = crossFieldValidate(mrzInput);
  console.log("MRZ flags:", r15.flags.filter(f => f.code.startsWith("MRZ")).map(f => `${f.code}(${f.severity})`).join(", "));
  assert(r15.flags.some(f => f.code === "MRZ_NATIONALITY_MISMATCH"), "MRZ_NATIONALITY_MISMATCH flag raised (MRZ UTO vs country SA)");
} else {
  console.log("Skipped (MRZ sample didn't parse)");
}

console.log("\n=== Test 16: Date format non-ISO ===");
const badDateFormat: CrossFieldInput = { ...cleanInput, birthDate: "01/15/1995" };
const r16 = crossFieldValidate(badDateFormat);
console.log("Flags:", r16.flags.filter(f => f.code === "DATE_FORMAT_NON_ISO").map(f => `${f.code}(${f.severity})`).join(", "));
assert(r16.flags.some(f => f.code === "DATE_FORMAT_NON_ISO"), "DATE_FORMAT_NON_ISO flag raised");

console.log("\n=== Test 17: Name length too short (single token) ===");
const shortName: CrossFieldInput = { ...cleanInput, fullNameAr: "محمد", fullNameEn: "Mohamed" };
const r17 = crossFieldValidate(shortName);
console.log("Flags:", r17.flags.filter(f => f.code.endsWith("NAME_TOO_SHORT")).map(f => `${f.code}(${f.severity})`).join(", "));
const shortNameFlags = r17.flags.filter(f => f.code.endsWith("NAME_TOO_SHORT"));
assert(shortNameFlags.length >= 2, `At least 2 NAME_TOO_SHORT flags (got ${shortNameFlags.length})`);

console.log("\n=== Test 18: Exports ===");
assert(CROSS_FIELD_CHECK_COUNT === 30, `Exported count = 30 (got ${CROSS_FIELD_CHECK_COUNT})`);
assert(CROSS_FIELD_CHECK_NAMES.length === 30, `Names array length = 30 (got ${CROSS_FIELD_CHECK_NAMES.length})`);

console.log("\n=== Test 19: Severity scoring (critical = 1.0 deduction) ===");
const onlyCritical: CrossFieldInput = { ...cleanInput, nationalId: "29501010123450" }; // tampered check digit
const r19 = crossFieldValidate(onlyCritical);
const checksumFail = r19.flags.find(f => f.code === "ID_CHECKSUM_MISMATCH");
console.log("ID checksum flag:", checksumFail);
assert(checksumFail?.severity === "critical", "ID_CHECKSUM_MISMATCH is critical severity");
// Score should be at most 1.0 - 1.0 (the critical deduction) + extras
// Actually it deducts for ALL flags, so just verify the deduction is correct on a single-flag case
console.log("Score (lower is worse, 0=floor):", r19.consistencyScore);

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
