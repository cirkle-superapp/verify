/**
 * Push the Cirkle Identity Verification schema to Turso.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://your-db.turso.io \
 *   TURSO_AUTH_TOKEN=<token> \
 *   bun run scripts/push-to-turso.ts
 *
 * This script uses raw HTTP /v2/pipeline calls (the same wire protocol the
 * libsql client uses) because some libsql client versions reject valid
 * Turso tokens with a 401 even when the token works fine over raw HTTP.
 */
import { readFileSync } from "fs";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error(
      "Missing TURSO_DATABASE_URL.\n\n" +
        "Usage:\n" +
        "  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run scripts/push-to-turso.ts"
    );
    process.exit(1);
  }

  // Normalize URL: libsql:// → https:// for raw HTTP
  const httpUrl = url.replace(/^libsql:/, "https:");
  console.log(`Connecting to ${url}...`);

  // Test connection
  const testBody = JSON.stringify({ requests: [{ type: "execute", stmt: { sql: "SELECT 1 as ok" } }] });
  try {
    const res = await fetch(`${httpUrl}/v2/pipeline`, {
      method: "POST",
      headers: token
        ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
      body: testBody,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    console.log("✓ Connection successful");
  } catch (e: any) {
    console.error("✗ Connection failed:", e.message);
    process.exit(1);
  }

  // Read schema and strip comments line-by-line BEFORE splitting on semicolons
  const schemaPath = new URL("../prisma/schema.sql", import.meta.url).pathname;
  const rawSchema = readFileSync(schemaPath, "utf-8");
  const schema = rawSchema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`\nApplying ${statements.length} DDL statements...`);
  let applied = 0;
  for (const stmt of statements) {
    const body = JSON.stringify({ requests: [{ type: "execute", stmt: { sql: stmt } }] });
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
        console.log(`  ✓ ${stmt.replace(/\s+/g, " ").slice(0, 65)}...`);
        applied++;
      } else {
        const err = json.results?.[0]?.error?.message || json.error || "unknown";
        if (String(err).includes("already exists")) {
          console.log(`  ⊘ already exists: ${stmt.replace(/\s+/g, " ").slice(0, 50)}...`);
          applied++;
        } else {
          console.log(`  ✗ ${err}`);
        }
      }
    } catch (e: any) {
      console.log(`  ✗ network: ${e.message}`);
    }
  }

  console.log(`\n✓ Applied ${applied}/${statements.length} statements.`);

  // Verify
  const verifyRes = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{ type: "execute", stmt: { sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" } }],
    }),
  });
  const vJson: any = await verifyRes.json();
  const tables = vJson.results?.[0]?.response?.result?.rows?.map((r: any) => r[0]?.value) || [];
  console.log("\nTables now in database:");
  for (const t of tables) console.log(`  - ${t}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
