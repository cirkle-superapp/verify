/**
 * Conversational Fallback for the Cirkle Assistant chatbot.
 *
 * When the LLM (z-ai-web-dev-sdk) is not directly reachable — which
 * happens on Vercel production where internal-api.z.ai is sandbox-only,
 * or when the API token is missing/invalid — the chat API falls back to
 * a knowledge-base-only answer.
 *
 * The previous fallback (in src/app/api/chat/route.ts) just dumped the
 * raw knowledge chunks. This module produces a more conversational,
 * template-based markdown response that:
 *
 *   1. Detects the user's intent (security features, MRZ, liveness,
 *      bias, multimodal fusion, adversarial detection, identity graph,
 *      continuous auth, validation, etc.) from the query.
 *   2. Opens with a natural-language intro that matches the intent.
 *   3. Formats the top retrieved chunk with intent-specific markdown
 *      (tables for security features, numbered steps for how-it-works,
 *      definition+details for what-is, algorithm+example for validation).
 *   4. Adds a "Related information" section with 2-3 truncated chunks.
 *   5. Closes with 3 follow-up question suggestions.
 *   6. Cites the source module of each chunk.
 *
 * This keeps the chatbot useful even when the LLM is offline — the
 * user gets a structured, readable answer instead of a raw dump.
 *
 * @module chatbot-fallback
 */

import type { KnowledgeChunk } from "@/lib/chatbot-knowledge-base";

// ─── Public types ────────────────────────────────────────────────────

/** Detected query intent — drives the intro + formatter + follow-ups. */
export type QueryIntent =
  | "security_features"
  | "how_does"
  | "what_is"
  | "validate"
  | "liveness"
  | "mrz"
  | "bias"
  | "multimodal"
  | "adversarial"
  | "identity_graph"
  | "continuous"
  | "default";

/** Result of intent detection — used to template the response. */
export interface DetectedIntent {
  intent: QueryIntent;
  /** Natural-language intro that opens the response. */
  intro: string;
  /** 3 follow-up question suggestions (without numbering). */
  followUps: string[];
}

// ─── Intent detection ───────────────────────────────────────────────

/**
 * Detect what the user is asking about from the raw query string.
 *
 * The detection is keyword + phrase-pattern based — no LLM call. The
 * returned `intro` and `followUps` are used by `generateConversationalFallback`
 * to produce a templated response.
 *
 * Matching order matters: more specific intents (liveness, MRZ, bias,
 * multimodal, adversarial, identity graph, continuous auth) are checked
 * first; the generic "security features" / "how does" / "what is" /
 * "validate" / "default" intents are checked last so they don't shadow
 * the specific ones.
 *
 * @param query  Raw user query (case-insensitive)
 * @returns DetectedIntent with intent name, intro, and 3 follow-ups
 */
export function detectQueryIntent(query: string): DetectedIntent {
  const q = (query || "").toLowerCase().trim();

  // Liveness / anti-spoofing
  if (
    q.includes("liveness") ||
    q.includes("anti-spoof") ||
    q.includes("anti spoof") ||
    q.includes("presentation attack") ||
    q.includes("pad") ||
    q.includes("blink") ||
    q.includes("spoof")
  ) {
    return {
      intent: "liveness",
      intro:
        "Our liveness detection system combines motion analysis, challenge-response, and seven anti-spoofing signals to verify you're a real, live person — not a photo, mask, or screen replay. Here's the breakdown:",
      followUps: [
        "What anti-spoofing signals do you check?",
        "What is the liveness score threshold?",
        "How does blink detection work?",
      ],
    };
  }

  // MRZ / ICAO 9303
  if (
    q.includes("mrz") ||
    q.includes("machine readable zone") ||
    q.includes("machine-readable") ||
    q.includes("icao 9303") ||
    q.includes("td1") ||
    q.includes("td2") ||
    q.includes("td3") ||
    q.includes("check digit")
  ) {
    return {
      intent: "mrz",
      intro:
        "MRZ (Machine Readable Zone) is the standardized machine-readable text at the bottom of passports and ID cards. We parse all three ICAO 9303 formats (TD1, TD2, TD3) and validate four check digits per document. Here's what we know:",
      followUps: [
        "What's the difference between TD1, TD2, and TD3?",
        "How are MRZ check digits computed?",
        "How do I parse an MRZ string?",
      ],
    };
  }

  // Bias detection / fairness
  if (
    q.includes("bias") ||
    q.includes("fairness") ||
    q.includes("demographic parity") ||
    q.includes("equal opportunity") ||
    q.includes("disparate impact") ||
    q.includes("skin tone") ||
    q.includes("equalized odds")
  ) {
    return {
      intent: "bias",
      intro:
        "Our bias detection system audits verification outcomes across demographic groups (gender, age band, skin tone, region) using seven fairness metrics — demographic parity, equal opportunity, disparate impact, equalized odds, plus three subgroup-specific scores. Results are SHA-256 chained into an audit trail so they can't be retroactively tampered with. Here's what we measure:",
      followUps: [
        "What is demographic parity?",
        "How does the fairness audit trail work?",
        "What happens when a bias check fails?",
      ],
    };
  }

  // Multimodal fusion
  if (
    q.includes("multimodal") ||
    q.includes("fusion") ||
    q.includes("dempster-shafer") ||
    q.includes("dempster shafer") ||
    q.includes("modality") ||
    q.includes("biometric fusion")
  ) {
    return {
      intent: "multimodal",
      intro:
        "Our multimodal fusion system combines face, voice, behavioral, document, and device signals using Dempster-Shafer evidence theory — instead of a fixed weighted average — so that strong agreement across modalities boosts confidence and strong disagreement triggers step-up authentication. Here's how it works:",
      followUps: [
        "What is Dempster-Shafer combination?",
        "How are modality weights chosen?",
        "What happens when modalities disagree?",
      ],
    };
  }

  // Adversarial attack detection
  if (
    q.includes("adversarial") ||
    q.includes("deepfake") ||
    q.includes("3d mask") ||
    q.includes("screen replay") ||
    q.includes("print attack") ||
    q.includes("silicone finger") ||
    q.includes("fgsm") ||
    q.includes("perturbation")
  ) {
    return {
      intent: "adversarial",
      intro:
        "Our adversarial attack detection layer runs eight specialized detectors — deepfake (GAN artifacts), 3D mask, screen replay, print attack, silicone finger, hybrid attack, FGSM, and adversarial perturbation — then ensembles them into a single pass/reject decision. Here's the catalog:",
      followUps: [
        "How do you detect a deepfake?",
        "What is FGSM and how do you catch it?",
        "What does the ensemble decide?",
      ],
    };
  }

  // Identity graph / fraud ring
  if (
    q.includes("identity graph") ||
    q.includes("fraud ring") ||
    q.includes("impossible travel") ||
    q.includes("velocity attack") ||
    q.includes("device reuse") ||
    q.includes("synthetic identity") ||
    q.includes("mule")
  ) {
    return {
      intent: "identity_graph",
      intro:
        "Our identity graph tracks every (entity → entity) relationship — persons ↔ phones, emails, devices, addresses, documents, biometrics — and runs graph algorithms (connected components, BFS, trust propagation) to detect fraud rings, synthetic identities, device reuse, and impossible-travel patterns. Here's what it can find:",
      followUps: [
        "How do you detect a fraud ring?",
        "What is impossible travel detection?",
        "How is the trust score computed?",
      ],
    };
  }

  // Continuous authentication / session
  if (
    q.includes("continuous") ||
    q.includes("session") ||
    q.includes("step-up") ||
    q.includes("step up") ||
    q.includes("drift") ||
    q.includes("reverify")
  ) {
    return {
      intent: "continuous",
      intro:
        "Continuous authentication doesn't stop at login — it tracks behavioral, device, and location signals throughout the session, computes a live drift score, and triggers step-up re-verification (or revocation) when the score crosses a threshold. Here's how it works:",
      followUps: [
        "What signals trigger re-verification?",
        "How is the trust decay function computed?",
        "What's the difference between reverify and revoke?",
      ],
    };
  }

  // Security features
  if (
    q.includes("security feature") ||
    q.includes("uv watermark") ||
    q.includes("hologram") ||
    q.includes("microprint") ||
    q.includes("ghost photo") ||
    q.includes("laser engraving") ||
    q.includes("kinegram") ||
    q.includes("thermochromic") ||
    q.includes("guilloche") ||
    q.includes("intaglio") ||
    (q.includes("security") && q.includes("document"))
  ) {
    return {
      intent: "security_features",
      intro:
        "I'll show you the physical security features for this document — these are the anti-counterfeiting elements you can verify visually (UV watermark, hologram, microprint, ghost photo, laser engraving, etc.). Here's the catalog:",
      followUps: [
        "How can I verify a UV watermark?",
        "What is a kinegram?",
        "Which documents have an embedded chip?",
      ],
    };
  }

  // Validation
  if (
    q.includes("validate") ||
    q.includes("validation") ||
    q.includes("checksum") ||
    q.includes("national id format") ||
    q.includes("id format") ||
    q.includes("luhn") ||
    q.includes("verhoeff")
  ) {
    return {
      intent: "validate",
      intro:
        "Here's how ID validation works in Cirkle — every country has its own checksum algorithm (Luhn, ISO 7064, Verhoeff, mod-10/11/23/26/31/97, country-specific weighted sums, etc.). We support 54 countries with format + checksum validation. Here's the relevant spec:",
      followUps: [
        "Which countries have ID validators?",
        "How does the Luhn algorithm work?",
        "How do I call the validate-id endpoint?",
      ],
    };
  }

  // How does
  if (
    q.startsWith("how ") ||
    q.startsWith("how does") ||
    q.startsWith("how do") ||
    q.startsWith("how is") ||
    q.startsWith("how are") ||
    q.startsWith("how can") ||
    q.includes(" how ") ||
    q.includes("workflow") ||
    q.includes("pipeline")
  ) {
    return {
      intent: "how_does",
      intro:
        "Here's how it works — I've broken the pipeline down into the main stages so you can follow the flow end-to-end:",
      followUps: [
        "What inputs does this require?",
        "What is the success criterion?",
        "Where can I read the API contract?",
      ],
    };
  }

  // What is / what are
  if (
    q.startsWith("what ") ||
    q.startsWith("what's") ||
    q.startsWith("whats") ||
    q.startsWith("what are")
  ) {
    return {
      intent: "what_is",
      intro:
        "Let me explain — here's a definition plus the supporting details from our knowledge base:",
      followUps: [
        "Why is this important for KYC?",
        "How does this compare across countries?",
        "Where can I learn more?",
      ],
    };
  }

  // Default
  return {
    intent: "default",
    intro:
      "Here's what I found in the Cirkle knowledge base — the most relevant specs and references for your query:",
    followUps: [
      "What document types do we support?",
      "How does liveness detection work?",
      "What is MRZ parsing?",
    ],
  };
}

// ─── Chunk formatters ───────────────────────────────────────────────

/**
 * Format a chunk's content as the primary answer, shaped by the
 * detected query intent.
 *
 *  - `security_features` → metadata block + markdown table
 *    (feature | position | description) parsed from the bullet list.
 *  - `how_does` → numbered steps (paragraph-per-step).
 *  - `what_is` → bolded one-line definition + details block.
 *  - `validate` → algorithm + example sections.
 *  - default → content as-is with light cleanup.
 *
 * @param chunk   The top-ranked knowledge chunk
 * @param intent  The detected user intent
 * @returns Formatted markdown for the answer body
 */
export function formatChunkAsAnswer(
  chunk: KnowledgeChunk,
  intent: QueryIntent,
): string {
  switch (intent) {
    case "security_features":
      return formatSecurityFeaturesTable(chunk);
    case "how_does":
      return formatAsNumberedSteps(chunk);
    case "what_is":
      return formatAsDefinition(chunk);
    case "validate":
      return formatAsAlgorithm(chunk);
    default:
      return formatAsCleanMarkdown(chunk);
  }
}

/**
 * Parse the "Security features:" bullet list out of a doc-spec chunk
 * and emit a markdown table. Falls back to clean markdown if the chunk
 * doesn't have the expected bullet-list shape.
 *
 * Sample chunk content:
 *   Country: Egypt (EG)
 *   Document type: national_id
 *   Material: polycarbonate
 *   ...
 *
 *   Security features:
 *     • ghost photo (right side) — Semi-transparent photo visible under UV light
 *     • UV watermark (center) — Republic of Egypt coat of arms under UV
 *     ...
 */
function formatSecurityFeaturesTable(chunk: KnowledgeChunk): string {
  const lines = chunk.content.split("\n");
  const metaLines: string[] = [];
  const featureLines: string[] = [];
  let inFeatures = false;

  for (const line of lines) {
    if (/^security\s*features\s*:\s*$/i.test(line.trim())) {
      inFeatures = true;
      continue;
    }
    if (inFeatures) {
      // Stop when we hit a non-bullet line (e.g. "Notes:")
      if (line.trim() === "" ) continue;
      if (line.trim().startsWith("•") || line.trim().startsWith("-") || line.trim().startsWith("*")) {
        featureLines.push(line.trim().replace(/^[-•*]\s*/, ""));
      } else if (line.trim().toLowerCase().startsWith("notes:")) {
        // Notes: keep on the meta block
        metaLines.push(line.trim());
        inFeatures = false;
      } else {
        // Continuation of a feature line (e.g. wrapped description) — append.
        if (featureLines.length > 0) {
          featureLines[featureLines.length - 1] += " " + line.trim();
        } else {
          metaLines.push(line.trim());
        }
      }
    } else {
      metaLines.push(line);
    }
  }

  // Build the metadata block (drop empty lines)
  const meta = metaLines.filter((l) => l.trim().length > 0).join("\n");

  if (featureLines.length === 0) {
    // No parseable feature list — fall back to clean markdown
    return formatAsCleanMarkdown(chunk);
  }

  // Parse "feature (position) — description" out of each feature line
  const rows: Array<[string, string, string]> = [];
  for (const fl of featureLines) {
    const m = fl.match(/^(.+?)\s*\(([^)]+)\)\s*[—-]?\s*(.+)$/);
    if (m) {
      rows.push([m[1].trim(), m[2].trim(), m[3].trim()]);
    } else {
      // No position — still include the line as a feature with no position
      rows.push([fl, "—", ""]);
    }
  }

  const table = [
    "| Feature | Position | Description |",
    "|---|---|---|",
    ...rows.map(
      ([f, p, d]) => `| **${f}** | ${p} | ${d} |`,
    ),
  ].join("\n");

  return `${meta}\n\n${table}`;
}

/**
 * Format a chunk as numbered steps — splits the content into non-empty
 * paragraphs and numbers each one. Good for "How does X work?" queries
 * where the chunk already lays out the steps in order.
 */
function formatAsNumberedSteps(chunk: KnowledgeChunk): string {
  // Split on blank lines → paragraphs; ignore trivial metadata lines
  const paragraphs = chunk.content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return formatAsCleanMarkdown(chunk);
  }

  // If only 1 paragraph, split on newlines (each line = a step)
  const steps =
    paragraphs.length > 1
      ? paragraphs
      : paragraphs[0]
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && !/^[-•*]\s/.test(s));

  if (steps.length === 0) return formatAsCleanMarkdown(chunk);

  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

/**
 * Format a chunk as a definition + details. The first line/paragraph
 * is bolded as the definition; the rest follows as plain paragraphs.
 */
function formatAsDefinition(chunk: KnowledgeChunk): string {
  const paragraphs = chunk.content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return formatAsCleanMarkdown(chunk);
  }

  const definition = paragraphs[0];
  const rest = paragraphs.slice(1).join("\n\n");

  return `**${definition}**\n\n${rest}`.trim();
}

/**
 * Format a chunk as algorithm + example. Looks for "Algorithm:" /
 * "Layout:" lines and emits them as bolded section headers, then the
 * rest as an example block.
 */
function formatAsAlgorithm(chunk: KnowledgeChunk): string {
  const lines = chunk.content.split("\n");
  const algoLines: string[] = [];
  const exampleLines: string[] = [];
  let inExample = false;

  for (const line of lines) {
    if (
      /^algorithm\s*:/i.test(line.trim()) ||
      /^layout\s*:/i.test(line.trim()) ||
      /^inputs?\s*:/i.test(line.trim()) ||
      /^returns?\s*:/i.test(line.trim())
    ) {
      algoLines.push(line);
    } else if (
      /^use\s/i.test(line.trim()) ||
      /^example\s*:/i.test(line.trim()) ||
      /^endpoint\s*:/i.test(line.trim()) ||
      line.trim().startsWith("POST ") ||
      line.trim().startsWith("GET ")
    ) {
      inExample = true;
      exampleLines.push(line);
    } else if (inExample) {
      exampleLines.push(line);
    } else {
      algoLines.push(line);
    }
  }

  const algoText = algoLines.filter((l) => l.trim().length > 0).join("\n");
  const exampleText = exampleLines.filter((l) => l.trim().length > 0).join("\n");

  const parts: string[] = [];
  if (algoText) {
    parts.push(`**Algorithm & inputs**\n\n${algoText}`);
  }
  if (exampleText) {
    parts.push(`**Example / endpoint**\n\n\`\`\`\n${exampleText}\n\`\`\``);
  }
  if (parts.length === 0) {
    return formatAsCleanMarkdown(chunk);
  }
  return parts.join("\n\n");
}

/**
 * Default formatter — emit the chunk content as-is with light cleanup:
 * strip leading/trailing blank lines, collapse 3+ blank lines to 2.
 */
function formatAsCleanMarkdown(chunk: KnowledgeChunk): string {
  return chunk.content
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "");
}

// ─── Follow-up generation ───────────────────────────────────────────

/**
 * Generate 3 follow-up question suggestions for the user. The questions
 * are pulled from the detected intent's default list, but when the
 * retrieved chunks give us more specific context (e.g. the user asked
 * about "Egyptian ID"), we substitute the most relevant chunk-derived
 * suggestion into slot #1.
 *
 * @param intent   Detected intent
 * @param chunks   Retrieved knowledge chunks (most relevant first)
 * @returns Array of exactly 3 follow-up question strings
 */
export function generateFollowUpQuestions(
  intent: QueryIntent,
  chunks: KnowledgeChunk[],
): string[] {
  const detected = detectQueryIntentFollowups(intent);
  const base = [...detected];
  const topChunk = chunks[0];

  // If we have a top chunk, derive a "tell me more about X" follow-up
  // from its title. This gives the user a one-tap path into the
  // closest related chunk.
  if (topChunk) {
    // Strip the " — security features" / " — overview" suffix to make
    // the follow-up read naturally.
    const shortTitle = topChunk.title
      .replace(/\s*[—-]\s*security features.*$/i, "")
      .replace(/\s*[—-]\s*overview.*$/i, "")
      .replace(/\s*[—-]\s*[a-z ]+$/i, "")
      .trim();
    if (shortTitle && shortTitle.length > 3) {
      base[0] = `Tell me more about ${shortTitle}`;
    }
  }

  // Second slot: if there's a second chunk that's clearly different
  // (different source module), suggest asking about it.
  const secondChunk = chunks[1];
  if (secondChunk && secondChunk.source !== topChunk?.source) {
    const shortTitle = secondChunk.title
      .replace(/\s*[—-]\s*[a-z ]+$/i, "")
      .trim();
    if (shortTitle && shortTitle.length > 3) {
      base[1] = `What about ${shortTitle}?`;
    }
  }

  // Always exactly 3, never undefined
  return base.slice(0, 3);
}

/** Get the default follow-ups for a given intent. */
function detectQueryIntentFollowups(intent: QueryIntent): string[] {
  switch (intent) {
    case "liveness":
      return [
        "What anti-spoofing signals do you check?",
        "What is the liveness score threshold?",
        "How does blink detection work?",
      ];
    case "mrz":
      return [
        "What's the difference between TD1, TD2, and TD3?",
        "How are MRZ check digits computed?",
        "How do I parse an MRZ string?",
      ];
    case "bias":
      return [
        "What is demographic parity?",
        "How does the fairness audit trail work?",
        "What happens when a bias check fails?",
      ];
    case "multimodal":
      return [
        "What is Dempster-Shafer combination?",
        "How are modality weights chosen?",
        "What happens when modalities disagree?",
      ];
    case "adversarial":
      return [
        "How do you detect a deepfake?",
        "What is FGSM and how do you catch it?",
        "What does the ensemble decide?",
      ];
    case "identity_graph":
      return [
        "How do you detect a fraud ring?",
        "What is impossible travel detection?",
        "How is the trust score computed?",
      ];
    case "continuous":
      return [
        "What signals trigger re-verification?",
        "How is the trust decay function computed?",
        "What's the difference between reverify and revoke?",
      ];
    case "security_features":
      return [
        "How can I verify a UV watermark?",
        "What is a kinegram?",
        "Which documents have an embedded chip?",
      ];
    case "validate":
      return [
        "Which countries have ID validators?",
        "How does the Luhn algorithm work?",
        "How do I call the validate-id endpoint?",
      ];
    case "how_does":
      return [
        "What inputs does this require?",
        "What is the success criterion?",
        "Where can I read the API contract?",
      ];
    case "what_is":
      return [
        "Why is this important for KYC?",
        "How does this compare across countries?",
        "Where can I learn more?",
      ];
    default:
      return [
        "What document types do we support?",
        "How does liveness detection work?",
        "What is MRZ parsing?",
      ];
  }
}

// ─── Main entry: conversational fallback ─────────────────────────────

/**
 * Generate a conversational, markdown-formatted fallback response from
 * the retrieved knowledge chunks. This is the public entry point used
 * by `src/app/api/chat/route.ts` when the LLM is unavailable.
 *
 * The response is structured as:
 *   1. Natural-language intro (no "Fallback mode" warning)
 *   2. The top chunk formatted per-intent (table / steps / definition / algorithm / clean)
 *   3. Source citation
 *   4. "Related information" section with 2-3 truncated chunks
 *   5. "Try asking" follow-up question suggestions
 *
 * @param query   Raw user query
 * @param chunks  Top-k retrieved knowledge chunks (most relevant first)
 * @returns Markdown-formatted response string
 */
export function generateConversationalFallback(
  query: string,
  chunks: KnowledgeChunk[],
): string {
  // No chunks — return a helpful "try asking about..." message
  if (!chunks || chunks.length === 0) {
    return [
      "I couldn't find any direct matches for that in the Cirkle knowledge base.",
      "",
      "Try asking about:",
      "- **Document security features** for a specific country (e.g. 'What security features does the Egyptian national ID have?')",
      "- **ID validation** (e.g. 'How does the Egyptian national ID checksum work?')",
      "- **MRZ parsing** (e.g. 'What is the TD1 format?')",
      "- **Liveness detection** (e.g. 'How does anti-spoofing work?')",
      "- **Cross-field validation** (e.g. 'What consistency checks do you run?')",
      "",
      `> Your query was: _"${(query || "").slice(0, 120)}"_`,
    ].join("\n");
  }

  const detected = detectQueryIntent(query);
  const topChunk = chunks[0];

  // 1. Natural intro
  const lines: string[] = [detected.intro, ""];

  // 2. Top-chunk title as a heading
  lines.push(`## ${topChunk.title}`, "");

  // 3. Formatted answer body (table / steps / definition / algorithm / clean)
  lines.push(formatChunkAsAnswer(topChunk, detected.intent), "");

  // 4. Source citation
  lines.push(citeSource(topChunk), "");

  // 5. Related information section — 2-3 truncated chunks
  const related = chunks.slice(1, 4);
  if (related.length > 0) {
    lines.push("## Related information", "");
    for (const c of related) {
      const truncated =
        c.content.length > 500
          ? c.content.slice(0, 500) + "…"
          : c.content;
      lines.push(`### ${c.title}`, "", truncated, "", citeSource(c), "");
    }
  }

  // 6. Follow-up question suggestions
  const followUps = generateFollowUpQuestions(detected.intent, chunks);
  if (followUps.length > 0) {
    lines.push("---", "");
    lines.push("**Try asking:**");
    for (const q of followUps) {
      lines.push(`- ${q}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build a source-citation string for a chunk. The format mirrors what
 * a real LLM-based RAG assistant would say ("According to the X spec...").
 */
function citeSource(chunk: KnowledgeChunk): string {
  switch (chunk.source) {
    case "doc-specs":
      return "> 📖 _Source: Cirkle document security features database_";
    case "id-validators":
      return "> 📖 _Source: Cirkle national ID validator catalog_";
    case "mrz":
      return "> 📖 _Source: Cirkle MRZ parser (ICAO 9303)_";
    case "cross-field":
      return "> 📖 _Source: Cirkle cross-field validation engine_";
    case "ocr":
      return "> 📖 _Source: Cirkle OCR post-processing engine_";
    case "face-quality":
      return "> 📖 _Source: Cirkle face image quality (ISO/IEC 19794-5)_";
    case "liveness":
      return "> 📖 _Source: Cirkle Liveness Pro anti-spoofing module_";
    case "ai-consensus":
      return "> 📖 _Source: Cirkle AI consensus router_";
    case "certificate":
      return "> 📖 _Source: Cirkle verification certificate module_";
    case "risk":
      return "> 📖 _Source: Cirkle risk-adaptive verification module_";
    default:
      return "> 📖 _Source: Cirkle knowledge base_";
  }
}
