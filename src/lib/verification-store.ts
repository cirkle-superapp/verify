"use client";

import { create } from "zustand";
import type {
  DocType,
  ExtractedDocumentData,
  FaceMatchResult,
  LivenessResult,
  LivenessAction,
} from "@/lib/verification-types";

export type StepId = "intro" | "doc_type" | "doc_capture" | "doc_review" | "selfie" | "liveness" | "result";

export const STEP_ORDER: StepId[] = ["intro", "doc_type", "doc_capture", "doc_review", "selfie", "liveness", "result"];

export const STEP_LABELS: Record<StepId, { en: string; ar: string }> = {
  intro: { en: "Start", ar: "ابدأ" },
  doc_type: { en: "Document", ar: "المستند" },
  doc_capture: { en: "Capture", ar: "الالتقاط" },
  doc_review: { en: "Review", ar: "المراجعة" },
  selfie: { en: "Selfie", ar: "صورة" },
  liveness: { en: "Liveness", ar: "الحياة" },
  result: { en: "Result", ar: "النتيجة" },
};

interface VerificationState {
  // navigation
  step: StepId;
  docType: DocType;
  // document capture
  docFront: string | null; // data URL
  docBack: string | null;
  docExtracted: ExtractedDocumentData | null;
  docLoading: boolean;
  // selfie
  selfie: string | null;
  // liveness
  livenessActions: LivenessAction[]; // randomly chosen sequence
  livenessFrames: string[];
  livenessResult: LivenessResult | null;
  // face match
  faceMatch: FaceMatchResult | null;
  // result
  recordId: string | null;
  isSubmitting: boolean;

  // actions
  setStep: (s: StepId) => void;
  setDocType: (t: DocType) => void;
  setDocFront: (img: string | null) => void;
  setDocBack: (img: string | null) => void;
  setDocExtracted: (d: ExtractedDocumentData | null) => void;
  setDocLoading: (b: boolean) => void;
  setSelfie: (s: string | null) => void;
  setLivenessActions: (a: LivenessAction[]) => void;
  addLivenessFrame: (f: string) => void;
  clearLivenessFrames: () => void;
  setLivenessResult: (r: LivenessResult | null) => void;
  setFaceMatch: (f: FaceMatchResult | null) => void;
  setRecordId: (id: string | null) => void;
  setSubmitting: (b: boolean) => void;
  reset: () => void;
  goNext: () => void;
  goPrev: () => void;
}

export const useVerificationStore = create<VerificationState>((set, get) => ({
  step: "intro",
  docType: "national_id",
  docFront: null,
  docBack: null,
  docExtracted: null,
  docLoading: false,
  selfie: null,
  livenessActions: [],
  livenessFrames: [],
  livenessResult: null,
  faceMatch: null,
  recordId: null,
  isSubmitting: false,

  setStep: (s) => set({ step: s }),
  setDocType: (t) => set({ docType: t }),
  setDocFront: (img) => set({ docFront: img }),
  setDocBack: (img) => set({ docBack: img }),
  setDocExtracted: (d) => set({ docExtracted: d }),
  setDocLoading: (b) => set({ docLoading: b }),
  setSelfie: (s) => set({ selfie: s }),
  setLivenessActions: (a) => set({ livenessActions: a }),
  addLivenessFrame: (f) => set((st) => ({ livenessFrames: [...st.livenessFrames, f] })),
  clearLivenessFrames: () => set({ livenessFrames: [] }),
  setLivenessResult: (r) => set({ livenessResult: r }),
  setFaceMatch: (f) => set({ faceMatch: f }),
  setRecordId: (id) => set({ recordId: id }),
  setSubmitting: (b) => set({ isSubmitting: b }),
  reset: () =>
    set({
      step: "intro",
      docType: "national_id",
      docFront: null,
      docBack: null,
      docExtracted: null,
      docLoading: false,
      selfie: null,
      livenessActions: [],
      livenessFrames: [],
      livenessResult: null,
      faceMatch: null,
      recordId: null,
      isSubmitting: false,
    }),
  goNext: () => {
    const { step } = get();
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) set({ step: STEP_ORDER[idx + 1] });
  },
  goPrev: () => {
    const { step } = get();
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) set({ step: STEP_ORDER[idx - 1] });
  },
}));
