/**
 * Cirkle test runner — entry point for `bun run tests/run.ts`.
 *
 * Runs all six test files, collects results, prints a per-file
 * summary + grand total, and exits 0 on all-pass, 1 on any-fail.
 *
 * For HTTP-based tests (health + endpoints), the runner spawns a
 * Next.js dev server as a child process if one isn't already up on
 * http://localhost:3000. Pure module tests (knowledge-base,
 * validators, mrz-parser, chatbot) don't need the server.
 */

import { run as knowledgeBaseTests } from "./knowledge-base.test";
import { run as validatorTests } from "./validators.test";
import { run as mrzParserTests } from "./mrz-parser.test";
import { run as chatbotTests } from "./chatbot.test";
import { run as healthTests } from "./health.test";
import { run as endpointTests } from "./endpoints.test";
import { ensureServerRunning, stopSpawnedServer, BASE_URL } from "./lib/server";
import { statusGlyph, type TestResult } from "./lib/runner";

const FILES: Array<{ name: string; run: () => Promise<TestResult[]> }> = [
  { name: "knowledge-base.test.ts", run: knowledgeBaseTests },
  { name: "validators.test.ts", run: validatorTests },
  { name: "mrz-parser.test.ts", run: mrzParserTests },
  { name: "chatbot.test.ts", run: chatbotTests },
  { name: "health.test.ts", run: healthTests },
  { name: "endpoints.test.ts", run: endpointTests },
];

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function main() {
  console.log("=".repeat(72));
  console.log("Cirkle test runner — starting.");
  console.log("=".repeat(72));

  // ─── Pure module tests (no server needed) ─────────────────────
  const moduleResults: Array<{ file: string; results: TestResult[] }> = [];
  for (const f of FILES.slice(0, 4)) {
    console.log(`\n── ${f.name} ─────────────────────────────────────────────`);
    const results = await f.run();
    moduleResults.push({ file: f.name, results });
    for (const r of results) {
      const glyph = statusGlyph(r.passed);
      const tag = r.passed ? "PASS" : "FAIL";
      console.log(`  ${glyph} [${tag}] ${padRight(r.name, 70)} ${r.durationMs}ms`);
      if (!r.passed && r.error) {
        console.log(`        ${r.error}`);
      }
    }
  }

  // ─── HTTP tests (need the dev server) ────────────────────────
  console.log("\n".padEnd(2));
  console.log("── HTTP tests — ensuring dev server is up ──────────────────");
  try {
    const spawned = await ensureServerRunning();
    console.log(`Server is up on ${BASE_URL}${spawned ? " (spawned by runner)" : " (was already running)"}.\n`);
  } catch (e: any) {
    console.error(`[runner] failed to ensure server running: ${e?.message || e}`);
    // Continue anyway — the HTTP tests will fail individually with fetch errors.
  }

  const httpResults: Array<{ file: string; results: TestResult[] }> = [];
  for (const f of FILES.slice(4)) {
    console.log(`\n── ${f.name} ─────────────────────────────────────────────`);
    let results: TestResult[];
    try {
      results = await f.run();
    } catch (e: any) {
      results = [
        {
          name: `runner crashed: ${e?.message || String(e)}`,
          passed: false,
          durationMs: 0,
          error: e?.stack?.slice(0, 400),
        },
      ];
    }
    httpResults.push({ file: f.name, results });
    for (const r of results) {
      const glyph = statusGlyph(r.passed);
      const tag = r.passed ? "PASS" : "FAIL";
      console.log(`  ${glyph} [${tag}] ${padRight(r.name, 70)} ${r.durationMs}ms`);
      if (!r.passed && r.error) {
        console.log(`        ${r.error}`);
      }
    }
  }

  // ─── Grand summary ─────────────────────────────────────────────
  const all = [...moduleResults, ...httpResults];
  const allResults = all.flatMap((r) => r.results);
  const passed = allResults.filter((r) => r.passed).length;
  const failed = allResults.filter((r) => !r.passed).length;
  const total = allResults.length;

  console.log("\n" + "=".repeat(72));
  console.log("  TEST SUMMARY");
  console.log("=".repeat(72));
  for (const f of all) {
    const passedInFile = f.results.filter((r) => r.passed).length;
    const failedInFile = f.results.filter((r) => !r.passed).length;
    const totalInFile = f.results.length;
    const status = failedInFile === 0 ? "PASS" : "FAIL";
    console.log(
      `  [${status}] ${padRight(f.file, 36)} ${passedInFile}/${totalInFile} passed${failedInFile ? ` (${failedInFile} failed)` : ""}`,
    );
  }
  console.log("-".repeat(72));
  console.log(`  Total: ${passed}/${total} passed, ${failed} failed.`);
  console.log("=".repeat(72));

  // Stop the spawned dev server before exiting.
  stopSpawnedServer();

  if (failed > 0) {
    console.error(`\n${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\nAll ${total} tests passed.`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error("[runner] uncaught:", e);
  stopSpawnedServer();
  process.exit(1);
});
