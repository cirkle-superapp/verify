import { validateNationalId } from "../src/lib/id-validators";

// Try to find a valid Egyptian ID with prefix 295010101 (born 1995-01-01, governorate 01=Cairo, first seq digit 2 → female? actually odd=male, even=female)
const prefix = "2950101" + "01" + "2345"; // 13 digits: born 1995-01-01, Cairo governorate, sequence 2345 (first seq digit 2 = even = female)
// Compute check digit per Egyptian algorithm in id-validators.ts:
// weights = (i+1) for i=0..12, sum mod 11, expectedCheck = (11 - sum) % 11
let sum = 0;
for (let i = 0; i < 13; i++) {
  sum += parseInt(prefix[i], 10) * (i + 1);
}
const expectedCheck = (11 - (sum % 11)) % 11;
console.log(`prefix=${prefix} sum=${sum} sum%11=${sum % 11} expectedCheck=${expectedCheck}`);
const fullId = prefix + expectedCheck;
console.log("fullId:", fullId);
const v = validateNationalId("EG", fullId);
console.log("validation:", JSON.stringify(v, null, 2));
