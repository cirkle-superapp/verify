-- Cirkle Identity Verification — Document Reference Database
-- Migration 001 — Phase 2 / Task P2-A
--
-- Schema for the document-reference catalogue that backs the Phase 2
-- ingestion pipeline (src/lib/ingestion-pipeline.ts) and the upgraded
-- source registry (src/lib/source-registry-v2.ts).
--
-- Target DB: Turso (libSQL/SQLite). Apply via:
--   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
--     bun run scripts/migrate-document-reference.ts
--
-- Tables:
--   countries              — ISO country codes + region/language summary
--   issuing_authorities    — Issuers of identity documents per country
--   document_definitions  — Versioned specifications of document types
--   source_provenance     — Per-source provenance + hash + licence record
--   coverage_gaps         — Catalogue of known coverage gaps
--
-- All JSON-typed columns are TEXT containing JSON; the application layer
-- is responsible for parsing/serialising. SQLite has no native JSON type
-- but supports json_extract() for query-time access where useful.

PRAGMA foreign_keys = ON;

-- ────────────────────────────────────────────────────────────────────
-- countries
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS countries (
  iso_alpha2 TEXT PRIMARY KEY NOT NULL,
  iso_alpha3 TEXT,
  country_name TEXT NOT NULL,
  region TEXT,
  languages TEXT,            -- JSON array of ISO 639-1 codes, e.g. ["en","ar"]
  last_reviewed TEXT         -- ISO 8601 timestamp of last review
);

-- ────────────────────────────────────────────────────────────────────
-- issuing_authorities
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS issuing_authorities (
  id TEXT PRIMARY KEY NOT NULL,
  country_code TEXT NOT NULL,
  authority_name TEXT NOT NULL,
  authority_type TEXT,        -- "government" | "ministry" | "agency" | ...
  official_url TEXT,
  FOREIGN KEY (country_code) REFERENCES countries(iso_alpha2)
);

CREATE INDEX IF NOT EXISTS idx_issuing_authorities_country
  ON issuing_authorities(country_code);

-- ────────────────────────────────────────────────────────────────────
-- document_definitions
--
-- One row per (country, doc_type, variant, version) tuple. Older
-- versions remain valid_until'd so historical verifications can be
-- audited against the spec that was current at the time.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_definitions (
  id TEXT PRIMARY KEY NOT NULL,
  country_code TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  doc_variant TEXT,
  issuing_authority_id TEXT,
  version TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  languages TEXT,            -- JSON array
  scripts TEXT,               -- JSON array of writing systems
  mrz_format TEXT,            -- "TD1" | "TD2" | "TD3" | null
  barcode_format TEXT,        -- "PDF417" | "QR" | "DataMatrix" | null
  field_specs TEXT,           -- JSON: per-field name, type, length, position
  validation_rules TEXT,      -- JSON: per-rule {name, type, expression, error}
  verification_capabilities TEXT, -- JSON: capabilities this definition supports
  reference_source_id TEXT,
  source_licence TEXT,
  coverage_state TEXT,        -- "comprehensive" | "partial" | "minimal" | "unknown"
  confidence_limitations TEXT, -- JSON array of known limitations
  last_reviewed TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (country_code) REFERENCES countries(iso_alpha2),
  FOREIGN KEY (issuing_authority_id) REFERENCES issuing_authorities(id)
);

CREATE INDEX IF NOT EXISTS idx_doc_def_country_type
  ON document_definitions(country_code, doc_type);

CREATE INDEX IF NOT EXISTS idx_doc_def_authority
  ON document_definitions(issuing_authority_id);

CREATE INDEX IF NOT EXISTS idx_doc_def_source
  ON document_definitions(reference_source_id);

-- ────────────────────────────────────────────────────────────────────
-- source_provenance
--
-- One row per successful (or attempted) ingestion. The ingestion
-- pipeline appends a row after each fetch+verify+persist cycle so
-- any downstream consumer can re-derive where a definition came from.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_provenance (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT,
  source_url TEXT,
  licence TEXT,
  downloaded_at TEXT,
  sha256_hash TEXT,
  size_bytes INTEGER,
  upstream_version TEXT,
  ingestion_status TEXT,      -- "succeeded" | "failed" | "skipped"
  provenance_notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_provenance_source
  ON source_provenance(source_id);

CREATE INDEX IF NOT EXISTS idx_source_provenance_hash
  ON source_provenance(sha256_hash);

-- ────────────────────────────────────────────────────────────────────
-- coverage_gaps
--
-- Tracks gaps between (country × doc_type) pairs the platform
-- supports in principle vs. pairs for which we currently lack a
-- verified source / spec. Used by the coverage matrix to surface
-- limitations honestly.
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coverage_gaps (
  id TEXT PRIMARY KEY NOT NULL,
  country_code TEXT,
  doc_type TEXT,
  gap_type TEXT,              -- "no_source" | "licence_blocked" | "stale" | ...
  description TEXT,
  blocking_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coverage_gaps_country
  ON coverage_gaps(country_code);

CREATE INDEX IF NOT EXISTS idx_coverage_gaps_type
  ON coverage_gaps(doc_type);
