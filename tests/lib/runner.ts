/**
 * Tiny test framework — no Jest, no Bun test, just plain TS.
 *
 * Each test file exports a `run()` async function that returns an
 * array of TestResult. The runner collects all results, prints a
 * per-file summary, and exits with code 0 (all passed) or 1 (any
 * failed).
 */

export interface TestResult {
  /** Test name in the form "file: test name". */
  name: string;
  passed: boolean;
  /** Milliseconds the test took to run. */
  durationMs: number;
  /** Error message (only when passed === false). */
  error?: string;
}

export interface TestFileResult {
  file: string;
  results: TestResult[];
}

/** Assert helper — throws with a message if the predicate is false. */
export function assert(
  predicate: boolean,
  message: string,
  details?: unknown,
): void {
  if (!predicate) {
    const detail =
      details === undefined
        ? ""
        : typeof details === "string"
          ? `\n  got: ${details}`
          : `\n  got: ${JSON.stringify(details)}`;
    throw new Error(`${message}${detail}`);
  }
}

export function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export function assertRange(
  value: number,
  min: number,
  max: number,
  label: string,
  /** Optional extra details value (e.g. the full result object) included
   *  in the error message on failure. Backwards-compatible — existing
   *  4-arg callers continue to work unchanged. */
  details?: unknown,
): void {
  if (value < min || value > max) {
    const detail =
      details === undefined
        ? ""
        : typeof details === "string"
          ? `\n  got: ${details}`
          : `\n  got: ${JSON.stringify(details)}`;
    throw new Error(
      `${label}: expected ${value} to be in [${min}, ${max}]${detail}`,
    );
  }
}

/**
 * Run a single test, capturing the result + duration. Never throws —
 * returns a TestResult with passed=false on error.
 */
export async function runTest(
  name: string,
  fn: () => void | Promise<void>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, passed: true, durationMs: Date.now() - start };
  } catch (e: any) {
    return {
      name,
      passed: false,
      durationMs: Date.now() - start,
      error: e?.message?.slice(0, 400) || String(e),
    };
  }
}

/** Format a check or cross. */
export function statusGlyph(passed: boolean): string {
  return passed ? "\u2713" : "\u2717";
}
