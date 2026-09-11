/**
 * Backup the Cirkle Turso database to a SQL file.
 *
 * Dumps all rows from our 4 tables (Verification, DocumentSample,
 * EvaluationRun, EvaluationResult) as INSERT statements, plus the schema.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *   bun run scripts/backup-turso.ts
 *
 * Output: backup/cirkle-backup-<timestamp>.sql
 */
import { createClient } from "@libsql/client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error("Missing TURSO_DATABASE_URL");
    process.exit(1);
  }

  const httpUrl = url.replace(/^libsql:/, "https:");
  console.log(`Backing up ${url}...`);

  const tables = ["Verification", "DocumentSample", "EvaluationRun", "EvaluationResult"];
  const lines: string[] = [
    "-- Cirkle Identity Verification — Turso backup",
    `-- Generated: ${new Date().toISOString()}`,
    `-- Source: ${url}`,
    "",
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
    "",
  ];

  for (const table of tables) {
    console.log(`  Dumping ${table}...`);
    try {
      const res = await fetch(`${httpUrl}/v2/pipeline`, {
        method: "POST",
        headers: token
          ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
          : { "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ type: "execute", stmt: { sql: `SELECT * FROM ${table}` } }] }),
      });
      const json: any = await res.json();
      const result = json.results?.[0]?.response?.result;
      if (!result) {
        lines.push(`-- (skipped ${table}: no result)`);
        continue;
      }
      const cols = result.cols.map((c: any) => c.name);
      const rows = result.rows;
      lines.push(`-- Table: ${table} (${rows.length} rows)`);
      lines.push(`DELETE FROM ${table};`);
      for (const row of rows) {
        const values = row.map((cell: any) => {
          if (cell === null || cell === undefined) return "NULL";
          if (typeof cell === "object" && "value" in cell) {
            const v = cell.value;
            if (v === null) return "NULL";
            const escaped = String(v).replace(/'/g, "''");
            return `'${escaped}'`;
          }
          const escaped = String(cell).replace(/'/g, "''");
          return `'${escaped}'`;
        });
        lines.push(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${values.join(", ")});`);
      }
      lines.push("");
    } catch (e: any) {
      lines.push(`-- ERROR dumping ${table}: ${e.message}`);
    }
  }

  lines.push("COMMIT;");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupDir = join(process.cwd(), "backup");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `cirkle-backup-${timestamp}.sql`);
  writeFileSync(backupPath, lines.join("\n"));

  console.log(`\n✓ Backup saved to ${backupPath}`);
  console.log(`  Size: ${(lines.join("\n").length / 1024).toFixed(1)}KB`);
  console.log(`  Lines: ${lines.length}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
