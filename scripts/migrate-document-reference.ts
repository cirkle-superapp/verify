/**
 * Migration runner — Document Reference Database (001).
 *
 * Phase 2 / Task P2-A.
 *
 * Reads migrations/001_document_reference.sql and applies it against
 * Turso using the same raw HTTP /v2/pipeline wire protocol the rest
 * of the platform uses (see src/lib/turso-http-client.ts). Idempotent
 * — every statement is `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX
 * IF NOT EXISTS`, so re-running is safe.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://your-db.turso.io \
 *   TURSO_AUTH_TOKEN=<token> \
 *   bun run scripts/migrate-document-reference.ts
 *
 * Options:
 *   --dry-run   Parse + print statements without executing.
 *   --file=<p>  Override the migration file path.
 *   --verbose   Print every statement before executing.
 */

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// ─── Helpers ─────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));

function defaultMigrationPath(): string {
  return resolve(here, "..", "migrations", "001_document_reference.sql");
}

function parseArgs(argv: string[]): { dryRun: boolean; verbose: boolean; file: string } {
  let dryRun = false;
  let verbose = false;
  let file = defaultMigrationPath();
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--verbose") verbose = true;
    else if (a.startsWith("--file=")) file = a.slice("--file=".length);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: migrate-document-reference.ts [--dry-run] [--verbose] [--file=PATH]",
      );
      process.exit(0);
    }
  }
  return { dryRun, verbose, file };
}

/**
 * Split the SQL file into individual statements, preserving the
 * statement boundaries. Trailing whitespace + comments are stripped
 * (we don't strip inside-string comments because libSQL's DDL has
 * no string literals in this migration).
 */
function splitStatements(sql: string): string[] {
  // Drop line comments first so they don't leak into statements.
  const noComments = sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      // Naive — assumes no "--" inside string literals. Safe for DDL.
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");

  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface TursoResult {
  ok: boolean;
  affected?: number;
  error?: string;
}

/**
 * Post the SQL statement to Turso's /v2/pipeline endpoint. Returns
 * a normalised result for the caller to log.
 */
async function executeStatement(
  httpUrl: string,
  token: string | undefined,
  sql: string,
): Promise<TursoResult> {
  const body = JSON.stringify({
    requests: [{ type: "execute", stmt: { sql } }],
  });
  try {
    const res = await fetch(`${httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: token
        ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
      body,
    });
    const json: any = await res.json();
    if (res.ok && json.results?.[0]?.type === "ok") {
      return { ok: true, affected: json.results[0].response?.result?.affected_row_count ?? 0 };
    }
    const err =
      json.results?.[0]?.error?.message ||
      json.error ||
      `HTTP ${res.status}: ${JSON.stringify(json)}`;
    // Idempotency: SQLite reports "already exists" — treat as ok.
    if (String(err).toLowerCase().includes("already exists")) {
      return { ok: true, affected: 0 };
    }
    return { ok: false, error: String(err) };
  } catch (e: any) {
    return { ok: false, error: `network: ${e?.message ?? String(e)}` };
  }
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const { dryRun, verbose, file } = parseArgs(process.argv);

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error(
      "Missing TURSO_DATABASE_URL.\n\n" +
        "Usage:\n" +
        "  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \\\n" +
        "  bun run scripts/migrate-document-reference.ts\n\n" +
        "Flags: --dry-run, --verbose, --file=<path>",
    );
    process.exit(1);
  }

  const httpUrl = url.replace(/^libsql:/, "https:");

  // Resolve migration file (relative to CWD if not absolute).
  const migrationPath = resolve(process.cwd(), file);
  let sql: string;
  try {
    sql = readFileSync(migrationPath, "utf-8");
  } catch (e: any) {
    console.error(`✗ Failed to read migration file '${migrationPath}': ${e?.message ?? e}`);
    process.exit(1);
  }

  const statements = splitStatements(sql);
  console.log(`Loaded ${migrationPath}`);
  console.log(`Parsed ${statements.length} statements.`);

  if (dryRun) {
    console.log("\n[dry-run] Would execute:\n");
    statements.forEach((s, i) => {
      const preview = s.replace(/\s+/g, " ").slice(0, 80);
      console.log(`  ${i + 1}. ${preview}${s.length > 80 ? "…" : ""}`);
    });
    process.exit(0);
  }

  console.log(`\nConnecting to ${url}…`);

  // Connectivity probe.
  const probe = await executeStatement(httpUrl, token, "SELECT 1 AS ok");
  if (!probe.ok) {
    console.error(`✗ Connection failed: ${probe.error}`);
    process.exit(1);
  }
  console.log("✓ Connection successful\n");

  let applied = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
    if (verbose) console.log(`  [${i + 1}/${statements.length}] ${preview}${stmt.length > 70 ? "…" : ""}`);

    const result = await executeStatement(httpUrl, token, stmt);
    if (result.ok) {
      // Determine whether this was a no-op (already exists) or a fresh apply.
      const alreadyExists = (result.affected ?? 0) === 0; // heuristic
      if (verbose || alreadyExists) {
        const tag = alreadyExists ? "⊘ already exists" : "✓ applied";
        console.log(`     ${tag}`);
      }
      applied++;
    } else {
      const err = result.error ?? "unknown";
      if (String(err).toLowerCase().includes("already exists")) {
        // Treated as ok above — defensive double-check.
        skipped++;
      } else {
        console.log(`  ✗ [${i + 1}] ${preview}`);
        console.log(`     ${err}`);
        failed++;
      }
    }
  }

  console.log(
    `\nMigration summary: ${applied} applied, ${skipped} skipped, ${failed} failed (of ${statements.length} statements).`,
  );

  // Verification: list created tables. Use the project's TursoHttpClient
  // (which parses rows from /v2/pipeline) so the operator can actually
  // see the tables we just created.
  try {
    const { TursoHttpClient } = await import("../src/lib/turso-http-client");
    const client = new TursoHttpClient({ url, authToken: token });
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('countries','issuing_authorities','document_definitions','source_provenance','coverage_gaps') ORDER BY name",
    );
    console.log("\nDocument-reference tables now present:");
    if (result.rows.length === 0) {
      console.log("  (none found — check Turso dashboard)");
    } else {
      for (const r of result.rows) {
        const name = (r as { name?: string }).name ?? JSON.stringify(r);
        console.log(`  - ${name}`);
      }
    }
  } catch (e: any) {
    console.log(`\n(could not enumerate tables: ${e?.message ?? e})`);
  }

  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e?.message ?? e);
  process.exit(1);
});
