/**
 * Neon PostgreSQL HTTP client.
 *
 * Uses @neondatabase/serverless (HTTP-based, no TCP connection needed).
 * Provides a Prisma-compatible interface for dual-write with Turso.
 *
 * Every write to Turso automatically mirrors to Neon for redundancy.
 */

import { neon } from "@neondatabase/serverless";

let sqlInstance: ReturnType<typeof neon> | null = null;

function getSql() {
  if (!sqlInstance) {
    const url = process.env.NEON_DATABASE_URL;
    if (!url) return null;
    sqlInstance = neon(url);
  }
  return sqlInstance;
}

function genId(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const neonDb = {
  /** Insert a verification record into Neon (mirror of Turso write) */
  async insertVerification(data: Record<string, unknown>): Promise<boolean> {
    const sql = getSql();
    if (!sql) return false;
    try {
      const id = (data.id as string) || genId();
      await sql`
        INSERT INTO "Verification" (
          id, "docType", "docSide", "docImageFront", "docImageBack",
          "fullNameAr", "fullNameEn", "nationalId", "birthDate", "address",
          "gender", "documentNo", "expiryDate", "nationality", "job",
          "religion", "maritalStatus", "extraFields", "imageQuality",
          "fieldConfidence", "selfieImage", "livenessFrames", "livenessActions",
          "docConfidence", "faceMatchScore", "livenessScore", "status", "notes",
          "createdAt", "updatedAt"
        ) VALUES (
          ${id},
          ${data.docType as string || "national_id"},
          ${data.docSide as string || "front"},
          ${data.docImageFront as string || null},
          ${data.docImageBack as string || null},
          ${data.fullNameAr as string || null},
          ${data.fullNameEn as string || null},
          ${data.nationalId as string || null},
          ${data.birthDate as string || null},
          ${data.address as string || null},
          ${data.gender as string || null},
          ${data.documentNo as string || null},
          ${data.expiryDate as string || null},
          ${data.nationality as string || null},
          ${data.job as string || null},
          ${data.religion as string || null},
          ${data.maritalStatus as string || null},
          ${data.extraFields as string || null},
          ${data.imageQuality as number || 0},
          ${data.fieldConfidence as string || null},
          ${data.selfieImage as string || null},
          ${data.livenessFrames as string || null},
          ${data.livenessActions as string || null},
          ${data.docConfidence as number || 0},
          ${data.faceMatchScore as number || 0},
          ${data.livenessScore as number || 0},
          ${data.status as string || "pending"},
          ${data.notes as string || null},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      return true;
    } catch (e: any) {
      console.error("[Neon] insertVerification error:", e.message?.slice(0, 100));
      return false;
    }
  },

  /** Insert a document sample into Neon */
  async insertSample(data: Record<string, unknown>): Promise<boolean> {
    const sql = getSql();
    if (!sql) return false;
    try {
      const id = (data.id as string) || genId();
      await sql`
        INSERT INTO "DocumentSample" (
          id, name, "docType", source, "imageData", "backImageData",
          "fullNameAr", "fullNameEn", "nationalId", "birthDate", "address",
          "gender", "documentNo", "expiryDate", "nationality", "job",
          "religion", "maritalStatus", "notes", "tags",
          "createdAt", "updatedAt"
        ) VALUES (
          ${id},
          ${data.name as string},
          ${data.docType as string || "national_id"},
          ${data.source as string || "manual"},
          ${data.imageData as string},
          ${data.backImageData as string || null},
          ${data.fullNameAr as string || null},
          ${data.fullNameEn as string || null},
          ${data.nationalId as string || null},
          ${data.birthDate as string || null},
          ${data.address as string || null},
          ${data.gender as string || null},
          ${data.documentNo as string || null},
          ${data.expiryDate as string || null},
          ${data.nationality as string || null},
          ${data.job as string || null},
          ${data.religion as string || null},
          ${data.maritalStatus as string || null},
          ${data.notes as string || null},
          ${data.tags as string || null},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      return true;
    } catch (e: any) {
      console.error("[Neon] insertSample error:", e.message?.slice(0, 100));
      return false;
    }
  },

  /** Count rows in a table */
  async count(table: string): Promise<number> {
    const sql = getSql();
    if (!sql) return -1;
    try {
      const rows = await sql`SELECT COUNT(*) as n FROM ${sql(table)}`;
      return Number(rows[0]?.n || 0);
    } catch {
      return -1;
    }
  },

  /** Check if Neon is available */
  isAvailable(): boolean {
    return !!process.env.NEON_DATABASE_URL;
  },
};
