/**
 * Dual-Database Client Initialization
 *
 * Exports two Drizzle ORM instances:
 *  - edgeDb: Turso (libSQL) via @libsql/client — for edge reads
 *  - centralDb: Neon Postgres via @neondatabase/serverless — for writes + audit
 *
 * Architecture:
 *  ┌──────────────┐        ┌──────────────┐
 *  │   edgeDb     │        │  centralDb   │
 *  │  (Turso)     │        │  (Neon PG)   │
 *  │  libsql HTTP │        │  neon HTTP   │
 *  ├──────────────┤        ├──────────────┤
 *  │ schema-turso │        │schema-postgres│
 *  │ Edge reads   │        │ Writes, audit │
 *  │ Low latency  │        │ ACID, FK     │
 *  └──────┬───────┘        └──────┬───────┘
 *         │                       │
 *         └───── API Routes ──────┘
 *
 * Runtime strategy:
 *  - Read-heavy routes → runtime="edge", use edgeDb
 *  - Write/audit routes → runtime="nodejs", use centralDb
 *  - Dual-write routes → read from edgeDb, write to centralDb + mirror to edgeDb
 */

import { drizzle } from "drizzle-orm/libsql";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { createClient as createLibsqlClient } from "@libsql/client";
import { neon } from "@neondatabase/serverless";

import * as tursoSchema from "./schema-turso";
import * as postgresSchema from "./schema-postgres";

// ─── Edge DB (Turso libSQL) ─────────────────────────────────────────
// Used for: low-latency reads at the edge, caching, doc-specs lookups
// Env vars: DATABASE_URL (libsql://...) + DATABASE_AUTH_TOKEN

let edgeDbInstance: ReturnType<typeof drizzle> | null = null;

export function getEdgeDb() {
  if (edgeDbInstance) return edgeDbInstance;

  const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL;
  if (!url) return null;

  // Use TursoHttpClient-style raw HTTP (bypasses libsql SDK 401 bug)
  // by creating the libsql client with explicit config
  const client = createLibsqlClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
  });

  edgeDbInstance = drizzle(client, { schema: tursoSchema });
  return edgeDbInstance;
}

// ─── Central DB (Neon PostgreSQL) ──────────────────────────────────
// Used for: permanent writes, audit logs, evaluation results, billing
// Env vars: NEON_DATABASE_URL or POSTGRES_DATABASE_URL

let centralDbInstance: ReturnType<typeof drizzleNeon> | null = null;

export function getCentralDb() {
  if (centralDbInstance) return centralDbInstance;

  const url =
    process.env.NEON_DATABASE_URL ||
    process.env.POSTGRES_DATABASE_URL ||
    process.env.cirkle_verify_POSTGRES_URL;

  if (!url) return null;

  const sql = neon(url);
  centralDbInstance = drizzleNeon(sql, { schema: postgresSchema });
  return centralDbInstance;
}

// ─── Convenience exports (backward compatibility) ──────────────────
// These provide a db-like interface so existing API routes can gradually
// migrate without breaking. Routes can import { edgeDb, centralDb } and
// use Drizzle's query builder directly.

export const edgeDb = getEdgeDb();
export const centralDb = getCentralDb();

// ─── Fallback: TursoHttpClient (for routes not yet migrated to Drizzle) ─
// The existing TursoHttpClient (src/lib/turso-http-client.ts) works
// reliably for raw SQL. We export it here so routes can choose:
//   - Drizzle (typed queries): use edgeDb / centralDb
//   - Raw SQL (fast prototyping): use the existing db export

export { db } from "@/lib/db-turso";
