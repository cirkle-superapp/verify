import { callText, callVision } from "@/lib/ai-router";

console.log("=== Testing callText (Arabic translation) ===");
const result = await callText(
  "Translate to English: محمد أحمد عبد الرحمن السيد. Return only the English name.",
  "You are an Arabic-to-English translator specializing in personal names."
);
console.log("callText result:", result);

console.log("\n=== Testing callVision (OCR on text-only image) ===");
// Create a simple text image
import { renderDocImage } from "@/lib/doc-renderer";
const img = renderDocImage({
  fullNameAr: "محمد أحمد عبد الرحمن",
  fullNameEn: "Mohamed Ahmed Abdelrahman",
  nationalId: "29001011234567",
  birthDate: "1990-01-01",
  gender: "Male",
  docType: "national_id",
  countryName: "Egypt",
});
const ocr = await callVision("Read ALL text visible on this image. Output the raw text.", [img]);
console.log("callVision OCR result:", ocr?.slice(0, 300));

process.exit(0);
