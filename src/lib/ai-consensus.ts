/**
 * AI Consensus Engine — multiple AI providers cross-check each other.
 *
 * ARCHITECTURE (the user's explicit request):
 *  "be sure we use ai api in consensus they cross check with each other
 *   to give perfect outcome"
 *
 * Instead of failover (try one, fall back on error), the consensus engine:
 *   1. Calls N providers IN PARALLEL for the SAME task
 *   2. Cross-checks their outputs using:
 *      - Field-level majority vote (for structured JSON fields)
 *      - Similarity clustering (for free-text answers like translations)
 *      - Numeric averaging + variance (for scores like similarity %)
 *      - Boolean majority vote (for isMatch / isLive)
 *   3. Returns the consensus value PLUS an `agreement` score (0-1)
 *      that quantifies how much the providers agreed.
 *
 * A low agreement score (e.g. < 0.6) signals that the field is contested
 * — the UI surfaces this as "low-confidence" so the user can retake.
 *
 * GRACEFUL DEGRADATION:
 *   If NO AI providers are configured (no env vars), every consensus call
 *   returns an empty outcome with agreement=0. The caller (vlm-service /
 *   API routes) then falls back to self-hosted engines only. This means:
 *   - With keys set → 3-5 providers cross-check each other (perfect outcome)
 *   - Without keys → self-hosted only (still works, no external deps)
 */

import {
  geminiVision,
  geminiText,
  groqText,
  openRouterVision,
  openRouterText,
  nvidiaText,
  nvidiaVision,
  huggingFaceText,
  hasVisionProviders,
  hasTextProviders,
} from "@/lib/ai-router";

// ─── Types ────────────────────────────────────────────────────────

export interface ProviderOutcome<T> {
  provider: string;
  success: boolean;
  result?: T;
  error?: string;
  latencyMs: number;
}

export interface ConsensusOutcome<T> {
  value: T;
  agreement: number; // 0..1 — 1 = all providers agreed
  providers: ProviderOutcome<T>[];
  successfulCount: number;
  totalProviders: number;
  fieldAgreement?: Record<string, number>;
}

// ─── String similarity (Levenshtein-based) ────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
    }
  }
  return m[a.length][b.length];
}

export function stringSimilarity(a?: string, b?: string): number {
  if (a == null || b == null) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ─── Helpers ─────────────────────────────────────────────────────

function verdictFromAgreement(agreement: number, successful: number): "unanimous" | "majority" | "split" {
  if (successful <= 1) return "unanimous";
  if (agreement >= 0.95) return "unanimous";
  if (agreement >= 0.66) return "majority";
  return "split";
}

async function runParallel<T>(
  tasks: { provider: string; fn: () => Promise<T> }[]
): Promise<ProviderOutcome<T>[]> {
  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      const start = Date.now();
      const result = await t.fn();
      return { provider: t.provider, success: true, result, latencyMs: Date.now() - start };
    })
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          provider: tasks[i].provider,
          success: false,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          latencyMs: 0,
        }
  );
}

// ─── Vision consensus (Gemini + OpenRouter + NVIDIA) ─────────────

/**
 * Run vision analysis on multiple providers in parallel, then pick the
 * response that has the highest average similarity to the others.
 *
 * Returns an empty outcome (agreement=0) if no vision providers are
 * configured — caller should fall back to self-hosted OCR.
 */
export async function callVisionConsensus(
  prompt: string,
  images: string[]
): Promise<ConsensusOutcome<string>> {
  if (!hasVisionProviders()) {
    return { value: "", agreement: 0, providers: [], successfulCount: 0, totalProviders: 0 };
  }

  const tasks: { provider: string; fn: () => Promise<string> }[] = [];
  tasks.push({ provider: "gemini-2.5-flash", fn: () => geminiVision(prompt, images) });
  tasks.push({ provider: "openrouter-ling-vl", fn: () => openRouterVision(prompt, images) });
  tasks.push({ provider: "nvidia-llama-vision", fn: () => nvidiaVision(prompt, images) });

  const providers = await runParallel(tasks);
  const successful = providers.filter(
    (p): p is ProviderOutcome<string> & { result: string } =>
      p.success && typeof p.result === "string" && p.result.trim().length > 0
  );

  if (successful.length === 0) {
    return { value: "", agreement: 0, providers, successfulCount: 0, totalProviders: tasks.length };
  }
  if (successful.length === 1) {
    return {
      value: successful[0].result,
      agreement: 0.5,
      providers,
      successfulCount: 1,
      totalProviders: tasks.length,
    };
  }

  // Compute pairwise similarity matrix
  const strings = successful.map((s) => s.result);
  const scores = strings.map((s, i) => {
    let total = 0;
    let count = 0;
    for (let j = 0; j < strings.length; j++) {
      if (i === j) continue;
      total += stringSimilarity(s, strings[j]);
      count++;
    }
    return count > 0 ? total / count : 0;
  });
  const bestIdx = scores.indexOf(Math.max(...scores));

  return {
    value: strings[bestIdx],
    agreement: scores[bestIdx],
    providers,
    successfulCount: successful.length,
    totalProviders: tasks.length,
  };
}

// ─── Text consensus (Groq + Gemini + NVIDIA + OpenRouter + HuggingFace) ─

export async function callTextConsensus(
  prompt: string,
  systemPrompt?: string
): Promise<ConsensusOutcome<string>> {
  if (!hasTextProviders()) {
    return { value: "", agreement: 0, providers: [], successfulCount: 0, totalProviders: 0 };
  }

  const tasks: { provider: string; fn: () => Promise<string> }[] = [];
  tasks.push({ provider: "groq-llama-3.3-70b", fn: () => groqText(prompt, systemPrompt) });
  tasks.push({ provider: "gemini-2.5-flash", fn: () => geminiText(prompt, systemPrompt) });
  tasks.push({ provider: "nvidia-deepseek-v4", fn: () => nvidiaText(prompt, systemPrompt) });
  tasks.push({ provider: "openrouter-ling", fn: () => openRouterText(prompt, systemPrompt) });
  tasks.push({ provider: "huggingface", fn: () => huggingFaceText(prompt, systemPrompt) });

  const providers = await runParallel(tasks);
  const successful = providers.filter(
    (p): p is ProviderOutcome<string> & { result: string } =>
      p.success && typeof p.result === "string" && p.result.trim().length > 0
  );

  if (successful.length === 0) {
    return { value: "", agreement: 0, providers, successfulCount: 0, totalProviders: tasks.length };
  }
  if (successful.length === 1) {
    return {
      value: successful[0].result,
      agreement: 0.4,
      providers,
      successfulCount: 1,
      totalProviders: tasks.length,
    };
  }

  const strings = successful.map((s) => s.result.trim());
  const scores = strings.map((s, i) => {
    let total = 0;
    let count = 0;
    for (let j = 0; j < strings.length; j++) {
      if (i === j) continue;
      total += stringSimilarity(s, strings[j]);
      count++;
    }
    return count > 0 ? total / count : 0;
  });
  const bestIdx = scores.indexOf(Math.max(...scores));

  return {
    value: strings[bestIdx],
    agreement: scores[bestIdx],
    providers,
    successfulCount: successful.length,
    totalProviders: tasks.length,
  };
}

// ─── Structured JSON consensus (the killer feature) ──────────────

/**
 * Cross-check structured JSON fields across multiple providers.
 *
 * For each field:
 *  - String values: cluster by similarity (>=0.85 same cluster), pick largest
 *  - Numbers: average, with agreement = 1 - normalized_variance
 *  - Booleans: majority vote, agreement = majority_fraction
 *  - Empty/undefined: skipped
 */
export function consensusJsonFields(
  extractions: { provider: string; data: Record<string, any> }[],
  fieldNames: string[]
): { merged: Record<string, any>; fieldAgreement: Record<string, number> } {
  const merged: Record<string, any> = {};
  const fieldAgreement: Record<string, number> = {};

  for (const field of fieldNames) {
    const present: { provider: string; value: any }[] = [];
    for (const ext of extractions) {
      const v = ext.data?.[field];
      if (v != null && v !== "" && (typeof v !== "string" || v.trim().length > 0)) {
        present.push({ provider: ext.provider, value: v });
      }
    }

    if (present.length === 0) {
      merged[field] = undefined;
      fieldAgreement[field] = 0;
      continue;
    }
    if (present.length === 1) {
      merged[field] = present[0].value;
      fieldAgreement[field] = 0.5;
      continue;
    }

    const sample = present[0].value;
    if (typeof sample === "boolean") {
      const trues = present.filter((p) => p.value === true).length;
      const winner = trues > present.length / 2;
      merged[field] = winner;
      fieldAgreement[field] = Math.max(trues, present.length - trues) / present.length;
    } else if (typeof sample === "number") {
      const nums = present.map((p) => Number(p.value));
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      merged[field] = Math.round(avg * 1000) / 1000;
      const variance = nums.reduce((s, n) => s + (n - avg) ** 2, 0) / nums.length;
      const stddev = Math.sqrt(variance);
      const range = Math.max(...nums) - Math.min(...nums);
      fieldAgreement[field] = range === 0 ? 1 : Math.max(0, 1 - stddev / Math.max(1, range));
    } else if (typeof sample === "string") {
      const clusters: { value: string; providers: string[] }[] = [];
      for (const p of present) {
        let matched = false;
        for (const c of clusters) {
          if (stringSimilarity(c.value.toLowerCase(), String(p.value).toLowerCase()) >= 0.85) {
            c.providers.push(p.provider);
            if (String(p.value).length < c.value.length) c.value = String(p.value);
            matched = true;
            break;
          }
        }
        if (!matched) {
          clusters.push({ value: String(p.value), providers: [p.provider] });
        }
      }
      clusters.sort((a, b) => b.providers.length - a.providers.length);
      merged[field] = clusters[0].value;
      fieldAgreement[field] = clusters[0].providers.length / present.length;
    } else {
      merged[field] = sample;
      fieldAgreement[field] = 0.5;
    }
  }

  return { merged, fieldAgreement };
}

// ─── Translation consensus ───────────────────────────────────────

/**
 * Translate text with Groq + Gemini in parallel; if they agree (similarity
 * >= 0.85), use either. If they disagree, call OpenRouter + NVIDIA as
 * tie-breakers, then pick the cluster with most votes.
 */
export async function translateWithConsensus(
  text: string,
  direction: "ar-to-en" | "en-to-ar"
): Promise<ConsensusOutcome<string>> {
  if (!text || text.trim().length === 0) {
    return { value: "", agreement: 1, providers: [], successfulCount: 0, totalProviders: 0 };
  }
  if (!hasTextProviders()) {
    return { value: "", agreement: 0, providers: [], successfulCount: 0, totalProviders: 0 };
  }

  const prompt =
    direction === "ar-to-en"
      ? `Translate the following Arabic text to English. For names, use the most common transliteration (e.g. محمد → Mohamed, أحمد → Ahmed). Return ONLY the English translation:\n\n${text}`
      : `Transliterate the following English name to Arabic script. Use standard transliteration (e.g. Mohamed → محمد, Ahmed → أحمد). Return ONLY the Arabic text:\n\n${text}`;

  const systemPrompt =
    direction === "ar-to-en"
      ? "You are a professional Arabic-to-English translator specializing in personal names and identity document fields."
      : "You are a professional English-to-Arabic transliterator specializing in personal names.";

  // First round: Groq + Gemini in parallel
  const tasks: { provider: string; fn: () => Promise<string> }[] = [];
  tasks.push({ provider: "groq-llama-3.3-70b", fn: () => groqText(prompt, systemPrompt) });
  tasks.push({ provider: "gemini-2.5-flash", fn: () => geminiText(prompt, systemPrompt) });

  const providers = await runParallel(tasks);
  const successful = providers.filter(
    (p): p is ProviderOutcome<string> & { result: string } =>
      p.success && typeof p.result === "string" && p.result.trim().length > 0
  );

  if (successful.length === 0) {
    return { value: "", agreement: 0, providers, successfulCount: 0, totalProviders: 3 };
  }

  if (successful.length === 1) {
    try {
      const fb = await openRouterText(prompt, systemPrompt);
      const sim = fb ? stringSimilarity(successful[0].result, fb) : 0;
      return {
        value: sim >= 0.85 ? successful[0].result : successful[0].result,
        agreement: sim,
        providers: [
          ...providers,
          { provider: "openrouter-ling", success: !!fb, result: fb, latencyMs: 0 },
        ],
        successfulCount: fb ? 2 : 1,
        totalProviders: 3,
      };
    } catch {
      return {
        value: successful[0].result,
        agreement: 0.4,
        providers,
        successfulCount: 1,
        totalProviders: 3,
      };
    }
  }

  // Both succeeded: check agreement
  const [a, b] = [successful[0].result, successful[1].result];
  const sim = stringSimilarity(a.trim(), b.trim());

  if (sim >= 0.85) {
    const winner = a.length <= b.length ? a : b;
    return {
      value: winner,
      agreement: sim,
      providers,
      successfulCount: 2,
      totalProviders: 2,
    };
  }

  // Disagreement — bring in NVIDIA + OpenRouter as tie-breakers
  const tieTasks: { provider: string; fn: () => Promise<string> }[] = [];
  tieTasks.push({ provider: "nvidia-deepseek-v4", fn: () => nvidiaText(prompt, systemPrompt) });
  tieTasks.push({ provider: "openrouter-ling", fn: () => openRouterText(prompt, systemPrompt) });
  const tieResults = await runParallel(tieTasks);
  const allResults = [
    ...successful,
    ...tieResults.filter(
      (p): p is ProviderOutcome<string> & { result: string } =>
        p.success && typeof p.result === "string" && p.result.trim().length > 0
    ),
  ];

  if (allResults.length === 0) {
    return { value: a, agreement: sim, providers, successfulCount: 2, totalProviders: 4 };
  }

  // Cluster by similarity
  const clusters: { value: string; count: number; providers: string[] }[] = [];
  for (const r of allResults) {
    let matched = false;
    for (const c of clusters) {
      if (stringSimilarity(c.value.toLowerCase(), r.result.toLowerCase()) >= 0.85) {
        c.count++;
        c.providers.push(r.provider);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ value: r.result, count: 1, providers: [r.provider] });
    }
  }
  clusters.sort((x, y) => y.count - x.count);
  const winner = clusters[0];
  return {
    value: winner.value,
    agreement: winner.count / allResults.length,
    providers: [...providers, ...tieResults],
    successfulCount: allResults.length,
    totalProviders: 4,
  };
}

// ─── Consensus Info builder (for API/UI surfacing) ───────────────

export function buildConsensusInfo<T>(outcome: ConsensusOutcome<T>) {
  if (outcome.totalProviders === 0) return null;
  const successful = outcome.providers.filter((p) => p.success);
  return {
    total: outcome.totalProviders,
    successful: outcome.successfulCount,
    providerNames: successful.map((p) => p.provider),
    agreement: Math.round(outcome.agreement * 100) / 100,
    fieldAgreement: outcome.fieldAgreement,
    outcomes: outcome.providers.map((p) => ({
      provider: p.provider,
      success: p.success,
      latencyMs: p.latencyMs,
    })),
    verdict: verdictFromAgreement(outcome.agreement, outcome.successfulCount),
  };
}

/**
 * Merge two ConsensusInfo objects — used when combining vision + text
 * consensus results into a single response.
 */
export function mergeConsensusInfo(a: any, b?: any | null) {
  if (!b) return a;
  if (!a) return b;
  const allOutcomes = [...a.outcomes, ...b.outcomes];
  const agreement = (a.agreement + b.agreement) / 2;
  return {
    total: a.total + b.total,
    successful: a.successful + b.successful,
    providerNames: Array.from(new Set([...a.providerNames, ...b.providerNames])),
    agreement: Math.round(agreement * 100) / 100,
    fieldAgreement: { ...a.fieldAgreement, ...b.fieldAgreement },
    outcomes: allOutcomes,
    verdict: verdictFromAgreement(agreement, Math.max(a.successful, b.successful)),
  };
}

export function emptyConsensusInfo() {
  return null;
}
