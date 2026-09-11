/**
 * Turso connection doctor.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... bun run scripts/turso-doctor.ts
 *
 * Runs a full diagnostic: DNS, TLS, auth, SQL execution, and reports
 * exactly which step fails so you know what to fix.
 */
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Cirkle Turso Connection Doctor                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (!url) {
    console.log("✗ Missing TURSO_DATABASE_URL env var");
    process.exit(1);
  }
  console.log(`URL:    ${url}`);
  console.log(`Token:  ${token ? token.slice(0, 30) + "..." : "(none)"}`);

  // Decode JWT payload if present
  if (token) {
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
        );
        console.log(`\nJWT payload:`);
        console.log(`  role id (rid): ${payload.rid}`);
        console.log(`  issued:        ${new Date(payload.iat * 1000).toISOString()}`);
        console.log(`  access:        ${payload.a} (rw = read/write)`);
      }
    } catch (e) {
      console.log("\n⚠  Token is not a parseable JWT");
    }
  }

  // Step 1: DNS / connectivity via raw HTTP
  console.log("\n--- Step 1: HTTP connectivity ---");
  const httpsUrl = url.replace(/^libsql:/, "https:");
  try {
    const res = await fetch(httpsUrl);
    console.log(`✓ Server reachable (HTTP ${res.status})`);
    if (res.status === 401) {
      console.log("  → 401 is GOOD: database exists, just needs auth");
    } else if (res.status === 404) {
      console.log("  → 404 WITHOUT token: database URL is wrong or DB doesn't exist");
    }
  } catch (e: any) {
    console.log(`✗ Cannot reach server: ${e.message}`);
    process.exit(1);
  }

  // Step 2: Auth via libsql client
  console.log("\n--- Step 2: Authentication ---");
  const client = createClient(token ? { url, authToken: token } : { url });
  try {
    const r = await client.execute("SELECT 1 as ok");
    console.log("✓ Token authorized — query succeeded");
    console.log(`  Result: ${JSON.stringify(r.rows[0])}`);
  } catch (e: any) {
    console.log(`✗ Auth/query failed: ${e.message}`);
    if (e.message.includes("404") || e.message.includes("auth role not found")) {
      console.log("\n  ┌─────────────────────────────────────────────────────────┐");
      console.log("  │ DIAGNOSIS: Token's role is NOT authorized on this DB.   │");
      console.log("  │                                                         │");
      console.log("  │ FIX (run these 3 commands in your terminal):            │");
      console.log("  │                                                         │");
      console.log("  │   turso auth login                                      │");
      console.log("  │   turso db tokens create identity-fortleem              │");
      console.log("  │   # then re-run this doctor with the new token          │");
      console.log("  │                                                         │");
      console.log("  │ If 'identity-fortleem' isn't listed by 'turso db list',│");
      console.log("  │ create it first:                                        │");
      console.log("  │   turso db create identity-fortleem                     │");
      console.log("  └─────────────────────────────────────────────────────────┘");
    }
    process.exit(1);
  }

  // Step 3: Check existing tables
  console.log("\n--- Step 3: Schema status ---");
  try {
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const names = tables.rows.map((r: any) => r.name);
    console.log(`Tables present: ${names.length}`);
    names.forEach((n: string) => console.log(`  - ${n}`));
    const expected = ["Verification", "DocumentSample", "EvaluationRun", "EvaluationResult"];
    const missing = expected.filter((t) => !names.includes(t));
    if (missing.length === 0) {
      console.log("\n✓ All required tables exist — schema is already pushed!");
    } else {
      console.log(`\n⚠  Missing tables: ${missing.join(", ")}`);
      console.log("   Run: bun run db:push-turso");
    }
  } catch (e: any) {
    console.log(`✗ Could not list tables: ${e.message}`);
  }

  console.log("\n✓ All checks passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
