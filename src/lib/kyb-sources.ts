/**
 * KYB (Know-Your-Business) Source Layer.
 *
 * Phase 2 / Task P2-B.
 *
 * A logically-distinct catalogue of public company registries and
 * business-data sources used to verify legal existence, registration
 * status, beneficial ownership, directors, and other corporate
 * attributes. KYB is parallel to KYC (which verifies *natural* persons)
 * but is NOT interchangeable with it — a KYB source's records describe
 * legal entities, not individuals.
 *
 * Each source is tagged with:
 *   - whether it can be queried automatically (available: true)
 *     or whether a commercial / government agreement is required first
 *     (available: false + reason in `notes`)
 *   - which KYB data attributes the source can verify
 *     (`dataProvided`: "legal_existence", "registration_status",
 *      "ownership", "directors", "financials", "address", ...)
 *
 * Legal basis notes are recorded for each source so the platform's
 * audit log can show where every KYB assertion came from.
 *
 * Sources are public registries that publish either free APIs or
 * human-searchable web pages. The platform never redistributes raw
 * records — it links to the registry's result page as proof.
 */

export type KybDataProvided =
  | "legal_existence" // confirms the entity legally exists
  | "registration_status" // active / dissolved / struck-off
  | "registration_number" // official company number
  | "entity_type" // LTD, LLC, GmbH, S.A., etc.
  | "incorporation_date"
  | "registered_address"
  | "directors" // names of directors / officers
  | "beneficial_ownership" // UBO / PSC register
  | "shareholders" // major shareholders
  | "financials" // filed accounts, turnover
  | "charges_liens" // registered charges / liens
  | "filings_history" // historical filings
  | "trade_name" // trading-as name
  | "vat_registration"; // tax / VAT number

export type KybAccessRequirement =
  | "public_free" // no account, no cost
  | "public_free_limited" // free but rate-limited / CAPTCHA
  | "registered" // free account required
  | "commercial" // paid service
  | "government_approval"; // special authorization required

export type KybLegalBasis =
  | "open_government_data" // public-sector information re-use
  | "public_registry" // public registry, free to search
  | "commercial_licence" // paid commercial agreement
  | "terms_of_service" // public ToS, non-commercial
  | "freedom_of_information" // FoI request required
  | "unspecified";

export interface KybSource {
  /** Stable identifier (kebab-case). */
  id: string;
  /** Human-readable source name. */
  name: string;
  /** ISO 3166-1 alpha-2 country code, or "EU" for pan-EU portals. */
  country: string;
  /** Official registry / portal URL (the source-of-truth page). */
  officialUrl: string;
  /** What kind of access is required to query the source programmatically. */
  accessRequirement: KybAccessRequirement;
  /** The KYB attributes this source can return. */
  dataProvided: KybDataProvided[];
  /** Legal basis the platform relies on to query this source. */
  legalBasis: KybLegalBasis;
  /** Whether the platform can reach this source automatically today. */
  available: boolean;
  /** Free-form notes (covers reason for `available: false`, rate limits, etc.). */
  notes: string;
}

// ─── Catalogue ───────────────────────────────────────────────────────

export const KYB_SOURCES: KybSource[] = [
  // ── United Kingdom ──────────────────────────────────────────────
  {
    id: "uk-companies-house",
    name: "Companies House (UK)",
    country: "GB",
    officialUrl: "https://find-and-update.company-information.service.gov.uk/",
    accessRequirement: "public_free",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "beneficial_ownership",
      "filings_history",
      "charges_liens",
    ],
    legalBasis: "open_government_data",
    available: true,
    notes:
      "Free public REST API (Companies House API). Rate-limited to 600 req/5 min. " +
      "PSC (people-with-significant-control) register is free. API key required (free).",
  },

  // ── United States ──────────────────────────────────────────────
  {
    id: "us-sec-edgar",
    name: "SEC EDGAR (US)",
    country: "US",
    officialUrl: "https://www.sec.gov/edgar/",
    accessRequirement: "public_free",
    dataProvided: [
      "legal_existence",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "financials",
      "filings_history",
    ],
    legalBasis: "open_government_data",
    available: true,
    notes:
      "Free full-text search + bulk data feeds. Covers US public companies " +
      "(10-K, 10-Q, S-1 filings). Private LLCs are NOT in EDGAR — check state registries. " +
      "Rate limit: 10 req/sec; user-agent header required.",
  },

  // ── Australia ──────────────────────────────────────────────────
  {
    id: "au-abn-lookup",
    name: "ABN Lookup (Australia)",
    country: "AU",
    officialUrl: "https://abr.business.gov.au/",
    accessRequirement: "public_free",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "trade_name",
      "registered_address",
      "vat_registration",
    ],
    legalBasis: "open_government_data",
    available: true,
    notes:
      "Australian Business Register (ABR) provides free ABN Lookup API. " +
      "Confirms entity name, status (active/cancelled), trading names, GST registration. " +
      "Does NOT include directors — use ASIC for that.",
  },

  {
    id: "au-asic",
    name: "ASIC (Australian Securities & Investments Commission)",
    country: "AU",
    officialUrl: "https://asic.gov.au/",
    accessRequirement: "commercial",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "directors",
      "shareholders",
      "charges_liens",
      "filings_history",
    ],
    legalBasis: "commercial_licence",
    available: false,
    notes:
      "ASIC's National Names Index is browsable for free, but directors + " +
      "shareholders require a paid ASIC Connect / information broker subscription " +
      "(e.g. InfoTrack, ASIC Connect). Not directly callable from the platform.",
  },

  // ── Germany ────────────────────────────────────────────────────
  {
    id: "de-handelsregister",
    name: "Handelsregister (Germany)",
    country: "DE",
    officialUrl: "https://www.handelsregister.de/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "filings_history",
    ],
    legalBasis: "public_registry",
    available: true,
    notes:
      "Common Register Portal of the German Länder. Search + raw register " +
      "documents are free; structured downloads (XML/HTML) cost €4.50/doc. " +
      "Historical disclosures and current managing directors are searchable. " +
      "UBO register (Transparenzregister) is separate and access-restricted.",
  },

  // ── France ─────────────────────────────────────────────────────
  {
    id: "fr-infogreffe",
    name: "Infogreffe (France)",
    country: "FR",
    officialUrl: "https://www.infogreffe.fr/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "filings_history",
    ],
    legalBasis: "public_registry",
    available: true,
    notes:
      "Operated by the commercial court clerks (greffes). Basic company " +
      "search free; full documents (Kbis, status certificates) are paid. " +
      "Pappers.fr (free third-party) and data.gouv.fr INSEE Sirene " +
      "open-data also cover the same records.",
  },

  // ── Netherlands ────────────────────────────────────────────────
  {
    id: "nl-kvk",
    name: "KvK — Kamer van Koophandel (Netherlands)",
    country: "NL",
    officialUrl: "https://www.kvk.nl/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "trade_name",
    ],
    legalBasis: "open_government_data",
    available: true,
    notes:
      "Chamber of Commerce (KvK) Handelsregister. Free public search by name/number; " +
      "UBO register (Uiteindelijk Belanghebbenden) is separate and access-restricted " +
      "to authorised parties only. API via KvK developer portal (free, registration).",
  },

  // ── India ──────────────────────────────────────────────────────
  {
    id: "in-mca21",
    name: "MCA21 (India Ministry of Corporate Affairs)",
    country: "IN",
    officialUrl: "https://www.mca.gov.in/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "charges_liens",
      "filings_history",
    ],
    legalBasis: "public_registry",
    available: true,
    notes:
      "MCA21 portal allows free company master-data lookup by CIN/LLPIN " +
      "after free account registration. Full financials / annual returns " +
      "are pay-per-document. Director info available via DIN lookup.",
  },

  // ── Singapore ──────────────────────────────────────────────────
  {
    id: "sg-acra",
    name: "ACRA BizFile (Singapore)",
    country: "SG",
    officialUrl: "https://www.bizfile.gov.sg/",
    accessRequirement: "commercial",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "shareholders",
      "charges_liens",
    ],
    legalBasis: "commercial_licence",
    available: false,
    notes:
      "Accounting and Corporate Regulatory Authority (ACRA) BizFile. " +
      "Basic search free; detailed company profile, directors, and " +
      "shareholder extracts are S$5.50-S$50 per record via ACRA iShop. " +
      "No bulk access without an authorised service-provider agreement.",
  },

  // ── United Arab Emirates ───────────────────────────────────────
  {
    id: "ae-ded",
    name: "DED (UAE Department of Economic Development)",
    country: "AE",
    officialUrl: "https://www.ded.ae/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "trade_name",
      "registered_address",
    ],
    legalBasis: "public_registry",
    available: true,
    notes:
      "DED issues mainland trade licences. Each Emirate has its own DED " +
      "(Dubai, Abu Dhabi, Sharjah) — searches by trade-licence number. " +
      "Free zones (DMCC, JAFZA, twofour54) maintain their own registries; " +
      "UBO information held by UAE Ministry of Economy under CRSDL #34.",
  },

  // ── Egypt ──────────────────────────────────────────────────────
  {
    id: "eg-gafi",
    name: "GAFI (Egypt General Authority for Investment)",
    country: "EG",
    officialUrl: "https://gafi.gov.eg/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
    ],
    legalBasis: "public_registry",
    available: false,
    notes:
      "GAFI is the companies' registry for investment-law entities in Egypt. " +
      "No public web search; data accessible only via direct enquiry / " +
      "licensed information broker. Commercial registry (Shrka) under " +
      "Ministry of Supply handles domestic LLCs.",
  },

  // ── Saudi Arabia ───────────────────────────────────────────────
  {
    id: "sa-maroof",
    name: "Maroof (Saudi Arabia)",
    country: "SA",
    officialUrl: "https://maroof.sa/",
    accessRequirement: "public_free",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "trade_name",
      "registered_address",
    ],
    legalBasis: "terms_of_service",
    available: true,
    notes:
      "Maroof is the Saudi Ministry of Commerce's verified merchant " +
      "registry — built for e-commerce merchant verification. Provides " +
      "commercial registration (CR) number, status, and category. " +
      "Limited to commercial merchants, not all registered companies.",
  },

  // ── Canada ─────────────────────────────────────────────────────
  {
    id: "ca-corporations-canada",
    name: "Corporations Canada (Innovation, Science and Economic Development Canada)",
    country: "CA",
    officialUrl: "https://ised-isde.canada.ca/site/office-superintendent-bankruptcy/en/corporations-canada",
    accessRequirement: "public_free",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
    ],
    legalBasis: "open_government_data",
    available: true,
    notes:
      "Federal corporations database (online lookup by name or corporation " +
      "number). Free. Covers only federally-incorporated companies; " +
      "provincial corporations (BC, ON, QC) require the provincial registry.",
  },

  // ── Ireland ─────────────────────────────────────────────────────
  {
    id: "ie-cro",
    name: "CRO — Companies Registration Office (Ireland)",
    country: "IE",
    officialUrl: "https://core.ie/",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "filings_history",
    ],
    legalBasis: "public_registry",
    available: true,
    notes:
      "CORE (CRO online register) free public search. Document purchases " +
      "(company profile, annual return) cost €1.20-€20. " +
      "Central Register of Beneficial Owners (RBO) is separate and " +
      "access-restricted under 4AMLD/5AMLD.",
  },

  // ── New Zealand ────────────────────────────────────────────────
  {
    id: "nz-companies-register",
    name: "New Zealand Companies Register",
    country: "NZ",
    officialUrl: "https://www.companiesoffice.govt.nz/",
    accessRequirement: "public_free",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
      "shareholders",
      "beneficial_ownership",
      "filings_history",
    ],
    legalBasis: "open_government_data",
    available: true,
    notes:
      "Companies Office public search includes directors, shareholders, " +
      "and historical filings. UBO info via the PSC register. No login " +
      "required for basic searches; document downloads free.",
  },

  // ── European Union pan-portal ──────────────────────────────────
  {
    id: "eu-ejustice-portal",
    name: "European e-Justice Portal — Business Registers",
    country: "EU",
    officialUrl: "https://e-justice.europa.eu/content_business_registers-45-en.do",
    accessRequirement: "public_free_limited",
    dataProvided: [
      "legal_existence",
      "registration_status",
      "registration_number",
      "entity_type",
      "incorporation_date",
      "registered_address",
      "directors",
    ],
    legalBasis: "public_registry",
    available: true,
    notes:
      "Federated portal that links to all EU member-state business " +
      "registers via BRIS (Business Registers Interconnection System). " +
      "Each national register has its own pricing for full extracts; " +
      "the portal itself is free to query for the cross-reference lookup.",
  },
];

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Return the full KYB source catalogue.
 */
export function getKybSources(): KybSource[] {
  return KYB_SOURCES;
}

/**
 * Return all KYB sources registered for a single country (ISO alpha-2).
 * Pass "EU" for the pan-EU portal.
 */
export function getKybSourcesForCountry(country: string): KybSource[] {
  const c = country.toUpperCase();
  return KYB_SOURCES.filter((s) => s.country.toUpperCase() === c);
}

/**
 * Return only the KYB sources the platform can call automatically today
 * (i.e. `available: true`). Useful for routing a live verification.
 */
export function getAvailableKybSources(): KybSource[] {
  return KYB_SOURCES.filter((s) => s.available);
}

/**
 * True if any source for this country can return the requested attribute.
 * Useful for the coverage-matrix's KYB branch.
 */
export function isKybDataProvided(
  country: string,
  attribute: KybDataProvided,
): boolean {
  return getKybSourcesForCountry(country).some((s) =>
    s.dataProvided.includes(attribute),
  );
}

/**
 * Return a summary of the KYB catalogue — used by the admin dashboard
 * to surface counts and per-country availability.
 */
export function getKybSummary(): {
  totalSources: number;
  availableSources: number;
  countriesCovered: number;
  byCountry: Record<string, number>;
  byAttribute: Record<string, number>;
} {
  const byCountry: Record<string, number> = {};
  const byAttribute: Record<string, number> = {};
  for (const s of KYB_SOURCES) {
    byCountry[s.country] = (byCountry[s.country] || 0) + 1;
    for (const attr of s.dataProvided) {
      byAttribute[attr] = (byAttribute[attr] || 0) + 1;
    }
  }
  return {
    totalSources: KYB_SOURCES.length,
    availableSources: KYB_SOURCES.filter((s) => s.available).length,
    countriesCovered: new Set(KYB_SOURCES.map((s) => s.country)).size,
    byCountry,
    byAttribute,
  };
}
