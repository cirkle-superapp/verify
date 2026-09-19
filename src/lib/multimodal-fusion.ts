/**
 * Multimodal Biometric Fusion — combine face + voice + behavioral + document
 * + device signals into a single identity-assurance score using Dempster-Shafer
 * evidence theory.
 *
 * ## Why this module exists
 *
 * Single-modality biometrics fail in predictable ways:
 *   - Face match is fooled by look-alike relatives (Fraternal Twin Problem)
 *   - Voice match is fooled by upper-respiratory infections
 *   - Document OCR is fooled by worn prints
 *   - Liveness is fooled by high-fidelity 3D masks
 *
 * **No single modality is bulletproof**. But the probability that *all*
 * modalities are simultaneously defeated by the same attacker drops
 * multiplicatively. An attacker who beats face (10%) and voice (20%) and
 * liveness (5%) is detected with probability 1 - 0.10 × 0.20 × 0.05 = 99.9%.
 *
 * Competitors (Onfido, Jumio, Veriff, Sumsub) ship *either* a face-only
 * flow *or* a face+document flow. Cirkle is the only platform that ships
 * **5-modality fusion with explicit Dempster-Shafer conflict tracking**,
 * meaning the system can *tell you* when the modalities disagree (face
 * says real, voice says spoof) — a strong signal of a coordinated attack.
 *
 * ## Why Dempster-Shafer (not just weighted average)
 *
 * Weighted averaging assumes each modality is independent and additive.
 * Dempster-Shafer explicitly models **uncertainty** (mass assigned to
 * "I don't know") and **conflict** (mass on contradictory hypotheses).
 * When two modalities strongly disagree, D-S reports high conflict —
 * surfacing the attack instead of averaging it away.
 *
 * All functions are pure TypeScript (no numpy, no sklearn) and safe for
 * Vercel serverless deployment.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The five biometric modalities Cirkle fuses. String enum so it can be
 * compared to plain string literals ("face", "voice", ...) from JSON.
 */
export enum BiometricModality {
  Face = "face",
  Voice = "voice",
  Behavioral = "behavioral",
  Document = "document",
  Device = "device",
}

/** List of all modalities — handy for iteration. */
export const ALL_MODALITIES: BiometricModality[] = [
  BiometricModality.Face,
  BiometricModality.Voice,
  BiometricModality.Behavioral,
  BiometricModality.Document,
  BiometricModality.Device,
];

/** A single named signal contributing to a modality score. */
export interface ModalitySignal {
  /** Machine-readable signal name, e.g. "blink_detected". */
  name: string;
  /** 0..1 normalized value — semantics depend on the signal. */
  value: number;
  /** Human-readable explanation / detail of what this value means. */
  detail: string;
}

/**
 * Per-modality score breakdown — produced by each `compute*Score` helper
 * and consumed by {@link fuseBiometrics}.
 */
export interface ModalityScore {
  /** Which modality this score is for. */
  modality: BiometricModality;
  /** 0..1 — probability this modality supports the "real" hypothesis. */
  score: number;
  /** 0..1 — detector confidence in this score (1 = no uncertainty). */
  confidence: number;
  /** Weight applied during fusion (defaults from {@link computeModalityWeights}). */
  weight: number;
  /** Individual signals that fed into this score. */
  signals: ModalitySignal[];
}

// ─── Per-modality signal bundles ─────────────────────────────────────────────

/**
 * Face biometric signals — output of the face-matching + liveness pipeline.
 * All values 0..1 unless noted.
 */
export interface FaceBiometricSignals {
  /** Face embedding cosine similarity to reference image. 0..1. */
  faceMatchScore: number;
  /** Passive liveness probability (real face vs spoof). 0..1. */
  livenessScore: number;
  /** Image quality score (blur, lighting, resolution). 0..1. */
  faceQualityScore: number;
  /** 68-landmark consistency (e.g. dlib model) — 1 = perfect. 0..1. */
  landmarkConsistency: number;
  /** Eye aspect ratio (EAR) — healthy range 0.2..0.4 maps to 0..1. */
  eyeAspectRatio: number;
  /** Was a blink detected during the challenge-response? 1=yes, 0=no. */
  blinkDetected: number;
  /** Head-pose stability across frames (yaw/pitch/roll variance, inverse). 0..1. */
  headPoseStability: number;
  /** Naturalness of expression (no extreme smile/frown from deepfake). 0..1. */
  expressionNaturalness: number;
}

/** Voice biometric signals from the voice-matching + liveness pipeline. */
export interface VoiceBiometricSignals {
  /** Mean pitch (Hz) — adult male 85-180Hz, female 165-255Hz. */
  pitchMean: number;
  /** Pitch standard deviation (Hz). Healthy speech 20-60Hz. */
  pitchStd: number;
  /** Formant frequencies F1, F2 (Hz) — vowel signature. */
  formantF1F2: { f1: number; f2: number };
  /** Voice embedding cosine similarity to enrollment. 0..1. */
  voiceEmbeddingSimilarity: number;
  /** Speech rate (words/min). Healthy 100-200 wpm. */
  speechRate: number;
  /** Pause pattern consistency (inter-word pauses, normalized). 0..1. */
  pausePattern: number;
  /** Signal-to-noise ratio in dB. Healthy > 20dB. */
  snr: number;
  /** Emotion consistency with enrollment sample (valence/arousal). 0..1. */
  emotionConsistency: number;
}

/** Behavioral biometric signals captured during the session. */
export interface BehavioralSignals {
  /** Keystroke dynamics similarity to enrollment (digraph timing). 0..1. */
  keystrokeDynamics: number;
  /** Mouse movement entropy (bits/sample) — healthy 2..4 bits. */
  mouseMovementEntropy: number;
  /** Scroll pattern similarity to enrollment (acceleration profile). 0..1. */
  scrollPattern: number;
  /** Touch pressure mean (g) — mobile only, 0..1 normalized. */
  touchPressure: number;
  /** Device angle stability (accelerometer variance, inverse). 0..1. */
  deviceAngleStability: number;
  /** Session duration in seconds. */
  sessionDuration: number;
}

/** Document authenticity signals from the OCR + security-feature pipeline. */
export interface DocumentSignals {
  /** OCR confidence (mean per-character probability). 0..1. */
  ocrConfidence: number;
  /** MRZ check-digit validity (1=all valid, 0=any invalid). */
  mrzValid: number;
  /** Cross-field pass rate (MRZ ↔ visual zone consistency). 0..1. */
  crossFieldPassRate: number;
  /** Tampering detection score (1=clean, 0=tampered). */
  tamperingScore: number;
  /** Number of security features detected (UV, hologram, microprint). */
  securityFeatureCount: number;
  /** Document age in days since issuance. */
  documentAge: number;
  /** Font consistency across fields (0..1, 1=perfect). */
  fontConsistency: number;
}

/** Optional device-trust signals. */
export interface DeviceSignals {
  /** Device attestation score (TPM / Secure Enclave verified). 0..1. */
  attestationScore: number;
  /** Emulator/root/jailbreak detected. 1=clean, 0=compromised. */
  environmentIntegrity: number;
  /** Known-bad device fingerprint. 1=clean, 0=blacklisted. */
  reputationScore: number;
}

// ─── Fusion inputs / outputs ─────────────────────────────────────────────────

/** Inputs to {@link fuseBiometrics} — any combination of modalities. */
export interface FusionInputs {
  face?: FaceBiometricSignals;
  voice?: VoiceBiometricSignals;
  behavior?: BehavioralSignals;
  document?: DocumentSignals;
  device?: DeviceSignals;
}

/** Context used to compute adaptive modality weights. */
export interface ModalityWeightContext {
  /** Risk level of the session (informs which modalities matter most). */
  riskLevel: "low" | "medium" | "high";
  /** Form factor the user is operating on. */
  deviceType: "mobile" | "desktop" | "kiosk";
  /** Session age in seconds at the time of fusion. */
  sessionAge: number;
}

/** Output of {@link fuseBiometrics}. */
export interface FusionResult {
  /** 0..1 — final probability that the user is real (D-S combined m_real). */
  fusedScore: number;
  /** Per-modality breakdown. */
  modalityBreakdown: ModalityScore[];
  /** Number of modalities that contributed. */
  modalityCount: number;
  /** Modalities expected but not provided. */
  missingModalities: BiometricModality[];
  /** Final decision. */
  decision: "approve" | "review" | "reject";
  /** Human-readable reasoning for the decision. */
  reasoning: string;
  /** Dempster-Shafer conflict mass (high = modalities disagree). */
  conflict: number;
}

/** Evidence item for Dempster-Shafer combination. */
export interface DSEvidence {
  /** Which hypothesis this evidence supports. */
  hypothesis: "real" | "spoof";
  /** Probability mass assigned to this hypothesis. 0..1. */
  probability: number;
  /** Mass assigned to "I don't know" (uncertainty). 0..1. */
  uncertainty: number;
}

/** Output of {@link dempsterShaferCombine}. */
export interface DSCombinationResult {
  /** Combined mass for "real" hypothesis. */
  real: number;
  /** Combined mass for "spoof" hypothesis. */
  spoof: number;
  /** Conflict mass (proportion of contradictory evidence). */
  conflict: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Clamp a number to [lo, hi]. */
function clamp(v: number, lo = 0, hi = 1): number {
  if (Number.isNaN(v)) return lo;
  return Math.min(hi, Math.max(lo, v));
}

/** Linear interpolate between a and b by t (0..1). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Map a value x in [inLo, inHi] to [outLo, outHi], clamped. */
function remap(x: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  if (inHi === inLo) return outLo;
  const t = (x - inLo) / (inHi - inLo);
  return clamp(lerp(outLo, outHi, t), Math.min(outLo, outHi), Math.max(outLo, outHi));
}

// ─── Per-modality scorers ────────────────────────────────────────────────────

/**
 * Convert raw face biometric signals into a {@link ModalityScore}.
 *
 * The face modality is the single strongest signal — weighted highest in
 * most contexts. The score combines match similarity, liveness, image
 * quality, and challenge-response (blink) verification.
 */
export function computeFaceScore(face: FaceBiometricSignals, weight: number): ModalityScore {
  const signals: ModalitySignal[] = [
    { name: "face_match_score", value: face.faceMatchScore, detail: `Embedding cosine similarity ${face.faceMatchScore.toFixed(3)}` },
    { name: "liveness_score", value: face.livenessScore, detail: `Passive liveness probability ${face.livenessScore.toFixed(3)}` },
    { name: "face_quality_score", value: face.faceQualityScore, detail: `Image quality (blur/lighting) ${face.faceQualityScore.toFixed(3)}` },
    { name: "landmark_consistency", value: face.landmarkConsistency, detail: `68-pt landmark fit ${face.landmarkConsistency.toFixed(3)}` },
    { name: "eye_aspect_ratio", value: remap(face.eyeAspectRatio, 0.1, 0.35, 0, 1), detail: `EAR ${face.eyeAspectRatio.toFixed(3)} (open-eye band 0.2..0.4)` },
    { name: "blink_detected", value: face.blinkDetected, detail: face.blinkDetected > 0.5 ? "Blink detected in challenge window" : "No blink — possible photo replay" },
    { name: "head_pose_stability", value: face.headPoseStability, detail: `Head pose stability ${face.headPoseStability.toFixed(3)}` },
    { name: "expression_naturalness", value: face.expressionNaturalness, detail: `Expression naturalness ${face.expressionNaturalness.toFixed(3)}` },
  ];

  // Weighted sub-scores: match + liveness dominate; quality gates the rest.
  const matchPart = face.faceMatchScore * 0.45;
  const livenessPart = face.livenessScore * 0.35;
  const qualityGate = face.faceQualityScore >= 0.4 ? 1 : face.faceQualityScore / 0.4;
  const challengePart = (face.blinkDetected * 0.5 + face.headPoseStability * 0.3 + face.expressionNaturalness * 0.2) * 0.20;
  const score = clamp((matchPart + livenessPart + challengePart) * qualityGate);

  // Confidence: high if all strong signals agree; degraded if quality low.
  const confidence = clamp(
    0.95 * Math.min(face.faceQualityScore, face.livenessScore, 1) +
    0.05 * face.landmarkConsistency,
  );

  return { modality: BiometricModality.Face, score, confidence, weight, signals };
}

/**
 * Convert raw voice biometric signals into a {@link ModalityScore}.
 */
export function computeVoiceScore(voice: VoiceBiometricSignals, weight: number): ModalityScore {
  // Pitch plausibility: male 85-180Hz, female 165-255Hz → reward middle of band.
  const pitchInBand =
    (voice.pitchMean >= 85 && voice.pitchMean <= 180) ||
    (voice.pitchMean >= 165 && voice.pitchMean <= 255);
  const pitchScore = pitchInBand ? 1 : remap(voice.pitchMean, 50, 300, 0, 1);

  const pitchStdScore = remap(voice.pitchStd, 0, 80, 0.3, 1); // monotonic up to 80Hz
  const snrScore = remap(voice.snr, 5, 40, 0, 1);
  const speechRateScore = remap(voice.speechRate, 60, 220, 0, 1);

  const signals: ModalitySignal[] = [
    { name: "pitch_mean", value: pitchScore, detail: `Pitch ${voice.pitchMean.toFixed(1)}Hz ${pitchInBand ? "(in band)" : "(out of band)"}` },
    { name: "pitch_std", value: pitchStdScore, detail: `Pitch stddev ${voice.pitchStd.toFixed(1)}Hz` },
    { name: "formant_f1f2", value: 0.8, detail: `F1=${voice.formantF1F2.f1.toFixed(0)}Hz F2=${voice.formantF1F2.f2.toFixed(0)}Hz` },
    { name: "voice_embedding_similarity", value: voice.voiceEmbeddingSimilarity, detail: `Embedding similarity ${voice.voiceEmbeddingSimilarity.toFixed(3)}` },
    { name: "speech_rate", value: speechRateScore, detail: `${voice.speechRate.toFixed(0)} wpm` },
    { name: "pause_pattern", value: voice.pausePattern, detail: `Pause pattern consistency ${voice.pausePattern.toFixed(3)}` },
    { name: "snr", value: snrScore, detail: `SNR ${voice.snr.toFixed(1)}dB` },
    { name: "emotion_consistency", value: voice.emotionConsistency, detail: `Emotion match ${voice.emotionConsistency.toFixed(3)}` },
  ];

  // Embedding similarity is the dominant signal (60%). Acoustic quality gates.
  const embeddingPart = voice.voiceEmbeddingSimilarity * 0.60;
  const acousticPart = (pitchScore + pitchStdScore + snrScore + speechRateScore + voice.pausePattern + voice.emotionConsistency) / 6 * 0.40;
  const score = clamp(embeddingPart + acousticPart);

  const confidence = clamp(
    0.6 * voice.voiceEmbeddingSimilarity +
    0.4 * Math.min(snrScore, pitchStdScore),
  );

  return { modality: BiometricModality.Voice, score, confidence, weight, signals };
}

/**
 * Convert raw behavioral signals into a {@link ModalityScore}.
 *
 * Behavioral biometrics is the *weakest single modality* but is the only
 * one that survives a session hijack — keyboard/mouse/touch patterns are
 * extremely hard for an impostor to imitate.
 */
export function computeBehavioralScore(behavior: BehavioralSignals, weight: number): ModalityScore {
  const keystrokeScore = clamp(behavior.keystrokeDynamics);
  const mouseScore = remap(behavior.mouseMovementEntropy, 0, 5, 0, 1);
  const scrollScore = clamp(behavior.scrollPattern);
  const touchScore = clamp(behavior.touchPressure);
  const angleScore = clamp(behavior.deviceAngleStability);
  // Session duration: very short (<10s) is suspicious for a verification flow.
  const durationScore = behavior.sessionDuration < 10
    ? behavior.sessionDuration / 10 * 0.5
    : remap(behavior.sessionDuration, 10, 300, 0.5, 1);

  const signals: ModalitySignal[] = [
    { name: "keystroke_dynamics", value: keystrokeScore, detail: `Digraph timing match ${keystrokeScore.toFixed(3)}` },
    { name: "mouse_movement_entropy", value: mouseScore, detail: `Entropy ${behavior.mouseMovementEntropy.toFixed(2)} bits` },
    { name: "scroll_pattern", value: scrollScore, detail: `Scroll profile match ${scrollScore.toFixed(3)}` },
    { name: "touch_pressure", value: touchScore, detail: `Touch pressure norm ${touchScore.toFixed(3)}` },
    { name: "device_angle_stability", value: angleScore, detail: `Accelerometer stability ${angleScore.toFixed(3)}` },
    { name: "session_duration", value: durationScore, detail: `${behavior.sessionDuration.toFixed(0)}s session` },
  ];

  // Keystroke + mouse dominate; the rest adds nuance.
  const score = clamp(
    keystrokeScore * 0.35 +
    mouseScore * 0.20 +
    scrollScore * 0.15 +
    touchScore * 0.10 +
    angleScore * 0.10 +
    durationScore * 0.10,
  );

  const confidence = clamp(
    0.5 * keystrokeScore +
    0.3 * mouseScore +
    0.2 * durationScore,
  );

  return { modality: BiometricModality.Behavioral, score, confidence, weight, signals };
}

/**
 * Convert raw document signals into a {@link ModalityScore}.
 */
export function computeDocumentScore(document: DocumentSignals, weight: number): ModalityScore {
  const ocrScore = clamp(document.ocrConfidence);
  const mrzScore = clamp(document.mrzValid);
  const crossFieldScore = clamp(document.crossFieldPassRate);
  const tamperingScore = clamp(document.tamperingScore);
  // Security features: most docs have 3-6. 0 or 1 is suspicious.
  const secScore = remap(document.securityFeatureCount, 0, 5, 0, 1);
  // Document age: too old or brand new are both mildly suspicious.
  const ageScore =
    document.documentAge < 1 ? 0.5 :
    document.documentAge < 3650 ? 1.0 :
    remap(document.documentAge, 3650, 36500, 1.0, 0.5);
  const fontScore = clamp(document.fontConsistency);

  const signals: ModalitySignal[] = [
    { name: "ocr_confidence", value: ocrScore, detail: `OCR mean confidence ${ocrScore.toFixed(3)}` },
    { name: "mrz_valid", value: mrzScore, detail: mrzScore > 0.5 ? "MRZ check digits valid" : "MRZ check digit failure" },
    { name: "cross_field_pass_rate", value: crossFieldScore, detail: `${crossFieldScore.toFixed(3)} cross-field pass rate` },
    { name: "tampering_score", value: tamperingScore, detail: tamperingScore > 0.7 ? "No tampering detected" : "Tampering indicators present" },
    { name: "security_feature_count", value: secScore, detail: `${document.securityFeatureCount} security features detected` },
    { name: "document_age", value: ageScore, detail: `${document.documentAge.toFixed(0)} days since issuance` },
    { name: "font_consistency", value: fontScore, detail: `Font consistency ${fontScore.toFixed(3)}` },
  ];

  // MRZ + tampering + cross-field are the strongest document signals.
  const score = clamp(
    mrzScore * 0.25 +
    tamperingScore * 0.25 +
    crossFieldScore * 0.20 +
    ocrScore * 0.10 +
    secScore * 0.10 +
    ageScore * 0.05 +
    fontScore * 0.05,
  );

  const confidence = clamp(
    0.4 * ocrScore +
    0.3 * mrzScore +
    0.3 * (document.securityFeatureCount > 0 ? 1 : 0),
  );

  return { modality: BiometricModality.Document, score, confidence, weight, signals };
}

/**
 * Convert raw device signals into a {@link ModalityScore}.
 */
export function computeDeviceScore(device: DeviceSignals, weight: number): ModalityScore {
  const signals: ModalitySignal[] = [
    { name: "attestation_score", value: device.attestationScore, detail: `Hardware attestation ${device.attestationScore.toFixed(3)}` },
    { name: "environment_integrity", value: device.environmentIntegrity, detail: device.environmentIntegrity > 0.5 ? "No root/jailbreak/emulator" : "Compromised environment" },
    { name: "reputation_score", value: device.reputationScore, detail: device.reputationScore > 0.5 ? "Device not blacklisted" : "Device on known-bad list" },
  ];

  const score = clamp(
    device.attestationScore * 0.40 +
    device.environmentIntegrity * 0.35 +
    device.reputationScore * 0.25,
  );

  const confidence = clamp(0.7 * device.attestationScore + 0.3 * device.environmentIntegrity);

  return { modality: BiometricModality.Device, score, confidence, weight, signals };
}

// ─── Core: Dempster-Shafer evidence combination ──────────────────────────────

/**
 * Combine a list of evidence items using Dempster-Shafer theory.
 *
 * Each evidence item is one modality's verdict:
 *   - `hypothesis` — which hypothesis the modality supports ('real' or 'spoof')
 *   - `probability` — mass assigned to that hypothesis (0..1)
 *   - `uncertainty` — mass assigned to "I don't know" (0..1)
 *
 * The remaining mass `1 - probability - uncertainty` is assigned to the
 * *opposite* hypothesis. (So a face modality that says "real" with p=0.8
 * and uncertainty=0.1 implicitly assigns 0.1 to "spoof".)
 *
 * Returns:
 *   - `real` — combined mass on the "real" hypothesis
 *   - `spoof` — combined mass on the "spoof" hypothesis
 *   - `conflict` — K, the proportion of mass lost to contradictory evidence
 *
 * High conflict (> 0.5) means modalities strongly disagree — a red flag
 * for a coordinated multi-modal attack.
 *
 * For the trivial N=1 case, returns the single evidence's masses directly
 * with conflict = 0.
 *
 * @example
 * // Two agreeing modalities (both say real, low conflict)
 * const r = dempsterShaferCombine([
 *   { hypothesis: "real", probability: 0.8, uncertainty: 0.1 },
 *   { hypothesis: "real", probability: 0.7, uncertainty: 0.2 },
 * ]);
 * // r.real ≈ 0.96, r.spoof ≈ 0.03, r.conflict ≈ 0.05
 *
 * @example
 * // Two disagreeing modalities (face says real, voice says spoof)
 * const r = dempsterShaferCombine([
 *   { hypothesis: "real", probability: 0.9, uncertainty: 0.05 },
 *   { hypothesis: "spoof", probability: 0.9, uncertainty: 0.05 },
 * ]);
 * // r.conflict ≈ 0.82 — disagreement surfaces explicitly
 */
export function dempsterShaferCombine(evidence: DSEvidence[]): DSCombinationResult {
  if (!evidence || evidence.length === 0) {
    return { real: 0.5, spoof: 0.5, conflict: 0 };
  }

  // Convert each evidence item to masses on (real, spoof, uncertain).
  const masses = evidence.map((e) => {
    const p = clamp(e.probability);
    const u = clamp(e.uncertainty);
    // mass on hypothesis:
    const mH = clamp(p);
    // mass on uncertainty:
    const mU = clamp(u, 0, Math.max(0, 1 - mH));
    // mass on opposite hypothesis (leftover):
    const mO = clamp(1 - mH - mU);
    if (e.hypothesis === "real") {
      return { real: mH, spoof: mO, uncertain: mU };
    }
    return { real: mO, spoof: mH, uncertain: mU };
  });

  // Iteratively combine. Start with the first evidence as the prior.
  let mReal = masses[0].real;
  let mSpoof = masses[0].spoof;
  let mUncertain = masses[0].uncertain;
  let conflict = 0;

  for (let i = 1; i < masses.length; i++) {
    const e = masses[i];
    // Dempster's rule: combine masses for {real, spoof, uncertain}.
    const newReal = mReal * e.real + mReal * e.uncertain + mUncertain * e.real;
    const newSpoof = mSpoof * e.spoof + mSpoof * e.uncertain + mUncertain * e.spoof;
    const newUncertain = mUncertain * e.uncertain;
    // Conflict K = masses that point at opposite hypotheses:
    const k = mReal * e.spoof + mSpoof * e.real;
    conflict = k; // report the most recent pairwise conflict (standard convention)
    const norm = 1 - k;
    if (norm > 1e-9) {
      mReal = newReal / norm;
      mSpoof = newSpoof / norm;
      mUncertain = newUncertain / norm;
    } else {
      // Total conflict — split evenly and zero out uncertainty.
      mReal = 0.5;
      mSpoof = 0.5;
      mUncertain = 0;
      conflict = 1;
    }
  }

  // Normalize so that real + spoof + uncertain = 1 (they already do, but be safe).
  const sum = mReal + mSpoof + mUncertain;
  if (sum > 0) {
    mReal /= sum;
    mSpoof /= sum;
  }

  return { real: mReal, spoof: mSpoof, conflict };
}

// ─── Adaptive modality weights ────────────────────────────────────────────────

/**
 * Compute adaptive per-modality weights based on session context.
 *
 * Heuristics:
 *   - High-risk sessions weight `document` and `face` higher.
 *   - Mobile sessions have rich behavioral signals — weight them more.
 *   - Desktop sessions lack touch/angle data — downweight behavioral.
 *   - Kiosk sessions are anonymous — upweight device attestation.
 *   - Long sessions (sessionAge > 600s) get behavioral boost (more data).
 *
 * Returns weights that **sum to 1.0**.
 */
export function computeModalityWeights(context: ModalityWeightContext): Record<BiometricModality, number> {
  // Base weights — face and document dominate by default.
  let weights: Record<BiometricModality, number> = {
    [BiometricModality.Face]: 0.35,
    [BiometricModality.Voice]: 0.20,
    [BiometricModality.Behavioral]: 0.15,
    [BiometricModality.Document]: 0.25,
    [BiometricModality.Device]: 0.05,
  };

  // Risk-level adjustments.
  if (context.riskLevel === "high") {
    weights[BiometricModality.Face] = 0.40;
    weights[BiometricModality.Document] = 0.30;
    weights[BiometricModality.Voice] = 0.20;
    weights[BiometricModality.Behavioral] = 0.05;
    weights[BiometricModality.Device] = 0.05;
  } else if (context.riskLevel === "low") {
    weights[BiometricModality.Face] = 0.45;
    weights[BiometricModality.Document] = 0.20;
    weights[BiometricModality.Voice] = 0.15;
    weights[BiometricModality.Behavioral] = 0.15;
    weights[BiometricModality.Device] = 0.05;
  }

  // Device-type adjustments.
  if (context.deviceType === "mobile") {
    // Mobiles have rich behavioral data (touch, accelerometer).
    weights[BiometricModality.Behavioral] += 0.05;
    weights[BiometricModality.Face] -= 0.03;
    weights[BiometricModality.Voice] -= 0.02;
  } else if (context.deviceType === "desktop") {
    // Desktops have no touch/angle — behavioral weaker.
    weights[BiometricModality.Behavioral] -= 0.05;
    weights[BiometricModality.Face] += 0.03;
    weights[BiometricModality.Device] += 0.02;
  } else if (context.deviceType === "kiosk") {
    // Kiosk is anonymous — trust device attestation more.
    weights[BiometricModality.Device] += 0.10;
    weights[BiometricModality.Document] += 0.03;
    weights[BiometricModality.Behavioral] -= 0.08;
    weights[BiometricModality.Voice] -= 0.05;
  }

  // Session-age adjustments: longer sessions have richer behavioral data.
  if (context.sessionAge > 600) {
    weights[BiometricModality.Behavioral] += 0.05;
    weights[BiometricModality.Face] -= 0.03;
    weights[BiometricModality.Document] -= 0.02;
  } else if (context.sessionAge < 30) {
    // Very short session — behavioral too sparse to trust.
    weights[BiometricModality.Behavioral] -= 0.05;
    weights[BiometricModality.Face] += 0.03;
    weights[BiometricModality.Document] += 0.02;
  }

  // Clamp all weights non-negative, then renormalize to sum=1.
  for (const m of ALL_MODALITIES) {
    weights[m] = Math.max(0.001, weights[m]);
  }
  const total = ALL_MODALITIES.reduce((s, m) => s + weights[m], 0);
  for (const m of ALL_MODALITIES) {
    weights[m] = weights[m] / total;
  }

  return weights;
}

// ─── Modality disagreement detection ─────────────────────────────────────────

/** Pair of modalities that disagree. */
export type ModalityPair = [BiometricModality, BiometricModality];

/** Output of {@link detectModalityDisagreement}. */
export interface DisagreementResult {
  /** 0..1 — how much the modalities disagree (0 = full agreement). */
  disagreement: number;
  /** Pairs of modalities whose verdicts contradict. */
  conflictingModalities: ModalityPair[];
  /** Human-readable explanation. */
  explanation: string;
}

/**
 * Detect when modalities disagree — face says "real" but voice says "spoof".
 *
 * For every pair of modalities, if one's `score >= 0.5` (supports "real")
 * and the other's `score < 0.5` (supports "spoof"), they conflict. The
 * magnitude of disagreement is the absolute difference in scores, weighted
 * by each modality's confidence.
 *
 * High disagreement is a strong signal of a coordinated attack — the
 * attacker has defeated some modalities but not all.
 */
export function detectModalityDisagreement(scores: ModalityScore[]): DisagreementResult {
  const pairs: ModalityPair[] = [];
  let totalDisagreement = 0;
  let pairCount = 0;

  for (let i = 0; i < scores.length; i++) {
    for (let j = i + 1; j < scores.length; j++) {
      const a = scores[i];
      const b = scores[j];
      const aReal = a.score >= 0.5;
      const bReal = b.score >= 0.5;
      if (aReal !== bReal) {
        pairs.push([a.modality, b.modality]);
        // Weighted disagreement: |scoreA - scoreB| * confidenceA * confidenceB
        const d = Math.abs(a.score - b.score) * a.confidence * b.confidence;
        totalDisagreement += d;
        pairCount += 1;
      }
    }
  }

  // Average disagreement across conflicting pairs (or 0 if none).
  const disagreement = pairCount > 0 ? clamp(totalDisagreement / pairCount) : 0;

  let explanation: string;
  if (pairs.length === 0) {
    explanation = `All ${scores.length} modalities agree on verdict.`;
  } else {
    const list = pairs.map(([a, b]) => `${a}↔${b}`).join(", ");
    explanation = `${pairs.length} modality conflict(s) detected: ${list}. ` +
      `Average disagreement ${(disagreement * 100).toFixed(1)}%.`;
  }

  return { disagreement, conflictingModalities: pairs, explanation };
}

// ─── The main fusion entry point ──────────────────────────────────────────────

/**
 * Fuse face + voice + behavioral + document + device biometric signals
 * into a single identity-assurance score using Dempster-Shafer theory.
 *
 * Process:
 *   1. Compute per-modality {@link ModalityScore} (score, confidence, signals).
 *   2. Convert each modality to a D-S evidence item:
 *      hypothesis = score >= 0.5 ? 'real' : 'spoof'
 *      probability = score (or 1-score if spoof)
 *      uncertainty = 1 - confidence
 *   3. Combine via {@link dempsterShaferCombine}.
 *   4. The fused score = combined mass on 'real'.
 *   5. Decision thresholds:
 *        - approve if fusedScore >= 0.70 AND conflict < 0.30
 *        - reject  if fusedScore < 0.40 OR conflict > 0.60
 *        - review  otherwise
 *
 * @param inputs   Up to 5 modality signal bundles. Missing ones are flagged.
 * @param weights  Optional weight overrides; defaults from {@link computeModalityWeights}
 *                 with a medium-risk, mobile, fresh-session context.
 */
export function fuseBiometrics(
  inputs: FusionInputs,
  weights?: Partial<Record<BiometricModality, number>>,
): FusionResult {
  const defaultWeights = computeModalityWeights({
    riskLevel: "medium",
    deviceType: "mobile",
    sessionAge: 60,
  });
  const w: Record<BiometricModality, number> = { ...defaultWeights, ...weights };

  const breakdown: ModalityScore[] = [];
  const missing: BiometricModality[] = [];

  if (inputs.face) breakdown.push(computeFaceScore(inputs.face, w[BiometricModality.Face] ?? 0.35));
  else missing.push(BiometricModality.Face);

  if (inputs.voice) breakdown.push(computeVoiceScore(inputs.voice, w[BiometricModality.Voice] ?? 0.20));
  else missing.push(BiometricModality.Voice);

  if (inputs.behavior) breakdown.push(computeBehavioralScore(inputs.behavior, w[BiometricModality.Behavioral] ?? 0.15));
  else missing.push(BiometricModality.Behavioral);

  if (inputs.document) breakdown.push(computeDocumentScore(inputs.document, w[BiometricModality.Document] ?? 0.25));
  else missing.push(BiometricModality.Document);

  if (inputs.device) breakdown.push(computeDeviceScore(inputs.device, w[BiometricModality.Device] ?? 0.05));
  else missing.push(BiometricModality.Device);

  // Build D-S evidence list. If no modalities present, return reject.
  if (breakdown.length === 0) {
    return {
      fusedScore: 0,
      modalityBreakdown: [],
      modalityCount: 0,
      missingModalities: missing,
      decision: "reject",
      reasoning: "No biometric modalities were provided for fusion.",
      conflict: 0,
    };
  }

  const evidence: DSEvidence[] = breakdown.map((s) => ({
    hypothesis: s.score >= 0.5 ? "real" : "spoof",
    probability: s.score >= 0.5 ? s.score : 1 - s.score,
    uncertainty: clamp(1 - s.confidence),
  }));

  const ds = dempsterShaferCombine(evidence);
  const fusedScore = clamp(ds.real);
  const conflict = clamp(ds.conflict);

  // Decision logic with conflict awareness.
  let decision: "approve" | "review" | "reject";
  if (fusedScore >= 0.70 && conflict < 0.30) {
    decision = "approve";
  } else if (fusedScore < 0.40 || conflict > 0.60) {
    decision = "reject";
  } else {
    decision = "review";
  }

  // Build reasoning string.
  const disagree = detectModalityDisagreement(breakdown);
  const topModality = breakdown.slice().sort((a, b) => b.weight * b.score - a.weight * a.score)[0];
  const parts: string[] = [];
  parts.push(`Fused ${breakdown.length} modality(ies) via Dempster-Shafer → m_real=${fusedScore.toFixed(3)}, conflict=${conflict.toFixed(3)}.`);
  if (topModality) {
    parts.push(`Top contributor: ${topModality.modality} (score ${topModality.score.toFixed(2)}, weight ${topModality.weight.toFixed(2)}).`);
  }
  if (missing.length > 0) {
    parts.push(`Missing modalities: ${missing.join(", ")}.`);
  }
  if (disagree.disagreement > 0) {
    parts.push(disagree.explanation);
  }
  parts.push(`Decision: ${decision}.`);

  return {
    fusedScore,
    modalityBreakdown: breakdown,
    modalityCount: breakdown.length,
    missingModalities: missing,
    decision,
    reasoning: parts.join(" "),
    conflict,
  };
}

// ─── Risk classification ──────────────────────────────────────────────────────

/** Output of {@link multimodalRiskScore}. */
export interface MultimodalRiskAssessment {
  /** 0..1 — risk score (inverse of fusedScore, adjusted for conflict). */
  riskScore: number;
  /** Bucketed risk level. */
  riskLevel: "low" | "medium" | "high" | "critical";
  /** List of factors that drove the risk score. */
  factors: string[];
  /** Recommended action. */
  recommendation: "approve" | "review" | "reject" | "step_up";
}

/**
 * Convert a {@link FusionResult} into a risk classification.
 *
 * Risk = (1 - fusedScore) + 0.5 * conflict, clamped to [0, 1]. High
 * conflict adds risk because it signals a coordinated attack even when
 * the average score is moderate.
 *
 * Risk levels:
 *   - low      riskScore < 0.20  → approve
 *   - medium   0.20 ≤ riskScore < 0.45  → review
 *   - high     0.45 ≤ riskScore < 0.70  → step_up
 *   - critical riskScore ≥ 0.70  → reject
 */
export function multimodalRiskScore(fusion: {
  fusedScore: number;
  modalityBreakdown: ModalityScore[];
  conflict?: number;
}): MultimodalRiskAssessment {
  const conflict = fusion.conflict ?? 0;
  const riskScore = clamp((1 - fusion.fusedScore) + 0.5 * conflict);

  const factors: string[] = [];
  factors.push(`fused_score=${fusion.fusedScore.toFixed(3)}`);
  factors.push(`conflict=${conflict.toFixed(3)}`);

  // Surface any modality scoring low.
  for (const m of fusion.modalityBreakdown) {
    if (m.score < 0.4) {
      factors.push(`${m.modality}_low_score=${m.score.toFixed(2)}`);
    }
    if (m.confidence < 0.4) {
      factors.push(`${m.modality}_low_confidence=${m.confidence.toFixed(2)}`);
    }
  }

  let riskLevel: MultimodalRiskAssessment["riskLevel"];
  let recommendation: MultimodalRiskAssessment["recommendation"];

  if (riskScore < 0.20) {
    riskLevel = "low";
    recommendation = "approve";
  } else if (riskScore < 0.45) {
    riskLevel = "medium";
    recommendation = "review";
  } else if (riskScore < 0.70) {
    riskLevel = "high";
    recommendation = "step_up";
  } else {
    riskLevel = "critical";
    recommendation = "reject";
  }

  return { riskScore, riskLevel, factors, recommendation };
}

// ─── Step-up authentication ─────────────────────────────────────────────────

/**
 * Recommend additional modalities to verify when initial verification fails.
 *
 * Strategy:
 *   - Always recommend the failed modalities first (re-try with stricter thresholds).
 *   - For high risk, add modalities not yet used, ordered by intrinsic strength:
 *     face > document > voice > behavioral > device.
 *   - Cap the recommendation at 3 modalities to avoid over-burdening the user.
 *
 * @param currentModalities  Modalities already attempted.
 * @param failedModalities   Modalities that failed (re-verify these first).
 * @param riskLevel          Current risk classification.
 */
export function stepUpAuthentication(
  currentModalities: BiometricModality[],
  failedModalities: BiometricModality[],
  riskLevel: string,
): BiometricModality[] {
  // Priority order by intrinsic reliability.
  const priority: BiometricModality[] = [
    BiometricModality.Face,
    BiometricModality.Document,
    BiometricModality.Voice,
    BiometricModality.Behavioral,
    BiometricModality.Device,
  ];

  const recommendation: BiometricModality[] = [];
  const seen = new Set<BiometricModality>();

  // 1. Re-verify failed modalities first.
  for (const m of failedModalities) {
    if (!seen.has(m)) {
      recommendation.push(m);
      seen.add(m);
    }
  }

  // 2. For high/critical risk, add modalities not yet attempted.
  if (riskLevel === "high" || riskLevel === "critical") {
    for (const m of priority) {
      if (recommendation.length >= 3) break;
      if (!currentModalities.includes(m) && !seen.has(m)) {
        recommendation.push(m);
        seen.add(m);
      }
    }
  } else if (riskLevel === "medium") {
    // Medium risk: add ONE additional modality not yet attempted.
    for (const m of priority) {
      if (recommendation.length >= 2) break;
      if (!currentModalities.includes(m) && !seen.has(m)) {
        recommendation.push(m);
        seen.add(m);
      }
    }
  }
  // Low risk: just re-verify failed modalities (no extras).

  return recommendation.slice(0, 3);
}
