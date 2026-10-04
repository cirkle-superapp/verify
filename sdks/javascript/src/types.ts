/**
 * TypeScript types for the Cirkle Verify JavaScript/TypeScript SDK.
 *
 * Pure-types file (no runtime exports) so it can be tree-shaken away.
 * Models the public API surface of the Cirkle Verify REST endpoints.
 *
 * Every type is a permissive `interface` (with optional fields where the
 * API can legitimately omit a value). Top-level result types bundle the
 * raw shape returned by the API + a handful of normalized accessors.
 */

// ─── Configuration ────────────────────────────────────────────────

export interface CirkleVerifyOptions {
  /** API key — `cvk_live_...` or `cvk_test_...`. Required. */
  apiKey: string;
  /** Override the API root. Default: public production endpoint. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default: 60000. */
  timeoutMs?: number;
  /** Maximum number of 5xx retries. Default: 3. */
  maxRetries?: number;
  /** Override the User-Agent header (Node only). */
  userAgent?: string;
  /** Custom fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Extra default headers to attach to every request. */
  defaultHeaders?: Record<string, string>;
}

// ─── Image inputs ──────────────────────────────────────────────────

/**
 * Image inputs accepted by the SDK.
 *
 * - `string` — a `data:` URL or a path that the runtime knows how to read
 *   (Node `fs.readFileSync` is used internally; pass a `data:` URL for the
 *   browser).
 * - `Uint8Array` / `ArrayBuffer` — raw bytes; SDK encodes to base64.
 * - `Blob` / `File` — browser objects; SDK uses `FileReader`/`Blob.text`.
 * - `ReadableStream` — Node only; consumed into an `ArrayBuffer`.
 */
export type ImageInput =
  | string
  | Uint8Array
  | ArrayBuffer
  | Blob
  | File
  | ReadableStream<Uint8Array>;

// ─── Shared sub-shapes ────────────────────────────────────────────

export interface ConsensusInfo {
  total?: number;
  successful?: number;
  providerNames?: string[];
  agreement?: number;
  fieldAgreement?: Record<string, number>;
  outcomes?: Array<{ provider: string; success: boolean; latencyMs: number }>;
  verdict?: 'unanimous' | 'majority' | 'split' | string;
}

export interface ImageQualityAssessment {
  overallQuality?: number;
  isDocument?: boolean;
  isBlurry?: boolean;
  hasGlare?: boolean;
  isFramedWell?: boolean;
  rotation?: 'none' | 'slight' | 'significant' | string;
  lighting?: 'good' | 'too_dark' | 'too_bright' | 'poor' | string;
  isFullFrame?: boolean;
  issues?: string[];
  suggestions?: string[];
}

export interface FieldConfidence {
  fullNameAr?: number;
  fullNameEn?: number;
  nationalId?: number;
  birthDate?: number;
  address?: number;
  gender?: number;
  documentNo?: number;
  expiryDate?: number;
  nationality?: number;
  job?: number;
  religion?: number;
  maritalStatus?: number;
}

export interface ExtractedFields {
  fullNameAr?: string;
  fullNameEn?: string;
  nationalId?: string;
  birthDate?: string;
  address?: string;
  gender?: string;
  documentNo?: string;
  expiryDate?: string;
  nationality?: string;
  job?: string;
  religion?: string;
  maritalStatus?: string;
  extraFields?: Record<string, string>;
  rawText?: string;
  arabicText?: string;
  hasPhoto?: boolean;
  confidence?: number;
  fieldConfidence?: FieldConfidence;
  imageQuality?: ImageQualityAssessment;
  mrzParsed?: boolean;
  validationFlags?: Record<string, unknown>;
  passes?: number;
  consensus?: ConsensusInfo;
}

// ─── Top-level results ─────────────────────────────────────────────

export interface VerificationResult {
  id?: string;
  status?: string;
  score?: number;
  extractedFields?: ExtractedFields;
  /** Alias for the raw `data` object returned by the API. */
  data?: ExtractedFields;
  elapsedMs?: number;
  engine?: string;
  consensus?: ConsensusInfo;
  providers?: string[];
  debug?: Record<string, unknown>;
}

export interface LivenessSignals {
  motionScore?: number;
  challengeScore?: number;
  printAttackScore?: number;
  screenArtifactScore?: number;
  depthScore?: number;
  motionSmoothnessScore?: number;
  velocityProfileScore?: number;
  totalScore?: number;
  isLive?: boolean;
  issues?: string[];
  suggestions?: string[];
}

export interface LivenessResult {
  passed?: boolean;
  isLive?: boolean;
  score?: number;
  detectedActions?: string[];
  reasoning?: string;
  signals?: LivenessSignals;
  consensus?: ConsensusInfo;
  engine?: string;
  /** Raw inner `result` block from the API. */
  result?: Record<string, unknown>;
}

export interface FaceMatchResult {
  matched?: boolean;
  isMatch?: boolean;
  samePerson?: boolean;
  score?: number;
  similarity?: number;
  confidence?: number;
  reasoning?: string;
  consensus?: ConsensusInfo;
  engine?: string;
  result?: Record<string, unknown>;
}

export interface IdValidationResult {
  isValid?: boolean;
  valid?: boolean;
  checksumValid?: boolean;
  country?: string;
  idNumber?: string;
  extractedFields?: Record<string, unknown>;
  extracted?: Record<string, unknown>;
  birthDate?: string;
  gender?: string;
  error?: string;
}

export interface MrzCheckDigits {
  documentNumber?: boolean;
  birthDate?: boolean;
  expiryDate?: boolean;
  composite?: boolean;
}

export interface MrzParseResult {
  valid?: boolean;
  format?: string;
  documentCode?: string;
  issuingCountry?: string;
  documentNumber?: string;
  name?: string;
  sex?: string;
  birthDate?: string;
  expiryDate?: string;
  nationality?: string;
  fields?: Record<string, unknown>;
  checkDigits?: MrzCheckDigits;
  errors?: string[];
  raw?: string;
}

export interface WebhookEndpoint {
  id?: string;
  url?: string;
  events?: string[];
  secret?: string;
  active?: boolean;
  createdAt?: string;
  lastTriggeredAt?: string;
  failureCount?: number;
}

export interface CertificateSubject {
  fullNameAr?: string;
  fullNameEn?: string;
  nationalId?: string;
  documentNo?: string;
  docType?: string;
  nationality?: string;
}

export interface CertificateResult {
  status?: 'verified' | 'failed' | 'rejected' | string;
  overallScore?: number;
  docConfidence?: number;
  faceMatchScore?: number;
  livenessScore?: number;
  consistencyScore?: number;
  fraudProbability?: number;
}

export interface CertificateSignature {
  algorithm?: 'HMAC-SHA256' | string;
  keyId?: string;
  value?: string;
}

export interface Certificate {
  id?: string;
  certificateId?: string;
  version?: string;
  verificationId?: string;
  subject?: CertificateSubject;
  result?: CertificateResult;
  layers?: Record<string, unknown>;
  metadata?: {
    issuedAt?: string;
    expiresAt?: string;
    verificationId?: string;
    platform?: string;
    epoch?: number;
    [k: string]: unknown;
  };
  signature?: CertificateSignature;
  issuedAt?: string;
  expiresAt?: string;
  raw?: string;
  verifyUrl?: string;
}

export interface GdprExport {
  userId?: string;
  user_id?: string;
  exportedAt?: string;
  exported_at?: string;
  data?: Record<string, unknown>;
  hash?: string;
  downloadUrl?: string;
  download_url?: string;
  regulation?: string;
  rawBiometricsPolicy?: string;
  raw_biometrics_policy?: string;
}

// ─── Method argument types ────────────────────────────────────────

export type DocType = 'national_id' | 'passport' | 'driver_license' | 'residence' | string;
export type LivenessChallengeType =
  | 'turn_left'
  | 'turn_right'
  | 'smile'
  | 'blink'
  | 'nod'
  | 'look_up'
  | string;

export interface VerifyDocumentArgs {
  /** Front image — data URL, raw bytes, Blob, or File. */
  image: ImageInput;
  /** Optional back image for two-sided documents. */
  backImage?: ImageInput;
  docType?: DocType;
  country?: string;
}

export interface CheckLivenessArgs {
  frames: ImageInput[];
  challengeType?: LivenessChallengeType;
  actions?: LivenessChallengeType[];
}

export interface FaceMatchArgs {
  documentImage: ImageInput;
  selfieImage: ImageInput;
}

export interface ValidateIdArgs {
  country: string;
  id: string;
}

export interface ParseMrzArgs {
  mrz: string;
}

export interface RegisterWebhookArgs {
  url: string;
  events: string[];
  secret: string;
}

export interface GetCertificateArgs {
  verificationId: string;
  subject?: Partial<CertificateSubject>;
  result?: Partial<CertificateResult>;
  layers?: Record<string, unknown>;
}

export interface ExportDataArgs {
  userId: string;
  /** Set true to ask the server for a downloadable attachment response. */
  download?: boolean;
}
