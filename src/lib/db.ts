/**
 * Database client (backward-compatible export)
 *
 * This file re-exports from the new src/lib/db/index.ts dual-database layer.
 * Existing routes that import { db } from "@/lib/db" continue to work —
 * they get the TursoHttpClient shim (raw SQL), which is 100% functional.
 *
 * New routes should import from "@/lib/db/index" directly:
 *   import { edgeDb, centralDb } from "@/lib/db";
 *   import { verifications } from "@/lib/db/schema-postgres";
 *   import { edgeVerifications } from "@/lib/db/schema-turso";
 *
 * Architecture:
 *   db (raw SQL, backward compat) → TursoHttpClient
 *   edgeDb (Drizzle ORM, typed)   → Turso libSQL
 *   centralDb (Drizzle ORM, typed) → Neon Postgres
 */

// Re-export the new dual-database layer
export { getEdgeDb, getCentralDb, edgeDb, centralDb } from "@/lib/db/index";

// Re-export schemas for convenience
export * from "@/lib/db/schema-postgres";
export * from "@/lib/db/schema-turso";

// Backward-compatible: existing routes use `db` (TursoHttpClient shim)
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const db = require("@/lib/db-turso").db;
