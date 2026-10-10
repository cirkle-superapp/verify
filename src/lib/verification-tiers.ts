/**
 * Multi-Layer Verification Tier System
 *
 * Progressive feature unlock based on verification depth. Each tier unlocks
 * more platform capabilities, from guest browsing to full API access.
 *
 * Tiers:
 *   0 — Guest (unverified)         → browse specs, read docs, basic chatbot
 *   1 — Registered (email)        → document samples, OpenAPI spec, model card
 *   2 — Document Verified         → OCR extraction, ID validation, MRZ parsing
 *   3 — Face Matched              → face quality, face match results
 *   4 — Liveness Passed           → liveness results, PAD signals
 *   5 — Risk Assessed             → risk assessment, identity graph, bias
 *   6 — Certificate Issued        → FULL ACCESS: batch, webhooks, SDKs, GDPR
 *
 * Each tier persists to Turso (authoritative) + replicates to Neon (recovery).
 * The tier is encoded in the API key — higher tiers unlock more endpoints.
 */

export type VerificationTier = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TierDefinition {
  level: VerificationTier;
  name: string;
  arabicName: string;
  description: string;
  color: string;
  icon: string;
  requirements: string[];
  unlocks: string[];
  endpoints: string[]; // API endpoints unlocked at this tier
}

export const VERIFICATION_TIERS: TierDefinition[] = [
  {
    level: 0,
    name: "Guest",
    arabicName: "زائر",
    description: "Unverified visitor — can browse public information",
    color: "#6b7280", // gray
    icon: "Eye",
    requirements: [],
    unlocks: ["Browse document specs", "Read API documentation", "Use chatbot (basic)", "View homepage"],
    endpoints: ["/api/health", "/api/platform/status", "/api/platform/harmony", "/api/docs", "/api/openapi.json", "/api/chat", "/api/chat/health", "/api/v1/verify/model-card", "/api/v1/verify/sbom"],
  },
  {
    level: 1,
    name: "Registered",
    arabicName: "مسجل",
    description: "Email verified — can view samples and specs",
    color: "#3b82f6", // blue
    icon: "UserCheck",
    requirements: ["Email verification"],
    unlocks: ["Document samples browser", "Training data viewer", "Specs database", "Infra dashboard", "Live dashboard", "Evaluation lab", "Benchmark dashboard", "Locale toggle", "PWA install"],
    endpoints: ["/api/verify/samples", "/api/verify/specs", "/api/verify/consensus-status", "/api/v1/verify/metrics", "/api/v1/verify/health/deep", "/api/v1/verify/document-template"],
  },
  {
    level: 2,
    name: "Document Verified",
    arabicName: "تم التحقق من المستند",
    description: "ID document uploaded and text extracted",
    color: "#f59e0b", // amber
    icon: "FileCheck",
    requirements: ["Upload document image", "OCR text extraction", "ID format validation"],
    unlocks: ["Document upload", "OCR extraction", "ID validation (76 countries)", "MRZ parsing (ICAO 9303)", "Cross-field validation (45 checks)", "Template overlay", "Auto-adjust picture"],
    endpoints: ["/api/verify/document", "/api/verify/validate-id", "/api/verify/parse-mrz", "/api/verify/cross-check", "/api/verify/ocr-correct", "/api/v1/verify/document", "/api/v1/verify/real-ocr", "/api/v1/verify/image-analysis", "/api/v1/verify/image-enhance"],
  },
  {
    level: 3,
    name: "Face Matched",
    arabicName: "مطابقة الوجه",
    description: "Selfie matched to document photo",
    color: "#8b5cf6", // purple
    icon: "ScanFace",
    requirements: ["Capture selfie", "Face quality analysis (13 dims)", "Face match to document"],
    unlocks: ["Selfie capture", "Face quality scoring", "Face match results", "Image auto-adjust"],
    endpoints: ["/api/verify/face-match", "/api/verify/face-quality", "/api/v1/verify/face-match"],
  },
  {
    level: 4,
    name: "Liveness Passed",
    arabicName: "تم التحقق من الحيوية",
    description: "Movement challenge completed — anti-spoofing verified",
    color: "#ec4899", // pink
    icon: "ShieldCheck",
    requirements: ["Movement challenge", "9 PAD signals analyzed", "Anti-spoofing score > 0.6"],
    unlocks: ["Liveness results", "PAD signal breakdown", "Challenge-response verification", "Adversarial detection"],
    endpoints: ["/api/verify/liveness", "/api/verify/liveness-pro", "/api/v1/verify/liveness", "/api/v1/verify/adversarial-detection"],
  },
  {
    level: 5,
    name: "Risk Assessed",
    arabicName: "تم تقييم المخاطر",
    description: "Risk score computed — fraud signals analyzed",
    color: "#ef4444", // red
    icon: "Gauge",
    requirements: ["Risk fusion (weighted)", "Identity graph check", "Bias detection", "Multimodal fusion"],
    unlocks: ["Risk assessment", "Identity graph analysis", "Bias detection report", "Multimodal fusion", "Explainability report"],
    endpoints: ["/api/v1/verify/risk-assessment", "/api/v1/verify/fraud-check", "/api/v1/verify/identity-graph", "/api/v1/verify/bias-report", "/api/v1/verify/multimodal-fusion", "/api/v1/verify/explain", "/api/v1/verify/continuous-auth", "/api/v1/verify/inference"],
  },
  {
    level: 6,
    name: "Certificate Issued",
    arabicName: "تم إصدار الشهادة",
    description: "HMAC-SHA256 certificate issued — FULL ACCESS",
    color: "#22c55e", // green
    icon: "BadgeCheck",
    requirements: ["All previous tiers passed", "HMAC-SHA256 certificate issued", "Audit chain entry created"],
    unlocks: ["Verification certificate", "Batch verification", "Webhook system", "SDK access", "GDPR compliance", "Provenance chain", "Synthetic data generator", "Full platform features"],
    endpoints: ["/api/v1/verify/certificate", "/api/v1/verify/batch", "/api/v1/verify/webhook-system", "/api/v1/verify/gdpr/*", "/api/v1/verify/provenance", "/api/v1/verify/synthetic-data", "/api/v1/verify/report", "/api/verify/records", "/api/verify/evaluate"],
  },
];

/**
 * Get the tier definition for a given level.
 */
export function getTier(level: VerificationTier): TierDefinition {
  return VERIFICATION_TIERS.find((t) => t.level === level) || VERIFICATION_TIERS[0];
}

/**
 * Get all tiers (for UI display).
 */
export function getAllTiers(): TierDefinition[] {
  return VERIFICATION_TIERS;
}

/**
 * Check if a given API endpoint is accessible at a given tier.
 */
export function isEndpointAccessible(endpoint: string, tier: VerificationTier): boolean {
  // Normalize: remove query string
  const path = endpoint.split("?")[0];
  for (let i = 0; i <= tier; i++) {
    const def = VERIFICATION_TIERS[i];
    if (def.endpoints.some((e) => {
      // Handle wildcards (e.g., /api/v1/verify/gdpr/*)
      if (e.endsWith("*")) return path.startsWith(e.slice(0, -1));
      return e === path;
    })) {
      return true;
    }
  }
  return false; // Endpoint not in any tier up to the current level
}

/**
 * Get the minimum tier required to access an endpoint.
 */
export function getRequiredTier(endpoint: string): VerificationTier {
  const path = endpoint.split("?")[0];
  for (const tier of VERIFICATION_TIERS) {
    if (tier.endpoints.some((e) => {
      if (e.endsWith("*")) return path.startsWith(e.slice(0, -1));
      return e === path;
    })) {
      return tier.level;
    }
  }
  return 6; // Unknown endpoints require highest tier
}

/**
 * Get all features unlocked at a given tier (cumulative).
 */
export function getUnlockedFeatures(tier: VerificationTier): string[] {
  const features: string[] = [];
  for (let i = 0; i <= tier; i++) {
    features.push(...VERIFICATION_TIERS[i].unlocks);
  }
  return features;
}

/**
 * Get the next tier to unlock (or null if at max).
 */
export function getNextTier(currentTier: VerificationTier): TierDefinition | null {
  if (currentTier >= 6) return null;
  return VERIFICATION_TIERS[currentTier + 1];
}

/**
 * Calculate tier progress (0-100%).
 */
export function getTierProgress(currentTier: VerificationTier): number {
  return Math.round((currentTier / 6) * 100);
}

/**
 * In-memory tier store (persisted to Turso + Neon via outbox).
 * Keyed by user_id → { tier, updatedAt, history }
 */
interface TierRecord {
  userId: string;
  tier: VerificationTier;
  updatedAt: string;
  history: Array<{ from: VerificationTier; to: VerificationTier; timestamp: string; reason: string }>;
}

const tierStore = new Map<string, TierRecord>();

/**
 * Get the current verification tier for a user.
 */
export function getUserTier(userId: string): VerificationTier {
  const record = tierStore.get(userId);
  return record?.tier ?? 0;
}

/**
 * Upgrade a user's verification tier.
 */
export function upgradeUserTier(
  userId: string,
  newTier: VerificationTier,
  reason: string,
): { from: VerificationTier; to: VerificationTier; unlocked: string[] } {
  const record = tierStore.get(userId) || {
    userId,
    tier: 0 as VerificationTier,
    updatedAt: new Date().toISOString(),
    history: [],
  };
  const oldTier = record.tier;
  if (newTier <= oldTier) {
    return { from: oldTier, to: oldTier, unlocked: [] };
  }
  record.tier = newTier;
  record.updatedAt = new Date().toISOString();
  record.history.push({
    from: oldTier,
    to: newTier,
    timestamp: new Date().toISOString(),
    reason,
  });
  tierStore.set(userId, record);
  // Return newly unlocked features (delta)
  const oldFeatures = new Set(getUnlockedFeatures(oldTier));
  const newFeatures = getUnlockedFeatures(newTier);
  const unlocked = newFeatures.filter((f) => !oldFeatures.has(f));
  return { from: oldTier, to: newTier, unlocked };
}

/**
 * Get tier record (for audit/admin).
 */
export function getTierRecord(userId: string): TierRecord | null {
  return tierStore.get(userId) || null;
}

/**
 * Get all tier records (for admin dashboard).
 */
export function getAllTierRecords(): TierRecord[] {
  return Array.from(tierStore.values());
}

/**
 * Get tier statistics.
 */
export function getTierStats(): { total: number; byTier: Record<number, number> } {
  const byTier: Record<number, number> = {};
  let total = 0;
  for (const record of tierStore.values()) {
    byTier[record.tier] = (byTier[record.tier] || 0) + 1;
    total++;
  }
  return { total, byTier };
}
