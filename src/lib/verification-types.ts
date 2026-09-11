// Shared types for identity verification

export type DocType = "national_id" | "passport" | "driver_license" | "residence";

export const DOC_TYPES: { id: DocType; label: string; labelAr: string; description: string; needsBack: boolean }[] = [
  {
    id: "national_id",
    label: "National ID Card",
    labelAr: "بطاقة الرقم القومي",
    description: "Egyptian national ID card (البطاقة الشخصية)",
    needsBack: true,
  },
  {
    id: "passport",
    label: "Passport",
    labelAr: "جواز السفر",
    description: "Egyptian or Arabic passport (جواز السفر المصري أو العربي)",
    needsBack: false,
  },
  {
    id: "driver_license",
    label: "Driver License",
    labelAr: "رخصة القيادة",
    description: "Egyptian driver license (رخصة قيادة مصرية)",
    needsBack: true,
  },
  {
    id: "residence",
    label: "Residence / Foreigner ID",
    labelAr: "إقامة",
    description: "Residence card for foreigners (بطاقة إقامة)",
    needsBack: true,
  },
];

export interface ExtractedDocumentData {
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
  hasPhoto?: boolean;
  confidence: number;
}

export interface FaceMatchResult {
  isMatch: boolean;
  similarity: number; // 0-100
  reasoning: string;
  samePerson: boolean;
}

export interface LivenessResult {
  isLive: boolean;
  score: number; // 0-100
  detectedActions: string[];
  reasoning: string;
}

export type LivenessAction = "turn_left" | "turn_right" | "look_up" | "blink" | "smile";

export const LIVENESS_ACTIONS: { id: LivenessAction; label: string; labelAr: string; icon: string; instruction: string; instructionAr: string }[] = [
  {
    id: "turn_left",
    label: "Turn head left",
    labelAr: "أدر رأسك لليسار",
    icon: "arrow-left",
    instruction: "Slowly turn your head to the LEFT",
    instructionAr: "أدر رأسك ببطء إلى اليسار",
  },
  {
    id: "turn_right",
    label: "Turn head right",
    labelAr: "أدر رأسك لليمين",
    icon: "arrow-right",
    instruction: "Slowly turn your head to the RIGHT",
    instructionAr: "أدر رأسك ببطء إلى اليمين",
  },
  {
    id: "look_up",
    label: "Look up",
    labelAr: "انظر لأعلى",
    icon: "arrow-up",
    instruction: "Slowly raise your head and LOOK UP",
    instructionAr: "ارفع رأسك ببطء وانظر لأعلى",
  },
  {
    id: "blink",
    label: "Blink twice",
    labelAr: "ارمش مرتين",
    icon: "eye",
    instruction: "BLINK your eyes twice clearly",
    instructionAr: "ارمش بعينيك مرتين بوضوح",
  },
  {
    id: "smile",
    label: "Smile",
    labelAr: "ابتسم",
    icon: "smile",
    instruction: "Please SMILE clearly at the camera",
    instructionAr: "ابتسم بوضوح للكاميرا",
  },
];

export type VerificationStatus = "pending" | "verified" | "failed" | "rejected";

export interface VerificationRecord {
  id: string;
  docType: DocType;
  docSide: string;
  docImageFront?: string | null;
  docImageBack?: string | null;
  fullNameAr?: string | null;
  fullNameEn?: string | null;
  nationalId?: string | null;
  birthDate?: string | null;
  address?: string | null;
  gender?: string | null;
  documentNo?: string | null;
  expiryDate?: string | null;
  nationality?: string | null;
  job?: string | null;
  religion?: string | null;
  maritalStatus?: string | null;
  extraFields?: string | null;
  selfieImage?: string | null;
  livenessFrames?: string | null;
  livenessActions?: string | null;
  docConfidence: number;
  faceMatchScore: number;
  livenessScore: number;
  status: VerificationStatus;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}
