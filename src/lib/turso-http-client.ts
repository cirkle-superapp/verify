/**
 * Minimal Turso/libSQL HTTP client.
 *
 * Uses the raw /v2/pipeline wire protocol instead of @libsql/client because
 * some libsql client versions reject valid Turso tokens with a 401, while
 * the same token works fine over plain HTTPS.
 *
 * Implements only the subset Prisma needs: execute (with parameters) and
 * the response shape Prisma's LibSQL adapter expects.
 */

interface PipelineRequest {
  type: "execute";
  stmt: { sql: string; args?: unknown[] };
}

interface PipelineResponse {
  results: Array<
    | { type: "ok"; response: { type: "execute"; result: QueryResult } }
    | { type: "error"; error: { message: string } }
  >;
}

interface QueryResult {
  cols: Array<{ name: string; decltype: string | null }>;
  rows: unknown[][];
  affected_row_count: number;
  last_insert_rowid: number | null;
}

export class TursoHttpClient {
  private url: string;
  private token: string | undefined;

  constructor(opts: { url: string; authToken?: string }) {
    // Normalize libsql:// → https:// for raw HTTP
    this.url = opts.url.replace(/^libsql:/, "https:");
    this.token = opts.authToken;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Convert a JS value to the typed shape Turso's /v2/pipeline expects.
   *  - string → { type: "text", value: "..." }
   *  - number → { type: "integer", value: "..." } (Turso wants numbers as strings)
   *  - boolean → { type: "integer", value: "0" | "1" }
   *  - null/undefined → { type: "null" }
   *  - Buffer → { type: "blob", value: base64 }
   *  - Date → { type: "text", value: ISO string }
   *  - object already typed → return as-is
   */
  private wrapArg(v: unknown): unknown {
    if (v === null || v === undefined) return { type: "null" };
    if (typeof v === "string") return { type: "text", value: v };
    if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
    if (typeof v === "number") {
      // Turso v2/pipeline expects integer/float values as STRINGS, not numbers
      if (Number.isInteger(v)) return { type: "integer", value: String(v) };
      return { type: "float", value: String(v) };
    }
    if (v instanceof Date) return { type: "text", value: v.toISOString() };
    if (Buffer.isBuffer(v)) return { type: "blob", value: v.toString("base64") };
    // Already typed ({type, value}) — pass through
    if (typeof v === "object" && "type" in (v as any)) return v;
    // Fallback: stringify
    return { type: "text", value: String(v) };
  }

  async execute(sql: string, args: unknown[] = []): Promise<{ rows: Record<string, unknown>[]; affectedRowCount: number; lastInsertRowid: unknown }> {
    const body: PipelineRequest[] = [{ type: "execute", stmt: { sql, args: args.map((a) => this.wrapArg(a)) } }];
    const res = await fetch(`${this.url}/v2/pipeline`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ requests: body }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Turso HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as PipelineResponse;
    const result = json.results?.[0];
    if (!result || result.type === "error") {
      throw new Error(result?.error?.message || "Turso query failed");
    }

    const qr = result.response.result;
    const cols = qr.cols.map((c) => c.name);
    const rows = qr.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      cols.forEach((name, i) => {
        const cell = row[i];
        if (cell && typeof cell === "object" && "value" in cell) {
          obj[name] = (cell as any).value;
        } else {
          obj[name] = cell;
        }
      });
      return obj;
    });

    return { rows, affectedRowCount: qr.affected_row_count, lastInsertRowid: qr.last_insert_rowid };
  }

  async batch(statements: Array<{ sql: string; args?: unknown[] }>): Promise<Array<{ rows: Record<string, unknown>[]; affectedRowCount: number; lastInsertRowid: unknown }>> {
    const body: PipelineRequest[] = statements.map((s) => ({
      type: "execute",
      stmt: { sql: s.sql, args: (s.args || []).map((a) => this.wrapArg(a)) },
    }));
    const res = await fetch(`${this.url}/v2/pipeline`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ requests: body }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Turso HTTP ${res.status}: ${text}`);
    }

    const json = (await res.json()) as PipelineResponse;
    return json.results.map((result) => {
      if (result.type === "error") {
        throw new Error(result.error.message);
      }
      const qr = result.response.result;
      const cols = qr.cols.map((c) => c.name);
      const rows = qr.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        cols.forEach((name, i) => {
          const cell = row[i];
          if (cell && typeof cell === "object" && "value" in cell) {
            obj[name] = (cell as any).value;
          } else {
            obj[name] = cell;
          }
        });
        return obj;
      });
      return { rows, affectedRowCount: qr.affected_row_count, lastInsertRowid: qr.last_insert_rowid };
    });
  }
}
