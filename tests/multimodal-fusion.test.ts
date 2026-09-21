/**
 * Multimodal Biometric Fusion tests — Dempster-Shafer evidence theory.
 *
 * Verifies:
 *   - computeFaceScore — weighted (match×0.45 + liveness×0.35 + challenge×0.20)
 *   - computeVoiceScore — embedding×0.60 + acoustic×0.40
 *   - computeBehavioralScore — keystroke + mouse + scroll + touch
 *   - computeDocumentScore — MRZ + tampering + cross-field + OCR
 *   - computeDeviceScore — attestation + environment + reputation
 *   - dempsterShaferCombine — D-S theory (agreement vs disagreement)
 *   - computeModalityWeights — adaptive weights by risk level
 *   - detectModalityDisagreement — face=real but voice=spoof → conflict
 *   - fuseBiometrics — full pipeline returns fusedScore + decision
 *   - multimodalRiskScore — risk = (1-fused) + 0.5·conflict
 *   - stepUpAuthentication — recommends additional modalities
 */

import {
  BiometricModality,
  ALL_MODALITIES,
  computeFaceScore,
  computeVoiceScore,
  computeBehavioralScore,
  computeDocumentScore,
  computeDeviceScore,
  dempsterShaferCombine,
  computeModalityWeights,
  detectModalityDisagreement,
  fuseBiometrics,
  multimodalRiskScore,
  stepUpAuthentication,
  type FaceBiometricSignals,
  type VoiceBiometricSignals,
  type BehavioralSignals,
  type DocumentSignals,
  type DeviceSignals,
  type DSEvidence,
} from "@/lib/multimodal-fusion";
import { runTest, assert, assertEqual, assertRange } from "./lib/runner";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function cleanFace(): FaceBiometricSignals {
  return {
    faceMatchScore: 0.95,
    livenessScore: 0.95,
    faceQualityScore: 0.95,
    landmarkConsistency: 0.95,
    eyeAspectRatio: 0.3,
    blinkDetected: 1,
    headPoseStability: 0.95,
    expressionNaturalness: 0.95,
  };
}

function cleanVoice(): VoiceBiometricSignals {
  return {
    pitchMean: 140,
    pitchStd: 40,
    formantF1F2: { f1: 500, f2: 1500 },
    voiceEmbeddingSimilarity: 0.95,
    speechRate: 140,
    pausePattern: 0.9,
    snr: 30,
    emotionConsistency: 0.9,
  };
}

function cleanBehavior(): BehavioralSignals {
  return {
    keystrokeDynamics: 0.9,
    mouseMovementEntropy: 3,
    scrollPattern: 0.85,
    touchPressure: 0.7,
    deviceAngleStability: 0.85,
    sessionDuration: 60,
  };
}

function cleanDocument(): DocumentSignals {
  return {
    ocrConfidence: 0.92,
    mrzValid: 1,
    crossFieldPassRate: 0.95,
    tamperingScore: 0.95,
    securityFeatureCount: 4,
    documentAge: 100,
    fontConsistency: 0.9,
  };
}

function cleanDevice(): DeviceSignals {
  return {
    attestationScore: 0.9,
    environmentIntegrity: 1,
    reputationScore: 1,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

export async function run() {
  return [
    // ─── computeFaceScore ────────────────────────────────────────────
    await runTest("computeFaceScore: weighted match×0.45 + liveness×0.35 + challenge×0.20", () => {
      const r = computeFaceScore(cleanFace(), 0.35);
      // match 0.95*0.45 = 0.4275, liveness 0.95*0.35 = 0.3325,
      // challenge = (1*0.5 + 0.95*0.3 + 0.95*0.2)*0.20 = (0.5 + 0.285 + 0.19)*0.20 = 0.195
      // quality gate = 1 (since 0.95 >= 0.4)
      // score ≈ 0.4275 + 0.3325 + 0.195 = 0.955
      assertRange(r.score, 0.90, 1.0, "clean face score", r.score);
      assertEqual(r.modality, BiometricModality.Face, "modality");
      assertEqual(r.weight, 0.35, "weight passthrough");
      assert(r.signals.length >= 7, "signals array populated", r.signals.length);
    }),

    await runTest("computeFaceScore: low quality gates the score down", () => {
      const face = { ...cleanFace(), faceQualityScore: 0.2 };
      const r = computeFaceScore(face, 0.35);
      // qualityGate = 0.2/0.4 = 0.5
      // score = 0.955 * 0.5 ≈ 0.478
      assertRange(r.score, 0.40, 0.60, "quality-gated score", r.score);
    }),

    await runTest("computeFaceScore: no blink → reduces challenge part", () => {
      const face = { ...cleanFace(), blinkDetected: 0 };
      const r = computeFaceScore(face, 0.35);
      // challenge = (0*0.5 + 0.95*0.3 + 0.95*0.2)*0.20 = (0 + 0.285 + 0.19)*0.20 = 0.095
      // score = 0.4275 + 0.3325 + 0.095 = 0.855 (still high because match+liveness strong)
      assertRange(r.score, 0.80, 0.90, "no-blink score", r.score);
    }),

    // ─── computeVoiceScore ──────────────────────────────────────────
    await runTest("computeVoiceScore: weighted embedding×0.60 + acoustic×0.40", () => {
      const r = computeVoiceScore(cleanVoice(), 0.20);
      // embedding 0.95*0.60 = 0.57
      // acoustic = avg of (pitchScore=1, pitchStdScore=0.5 (40/80*0.7+0.3 = 0.65 actually),
      //   snrScore=30/40 remap 5..40 → 0 to 1: (30-5)/(40-5) = 25/35 ≈ 0.714,
      //   speechRateScore: 60..220 remap → (140-60)/160 = 0.5,
      //   pausePattern 0.9, emotionConsistency 0.9) / 6 * 0.40
      // acoustic avg ≈ (1 + 0.65 + 0.714 + 0.5 + 0.9 + 0.9) / 6 = 4.664/6 = 0.777
      // acoustic * 0.40 = 0.311
      // score = 0.57 + 0.311 = 0.881
      assertRange(r.score, 0.80, 0.95, "clean voice score", r.score);
      assertEqual(r.modality, BiometricModality.Voice, "modality");
    }),

    await runTest("computeVoiceScore: low embedding similarity → score degrades", () => {
      const voice = { ...cleanVoice(), voiceEmbeddingSimilarity: 0.3 };
      const r = computeVoiceScore(voice, 0.20);
      // embedding 0.3*0.60 = 0.18
      // score ≈ 0.18 + 0.311 = 0.491
      assertRange(r.score, 0.40, 0.60, "low-embedding voice score", r.score);
    }),

    // ─── computeBehavioralScore ─────────────────────────────────────
    await runTest("computeBehavioralScore: keystroke + mouse + scroll + touch + angle + duration", () => {
      const r = computeBehavioralScore(cleanBehavior(), 0.15);
      // keystroke 0.9*0.35 = 0.315
      // mouse remap(3, 0..5, 0..1) = 0.6; *0.20 = 0.12
      // scroll 0.85*0.15 = 0.1275
      // touch 0.7*0.10 = 0.07
      // angle 0.85*0.10 = 0.085
      // duration: sessionDuration=60 >= 10 → remap(60, 10..300, 0.5..1) = 0.5 + 0.5*(50/290) ≈ 0.586; *0.10 = 0.0586
      // total = 0.315 + 0.12 + 0.1275 + 0.07 + 0.085 + 0.0586 ≈ 0.776
      assertRange(r.score, 0.70, 0.85, "clean behavioral score", r.score);
      assertEqual(r.modality, BiometricModality.Behavioral, "modality");
    }),

    await runTest("computeBehavioralScore: very short session → duration score degrades", () => {
      const beh = { ...cleanBehavior(), sessionDuration: 5 };
      const r = computeBehavioralScore(beh, 0.15);
      // duration score = 5/10 * 0.5 = 0.25
      // vs normal 0.586 → loss of ~0.336 in duration contribution → ~0.034 drop in total
      assert(r.score < 0.78, "short session → lower score", r.score);
    }),

    // ─── computeDocumentScore ───────────────────────────────────────
    await runTest("computeDocumentScore: MRZ + tampering + cross-field + OCR + sec + age + font", () => {
      const r = computeDocumentScore(cleanDocument(), 0.25);
      // MRZ 1*0.25 = 0.25
      // tampering 0.95*0.25 = 0.2375
      // cross-field 0.95*0.20 = 0.19
      // OCR 0.92*0.10 = 0.092
      // sec remap(4, 0..5, 0..1) = 0.8; *0.10 = 0.08
      // age 100 < 3650 → 1.0; *0.05 = 0.05
      // font 0.9*0.05 = 0.045
      // total = 0.25 + 0.2375 + 0.19 + 0.092 + 0.08 + 0.05 + 0.045 = 0.9445
      assertRange(r.score, 0.85, 0.99, "clean document score", r.score);
      assertEqual(r.modality, BiometricModality.Document, "modality");
    }),

    await runTest("computeDocumentScore: invalid MRZ halves the MRZ contribution", () => {
      const doc = { ...cleanDocument(), mrzValid: 0 };
      const r = computeDocumentScore(doc, 0.25);
      // MRZ 0*0.25 = 0; total drops by 0.25 → 0.9445 - 0.25 = 0.6945
      assertRange(r.score, 0.65, 0.75, "invalid MRZ score", r.score);
    }),

    // ─── computeDeviceScore ─────────────────────────────────────────
    await runTest("computeDeviceScore: attestation×0.40 + environment×0.35 + reputation×0.25", () => {
      const r = computeDeviceScore(cleanDevice(), 0.05);
      // 0.9*0.40 + 1*0.35 + 1*0.25 = 0.36 + 0.35 + 0.25 = 0.96
      assertRange(r.score, 0.90, 0.99, "clean device score", r.score);
      assertEqual(r.modality, BiometricModality.Device, "modality");
    }),

    await runTest("computeDeviceScore: compromised environment → score degrades", () => {
      const dev = { ...cleanDevice(), environmentIntegrity: 0 };
      const r = computeDeviceScore(dev, 0.05);
      // 0.9*0.40 + 0*0.35 + 1*0.25 = 0.36 + 0 + 0.25 = 0.61
      assertRange(r.score, 0.55, 0.70, "compromised environment", r.score);
    }),

    // ─── dempsterShaferCombine ───────────────────────────────────────
    await runTest("dempsterShaferCombine: empty evidence → 0.5/0.5/0", () => {
      const r = dempsterShaferCombine([]);
      assertEqual(r.real, 0.5, "default real");
      assertEqual(r.spoof, 0.5, "default spoof");
      assertEqual(r.conflict, 0, "no conflict");
    }),

    await runTest("dempsterShaferCombine: single evidence → returns its masses", () => {
      const r = dempsterShaferCombine([
        { hypothesis: "real", probability: 0.9, uncertainty: 0.05 },
      ]);
      assertRange(r.real, 0.85, 0.95, "real near 0.9");
      assertEqual(r.conflict, 0, "no conflict for single evidence");
    }),

    await runTest("dempsterShaferCombine: agreement → high real, low conflict", () => {
      const r = dempsterShaferCombine([
        { hypothesis: "real", probability: 0.8, uncertainty: 0.1 },
        { hypothesis: "real", probability: 0.7, uncertainty: 0.2 },
      ]);
      // Expected: real ≈ 0.95, conflict ≈ 0.16 (computed above)
      assert(r.real > 0.85, "agreement → real > 0.85", r);
      assert(r.conflict < 0.30, "agreement → conflict < 0.30", r);
      assert(r.real > r.spoof, "real > spoof", r);
    }),

    await runTest("dempsterShaferCombine: disagreement → high conflict", () => {
      const r = dempsterShaferCombine([
        { hypothesis: "real", probability: 0.9, uncertainty: 0.05 },
        { hypothesis: "spoof", probability: 0.9, uncertainty: 0.05 },
      ]);
      // Expected: conflict ≈ 0.81
      assert(r.conflict > 0.50, "disagreement → conflict > 0.5", r);
      assertRange(r.real, 0.40, 0.60, "real split near 0.5", r.real);
      assertRange(r.spoof, 0.40, 0.60, "spoof split near 0.5", r.spoof);
    }),

    await runTest("dempsterShaferCombine: total conflict → split 0.5/0.5", () => {
      const r = dempsterShaferCombine([
        { hypothesis: "real", probability: 1, uncertainty: 0 },
        { hypothesis: "spoof", probability: 1, uncertainty: 0 },
      ]);
      // k = 1*1 + 0*0 = 1, norm = 0 → falls into "total conflict" branch
      assertEqual(r.conflict, 1, "total conflict");
      assertRange(r.real, 0.49, 0.51, "real = 0.5");
      assertRange(r.spoof, 0.49, 0.51, "spoof = 0.5");
    }),

    // ─── computeModalityWeights ─────────────────────────────────────
    await runTest("computeModalityWeights: returns weights summing to 1.0", () => {
      const w = computeModalityWeights({
        riskLevel: "medium",
        deviceType: "mobile",
        sessionAge: 60,
      });
      const sum = ALL_MODALITIES.reduce((s, m) => s + w[m], 0);
      assertRange(sum, 0.999, 1.001, "weights sum to 1", sum);
      for (const m of ALL_MODALITIES) {
        assert(w[m] > 0, `${m} weight positive`, w[m]);
      }
    }),

    await runTest("computeModalityWeights: high-risk upweights document (more reliable in adversarial contexts)", () => {
      // In this codebase the design intent is: low-risk trusts face alone
      // (face weight 0.45), high-risk rebalances toward document (document
      // weight 0.30 > low-risk 0.20) and reduces behavioral+device reliance.
      const low = computeModalityWeights({
        riskLevel: "low",
        deviceType: "mobile",
        sessionAge: 60,
      });
      const high = computeModalityWeights({
        riskLevel: "high",
        deviceType: "mobile",
        sessionAge: 60,
      });
      assert(
        high[BiometricModality.Document] > low[BiometricModality.Document],
        "high-risk document weight > low-risk",
        { high: high[BiometricModality.Document], low: low[BiometricModality.Document] },
      );
      assert(
        high[BiometricModality.Behavioral] < low[BiometricModality.Behavioral],
        "high-risk behavioral weight < low-risk",
        { high: high[BiometricModality.Behavioral], low: low[BiometricModality.Behavioral] },
      );
    }),

    await runTest("computeModalityWeights: kiosk upweights device attestation", () => {
      const mobile = computeModalityWeights({
        riskLevel: "medium",
        deviceType: "mobile",
        sessionAge: 60,
      });
      const kiosk = computeModalityWeights({
        riskLevel: "medium",
        deviceType: "kiosk",
        sessionAge: 60,
      });
      assert(
        kiosk[BiometricModality.Device] > mobile[BiometricModality.Device],
        "kiosk device weight > mobile",
        { kiosk: kiosk[BiometricModality.Device], mobile: mobile[BiometricModality.Device] },
      );
    }),

    // ─── detectModalityDisagreement ─────────────────────────────────
    await runTest("detectModalityDisagreement: all agreeing → 0 disagreement", () => {
      const scores = [
        { modality: BiometricModality.Face, score: 0.9, confidence: 0.9, weight: 0.35, signals: [] },
        { modality: BiometricModality.Voice, score: 0.85, confidence: 0.85, weight: 0.20, signals: [] },
      ];
      const r = detectModalityDisagreement(scores);
      assertEqual(r.disagreement, 0, "no disagreement");
      assertEqual(r.conflictingModalities.length, 0, "no conflicting pairs");
    }),

    await runTest("detectModalityDisagreement: face=real, voice=spoof → conflict pair", () => {
      const scores = [
        { modality: BiometricModality.Face, score: 0.9, confidence: 0.9, weight: 0.35, signals: [] },
        { modality: BiometricModality.Voice, score: 0.2, confidence: 0.9, weight: 0.20, signals: [] },
      ];
      const r = detectModalityDisagreement(scores);
      assert(r.disagreement > 0, "non-zero disagreement", r);
      assertEqual(r.conflictingModalities.length, 1, "1 conflict pair");
      const [a, b] = r.conflictingModalities[0];
      assert(
        (a === BiometricModality.Face && b === BiometricModality.Voice) ||
        (a === BiometricModality.Voice && b === BiometricModality.Face),
        "conflict pair is face↔voice",
      );
    }),

    // ─── fuseBiometrics ─────────────────────────────────────────────
    await runTest("fuseBiometrics: all clean modalities → approve (fusedScore high, low conflict)", () => {
      const r = fuseBiometrics({
        face: cleanFace(),
        voice: cleanVoice(),
        behavior: cleanBehavior(),
        document: cleanDocument(),
        device: cleanDevice(),
      });
      assert(r.fusedScore > 0.7, "fused score > 0.7", r.fusedScore);
      assertEqual(r.decision, "approve", "approve");
      assertEqual(r.modalityCount, 5, "5 modalities");
      assertEqual(r.missingModalities.length, 0, "no missing");
      assert(r.conflict < 0.30, "low conflict", r.conflict);
    }),

    await runTest("fuseBiometrics: all spoofed modalities → reject", () => {
      const r = fuseBiometrics({
        face: { ...cleanFace(), faceMatchScore: 0.1, livenessScore: 0.1 },
        voice: { ...cleanVoice(), voiceEmbeddingSimilarity: 0.1 },
        behavior: { ...cleanBehavior(), keystrokeDynamics: 0.1 },
        document: { ...cleanDocument(), mrzValid: 0, tamperingScore: 0.1 },
        device: { ...cleanDevice(), environmentIntegrity: 0 },
      });
      assert(r.fusedScore < 0.4, "fused score < 0.4", r.fusedScore);
      assertEqual(r.decision, "reject", "reject");
    }),

    await runTest("fuseBiometrics: empty inputs → reject with reasoning", () => {
      const r = fuseBiometrics({});
      assertEqual(r.fusedScore, 0, "fused score 0");
      assertEqual(r.decision, "reject", "reject");
      assertEqual(r.modalityCount, 0, "0 modalities");
      assertEqual(r.missingModalities.length, 5, "5 missing");
      assert(r.reasoning.length > 0, "non-empty reasoning");
    }),

    await runTest("fuseBiometrics: face real + voice spoof → review/reject (conflict surfaces)", () => {
      const r = fuseBiometrics({
        face: cleanFace(),
        voice: { ...cleanVoice(), voiceEmbeddingSimilarity: 0.1 },
      });
      // Modalities disagree → conflict should surface.
      assert(r.conflict > 0, "conflict > 0", r);
      assert(
        r.decision === "review" || r.decision === "reject",
        "review or reject when modalities conflict",
        r.decision,
      );
    }),

    // ─── multimodalRiskScore ────────────────────────────────────────
    await runTest("multimodalRiskScore: high fused + low conflict → low risk → approve", () => {
      const fusion = {
        fusedScore: 0.95,
        modalityBreakdown: [],
        conflict: 0.05,
      };
      const r = multimodalRiskScore(fusion);
      // risk = (1 - 0.95) + 0.5 * 0.05 = 0.05 + 0.025 = 0.075 → low
      assert(r.riskScore < 0.20, "low risk", r.riskScore);
      assertEqual(r.riskLevel, "low", "low");
      assertEqual(r.recommendation, "approve", "approve");
    }),

    await runTest("multimodalRiskScore: low fused + high conflict → critical risk → reject", () => {
      const fusion = {
        fusedScore: 0.2,
        modalityBreakdown: [],
        conflict: 0.9,
      };
      const r = multimodalRiskScore(fusion);
      // risk = (1 - 0.2) + 0.5 * 0.9 = 0.8 + 0.45 = 1.25 → clamp to 1 → critical
      assertEqual(r.riskLevel, "critical", "critical");
      assertEqual(r.recommendation, "reject", "reject");
    }),

    await runTest("multimodalRiskScore: medium risk → review", () => {
      const fusion = {
        fusedScore: 0.7,
        modalityBreakdown: [],
        conflict: 0.1,
      };
      const r = multimodalRiskScore(fusion);
      // risk = 0.3 + 0.05 = 0.35 → medium (0.20 ≤ riskScore < 0.45)
      assertEqual(r.riskLevel, "medium", "medium");
      assertEqual(r.recommendation, "review", "review");
    }),

    await runTest("multimodalRiskScore: surfaces low-score + low-confidence modality factors", () => {
      const fusion = {
        fusedScore: 0.5,
        modalityBreakdown: [
          { modality: BiometricModality.Face, score: 0.2, confidence: 0.3, weight: 0.3, signals: [] },
        ],
        conflict: 0.1,
      };
      const r = multimodalRiskScore(fusion);
      assert(r.factors.some((f) => f.includes("face_low_score")), "should flag low face score");
      assert(r.factors.some((f) => f.includes("face_low_confidence")), "should flag low face confidence");
    }),

    // ─── stepUpAuthentication ───────────────────────────────────────
    await runTest("stepUpAuthentication: low risk → only re-verify failed modalities", () => {
      const rec = stepUpAuthentication(
        [BiometricModality.Face, BiometricModality.Voice],
        [BiometricModality.Voice],
        "low",
      );
      assertEqual(rec.length, 1, "only 1 (the failed one)");
      assert(rec.includes(BiometricModality.Voice), "voice included");
    }),

    await runTest("stepUpAuthentication: high risk → adds untried modalities up to 3", () => {
      const rec = stepUpAuthentication(
        [BiometricModality.Face],
        [BiometricModality.Face],
        "high",
      );
      // Should re-verify face first, then add document, voice (priority order).
      assertEqual(rec.length, 3, "cap at 3");
      assertEqual(rec[0], BiometricModality.Face, "failed first");
      assert(rec.includes(BiometricModality.Document), "document added");
      assert(rec.includes(BiometricModality.Voice), "voice added");
    }),

    await runTest("stepUpAuthentication: medium risk → 1 extra untried modality", () => {
      const rec = stepUpAuthentication(
        [BiometricModality.Face],
        [],
        "medium",
      );
      // No failed → 1 extra (document). Total = 1 (cap at 2 for medium).
      assert(rec.length <= 2, "cap at 2 for medium", rec.length);
      assert(rec.includes(BiometricModality.Document), "document added");
    }),
  ];
}
