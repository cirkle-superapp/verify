import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: any | undefined;
};

function createDbClient(): any {
  const databaseUrl = process.env.DATABASE_URL;

  // If DATABASE_URL is a libsql/turso URL, use our Turso HTTP shim.
  // The @prisma/adapter-libsql has a bug where it rejects valid Turso
  // tokens with HTTP 401. Our TursoHttpClient works correctly, so we use
  // a Prisma-compatible shim backed by it.
  if (databaseUrl && databaseUrl.startsWith("libsql:")) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tursoDb = require("@/lib/db-turso").db;
    return tursoDb;
  }

  // Local SQLite (default — Prisma with sqlite provider)
  return new PrismaClient({
    log: process.env.NODE_ENV !== "production" ? ["query"] : [],
  });
}

export const db = globalForPrisma.prisma ?? createDbClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
