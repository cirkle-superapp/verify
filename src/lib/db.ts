import { PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { createClient } from "@libsql/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;

  // If the DATABASE_URL is a libsql/turso URL, use the libsql adapter.
  // Otherwise fall back to the default SQLite provider (local dev).
  if (databaseUrl && databaseUrl.startsWith("libsql:")) {
    const libsql = createClient({
      url: databaseUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    const adapter = new PrismaLibSql(libsql);
    return new PrismaClient({ adapter } as any);
  }

  // Local SQLite (default — no adapter needed)
  return new PrismaClient({
    log: process.env.NODE_ENV !== "production" ? ["query"] : [],
  });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
