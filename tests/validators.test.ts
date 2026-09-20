/**
 * ID validator tests.
 *
 * Verifies:
 *   - Egyptian ID checksum (validateEgyptianId) — 14-digit weighted mod-11
 *   - Saudi ID checksum (validateSaudiId) — Luhn variant
 *   - IBAN MOD-97 (algorithm verified inline)
 *   - Luhn (credit card algorithm verified inline)
 *   - ISO 7064 MOD 11-2 (algorithm verified inline)
 *
 * Each algorithm is tested with one valid sample (should pass) and
 * one invalid sample (should fail). The Egyptian + Saudi tests use
 * the actual exported validators; the IBAN / Luhn / ISO-7064 tests
 * re-implement the algorithm in-test so the spec stays independent
 * of any specific national-ID validator's quirks.
 */

import {
  validateEgyptianId,
  validateSaudiId,
  validateNationalId,
} from "@/lib/id-validators";
import { runTest, assert, assertEqual } from "./lib/runner";

// ─── IBAN MOD-97 (verified inline) ─────────────────────────────────
// Algorithm: move first 4 chars to end, replace each letter with two
// digits (A=10, B=11, ..., Z=35), parse as a big integer, take mod 97.
// Result must equal 1 for the IBAN to be valid.

function ibanMod97(iban: string): number {
  const cleaned = iban.replace(/\s/g, "").toUpperCase();
  if (cleaned.length < 5) return -1;
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  // Compute mod 97 over the (potentially very long) digit string.
  let remainder = 0;
  for (const ch of expanded) {
    remainder = (remainder * 10 + parseInt(ch, 10)) % 97;
  }
  return remainder;
}

// ─── Luhn (verified inline) ────────────────────────────────────────
// Algorithm: from the rightmost digit (the check digit), double every
// second digit. If the result is > 9, subtract 9. Sum all. The total
// mod 10 must equal 0.

function luhnValid(num: string): boolean {
  const cleaned = num.replace(/\D/g, "");
  if (cleaned.length < 2) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let d = parseInt(cleaned[i], 10);
    if (shouldDouble) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

// ─── ISO 7064 MOD 11-2 (verified inline) ──────────────────────────
// Algorithm: weights are powers of 2 (mod 11). For each digit at
// position i (0-indexed from the left), weight = 2^(i+1) mod 11.
// Sum the products. The check digit C is chosen so that (sum + C) mod 11 = 1.
// (Hybrid variant: append C, re-compute weights, mod 11 = 1.)

function iso7064Mod11_2(input: string): { checkDigit: number; valid: boolean } {
  const digits = input.replace(/\D/g, "");
  if (digits.length < 2) return { checkDigit: -1, valid: false };
  // Body = all but last digit; last digit is the check digit.
  const body = digits.slice(0, -1);
  const providedCheck = parseInt(digits[digits.length - 1], 10);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const weight = Math.pow(2, i + 1) % 11;
    sum += parseInt(body[i], 10) * weight;
  }
  const expectedCheck = (12 - (sum % 11)) % 11;
  const valid = expectedCheck === providedCheck;
  return { checkDigit: expectedCheck, valid };
}

// ─── Tests ──────────────────────────────────────────────────────────

export async function run() {
  return [
    // ─── Egyptian ID ───────────────────────────────────────────────
    await runTest("validateEgyptianId: valid format + valid checksum (29608010101238)", () => {
      const r = validateEgyptianId("29608010101238");
      assert(r.isValid, "expected isValid=true", r.reasoning);
      assert(r.checksumValid, "expected checksumValid=true", r.reasoning);
      assertEqual(r.country, "EG", "country");
      assertEqual(r.idType, "national_id", "idType");
      // Should extract birth date fields.
      assert(!!r.extractedFields?.birthDate, "should extract birthDate");
      assert(!!r.extractedFields?.gender, "should extract gender");
    }),

    await runTest("validateEgyptianId: famous test ID 29608010101234 has checksum mismatch", () => {
      const r = validateEgyptianId("29608010101234");
      assert(r.isValid, "expected isValid=true (format valid)", r.reasoning);
      assert(!r.checksumValid, "expected checksumValid=false (test ID has bad checksum)");
    }),

    await runTest("validateEgyptianId: too short (123) fails format", () => {
      const r = validateEgyptianId("123");
      assert(!r.isValid, "expected isValid=false");
      assert(!r.checksumValid, "expected checksumValid=false");
    }),

    await runTest("validateEgyptianId: invalid month (29613010101238) fails", () => {
      const r = validateEgyptianId("29613010101238");
      assert(!r.isValid, "expected isValid=false (month 13 invalid)");
    }),

    await runTest("validateEgyptianId: invalid day (29608320101238 — day 32) fails", () => {
      const r = validateEgyptianId("29608320101238");
      assert(!r.isValid, "expected isValid=false (day 32 invalid)");
    }),

    // ─── Saudi ID ──────────────────────────────────────────────────
    await runTest("validateSaudiId: valid Luhn checksum (1020304059)", () => {
      const r = validateSaudiId("1020304059");
      assert(r.isValid, "expected isValid=true", r.reasoning);
      assert(r.checksumValid, "expected checksumValid=true", r.reasoning);
      assertEqual(r.country, "SA", "country");
    }),

    await runTest("validateSaudiId: invalid checksum (1020304050)", () => {
      const r = validateSaudiId("1020304050");
      assert(r.isValid, "expected isValid=true (format valid)", r.reasoning);
      assert(!r.checksumValid, "expected checksumValid=false");
    }),

    await runTest("validateSaudiId: too short (123) fails format", () => {
      const r = validateSaudiId("123");
      assert(!r.isValid, "expected isValid=false");
      assert(!r.checksumValid, "expected checksumValid=false");
    }),

    // ─── IBAN MOD-97 ───────────────────────────────────────────────
    await runTest("IBAN MOD-97: GB82 WEST 1234 5698 7654 32 is valid", () => {
      const remainder = ibanMod97("GB82WEST12345698765432");
      assertEqual(remainder, 1, "MOD-97 remainder for valid GB IBAN");
    }),

    await runTest("IBAN MOD-97: GB82 WEST 1234 5698 7654 33 (corrupted) is invalid", () => {
      const remainder = ibanMod97("GB82WEST12345698765433");
      assert(remainder !== 1, `expected remainder ≠ 1, got ${remainder}`);
    }),

    await runTest("IBAN MOD-97: DE89 3704 0044 0532 0130 00 (real German IBAN) is valid", () => {
      const remainder = ibanMod97("DE89370400440532013000");
      assertEqual(remainder, 1, "MOD-97 remainder for valid DE IBAN");
    }),

    // ─── Luhn (credit cards) ───────────────────────────────────────
    await runTest("Luhn: Visa test card 4111111111111111 is valid", () => {
      assert(luhnValid("4111111111111111"), "expected Luhn-valid Visa test card");
    }),

    await runTest("Luhn: 4111111111111112 (one off) is invalid", () => {
      assert(!luhnValid("4111111111111112"), "expected Luhn-invalid");
    }),

    await runTest("Luhn: Mastercard test 5555555555554444 is valid", () => {
      assert(luhnValid("5555555555554444"), "expected Luhn-valid Mastercard");
    }),

    await runTest("Luhn: 5555555555554445 (one off) is invalid", () => {
      assert(!luhnValid("5555555555554445"), "expected Luhn-invalid");
    }),

    // ─── ISO 7064 MOD 11-2 ─────────────────────────────────────────
    await runTest("ISO 7064 MOD 11-2: 079 (X=10 placeholder omitted; sample body)", () => {
      // Body "07" → weights 2^1=2, 2^2=4. Sum = 0*2 + 7*4 = 28. 28 mod 11 = 6.
      // Expected check = (12 - 6) mod 11 = 6.
      const r = iso7064Mod11_2("076");
      assertEqual(r.checkDigit, 6, "ISO 7064 check digit for body 07");
      assert(r.valid, "expected self-consistent ISO 7064 sample");
    }),

    await runTest("ISO 7064 MOD 11-2: corrupted check digit fails", () => {
      const r = iso7064Mod11_2("077");
      assert(!r.valid, "expected invalid check digit");
    }),

    // ─── Cross-cutting: validateNationalId dispatcher ──────────────
    await runTest("validateNationalId: dispatcher routes EG to Egyptian validator", () => {
      const r = validateNationalId("EG", "29608010101238");
      assert(r.country === "EG", "country should be EG");
      assert(r.isValid, "EG dispatcher should return isValid=true");
    }),

    await runTest("validateNationalId: dispatcher routes SA to Saudi validator", () => {
      const r = validateNationalId("SA", "1020304059");
      assert(r.country === "SA", "country should be SA");
      assert(r.isValid, "SA dispatcher should return isValid=true");
    }),

    await runTest("validateNationalId: unknown country returns isValid=false", () => {
      const r = validateNationalId("XX", "123");
      assert(!r.isValid, "unknown country should return isValid=false");
    }),
  ];
}
