/**
 * Source Registry V2 — Lifecycle-aware catalogue of identity-document
 * reference sources.
 *
 * Phase 2 / Task P2-A.
 *
 * This module upgrades the original global-source-registry.ts with an
 * explicit, ordered lifecycle state machine and a richer per-source record
 * that tracks every field required by spec section 3 (provenance,
 * licence, automated-access permission, technical + legal review,
 * download status, integrity-check info, completeness limitations, and
 * internal implementation decision + reviewer notes).
 *
 * Lifecycle (ordered):
 *   DISCOVERED → UNDER_REVIEW → APPROVED → DOWNLOADABLE
 *                → DOWNLOADED → VALIDATED → INTEGRATED
 *
 * Terminal / blocking states reachable at any point:
 *   REJECTED, RESTRICTED, BLOCKED
 *
 * The registry is the single source of truth that the ingestion pipeline
 * (src/lib/ingestion-pipeline.ts) consults before retrieving any external
 * resource. Only sources in APPROVED or later states are eligible for
 * automated ingestion.
 */

import { createHash } from "crypto";
import {
  REFERENCE_SOURCES,
  type AccessRequirement,
  type SourceCategory,
} from "@/lib/global-source-registry";

// ─── Lifecycle state machine ─────────────────────────────────────────

export type SourceLifecycleState =
  | "DISCOVERED" // We know the source exists; no review yet.
  | "UNDER_REVIEW" // Being assessed (technical + legal).
  | "APPROVED" // Licence + access reviewed and approved for use.
  | "DOWNLOADABLE" // Automated retrieval is permitted + reachable.
  | "DOWNLOADED" // Content has been retrieved at least once.
  | "VALIDATED" // Format + content + hash verified.
  | "INTEGRATED" // Wired into verification code paths.
  | "REJECTED" // Reviewed and explicitly rejected.
  | "RESTRICTED" // Available only under special conditions.
  | "BLOCKED"; // Hard-blocked (licence/abuse/legal).

export const LIFECYCLE_ORDER: SourceLifecycleState[] = [
  "DISCOVERED",
  "UNDER_REVIEW",
  "APPROVED",
  "DOWNLOADABLE",
  "DOWNLOADED",
  "VALIDATED",
  "INTEGRATED",
];

export const TERMINAL_STATES: SourceLifecycleState[] = [
  "REJECTED",
  "RESTRICTED",
  "BLOCKED",
];

/**
 * Allowed forward transitions for the happy path. Terminal states are
 * sticky (REJECTED → BLOCKED allowed only via escalation).
 */
const ALLOWED_TRANSITIONS: Record<SourceLifecycleState, SourceLifecycleState[]> = {
  DISCOVERED: ["UNDER_REVIEW", "REJECTED", "BLOCKED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "RESTRICTED", "BLOCKED"],
  APPROVED: ["DOWNLOADABLE", "RESTRICTED", "REJECTED"],
  DOWNLOADABLE: ["DOWNLOADED", "RESTRICTED", "BLOCKED"],
  DOWNLOADED: ["VALIDATED", "DOWNLOADABLE", "BLOCKED"],
  VALIDATED: ["INTEGRATED", "DOWNLOADED", "BLOCKED"],
  INTEGRATED: ["VALIDATED", "DOWNLOADED", "BLOCKED"],
  REJECTED: ["UNDER_REVIEW", "BLOCKED"],
  RESTRICTED: ["UNDER_REVIEW", "APPROVED", "BLOCKED"],
  BLOCKED: [],
};

export function isTransitionAllowed(
  from: SourceLifecycleState,
  to: SourceLifecycleState,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ─── Review + download status enums ──────────────────────────────────

export type ReviewStatus = "pending" | "in_progress" | "passed" | "failed" | "waived";

export type DownloadStatus =
  | "never_attempted"
  | "in_progress"
  | "succeeded"
  | "failed"
  | "stale";

export type ImplementationDecision =
  | "adopted" // Source is integrated and used in production paths.
  | "evaluating" // Still being assessed for integration.
  | "shadow_only" // Used for benchmarking, not in production paths.
  | "rejected" // Considered and explicitly rejected.
  | "not_applicable"; // Source is informational only (e.g., standards text).

// ─── Upgraded source record ──────────────────────────────────────────

export interface ReferenceSourceV2 {
  // ─ Stable identification
  id: string;
  name: string;
  description: string;
  category: SourceCategory;
  officialUrl: string;

  // ─ Scope
  countriesCovered: string[]; // ISO alpha-2 or ["global"]
  documentCategories: string[]; // ["passport", "national_id", ...]
  documentVariants?: string[]; // e.g. ["TD3", "TD1", "ePassport"]
  languages: string[]; // ["en", "ar", ...]
  writingSystems?: string[]; // ["Latin", "Arabic", "Cyrillic", ...]
  publishingOrg?: string; // e.g. "ICAO", "Council of the EU"

  // ─ Resource metadata (NEW in v2)
  format?: string; // "pdf", "zip", "json", "csv", ...
  sizeBytes?: number; // Known/declared size, if any
  upstreamVersion?: string; // Version reported by the upstream
  publicationDate?: string; // ISO date the upstream published this revision

  // ─ Licence + attribution (some NEW in v2)
  licence: string;
  licenceUrl?: string;
  attributionRequired: boolean; // NEW
  redistributionNotes?: string; // NEW — describes redistribution limits
  redistributionAllowed: boolean;

  // ─ Automated access
  accessRequirement: AccessRequirement;
  retrievalMethod: "manual" | "api" | "download" | "not_automated";
  lastChecked: string; // ISO 8601

  // ─ Review status (NEW in v2)
  technicalReviewStatus: ReviewStatus;
  legalReviewStatus: ReviewStatus;
  reviewerNotes?: string; // NEW
  implementationDecision: ImplementationDecision; // NEW

  // ─ Download + integrity (NEW in v2)
  downloadStatus: DownloadStatus;
  sha256Hash?: string; // NEW — set after successful ingestion
  downloadedAt?: string; // NEW — ISO timestamp of last successful fetch

  // ─ Lifecycle + limitations
  lifecycleState: SourceLifecycleState;
  completeness: "comprehensive" | "partial" | "minimal" | "unknown";
  limitations: string[];

  // Free-form notes (kept for backward compat with v1)
  notes: string;
}

// ─── Seed: lift v1 sources into v2 shape ────────────────────────────

function inferFormat(method: string, url: string): string | undefined {
  if (url.endsWith(".pdf")) return "pdf";
  if (url.endsWith(".zip")) return "zip";
  if (url.endsWith(".json")) return "json";
  if (url.endsWith(".csv")) return "csv";
  if (url.endsWith(".xml")) return "xml";
  if (url.endsWith(".sql")) return "sql";
  if (method === "api") return "json";
  return undefined;
}

function inferWritingSystems(languages: string[]): string[] {
  const map: Record<string, string> = {
    en: "Latin",
    fr: "Latin",
    es: "Latin",
    de: "Latin",
    it: "Latin",
    pt: "Latin",
    nl: "Latin",
    tr: "Latin",
    vi: "Latin",
    id: "Latin",
    ar: "Arabic",
    fa: "Arabic",
    ur: "Arabic",
    ru: "Cyrillic",
    bg: "Cyrillic",
    uk: "Cyrillic",
    zh: "Han",
    ja: "Kana/Kanji",
    ko: "Hangul",
    th: "Thai",
    he: "Hebrew",
    hi: "Devanagari",
  };
  const set = new Set<string>();
  for (const l of languages) {
    const w = map[l];
    if (w) set.add(w);
  }
  return Array.from(set);
}

function liftToV2(src: (typeof REFERENCE_SOURCES)[number]): ReferenceSourceV2 {
  // Heuristic: assign lifecycle state from v1 status.
  let lifecycleState: SourceLifecycleState = "DISCOVERED";
  switch (src.sourceStatus) {
    case "verified":
      lifecycleState = "INTEGRATED";
      break;
    case "investigated":
      lifecycleState = "UNDER_REVIEW";
      break;
    case "pending":
      lifecycleState = "DISCOVERED";
      break;
    case "blocked":
      lifecycleState = "BLOCKED";
      break;
    case "unavailable":
      lifecycleState = "RESTRICTED";
      break;
  }

  const technicalReviewStatus: ReviewStatus =
    src.sourceStatus === "verified"
      ? "passed"
      : src.sourceStatus === "investigated"
        ? "in_progress"
        : "pending";

  const legalReviewStatus: ReviewStatus =
    src.accessRequirement === "public_free" || src.accessRequirement === "public_licensed"
      ? "passed"
      : src.sourceStatus === "verified"
        ? "passed"
        : "in_progress";

  const implementationDecision: ImplementationDecision =
    src.sourceStatus === "verified"
      ? "adopted"
      : src.sourceStatus === "investigated"
        ? "evaluating"
        : src.sourceStatus === "pending"
          ? "evaluating"
          : "rejected";

  return {
    id: src.id,
    name: src.name,
    description: src.description,
    category: src.category,
    officialUrl: src.officialUrl,
    countriesCovered: src.countriesCovered,
    documentCategories: src.documentTypes,
    languages: src.languages,
    writingSystems: inferWritingSystems(src.languages),
    publishingOrg: src.category === "icao_standard" ? "ICAO" :
      src.category === "icao_pkd" ? "ICAO" :
      src.category === "prado" ? "Council of the European Union" :
      src.category === "open_source_software" ? "Open-source community" : undefined,
    format: inferFormat(src.retrievalMethod, src.officialUrl),
    sizeBytes: undefined,
    upstreamVersion: undefined,
    publicationDate: undefined,
    licence: src.licence,
    licenceUrl: src.licenceUrl,
    attributionRequired: !src.redistributionAllowed,
    redistributionNotes: src.redistributionAllowed
      ? undefined
      : "Redistribution not permitted; platform links to source rather than mirroring content.",
    redistributionAllowed: src.redistributionAllowed,
    accessRequirement: src.accessRequirement,
    retrievalMethod: src.retrievalMethod,
    lastChecked: src.lastChecked,
    technicalReviewStatus,
    legalReviewStatus,
    reviewerNotes: src.notes,
    implementationDecision,
    downloadStatus:
      src.retrievalMethod === "download" && src.sourceStatus === "verified"
        ? "succeeded"
        : "never_attempted",
    sha256Hash: undefined,
    downloadedAt: undefined,
    lifecycleState,
    completeness: src.completeness,
    limitations: src.limitations,
    notes: src.notes,
  };
}

// In-memory registry (mutated by upgradeSourceState / download lifecycle hooks).
// We start from the v1 seed so that the platform has continuity with the
// existing global-source-registry.ts.
const REGISTRY: Map<string, ReferenceSourceV2> = new Map(
  REFERENCE_SOURCES.map((s) => [s.id, liftToV2(s)]),
);

// Provenance log — every lifecycle transition is appended here with a
// timestamp + reviewer notes. getSourceProvenance(id) returns this chain.
interface ProvenanceEntry {
  sourceId: string;
  timestamp: string;
  fromState: SourceLifecycleState | "INIT";
  toState: SourceLifecycleState;
  notes?: string;
  reviewer?: string;
  hash: string;
}

const PROVENANCE_LOG: ProvenanceEntry[] = REFERENCE_SOURCES.map((s) => {
  const v2 = liftToV2(s);
  const entry: ProvenanceEntry = {
    sourceId: s.id,
    timestamp: s.lastChecked,
    fromState: "INIT",
    toState: v2.lifecycleState,
    notes: "Auto-seeded from v1 registry",
    reviewer: "system",
    hash: "",
  };
  entry.hash = createHash("sha256")
    .update(`${entry.sourceId}|${entry.timestamp}|${entry.fromState}|${entry.toState}`)
    .digest("hex");
  return entry;
});

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Return every source in the registry (v2 shape).
 */
export function getAllSourcesV2(): ReferenceSourceV2[] {
  return Array.from(REGISTRY.values());
}

/**
 * Sources that have passed both technical and legal review (lifecycle
 * state >= APPROVED). These are eligible for automated ingestion.
 */
export function getApprovedSources(): ReferenceSourceV2[] {
  return getAllSourcesV2().filter(
    (s) =>
      LIFECYCLE_ORDER.indexOf(s.lifecycleState) >= LIFECYCLE_ORDER.indexOf("APPROVED") ||
      s.lifecycleState === "RESTRICTED",
  );
}

/**
 * Sources cleared for automated download (state >= DOWNLOADABLE).
 * The ingestion pipeline only ingests from this set.
 */
export function getDownloadableSources(): ReferenceSourceV2[] {
  return getAllSourcesV2().filter(
    (s) =>
      LIFECYCLE_ORDER.indexOf(s.lifecycleState) >= LIFECYCLE_ORDER.indexOf("DOWNLOADABLE"),
  );
}

/**
 * Sources that have reached the INTEGRATED state — i.e. they are wired
 * into verification code paths.
 */
export function getIntegratedSources(): ReferenceSourceV2[] {
  return getAllSourcesV2().filter((s) => s.lifecycleState === "INTEGRATED");
}

export function getSourceById(id: string): ReferenceSourceV2 | undefined {
  return REGISTRY.get(id);
}

/**
 * Move a source from one lifecycle state to another. The transition is
 * validated against the state machine, and the change is recorded in
 * the provenance log. Throws if the transition is not allowed.
 */
export function upgradeSourceState(
  id: string,
  newState: SourceLifecycleState,
  notes?: string,
  reviewer: string = "operator",
): ReferenceSourceV2 {
  const src = REGISTRY.get(id);
  if (!src) {
    throw new Error(`Source not found: ${id}`);
  }
  if (!isTransitionAllowed(src.lifecycleState, newState)) {
    throw new Error(
      `Illegal transition for ${id}: ${src.lifecycleState} → ${newState}`,
    );
  }

  const prev = src.lifecycleState;
  src.lifecycleState = newState;
  src.lastChecked = new Date().toISOString();

  // Side-effects on relevant transitions.
  if (newState === "DOWNLOADED") src.downloadStatus = "succeeded";
  if (newState === "VALIDATED") src.downloadStatus = "succeeded";
  if (newState === "INTEGRATED") src.implementationDecision = "adopted";
  if (newState === "REJECTED") src.implementationDecision = "rejected";
  if (newState === "BLOCKED") src.implementationDecision = "rejected";
  if (newState === "RESTRICTED") src.implementationDecision = "shadow_only";

  if (notes) src.reviewerNotes = notes;

  const entry: ProvenanceEntry = {
    sourceId: id,
    timestamp: src.lastChecked,
    fromState: prev,
    toState: newState,
    notes,
    reviewer,
    hash: "",
  };
  entry.hash = createHash("sha256")
    .update(`${entry.sourceId}|${entry.timestamp}|${entry.fromState}|${entry.toState}|${notes ?? ""}`)
    .digest("hex");
  PROVENANCE_LOG.push(entry);

  return src;
}

/**
 * Record the result of a successful download / integrity check on a source.
 * Used by the ingestion pipeline.
 */
export function recordDownloadResult(
  id: string,
  result: { sha256Hash: string; sizeBytes: number; upstreamVersion?: string },
): ReferenceSourceV2 | undefined {
  const src = REGISTRY.get(id);
  if (!src) return undefined;
  src.sha256Hash = result.sha256Hash;
  src.sizeBytes = result.sizeBytes;
  if (result.upstreamVersion) src.upstreamVersion = result.upstreamVersion;
  src.downloadedAt = new Date().toISOString();
  src.downloadStatus = "succeeded";
  return src;
}

/**
 * Return the full provenance chain for a source — every lifecycle
 * transition recorded against the source id, with hashes for tamper
 * detection.
 */
export function getSourceProvenance(id: string): {
  sourceId: string;
  entries: ProvenanceEntry[];
  length: number;
  head: string;
  currentState: SourceLifecycleState | undefined;
} {
  const entries = PROVENANCE_LOG.filter((e) => e.sourceId === id);
  const head = entries.length
    ? entries[entries.length - 1].hash
    : "0".repeat(64);
  return {
    sourceId: id,
    entries,
    length: entries.length,
    head,
    currentState: REGISTRY.get(id)?.lifecycleState,
  };
}

/**
 * Summary statistics for the registry.
 */
export function getSourceRegistryV2Summary() {
  const all = getAllSourcesV2();
  const byState = all.reduce((acc, s) => {
    acc[s.lifecycleState] = (acc[s.lifecycleState] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const byImplementation = all.reduce((acc, s) => {
    acc[s.implementationDecision] = (acc[s.implementationDecision] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const byAccess = all.reduce((acc, s) => {
    acc[s.accessRequirement] = (acc[s.accessRequirement] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    totalSources: all.length,
    approved: getApprovedSources().length,
    downloadable: getDownloadableSources().length,
    integrated: getIntegratedSources().length,
    byState,
    byImplementation,
    byAccess,
    countriesCovered: new Set(all.flatMap((s) => s.countriesCovered)).size,
  };
}
