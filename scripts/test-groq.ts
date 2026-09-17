import { groqText, openRouterText, callText } from "@/lib/ai-router";

console.log("=== Testing Groq ===");
const g = await groqText("Translate to English: محمد أحمد عبد الرحمن السيد", "You are an Arabic-to-English translator specializing in personal names.");
console.log("Groq result:", g);

console.log("\n=== Testing OpenRouter ===");
const o = await openRouterText("Translate to English: فاطمة علي حسن إبراهيم", "You are an Arabic-to-English translator.");
console.log("OpenRouter result:", o);

console.log("\n=== Testing callText (failover) ===");
const t = await callText("Extract the national ID number (14 digits) from this text: الاسم: أحمد محمد الرقم القومي: 29001011234567", "You extract structured data from Arabic identity documents.");
console.log("callText result:", t);

process.exit(0);
