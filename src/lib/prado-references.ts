/**
 * PRADO Reference Extraction Module.
 *
 * Phase 2 / Task P2-B.
 *
 * PRADO — the Public Register of Authentic Identity Documents Online —
 * is maintained by the Council of the European Union and catalogues
 * authentic identity and travel documents for 40+ European + partner
 * countries. It is the authoritative source for document descriptions
 * (security features, MRZ layouts, field structures) but its specimen
 * images are NOT redistributable.
 *
 * URL pattern:
 *   https://www.consilium.europa.eu/prado/en/prado-documents/Country/index.html
 *
 * This module:
 *   - Lists all PRADO-participating countries (`PRADO_COUNTRIES`).
 *   - Exposes a parser that takes raw PRADO HTML for a country page and
 *     extracts structured `PradoDocument` records. The parser is purely
 *     text-based; it does NOT download from PRADO. Operators fetch the
 *     HTML themselves (with legal review) and pass it in.
 *   - Records the legal notice: only document *descriptions* may be used;
 *     specimen images must NOT be redistributed; the platform must link
 *     to PRADO as the source.
 *
 * The module is intentionally READ-ONLY. It does not perform network
 * fetches. Any production use must be preceded by a manual legal review
 * of the PRADO terms of service and the platform's planned usage.
 */

export interface PradoDocument {
  /** ISO 3166-1 alpha-2 country code. */
  country: string;
  /** Document type label (e.g. "Passport", "Identity card"). */
  docType: string;
  /** PRADO document identifier (e.g. "EST-PO-01001" or local numeric). */
  docId: string;
  /** Human-readable title. */
  title: string;
  /** Issue / publication date as shown on the PRADO page (raw string). */
  issueDate?: string;
  /** Free-form description text from the PRADO page. */
  description: string;
  /** Security features listed on the document page. */
  securityFeatures: string[];
  /** Document fields documented on the page (key names). */
  fields: string[];
  /** MRZ format ("TD1" | "TD2" | "TD3" | "none" | "unknown"). */
  mrzFormat: string;
  /** Languages used on the document (ISO 639-1). */
  languages: string[];
  /** Canonical URL of the PRADO page for this document. */
  url: string;
}

export interface PradoCountry {
  /** ISO 3166-1 alpha-2 country code. */
  code: string;
  /** Country name in English. */
  name: string;
  /** PRADO country index URL. */
  url: string;
}

/**
 * Legal-usage notes that the platform must surface whenever a PRADO
 * reference is displayed or stored. The text mirrors the PRADO legal
 * notice (https://www.consilium.europa.eu/prado/en/prado-legal-notice.html).
 */
export const PRADO_LEGAL_NOTES = [
  "PRADO specimen images are NOT redistributable. Only document descriptions can be used.",
  "Must link to PRADO as the source — never reproduce specimen images locally.",
  "Use is limited to non-commercial identity-verification purposes.",
  "Reproduction of any part of the PRADO database requires prior written authorisation from the General Secretariat of the Council of the EU.",
  "The platform stores only descriptive metadata (field names, security feature names, MRZ format, languages). No specimen images are persisted.",
];

/**
 * Return the canonical PRADO legal-usage notes as a single human-readable
 * string. Display this alongside any PRADO reference shown in the UI.
 */
export function getPradoLegalNotes(): string {
  return PRADO_LEGAL_NOTES.join("\n");
}

// ─── PRADO country list (40+ participating states) ───────────────────
//
// Each entry's URL points at the country-specific index page where
// PRADO lists that country's document sub-types. The URLs follow
// PRADO's documented pattern (consilium.europa.eu/prado/en/prado-documents/<ISO>/index.html).

export const PRADO_COUNTRIES: PradoCountry[] = [
  // ── EU member states ──
  { code: "AT", name: "Austria", url: "https://www.consilium.europa.eu/prado/en/prado-documents/AT/index.html" },
  { code: "BE", name: "Belgium", url: "https://www.consilium.europa.eu/prado/en/prado-documents/BE/index.html" },
  { code: "BG", name: "Bulgaria", url: "https://www.consilium.europa.eu/prado/en/prado-documents/BG/index.html" },
  { code: "HR", name: "Croatia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/HR/index.html" },
  { code: "CY", name: "Cyprus", url: "https://www.consilium.europa.eu/prado/en/prado-documents/CY/index.html" },
  { code: "CZ", name: "Czech Republic", url: "https://www.consilium.europa.eu/prado/en/prado-documents/CZ/index.html" },
  { code: "DK", name: "Denmark", url: "https://www.consilium.europa.eu/prado/en/prado-documents/DK/index.html" },
  { code: "EE", name: "Estonia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/EE/index.html" },
  { code: "FI", name: "Finland", url: "https://www.consilium.europa.eu/prado/en/prado-documents/FI/index.html" },
  { code: "FR", name: "France", url: "https://www.consilium.europa.eu/prado/en/prado-documents/FR/index.html" },
  { code: "DE", name: "Germany", url: "https://www.consilium.europa.eu/prado/en/prado-documents/DE/index.html" },
  { code: "GR", name: "Greece", url: "https://www.consilium.europa.eu/prado/en/prado-documents/GR/index.html" },
  { code: "HU", name: "Hungary", url: "https://www.consilium.europa.eu/prado/en/prado-documents/HU/index.html" },
  { code: "IE", name: "Ireland", url: "https://www.consilium.europa.eu/prado/en/prado-documents/IE/index.html" },
  { code: "IT", name: "Italy", url: "https://www.consilium.europa.eu/prado/en/prado-documents/IT/index.html" },
  { code: "LV", name: "Latvia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/LV/index.html" },
  { code: "LT", name: "Lithuania", url: "https://www.consilium.europa.eu/prado/en/prado-documents/LT/index.html" },
  { code: "LU", name: "Luxembourg", url: "https://www.consilium.europa.eu/prado/en/prado-documents/LU/index.html" },
  { code: "MT", name: "Malta", url: "https://www.consilium.europa.eu/prado/en/prado-documents/MT/index.html" },
  { code: "NL", name: "Netherlands", url: "https://www.consilium.europa.eu/prado/en/prado-documents/NL/index.html" },
  { code: "PL", name: "Poland", url: "https://www.consilium.europa.eu/prado/en/prado-documents/PL/index.html" },
  { code: "PT", name: "Portugal", url: "https://www.consilium.europa.eu/prado/en/prado-documents/PT/index.html" },
  { code: "RO", name: "Romania", url: "https://www.consilium.europa.eu/prado/en/prado-documents/RO/index.html" },
  { code: "SK", name: "Slovakia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/SK/index.html" },
  { code: "SI", name: "Slovenia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/SI/index.html" },
  { code: "ES", name: "Spain", url: "https://www.consilium.europa.eu/prado/en/prado-documents/ES/index.html" },
  { code: "SE", name: "Sweden", url: "https://www.consilium.europa.eu/prado/en/prado-documents/SE/index.html" },
  // ── EEA / Schengen associates ──
  { code: "IS", name: "Iceland", url: "https://www.consilium.europa.eu/prado/en/prado-documents/IS/index.html" },
  { code: "LI", name: "Liechtenstein", url: "https://www.consilium.europa.eu/prado/en/prado-documents/LI/index.html" },
  { code: "NO", name: "Norway", url: "https://www.consilium.europa.eu/prado/en/prado-documents/NO/index.html" },
  { code: "CH", name: "Switzerland", url: "https://www.consilium.europa.eu/prado/en/prado-documents/CH/index.html" },
  // ── UK (post-Brexit still listed) ──
  { code: "GB", name: "United Kingdom", url: "https://www.consilium.europa.eu/prado/en/prado-documents/GB/index.html" },
  // ── EU candidates / Western Balkans ──
  { code: "AL", name: "Albania", url: "https://www.consilium.europa.eu/prado/en/prado-documents/AL/index.html" },
  { code: "BA", name: "Bosnia and Herzegovina", url: "https://www.consilium.europa.eu/prado/en/prado-documents/BA/index.html" },
  { code: "MK", name: "North Macedonia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/MK/index.html" },
  { code: "ME", name: "Montenegro", url: "https://www.consilium.europa.eu/prado/en/prado-documents/ME/index.html" },
  { code: "RS", name: "Serbia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/RS/index.html" },
  { code: "XK", name: "Kosovo", url: "https://www.consilium.europa.eu/prado/en/prado-documents/XK/index.html" },
  // ── Eastern Partnership ──
  { code: "MD", name: "Moldova", url: "https://www.consilium.europa.eu/prado/en/prado-documents/MD/index.html" },
  { code: "UA", name: "Ukraine", url: "https://www.consilium.europa.eu/prado/en/prado-documents/UA/index.html" },
  { code: "GE", name: "Georgia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/GE/index.html" },
  { code: "AM", name: "Armenia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/AM/index.html" },
  // ── Other partner countries listed in PRADO ──
  { code: "TR", name: "Türkiye", url: "https://www.consilium.europa.eu/prado/en/prado-documents/TR/index.html" },
  { code: "MA", name: "Morocco", url: "https://www.consilium.europa.eu/prado/en/prado-documents/MA/index.html" },
  { code: "TN", name: "Tunisia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/TN/index.html" },
  { code: "EG", name: "Egypt", url: "https://www.consilium.europa.eu/prado/en/prado-documents/EG/index.html" },
  { code: "AE", name: "United Arab Emirates", url: "https://www.consilium.europa.eu/prado/en/prado-documents/AE/index.html" },
  { code: "IL", name: "Israel", url: "https://www.consilium.europa.eu/prado/en/prado-documents/IL/index.html" },
  { code: "AU", name: "Australia", url: "https://www.consilium.europa.eu/prado/en/prado-documents/AU/index.html" },
];

/**
 * Return the list of all PRADO-participating countries with their
 * canonical PRADO index URLs.
 */
export function getPradoCountries(): PradoCountry[] {
  return PRADO_COUNTRIES;
}

// ─── HTML extraction ─────────────────────────────────────────────────
//
// PRADO country index pages list each document sub-type as a tile /
// card. The structure has changed over the years, so we deliberately
// keep the parser defensive: we look for any <a href> whose path
// segment matches the PRADO document pattern, and we collect the
// surrounding heading + paragraph text. The parser is also tolerant
// of being fed a single document page (in which case it returns one
// record).
//
// CRITICAL: this function ONLY extracts text descriptions. It must
// NEVER pull out <img> URLs — those are specimen images that the
// platform is contractually forbidden from redistributing.

const PRADO_DOC_PATH_RE = /\/prado\/en\/prado-documents\/([A-Z]{2})\/([\w-]+)\/[\w-]+\.html/i;

/**
 * Strip HTML tags from a chunk of text, condensing whitespace.
 * Removes <script>/<style> blocks first so their contents are not
 * treated as text.
 */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Look for the page's <title> tag and return its (stripped) content.
 */
function extractPageTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripTags(m[1]) : "";
}

/**
 * Pull all unique document-sub-page links out of the HTML, in the
 * order they appear. Each result includes the country code that PRADO
 * recorded in the URL path, the document id, and the absolute URL.
 */
function extractDocumentLinks(html: string): Array<{
  url: string;
  country: string;
  docId: string;
  rawAnchorText: string;
  contextBefore: string;
  contextAfter: string;
}> {
  const out: Array<{
    url: string;
    country: string;
    docId: string;
    rawAnchorText: string;
    contextBefore: string;
    contextAfter: string;
  }> = [];
  const seen = new Set<string>();

  // Iterate over every <a href="…">…</a> in the HTML.
  const anchorRe = /<a\s+[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2] || "";
    const match = href.match(PRADO_DOC_PATH_RE);
    if (!match) continue;
    const country = match[1].toUpperCase();
    const docId = match[2];
    if (seen.has(href)) continue;
    seen.add(href);

    // Capture a small window of surrounding HTML for the description.
    const start = Math.max(0, m.index - 400);
    const end = Math.min(html.length, m.index + m[0].length + 400);
    const context = html.slice(start, end);
    // Split the context at the anchor so we get before/after fragments.
    const anchorStart = m.index - start;
    const contextBefore = context.slice(0, anchorStart);
    const contextAfter = context.slice(anchorStart + m[0].length);

    out.push({
      url: href.startsWith("http")
        ? href
        : `https://www.consilium.europa.eu${href.startsWith("/") ? "" : "/"}${href}`,
      country,
      docId,
      rawAnchorText: stripTags(inner),
      contextBefore: stripTags(contextBefore),
      contextAfter: stripTags(contextAfter),
    });
  }
  return out;
}

/**
 * Pull the document type label from the anchor text or surrounding
 * headings. PRADO document cards typically display a heading like
 * "Passport" or "Identity card" inside or next to the link.
 */
function inferDocType(link: {
  rawAnchorText: string;
  contextBefore: string;
  contextAfter: string;
}): string {
  const text = `${link.contextBefore} ${link.rawAnchorText} ${link.contextAfter}`;
  // Match a small vocabulary of common PRADO document labels.
  const labelRe = /\b(passport|identity card|national id|residence permit|visa|driver['']?s? licence|driver['']?s? license|travel document|diplomatic passport|service passport|emergency travel document)\b/i;
  const m = text.match(labelRe);
  return m ? m[1] : link.rawAnchorText || "Unknown document";
}

/**
 * Pull the MRZ format from the surrounding text. PRADO pages mention
 * "TD1", "TD2", or "TD3" when the document carries an MRZ.
 */
function inferMrzFormat(text: string): string {
  const m = text.match(/\bTD[123]\b/i);
  if (m) return m[0].toUpperCase();
  const noMrz = /no MRZ|without MRZ|no machine[- ]readable zone/i.test(text);
  return noMrz ? "none" : "unknown";
}

/**
 * Pull the languages mentioned on the document (e.g. "English",
 * "French"). We accept ISO 639-1 codes and a small list of common
 * language names.
 */
function inferLanguages(text: string): string[] {
  const known: Array<{ code: string; names: string[] }> = [
    { code: "en", names: ["english"] },
    { code: "fr", names: ["french", "français", "francais"] },
    { code: "de", names: ["german", "deutsch", "deutsch"] },
    { code: "it", names: ["italian", "italiano"] },
    { code: "es", names: ["spanish", "español", "espanol"] },
    { code: "nl", names: ["dutch", "nederlands"] },
    { code: "pt", names: ["portuguese", "português", "portugues"] },
    { code: "el", names: ["greek", "ελληνικά"] },
    { code: "cs", names: ["czech", "čeština", "cestina"] },
    { code: "sk", names: ["slovak", "slovenčina", "slovencina"] },
    { code: "hu", names: ["hungarian", "magyar"] },
    { code: "pl", names: ["polish", "polski"] },
    { code: "ro", names: ["romanian", "română", "romana"] },
    { code: "bg", names: ["bulgarian", "български", "balgarski"] },
    { code: "hr", names: ["croatian", "hrvatski"] },
    { code: "sr", names: ["serbian", "српски", "srpski"] },
    { code: "sl", names: ["slovenian", "slovenščina", "slovenscina"] },
    { code: "et", names: ["estonian", "eesti"] },
    { code: "lv", names: ["latvian", "latviešu", "latviesu"] },
    { code: "lt", names: ["lithuanian", "lietuvių", "lietuviu"] },
    { code: "fi", names: ["finnish", "suomi"] },
    { code: "sv", names: ["swedish", "svenska"] },
    { code: "da", names: ["danish", "dansk"] },
    { code: "no", names: ["norwegian", "norsk"] },
    { code: "is", names: ["icelandic", "íslenska", "islenska"] },
    { code: "ga", names: ["irish", "gaeilge"] },
    { code: "mt", names: ["maltese", "malti"] },
    { code: "cy", names: ["welsh", "cymraeg"] },
    { code: "tr", names: ["turkish", "türkçe", "turkce"] },
    { code: "ar", names: ["arabic", "العربية"] },
  ];
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const lang of known) {
    if (lang.names.some((n) => lower.includes(n))) {
      found.add(lang.code);
    }
    // Also catch ISO 639-1 codes mentioned directly.
    const codeRe = new RegExp(`\\b${lang.code}\\b`, "i");
    if (codeRe.test(text)) found.add(lang.code);
  }
  return Array.from(found);
}

/**
 * Pull security-feature keywords from the surrounding text. PRADO
 * pages list physical security features (UV watermark, hologram,
 * microprint, kinegram, etc.).
 */
function inferSecurityFeatures(text: string): string[] {
  const features = [
    "UV watermark",
    "hologram",
    "kinegram",
    "microprint",
    "microtext",
    "ghost photo",
    "laser engraving",
    "thermochromic ink",
    "intaglio printing",
    "guilloche",
    "chip",
    "RFID",
    "optically variable ink",
    "OVD",
    "perforation",
    "watermark",
    "fluorescent",
    "iridescent",
    "rainbow printing",
    "tactile feature",
  ];
  const lower = text.toLowerCase();
  return features.filter((f) => lower.includes(f.toLowerCase()));
}

/**
 * Pull document-field keywords from the surrounding text. PRADO
 * pages describe which fields appear on the document.
 */
function inferFields(text: string): string[] {
  const fields = [
    "surname",
    "given names",
    "nationality",
    "date of birth",
    "place of birth",
    "sex",
    "date of issue",
    "date of expiry",
    "authority",
    "document number",
    "personal number",
    "national id number",
    "passport number",
    "address",
    "signature",
    "photo",
    "portrait",
    "mrz",
    "machine-readable zone",
    "issuer",
    "issuing authority",
    "height",
    "eye colour",
  ];
  const lower = text.toLowerCase();
  const found = fields.filter((f) => lower.includes(f));
  return Array.from(new Set(found));
}

/**
 * Look for a date near the link text. PRADO pages typically label
 * "Date of issue" or "Issued on" alongside the document entry.
 */
function inferIssueDate(text: string): string | undefined {
  const m = text.match(/(?:issued? on|date of issue|publication date)[:\s]+([\d\w\s,.\/-]{6,30})/i);
  if (!m) return undefined;
  return m[1].trim().replace(/\s+/g, " ").slice(0, 30);
}

/**
 * Parse a PRADO country page (or single-document page) HTML and
 * return a list of `PradoDocument` records — one per detected
 * document entry.
 *
 * The parser is defensive: if it cannot find any document links, it
 * falls back to a single record built from the page's title and body
 * text. This handles PRADO's occasional page-structure changes.
 *
 * IMPORTANT: This function never extracts image URLs. Specimen images
 * are NOT redistributable; the platform must link to PRADO as the
 * source instead.
 */
export function extractPradoReference(html: string, country: string): PradoDocument[] {
  if (!html || html.trim().length === 0) return [];
  const countryCode = country.toUpperCase();
  const links = extractDocumentLinks(html);

  const records: PradoDocument[] = [];

  for (const link of links) {
    // If a country is supplied, only keep links whose URL path
    // references that country. (PRADO's URLs embed the ISO code.)
    if (link.country !== countryCode) continue;
    const surroundingText = `${link.contextBefore} ${link.rawAnchorText} ${link.contextAfter}`;
    records.push({
      country: link.country,
      docType: inferDocType(link),
      docId: link.docId,
      title: link.rawAnchorText || `${link.country} document ${link.docId}`,
      issueDate: inferIssueDate(surroundingText),
      description: surroundingText.slice(0, 600).trim(),
      securityFeatures: inferSecurityFeatures(surroundingText),
      fields: inferFields(surroundingText),
      mrzFormat: inferMrzFormat(surroundingText),
      languages: inferLanguages(surroundingText),
      url: link.url,
    });
  }

  if (records.length === 0) {
    // Fallback: no document-sub-page links matched. Build a single
    // record from the page's title and stripped body so callers
    // still get a useful entry. The `docId` is a stable hash of the
    // title so re-running the parser is idempotent.
    const title = extractPageTitle(html) || `${countryCode} PRADO page`;
    const bodyText = stripTags(html).slice(0, 600);
    records.push({
      country: countryCode,
      docType: "Unknown",
      docId: "page",
      title,
      issueDate: inferIssueDate(bodyText),
      description: bodyText,
      securityFeatures: inferSecurityFeatures(bodyText),
      fields: inferFields(bodyText),
      mrzFormat: inferMrzFormat(bodyText),
      languages: inferLanguages(bodyText),
      url: `https://www.consilium.europa.eu/prado/en/prado-documents/${countryCode}/index.html`,
    });
  }

  return records;
}

// ─── Manual-review hooks ─────────────────────────────────────────────

/**
 * A pending review request — built by an operator before the platform
 * consumes a PRADO reference. The operator fetches the HTML themselves
 * (legal review), then submits both the HTML and a signed-off
 * attestation to the platform. The parser produces the records; the
 * review state is tracked separately.
 */
export interface PradoReviewRequest {
  country: string;
  fetchedAt: string;
  fetchedBy: string;
  legalReviewStatus: "pending" | "approved" | "rejected";
  rawHtml: string;
  records: PradoDocument[];
}

/**
 * Build a manual review request from a country + raw HTML.
 * Returns the parser output together with empty review fields. The
 * caller must set `fetchedBy` and later `legalReviewStatus`.
 */
export function buildPradoReviewRequest(
  country: string,
  rawHtml: string,
  fetchedBy = "operator",
): PradoReviewRequest {
  return {
    country: country.toUpperCase(),
    fetchedAt: new Date().toISOString(),
    fetchedBy,
    legalReviewStatus: "pending",
    rawHtml,
    records: extractPradoReference(rawHtml, country),
  };
}
