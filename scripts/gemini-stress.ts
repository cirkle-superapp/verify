import { TursoHttpClient } from "@/lib/turso-http-client";
import { callVision } from "@/lib/ai-router";
import { extractDocumentSelfHosted } from "@/lib/doc-parser";
import { fieldMatches } from "@/lib/doc-validators";

const turso = new TursoHttpClient({ url: "libsql://validate-fortleem.aws-us-east-2.turso.io", authToken: process.env.TURSO_TOKEN! });

// Get 5 benchmark samples with images
const res = await turso.execute("SELECT name, imageData, fullNameAr, nationalId, gender, birthDate, job, religion FROM DocumentSample LIMIT 5");
const samples = res.rows;
console.log("Testing Gemini OCR on", samples.length, "benchmark samples...\n");

let nameOk = 0, nidOk = 0, genderOk = 0, jobOk = 0;

for (const s of samples) {
  const img = (s as any).imageData;
  const expName = (s as any).fullNameAr;
  const expNid = (s as any).nationalId;
  const expGender = (s as any).gender;
  const expJob = (s as any).job;

  console.log("--- " + (s as any).name + " ---");
  console.log("  Expected: " + expName + " | NID: " + expNid + " | Job: " + expJob);

  // Run Gemini OCR
  const t0 = Date.now();
  const ocrText = await callVision(
    "Read ALL Arabic and English text visible on this document. Output the raw text line by line.",
    [img]
  );
  const elapsed = Date.now() - t0;

  console.log("  Gemini OCR time: " + (elapsed / 1000).toFixed(1) + "s");
  console.log("  OCR text (first 200): " + ocrText?.slice(0, 200));

  // Run parser
  const fakeOcr = { text: ocrText || "", confidence: 0.9, words: [] };
  const data = await extractDocumentSelfHosted(fakeOcr as any, null, "national_id", img);

  const nm = fieldMatches(expName, data.fullNameAr);
  const nd = fieldMatches(expNid, data.nationalId);
  const gd = fieldMatches(expGender, data.gender);
  const jb = fieldMatches(expJob, data.job);

  console.log("  Extracted: name=" + data.fullNameAr + ", nid=" + data.nationalId + ", job=" + data.job);
  console.log("  Match: name=" + (nm ? "✓" : "✗") + ", nid=" + (nd ? "✓" : "✗") + ", gender=" + (gd ? "✓" : "✗") + ", job=" + (jb ? "✓" : "✗"));

  if (nm) nameOk++; if (nd) nidOk++; if (gd) genderOk++; if (jb) jobOk++;
}

const total = samples.length;
console.log("\n═══════════════════════════════════════════════");
console.log("  GEMINI OCR BENCHMARK — " + total + " samples");
console.log("═══════════════════════════════════════════════");
console.log("  Name:    " + nameOk + "/" + total + " (" + Math.round(nameOk/total*100) + "%)");
console.log("  NID:     " + nidOk + "/" + total + " (" + Math.round(nidOk/total*100) + "%)");
console.log("  Gender:  " + genderOk + "/" + total + " (" + Math.round(genderOk/total*100) + "%)");
console.log("  Job:     " + jobOk + "/" + total + " (" + Math.round(jobOk/total*100) + "%)");
process.exit(0);
