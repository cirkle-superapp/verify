/**
 * Regenerate all training sample images as real JPEGs.
 *
 * Reads all DocumentSample records from Turso, replaces their text-based
 * imageData with actual JPEG images rendered via @napi-rs/canvas,
 * and mirrors to Neon Postgres.
 *
 * Usage:
 *   TURSO_TOKEN=... bun run scripts/regenerate-images.ts
 */

import { TursoHttpClient } from "@/lib/turso-http-client";
import { renderDocImage } from "@/lib/doc-renderer";
import { neon } from "@neondatabase/serverless";

const tursoUrl = "libsql://validate-fortleem.aws-us-east-2.turso.io";
const tursoToken = process.env.TURSO_TOKEN!;
const neonUrl = process.env.NEON_DATABASE_URL || "postgresql://neondb_owner:npg_3iB1acDHTPCt@ep-dry-bread-aum66qr0-pooler.c-10.us-east-1.aws.neon.tech/Cirkle-verify%20?sslmode=require";

const tursoClient = new TursoHttpClient({ url: tursoUrl, authToken: tursoToken });
const neonSql = neon(neonUrl);

async function main() {
  console.log("Fetching all samples from Turso...");
  const res = await tursoClient.execute("SELECT id, name, docType, source, imageData, fullNameAr, fullNameEn, nationalId, birthDate, gender, address, job, religion, maritalStatus, documentNo, expiryDate, nationality FROM DocumentSample");
  const samples = res.rows;
  console.log("Found", samples.length, "samples to regenerate\n");

  let updated = 0;
  let skipped = 0;

  for (const s of samples) {
    const id = (s as any).id as string;
    const oldImage = (s as any).imageData as string;

    // Skip if already has a real image
    if (oldImage && oldImage.startsWith("data:image/")) {
      skipped++;
      continue;
    }

    // Render a real JPEG image
    const newImage = renderDocImage({
      fullNameAr: (s as any).fullNameAr || undefined,
      fullNameEn: (s as any).fullNameEn || undefined,
      nationalId: (s as any).nationalId || undefined,
      birthDate: (s as any).birthDate || undefined,
      gender: (s as any).gender || undefined,
      address: (s as any).address || undefined,
      job: (s as any).job || undefined,
      religion: (s as any).religion || undefined,
      maritalStatus: (s as any).maritalStatus || undefined,
      documentNo: (s as any).documentNo || undefined,
      expiryDate: (s as any).expiryDate || undefined,
      nationality: (s as any).nationality || undefined,
      docType: (s as any).docType || "national_id",
      country: (s as any).source === "worldwide" ? "WW" : "EG",
      countryName: (s as any).source === "worldwide" ? "Worldwide Training" : "Egypt",
    });

    // Update Turso
    try {
      await tursoClient.execute(
        'UPDATE DocumentSample SET "imageData" = ? WHERE id = ?',
        [newImage, id]
      );
    } catch (e: any) {
      console.log("  x Turso update failed for", id, ":", e.message?.slice(0, 60));
    }

    // Update Neon
    try {
      await neonSql`UPDATE "DocumentSample" SET "imageData" = ${newImage} WHERE id = ${id}`;
    } catch (e: any) {
      // Neon might not have this record — insert it
      try {
        await neonSql`INSERT INTO "DocumentSample" (
          id, name, "docType", source, "imageData",
          "fullNameAr", "fullNameEn", "nationalId", "birthDate", "gender",
          "documentNo", "expiryDate", "nationality", "job", "religion", "maritalStatus",
          "notes", "tags", "createdAt", "updatedAt"
        ) VALUES (
          ${id},
          ${(s as any).name || "Training sample"},
          ${(s as any).docType || "national_id"},
          ${(s as any).source || "training"},
          ${newImage},
          ${(s as any).fullNameAr || null},
          ${(s as any).fullNameEn || null},
          ${(s as any).nationalId || null},
          ${(s as any).birthDate || null},
          ${(s as any).gender || null},
          ${(s as any).documentNo || null},
          ${(s as any).expiryDate || null},
          ${(s as any).nationality || null},
          ${(s as any).job || null},
          ${(s as any).religion || null},
          ${(s as any).maritalStatus || null},
          ${"Regenerated image"},
          ${(s as any).tags || null},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`;
      } catch (e2: any) {
        // skip — duplicate or missing
      }
    }

    updated++;
    if (updated % 20 === 0) console.log("  + Regenerated " + updated + "/" + samples.length);
  }

  console.log("\n✓ Updated " + updated + " samples with real JPEG images");
  console.log("  Skipped (already had images): " + skipped);

  // Verify
  const verify = await tursoClient.execute("SELECT COUNT(*) as n FROM DocumentSample WHERE imageData LIKE 'data:image/%'");
  const imageCount = (verify.rows[0] as any)?.n || 0;
  console.log("  Samples with image data URLs: " + imageCount);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
