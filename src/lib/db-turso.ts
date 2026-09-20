/**
 * Prisma-compatible database client that works with Turso via raw HTTP.
 *
 * The @prisma/adapter-libsql has a bug where it rejects valid Turso tokens
 * with HTTP 401 (confirmed via raw HTTP testing — the same token works fine
 * over plain HTTPS). This shim provides a Prisma-like API backed by our
 * working TursoHttpClient, so the app routes work without code changes.
 *
 * Only implements the methods actually used by the app:
 *  - verification.findMany, .findUnique, .create, .delete
 *  - documentSample.findMany, .findFirst, .create, .delete, .count, .createMany
 *  - evaluationRun.findMany, .findUnique, .create, .update, .delete
 *  - evaluationResult.findMany, .create
 */

import { TursoHttpClient } from "@/lib/turso-http-client";

interface DbConfig {
  url: string;
  authToken?: string;
}

function getTursoClient(): TursoHttpClient | null {
  // Prefer TURSO_DATABASE_URL (only set in .env.local, always Turso)
  // over DATABASE_URL (may be overridden by .env to a SQLite file path).
  const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url || !url.startsWith("libsql:")) return null;
  const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;
  if (!authToken) return null;
  return new TursoHttpClient({ url, authToken });
}

// Generate a CUID-like ID
function genId(): string {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Build a SQL INSERT from an object
function buildInsert(table: string, data: Record<string, unknown>): { sql: string; args: unknown[] } {
  const cols = Object.keys(data);
  const placeholders = cols.map(() => "?").join(", ");
  const values = cols.map((c) => data[c]);
  const colList = cols.join(", ");
  return {
    sql: `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`,
    args: values,
  };
}

// Build a SQL UPDATE from an object + where clause
function buildUpdate(table: string, data: Record<string, unknown>, whereClause: string, whereArgs: unknown[]): { sql: string; args: unknown[] } {
  const sets = Object.keys(data).map((c) => `${c} = ?`).join(", ");
  return {
    sql: `UPDATE ${table} SET ${sets} WHERE ${whereClause}`,
    args: [...Object.values(data), ...whereArgs],
  };
}

// ─── Verification model ────────────────────────────────────────────────
const verificationModel = {
  async findMany(opts?: { orderBy?: any; take?: number; where?: any }): Promise<any[]> {
    const client = getTursoClient()!;
    let sql = "SELECT * FROM Verification";
    const args: unknown[] = [];
    if (opts?.where) {
      const conds: string[] = [];
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined) continue;
        conds.push(`${k} = ?`);
        args.push(v);
      }
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
    }
    if (opts?.orderBy?.createdAt === "desc") sql += " ORDER BY createdAt DESC";
    if (opts?.take) sql += ` LIMIT ${Number(opts.take)}`;
    const r = await client.execute(sql, args);
    return r.rows as any[];
  },

  async findUnique(opts: { where: { id: string } }): Promise<any | null> {
    const client = getTursoClient()!;
    const r = await client.execute("SELECT * FROM Verification WHERE id = ?", [opts.where.id]);
    return (r.rows[0] as any) || null;
  },

  async create(opts: { data: Record<string, unknown> }): Promise<any> {
    const client = getTursoClient()!;
    const data = { id: genId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...opts.data };
    const { sql, args } = buildInsert("Verification", data);
    await client.execute(sql, args);
    return data;
  },

  async delete(opts: { where: { id: string } }): Promise<any> {
    const client = getTursoClient()!;
    await client.execute("DELETE FROM Verification WHERE id = ?", [opts.where.id]);
    return { ok: true };
  },
};

// ─── DocumentSample model ──────────────────────────────────────────────
const documentSampleModel = {
  async findMany(opts?: { orderBy?: any; take?: number; where?: any; select?: any }): Promise<any[]> {
    const client = getTursoClient()!;
    const withImage = opts?.select === undefined;
    let sql = withImage ? "SELECT * FROM DocumentSample" : "SELECT id, name, docType, source, fullNameAr, fullNameEn, nationalId, birthDate, address, gender, documentNo, expiryDate, nationality, job, religion, maritalStatus, notes, tags, createdAt, updatedAt FROM DocumentSample";
    const args: unknown[] = [];
    if (opts?.where) {
      const conds: string[] = [];
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined || v === null) continue;
        conds.push(`${k} = ?`);
        args.push(v);
      }
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
    }
    if (opts?.orderBy?.createdAt === "desc") sql += " ORDER BY createdAt DESC";
    if (opts?.take) sql += ` LIMIT ${Number(opts.take)}`;
    const r = await client.execute(sql, args);
    return r.rows as any[];
  },

  async findFirst(opts?: { where?: any }): Promise<any | null> {
    const client = getTursoClient()!;
    let sql = "SELECT * FROM DocumentSample";
    const args: unknown[] = [];
    if (opts?.where) {
      const conds: string[] = [];
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined || v === null) continue;
        conds.push(`${k} = ?`);
        args.push(v);
      }
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
    }
    sql += " LIMIT 1";
    const r = await client.execute(sql, args);
    return (r.rows[0] as any) || null;
  },

  async create(opts: { data: Record<string, unknown> }): Promise<any> {
    const client = getTursoClient()!;
    const data = { id: genId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...opts.data };
    const { sql, args } = buildInsert("DocumentSample", data);
    await client.execute(sql, args);
    return data;
  },

  async createMany(opts: { data: Record<string, unknown>[] }): Promise<{ count: number }> {
    const client = getTursoClient()!;
    let count = 0;
    for (const row of opts.data) {
      const data = { id: genId(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...row };
      const { sql, args } = buildInsert("DocumentSample", data);
      try {
        await client.execute(sql, args);
        count++;
      } catch (e) {
        // skip duplicates
      }
    }
    return { count };
  },

  async deleteMany(opts?: { where?: any }): Promise<{ count: number }> {
    const client = getTursoClient()!;
    let sql = "DELETE FROM DocumentSample";
    const args: unknown[] = [];
    if (opts?.where) {
      const conds: string[] = [];
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined || v === null) continue;
        conds.push(`${k} = ?`);
        args.push(v);
      }
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
    }
    await client.execute(sql, args);
    return { count: 0 };
  },

  async count(opts?: { where?: any }): Promise<number> {
    const client = getTursoClient()!;
    let sql = "SELECT COUNT(*) as n FROM DocumentSample";
    const args: unknown[] = [];
    if (opts?.where) {
      const conds: string[] = [];
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined || v === null) continue;
        conds.push(`${k} = ?`);
        args.push(v);
      }
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
    }
    const r = await client.execute(sql, args);
    return Number((r.rows[0] as any)?.n || 0);
  },

  async delete(opts: { where: { id: string } }): Promise<any> {
    const client = getTursoClient()!;
    await client.execute("DELETE FROM DocumentSample WHERE id = ?", [opts.where.id]);
    return { ok: true };
  },
};

// ─── EvaluationRun model ───────────────────────────────────────────────
const evaluationRunModel = {
  async findMany(opts?: { orderBy?: any; take?: number }): Promise<any[]> {
    const client = getTursoClient()!;
    let sql = "SELECT * FROM EvaluationRun";
    if (opts?.orderBy?.startedAt === "desc") sql += " ORDER BY startedAt DESC";
    if (opts?.take) sql += ` LIMIT ${Number(opts.take)}`;
    const r = await client.execute(sql);
    return r.rows as any[];
  },

  async findUnique(opts: { where: { id: string }; include?: any }): Promise<any | null> {
    const client = getTursoClient()!;
    const r = await client.execute("SELECT * FROM EvaluationRun WHERE id = ?", [opts.where.id]);
    const run = (r.rows[0] as any) || null;
    if (run && opts.include?.results) {
      const resR = await client.execute("SELECT * FROM EvaluationResult WHERE runId = ? ORDER BY createdAt ASC LIMIT 500", [opts.where.id]);
      (run as any).results = resR.rows;
    }
    return run;
  },

  async create(opts: { data: Record<string, unknown> }): Promise<any> {
    const client = getTursoClient()!;
    const data = { id: genId(), startedAt: new Date().toISOString(), ...opts.data };
    const { sql, args } = buildInsert("EvaluationRun", data);
    await client.execute(sql, args);
    return data;
  },

  async update(opts: { where: { id: string }; data: Record<string, unknown> }): Promise<any> {
    const client = getTursoClient()!;
    const { sql, args } = buildUpdate("EvaluationRun", opts.data, "id = ?", [opts.where.id]);
    await client.execute(sql, args);
    const r = await client.execute("SELECT * FROM EvaluationRun WHERE id = ?", [opts.where.id]);
    return (r.rows[0] as any) || null;
  },

  async delete(opts: { where: { id: string } }): Promise<any> {
    const client = getTursoClient()!;
    await client.execute("DELETE FROM EvaluationResult WHERE runId = ?", [opts.where.id]);
    await client.execute("DELETE FROM EvaluationRun WHERE id = ?", [opts.where.id]);
    return { ok: true };
  },
};

// ─── EvaluationResult model ────────────────────────────────────────────
const evaluationResultModel = {
  async findMany(opts?: { where?: any; select?: any; orderBy?: any; take?: number }): Promise<any[]> {
    const client = getTursoClient()!;
    let sql = "SELECT * FROM EvaluationResult";
    const args: unknown[] = [];
    if (opts?.where) {
      const conds: string[] = [];
      for (const [k, v] of Object.entries(opts.where)) {
        if (v === undefined || v === null) continue;
        conds.push(`${k} = ?`);
        args.push(v);
      }
      if (conds.length) sql += " WHERE " + conds.join(" AND ");
    }
    if (opts?.orderBy?.createdAt === "asc") sql += " ORDER BY createdAt ASC";
    if (opts?.take) sql += ` LIMIT ${Number(opts.take)}`;
    const r = await client.execute(sql, args);
    return r.rows as any[];
  },

  async create(opts: { data: Record<string, unknown> }): Promise<any> {
    const client = getTursoClient()!;
    const data = { id: genId(), createdAt: new Date().toISOString(), ...opts.data };
    const { sql, args } = buildInsert("EvaluationResult", data);
    await client.execute(sql, args);
    return data;
  },
};

export const db = {
  verification: verificationModel,
  documentSample: documentSampleModel,
  evaluationRun: evaluationRunModel,
  evaluationResult: evaluationResultModel,
};
