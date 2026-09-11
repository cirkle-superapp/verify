/**
 * Push the Cirkle Identity Verification schema to Turso.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://identity-fortleem.aws-us-east-1.turso.io \
 *   TURSO_AUTH_TOKEN=<your-valid-token> \
 *   bun run scripts/push-to-turso.ts
 *
 * If you don't have a valid token yet, generate one with the Turso CLI:
 *   turso auth login
 *   turso db tokens create identity-fortleem
 *
 * Or apply the schema directly via the Turso shell:
 *   turso db shell identity-fortleem < prisma/schema.sql
 */
import { createClient } from "@libsql/client";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url || !token) {
    console.error(
      "Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.\n\n" +
        "Usage:\n" +
        "  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run scripts/push-to-turso.ts\n\n" +
        "Get a valid token with:\n" +
        "  turso auth login && turso db tokens create identity-fortleem"
    );
    process.exit(1);
  }

  console.log(`Connecting to ${url}...`);
  const client = createClient({ url, authToken: token });

  // Test connection
  try {
    const test = await client.execute("SELECT 1 as ok");
    console.log("✓ Connection successful");
  } catch (e: any) {
    console.error("✗ Connection failed:", e.message);
    if (e.message.includes("404") || e.message.includes("auth role not found")) {
      console.error(
        "\nThe token's role is not authorized on this database.\n" +
          "Generate a valid token with:\n" +
          "  turso auth login\n" +
          "  turso db tokens create identity-fortleem"
      );
    }
    process.exit(1);
  }

  // Read and apply schema
  const schemaPath = join(import.meta.dir, "..", "prisma", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // Split on semicolons (not inside strings — our schema has none, so simple split works)
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`\nApplying ${statements.length} DDL statements...`);
  let applied = 0;
  for (const stmt of statements) {
    try {
      await client.execute(stmt);
      const preview = stmt.replace(/\s+/g, " ").slice(0, 70);
      console.log(`  ✓ ${preview}...`);
      applied++;
    } catch (e: any) {
      if (e.message.includes("already exists")) {
        console.log(`  ⊘ already exists: ${stmt.replace(/\s+/g, " ").slice(0, 50)}...`);
      } else {
        console.error(`  ✗ error: ${e.message}`);
      }
    }
  }

  console.log(`\n✓ Applied ${applied} statements.`);

  // Verify
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log("\nTables now in database:");
  for (const row of tables.rows) {
    console.log(`  - ${row.name}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
