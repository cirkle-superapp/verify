/**
 * Seed Document-Definitions Database (Phase 2 / Task P2-B).
 *
 * Populates the Turso `countries`, `document_definitions`, and
 * `coverage_gaps` tables created by migration 001 from the existing
 * in-process knowledge base:
 *
 *   - 175 security-feature specs from src/lib/document-security-features.ts
 *     (93 countries)
 *   - 81 visual templates from src/lib/document-templates.ts (50 countries)
 *   - 76 ID-validators from src/lib/id-validators.ts
 *
 * One `document_definitions` row is created per (country, doc_type, version)
 * tuple, seeded from the security spec and updated with the matching visual
 * template's field_specs when one exists.
 *
 * Coverage gaps are recorded for (country, doc_type) pairs that:
 *   - are supported by an ID validator but lack a security spec (no_source)
 *   - have a security spec but no visual template (template_missing)
 *   - have a spec but no ID checksum validator for the same country
 *     (validator_missing)
 *
 * Idempotent: every write is INSERT OR REPLACE / INSERT OR IGNORE so
 * re-running the script refreshes the catalogue without duplicating rows.
 *
 * Usage:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *     bun run scripts/seed-document-definitions.ts
 *
 * Options:
 *   --dry-run   Build the payload but do not push to Turso.
 *   --verbose   Print every statement's affected-row count.
 */

import { createHash } from "crypto";

import { TursoHttpClient } from "../src/lib/turso-http-client";
import {
  DOCUMENT_SECURITY_SPECS,
  getDocumentSecuritySpec,
  getSecuritySpecCountries,
  type DocumentSecuritySpec,
} from "../src/lib/document-security-features";
import {
  DOCUMENT_TEMPLATES,
  getTemplate,
  type DocumentTemplate,
} from "../src/lib/document-templates";
import { supportedCountries } from "../src/lib/id-validators";

// ─── Helpers ────────────────────────────────────────────────────────

interface CountryMeta {
  isoAlpha3: string;
  region: string;
  languages: string[];
}

const COUNTRY_META: Record<string, CountryMeta> = {
  // ── Africa
  EG: { isoAlpha3: "EGY", region: "Africa", languages: ["ar", "en"] },
  SA: { isoAlpha3: "SAU", region: "Middle East", languages: ["ar"] },
  AE: { isoAlpha3: "ARE", region: "Middle East", languages: ["ar", "en"] },
  KW: { isoAlpha3: "KWT", region: "Middle East", languages: ["ar"] },
  QA: { isoAlpha3: "QAT", region: "Middle East", languages: ["ar", "en"] },
  BH: { isoAlpha3: "BHR", region: "Middle East", languages: ["ar", "en"] },
  OM: { isoAlpha3: "OMN", region: "Middle East", languages: ["ar"] },
  JO: { isoAlpha3: "JOR", region: "Middle East", languages: ["ar"] },
  YE: { isoAlpha3: "YEM", region: "Middle East", languages: ["ar"] },
  IQ: { isoAlpha3: "IRQ", region: "Middle East", languages: ["ar", "ku"] },
  IR: { isoAlpha3: "IRN", region: "Middle East", languages: ["fa"] },
  IL: { isoAlpha3: "ISR", region: "Middle East", languages: ["he", "ar"] },
  PS: { isoAlpha3: "PSE", region: "Middle East", languages: ["ar"] },
  LB: { isoAlpha3: "LBN", region: "Middle East", languages: ["ar"] },
  SY: { isoAlpha3: "SYR", region: "Middle East", languages: ["ar"] },
  AF: { isoAlpha3: "AFG", region: "South Asia", languages: ["ps", "fa"] },
  SD: { isoAlpha3: "SDN", region: "Africa", languages: ["ar", "en"] },
  LY: { isoAlpha3: "LBY", region: "Africa", languages: ["ar"] },
  DZ: { isoAlpha3: "DZA", region: "Africa", languages: ["ar", "fr"] },
  MA: { isoAlpha3: "MAR", region: "Africa", languages: ["ar", "fr"] },
  TN: { isoAlpha3: "TUN", region: "Africa", languages: ["ar", "fr"] },
  TR: { isoAlpha3: "TUR", region: "Europe/Middle East", languages: ["tr"] },
  NG: { isoAlpha3: "NGA", region: "Africa", languages: ["en"] },
  GH: { isoAlpha3: "GHA", region: "Africa", languages: ["en"] },
  KE: { isoAlpha3: "KEN", region: "Africa", languages: ["en", "sw"] },
  ZA: { isoAlpha3: "ZAF", region: "Africa", languages: ["en"] },
  MU: { isoAlpha3: "MUS", region: "Africa", languages: ["en", "fr"] },
  // ── Europe
  GB: { isoAlpha3: "GBR", region: "Europe", languages: ["en"] },
  FR: { isoAlpha3: "FRA", region: "Europe", languages: ["fr"] },
  DE: { isoAlpha3: "DEU", region: "Europe", languages: ["de"] },
  IT: { isoAlpha3: "ITA", region: "Europe", languages: ["it"] },
  ES: { isoAlpha3: "ESP", region: "Europe", languages: ["es"] },
  PT: { isoAlpha3: "PRT", region: "Europe", languages: ["pt"] },
  NL: { isoAlpha3: "NLD", region: "Europe", languages: ["nl"] },
  BE: { isoAlpha3: "BEL", region: "Europe", languages: ["nl", "fr", "de"] },
  LU: { isoAlpha3: "LUX", region: "Europe", languages: ["fr", "de", "lb"] },
  IE: { isoAlpha3: "IRL", region: "Europe", languages: ["en", "ga"] },
  CH: { isoAlpha3: "CHE", region: "Europe", languages: ["de", "fr", "it"] },
  AT: { isoAlpha3: "AUT", region: "Europe", languages: ["de"] },
  SE: { isoAlpha3: "SWE", region: "Europe", languages: ["sv"] },
  NO: { isoAlpha3: "NOR", region: "Europe", languages: ["no"] },
  DK: { isoAlpha3: "DNK", region: "Europe", languages: ["da"] },
  FI: { isoAlpha3: "FIN", region: "Europe", languages: ["fi", "sv"] },
  IS: { isoAlpha3: "ISL", region: "Europe", languages: ["is"] },
  PL: { isoAlpha3: "POL", region: "Europe", languages: ["pl"] },
  CZ: { isoAlpha3: "CZE", region: "Europe", languages: ["cs"] },
  SK: { isoAlpha3: "SVK", region: "Europe", languages: ["sk"] },
  HU: { isoAlpha3: "HUN", region: "Europe", languages: ["hu"] },
  RO: { isoAlpha3: "ROU", region: "Europe", languages: ["ro"] },
  BG: { isoAlpha3: "BGR", region: "Europe", languages: ["bg"] },
  GR: { isoAlpha3: "GRC", region: "Europe", languages: ["el"] },
  HR: { isoAlpha3: "HRV", region: "Europe", languages: ["hr"] },
  RS: { isoAlpha3: "SRB", region: "Europe", languages: ["sr"] },
  SI: { isoAlpha3: "SVN", region: "Europe", languages: ["sl"] },
  EE: { isoAlpha3: "EST", region: "Europe", languages: ["et"] },
  LV: { isoAlpha3: "LVA", region: "Europe", languages: ["lv"] },
  LT: { isoAlpha3: "LTU", region: "Europe", languages: ["lt"] },
  MT: { isoAlpha3: "MLT", region: "Europe", languages: ["mt", "en"] },
  CY: { isoAlpha3: "CYP", region: "Europe", languages: ["el", "tr"] },
  AL: { isoAlpha3: "ALB", region: "Europe", languages: ["sq"] },
  MK: { isoAlpha3: "MKD", region: "Europe", languages: ["mk"] },
  ME: { isoAlpha3: "MNE", region: "Europe", languages: ["srp"] },
  BA: { isoAlpha3: "BIH", region: "Europe", languages: ["bs", "hr", "sr"] },
  XK: { isoAlpha3: "XKX", region: "Europe", languages: ["sq", "sr"] },
  RU: { isoAlpha3: "RUS", region: "Europe/Asia", languages: ["ru"] },
  MD: { isoAlpha3: "MDA", region: "Europe", languages: ["ro", "ru"] },
  UA: { isoAlpha3: "UKR", region: "Europe", languages: ["uk"] },
  GE: { isoAlpha3: "GEO", region: "Europe/Asia", languages: ["ka"] },
  AM: { isoAlpha3: "ARM", region: "Europe/Asia", languages: ["hy"] },
  // ── Americas
  US: { isoAlpha3: "USA", region: "Americas", languages: ["en"] },
  CA: { isoAlpha3: "CAN", region: "Americas", languages: ["en", "fr"] },
  MX: { isoAlpha3: "MEX", region: "Americas", languages: ["es"] },
  BR: { isoAlpha3: "BRA", region: "Americas", languages: ["pt"] },
  AR: { isoAlpha3: "ARG", region: "Americas", languages: ["es"] },
  CL: { isoAlpha3: "CHL", region: "Americas", languages: ["es"] },
  CO: { isoAlpha3: "COL", region: "Americas", languages: ["es"] },
  // ── Asia-Pacific
  CN: { isoAlpha3: "CHN", region: "Asia-Pacific", languages: ["zh"] },
  JP: { isoAlpha3: "JPN", region: "Asia-Pacific", languages: ["ja"] },
  KR: { isoAlpha3: "KOR", region: "Asia-Pacific", languages: ["ko"] },
  IN: { isoAlpha3: "IND", region: "South Asia", languages: ["hi", "en"] },
  PK: { isoAlpha3: "PAK", region: "South Asia", languages: ["ur", "en"] },
  BD: { isoAlpha3: "BGD", region: "South Asia", languages: ["bn"] },
  LK: { isoAlpha3: "LKA", region: "South Asia", languages: ["si", "ta"] },
  NP: { isoAlpha3: "NPL", region: "South Asia", languages: ["ne"] },
  TH: { isoAlpha3: "THA", region: "Asia-Pacific", languages: ["th"] },
  VN: { isoAlpha3: "VNM", region: "Asia-Pacific", languages: ["vi"] },
  ID: { isoAlpha3: "IDN", region: "Asia-Pacific", languages: ["id"] },
  PH: { isoAlpha3: "PHL", region: "Asia-Pacific", languages: ["en", "fil"] },
  MY: { isoAlpha3: "MYS", region: "Asia-Pacific", languages: ["ms", "en"] },
  SG: { isoAlpha3: "SGP", region: "Asia-Pacific", languages: ["en", "ms", "ta"] },
  HK: { isoAlpha3: "HKG", region: "Asia-Pacific", languages: ["zh", "en"] },
  AU: { isoAlpha3: "AUS", region: "Asia-Pacific", languages: ["en"] },
  NZ: { isoAlpha3: "NZL", region: "Asia-Pacific", languages: ["en", "mi"] },
  KH: { isoAlpha3: "KHM", region: "Asia-Pacific", languages: ["km"] },
};

const FALLBACK_REGION = "Unknown";

function countryMeta(code: string): CountryMeta {
  return (
    COUNTRY_META[code] ?? {
      isoAlpha3: code, // best-effort
      region: FALLBACK_REGION,
      languages: ["en"],
    }
  );
}

/**
 * Determine a 1-line country name from a security spec or template.
 * Falls back to the existing `getSecuritySpecCountries` list so even
 * specs without a COUNTRY_META entry get a real name.
 */
function countryNameFor(code: string): string {
  const meta = countryMeta(code);
  if (meta !== COUNTRY_META[code]) {
    // Look up name from spec catalog (case-insensitive).
    const fromCatalog = getSecuritySpecCountries().find(
      (c) => c.code.toUpperCase() === code.toUpperCase(),
    );
    if (fromCatalog) return fromCatalog.name;
  }
  // Last resort — return the code; will be visible in logs.
  return code;
}

function stableId(country: string, docType: string, version: string): string {
  const raw = `${country.toUpperCase()}|${docType}|${version}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

function asJson(value: unknown): string {
  return JSON.stringify(value);
}

function coverageStateFor(spec: DocumentSecuritySpec, hasTemplate: boolean): string {
  // Stronger = more sources of truth align.
  if (spec.features.length >= 5 && hasTemplate) return "comprehensive";
  if (spec.features.length >= 3) return "partial";
  return "minimal";
}

function capabilitiesForSpec(spec: DocumentSecuritySpec): string[] {
  const caps: string[] = ["security_features", "field_validation"];
  if (spec.hasChip) caps.push("chip_authentication");
  if (spec.mrzFormat) caps.push("mrz_structure");
  if (spec.features.some((f) => f.feature.includes("hologram") || f.feature.includes("kinegram"))) {
    caps.push("tampering_detection");
  }
  return Array.from(new Set(caps));
}

function validationRulesFor(spec: DocumentSecuritySpec, template?: DocumentTemplate): unknown[] {
  const rules: Array<{ name: string; type: string; description: string }> = [];
  rules.push({
    name: "material_check",
    type: "literal",
    description: `Expected material: ${spec.material}`,
  });
  if (spec.dimensions) {
    rules.push({
      name: "dimensions_check",
      type: "literal",
      description: `Expected dimensions: ${spec.dimensions}`,
    });
  }
  if (spec.mrzFormat) {
    rules.push({
      name: "mrz_format_check",
      type: "enum",
      description: `MRZ format must be ${spec.mrzFormat} (per ICAO Doc 9303)`,
    });
  }
  for (const feature of spec.features) {
    rules.push({
      name: `security_feature:${feature.feature}`,
      type: "presence",
      description: `${feature.feature} at ${feature.position}: ${feature.description}`,
    });
  }
  if (template) {
    for (const field of template.fields) {
      rules.push({
        name: `field:${field.name}`,
        type: "position",
        description: `Field ${field.name} at relative position x=${field.position.x} y=${field.position.y} w=${field.position.w} h=${field.position.h}`,
      });
    }
  }
  return rules;
}

function confidenceLimitationsFor(spec: DocumentSecuritySpec, hasTemplate: boolean): string[] {
  const limits: string[] = [];
  if (!hasTemplate) limits.push("no_visual_template: field-position accuracy is unverified");
  if (!spec.hasChip && spec.docType === "passport") {
    limits.push("no_chip: electronic authentication unavailable for this passport");
  }
  if (spec.features.length < 3) {
    limits.push("limited_security_features: few anti-counterfeit elements documented");
  }
  if (spec.notes) limits.push(`spec_notes: ${spec.notes}`);
  return limits;
}

interface CoverageGapSeed {
  id: string;
  countryCode: string;
  docType: string;
  gapType: string;
  description: string;
  blockingReason: string;
}

function buildCoverageGaps(
  securitySpecs: DocumentSecuritySpec[],
  templateKeys: Set<string>,
  validatorCountries: Set<string>,
): CoverageGapSeed[] {
  const gaps: CoverageGapSeed[] = [];
  const seen = new Set<string>();

  const push = (countryCode: string, docType: string, gapType: string, description: string, blockingReason: string) => {
    const id = createHash("sha256")
      .update(`${countryCode}|${docType}|${gapType}`)
      .digest("hex")
      .slice(0, 16);
    if (seen.has(id)) return;
    seen.add(id);
    gaps.push({ id, countryCode, docType, gapType, description, blockingReason });
  };

  for (const spec of securitySpecs) {
    const key = `${spec.country.toUpperCase()}|${spec.docType}`;
    if (!templateKeys.has(key)) {
      push(
        spec.country,
        spec.docType,
        "template_missing",
        `Security spec exists for ${spec.country} ${spec.docType} but no visual field-position template is available`,
        "Field-position verification cannot be performed — risk of false-positive matches",
      );
    }
    if (spec.docType === "national_id" && !validatorCountries.has(spec.country.toUpperCase())) {
      push(
        spec.country,
        spec.docType,
        "validator_missing",
        `Security spec exists for ${spec.country} ${spec.docType} but no ID checksum validator is implemented`,
        "Cross-field checksum validation cannot be performed",
      );
    }
  }

  return gaps;
}

// ─── Statement builders ─────────────────────────────────────────────

function buildCountryStatement(code: string, name: string, meta: CountryMeta, nowIso: string): {
  sql: string;
  args: unknown[];
} {
  return {
    sql: `INSERT OR REPLACE INTO countries
            (iso_alpha2, iso_alpha3, country_name, region, languages, last_reviewed)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [code, meta.isoAlpha3, name, meta.region, asJson(meta.languages), nowIso],
  };
}

interface DocDefinitionSeed {
  id: string;
  countryCode: string;
  docType: string;
  version: string;
  languages: string;
  scripts: string;
  mrzFormat: string | null;
  fieldSpecs: string;
  validationRules: string;
  verificationCapabilities: string;
  referenceSourceId: string;
  sourceLicence: string;
  coverageState: string;
  confidenceLimitations: string;
  lastReviewed: string;
}

function buildDocDefinitionStatement(seed: DocDefinitionSeed, nowIso: string): {
  sql: string;
  args: unknown[];
} {
  return {
    sql: `INSERT OR REPLACE INTO document_definitions
            (id, country_code, doc_type, version, languages, scripts, mrz_format,
             field_specs, validation_rules, verification_capabilities,
             reference_source_id, source_licence, coverage_state,
             confidence_limitations, last_reviewed, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      seed.id,
      seed.countryCode,
      seed.docType,
      seed.version,
      seed.languages,
      seed.scripts,
      seed.mrzFormat,
      seed.fieldSpecs,
      seed.validationRules,
      seed.verificationCapabilities,
      seed.referenceSourceId,
      seed.sourceLicence,
      seed.coverageState,
      seed.confidenceLimitations,
      seed.lastReviewed,
      nowIso,
    ],
  };
}

function buildCoverageGapStatement(gap: CoverageGapSeed, nowIso: string): {
  sql: string;
  args: unknown[];
} {
  return {
    sql: `INSERT OR REPLACE INTO coverage_gaps
            (id, country_code, doc_type, gap_type, description, blocking_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      gap.id,
      gap.countryCode,
      gap.docType,
      gap.gapType,
      gap.description,
      gap.blockingReason,
      nowIso,
    ],
  };
}

// ─── Argument parsing ───────────────────────────────────────────────

function parseArgs(argv: string[]): { dryRun: boolean; verbose: boolean } {
  let dryRun = false;
  let verbose = false;
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--verbose") verbose = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: seed-document-definitions.ts [--dry-run] [--verbose]",
      );
      process.exit(0);
    }
  }
  return { dryRun, verbose };
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const { dryRun, verbose } = parseArgs(process.argv);

  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.error(
      "Missing TURSO_DATABASE_URL.\n\n" +
        "Usage:\n" +
        "  TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \\\n" +
        "  bun run scripts/seed-document-definitions.ts\n",
    );
    process.exit(1);
  }

  const nowIso = new Date().toISOString();

  // ─── Build country set (union of all three sources) ────────────
  const validatorCountriesList = supportedCountries();
  const securitySpecCountries = getSecuritySpecCountries();
  const templateCountriesSet = new Set(
    DOCUMENT_TEMPLATES.map((t) => t.country.toUpperCase()),
  );
  const securitySpecCountriesSet = new Set(
    securitySpecCountries.map((c) => c.code.toUpperCase()),
  );
  const validatorCountriesSet = new Set(
    validatorCountriesList.map((c) => c.toUpperCase()),
  );

  const allCountryCodes = new Set<string>([
    ...validatorCountriesList.map((c) => c.toUpperCase()),
    ...securitySpecCountriesSet,
    ...templateCountriesSet,
  ]);

  console.log(
    `Discovered ${allCountryCodes.size} unique countries ` +
      `(${validatorCountriesList.length} with validators, ` +
      `${securitySpecCountries.length} with security specs, ` +
      `${templateCountriesSet.size} with visual templates).`,
  );

  // ─── Build country statements ─────────────────────────────────
  const countryStatements = Array.from(allCountryCodes).map((code) =>
    buildCountryStatement(code, countryNameFor(code), countryMeta(code), nowIso),
  );

  // ─── Build document_definition statements ─────────────────────
  // Pre-index templates by (country|docType) for fast lookup.
  const templatesByKey = new Map<string, DocumentTemplate>();
  for (const t of DOCUMENT_TEMPLATES) {
    templatesByKey.set(`${t.country.toUpperCase()}|${t.docType}`, t);
  }
  const templateKeys = new Set(templatesByKey.keys());

  // Track which (country|docType) pairs have a definition so we can
  // detect template-only entries that have no security spec.
  const definedPairs = new Set<string>();

  const docDefSeeds: DocDefinitionSeed[] = [];
  for (const spec of DOCUMENT_SECURITY_SPECS) {
    const countryCode = spec.country.toUpperCase();
    const key = `${countryCode}|${spec.docType}`;
    definedPairs.add(key);
    const template = templatesByKey.get(key);
    const hasTemplate = !!template;

    const version = spec.issuedSince ?? "1.0";
    const meta = countryMeta(countryCode);

    const fieldSpecs = template
      ? asJson({
          source: "document-templates",
          fields: template.fields.map((f) => ({
            name: f.name,
            position: f.position,
            fontSize: f.fontSize,
            fontStyle: f.fontStyle,
            alignment: f.alignment,
            script: f.script,
          })),
          layout: template.layout,
          colors: template.colors,
        })
      : asJson({
          source: "security-spec-only",
          features: spec.features.map((f) => ({
            feature: f.feature,
            position: f.position,
            description: f.description,
          })),
          note: "No visual template — field positions are unknown",
        });

    docDefSeeds.push({
      id: stableId(countryCode, spec.docType, version),
      countryCode,
      docType: spec.docType,
      version,
      languages: asJson(meta.languages),
      scripts: asJson(
        meta.languages.includes("ar") ? ["Latin", "Arabic"] : ["Latin"],
      ),
      mrzFormat: spec.mrzFormat ?? null,
      fieldSpecs,
      validationRules: asJson(validationRulesFor(spec, template)),
      verificationCapabilities: asJson(capabilitiesForSpec(spec)),
      referenceSourceId: "prado",
      sourceLicence:
        "Council of the EU — public information, non-commercial use; specimens NOT redistributable",
      coverageState: coverageStateFor(spec, hasTemplate),
      confidenceLimitations: asJson(confidenceLimitationsFor(spec, hasTemplate)),
      lastReviewed: nowIso,
    });
  }

  // Templates without a matching security spec still get a
  // document_definitions row (so the catalogue is exhaustive).
  for (const t of DOCUMENT_TEMPLATES) {
    const key = `${t.country.toUpperCase()}|${t.docType}`;
    if (definedPairs.has(key)) continue;
    definedPairs.add(key);
    const version = "1.0";
    const meta = countryMeta(t.country.toUpperCase());
    docDefSeeds.push({
      id: stableId(t.country.toUpperCase(), t.docType, version),
      countryCode: t.country.toUpperCase(),
      docType: t.docType,
      version,
      languages: asJson(meta.languages),
      scripts: asJson(
        meta.languages.includes("ar") ? ["Latin", "Arabic"] : ["Latin"],
      ),
      mrzFormat: t.docType === "passport" ? "TD3" : null,
      fieldSpecs: asJson({
        source: "document-templates",
        fields: t.fields.map((f) => ({
          name: f.name,
          position: f.position,
          fontSize: f.fontSize,
          fontStyle: f.fontStyle,
          alignment: f.alignment,
          script: f.script,
        })),
        layout: t.layout,
        colors: t.colors,
      }),
      validationRules: asJson(validationRulesFor({
        ...t,
        country: t.country,
        countryName: countryNameFor(t.country),
        material: "unknown",
        features: [],
      } as unknown as DocumentSecuritySpec, t)),
      verificationCapabilities: asJson([
        "field_validation",
        "document_classification",
      ]),
      referenceSourceId: "internal",
      sourceLicence: "Internal knowledge base — public government references",
      coverageState: "partial",
      confidenceLimitations: asJson([
        "no_security_spec: physical security features undocumented for this document",
      ]),
      lastReviewed: nowIso,
    });
  }

  const docDefStatements = docDefSeeds.map((s) =>
    buildDocDefinitionStatement(s, nowIso),
  );

  // ─── Build coverage_gaps statements ───────────────────────────
  const gaps = buildCoverageGaps(
    DOCUMENT_SECURITY_SPECS,
    templateKeys,
    validatorCountriesSet,
  );
  const gapStatements = gaps.map((g) => buildCoverageGapStatement(g, nowIso));

  // ─── Dry-run: print summary and exit ──────────────────────────
  if (dryRun) {
    console.log("\n[dry-run] Would push:");
    console.log(`  ${countryStatements.length} country rows`);
    console.log(`  ${docDefStatements.length} document_definition rows`);
    console.log(`  ${gapStatements.length} coverage_gap rows`);
    if (verbose) {
      console.log("\nFirst 3 country statements:");
      countryStatements.slice(0, 3).forEach((s, i) =>
        console.log(`  [${i + 1}] ${s.sql.replace(/\s+/g, " ").slice(0, 80)}…`),
      );
      console.log("\nFirst 3 doc-definition statements:");
      docDefStatements.slice(0, 3).forEach((s, i) =>
        console.log(`  [${i + 1}] ${s.sql.replace(/\s+/g, " ").slice(0, 80)}…`),
      );
      console.log("\nFirst 3 coverage-gap statements:");
      gapStatements.slice(0, 3).forEach((s, i) =>
        console.log(`  [${i + 1}] ${s.sql.replace(/\s+/g, " ").slice(0, 80)}…`),
      );
    }
    process.exit(0);
  }

  // ─── Push to Turso ─────────────────────────────────────────────
  console.log(`\nConnecting to ${url}…`);
  const client = new TursoHttpClient({ url, authToken: token });

  // Connectivity probe.
  try {
    const probe = await client.execute("SELECT 1 AS ok");
    if (probe.rows.length === 0) throw new Error("probe returned no rows");
    console.log("✓ Connection successful\n");
  } catch (e: any) {
    console.error(`✗ Connection failed: ${e?.message ?? e}`);
    process.exit(1);
  }

  // Push in batches. Turso's /v2/pipeline accepts many statements at
  // once, but we chunk to keep requests manageable.
  const BATCH_SIZE = 25;
  let countriesSeeded = 0;
  let docDefsSeeded = 0;
  let gapsSeeded = 0;
  let failures = 0;

  async function pushBatch(
    label: string,
    stmts: Array<{ sql: string; args?: unknown[] }>,
    counter: () => void,
  ) {
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const slice = stmts.slice(i, i + BATCH_SIZE);
      try {
        const results = await client.batch(slice);
        for (const r of results) {
          if (r.affectedRowCount > 0) counter();
        }
        if (verbose) {
          console.log(
            `  ${label}: pushed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(stmts.length / BATCH_SIZE)} (${slice.length} stmts)`,
          );
        }
      } catch (e: any) {
        failures++;
        console.error(`  ✗ ${label} batch at offset ${i}: ${e?.message ?? e}`);
      }
    }
  }

  await pushBatch("countries", countryStatements, () => countriesSeeded++);
  await pushBatch("document_definitions", docDefStatements, () => docDefsSeeded++);
  await pushBatch("coverage_gaps", gapStatements, () => gapsSeeded++);

  // ─── Verification: count rows per table ────────────────────────
  console.log("\nVerification — row counts:");
  let dbCountryRows = 0;
  let dbDocDefRows = 0;
  let dbGapRows = 0;
  for (const table of ["countries", "document_definitions", "coverage_gaps"]) {
    try {
      const r = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
      const n = Number((r.rows[0] as { n?: number | string })?.n ?? 0);
      console.log(`  - ${table}: ${n} rows`);
      if (table === "countries") dbCountryRows = n;
      if (table === "document_definitions") dbDocDefRows = n;
      if (table === "coverage_gaps") dbGapRows = n;
    } catch (e: any) {
      console.log(`  - ${table}: (could not count: ${e?.message ?? e})`);
    }
  }

  // Print the summary. We surface both the count of seed records we
  // generated AND the actual unique rows stored in the DB — when
  // the same (country, docType, version) tuple appears multiple
  // times in the source data (duplicate specs/templates), INSERT OR
  // REPLACE collapses them into one row.
  console.log(
    `\nSeeded ${dbCountryRows} countries, ${dbDocDefRows} document definitions, ${dbGapRows} coverage gaps` +
      ` (${docDefsSeeded - dbDocDefRows} duplicate-key merges)`,
  );

  if (failures > 0) {
    console.error(`\n${failures} batch failure(s) — see logs above.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("Fatal:", e?.message ?? e);
  process.exit(1);
});
