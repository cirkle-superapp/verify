/**
 * Cirkle i18n — Lightweight translation system with Arabic (RTL) + English (LTR).
 *
 * Design:
 *  - No external runtime dependency (uses built-in Record lookup).
 *  - Each locale has its own dictionary object with `dir` metadata.
 *  - The hook `useI18n()` exposes `t(key, vars?)` which does flat key lookup with
 *    variable interpolation (`{name}` style).
 *  - Arabic translations are hand-written Modern Standard Arabic (MSA), not
 *    Google Translate output.
 *
 * Categories of keys (minimum 80):
 *   nav, common, wizard (intro/doc_type/doc_capture/doc_review/selfie/liveness/result),
 *   chatbot, quality, footer, infra.
 */

export type Locale = "en" | "ar";

export type TranslationDir = "ltr" | "rtl";

export interface LocaleMeta {
  locale: Locale;
  label: string; // English name e.g. "English"
  nativeLabel: string; // native name e.g. "العربية"
  flag: string; // emoji flag
  dir: TranslationDir;
  code: string; // BCP-47 code e.g. "en-US" or "ar-EG"
}

export const LOCALES: Record<Locale, LocaleMeta> = {
  en: {
    locale: "en",
    label: "English",
    nativeLabel: "English",
    flag: "🇬🇧",
    dir: "ltr",
    code: "en-US",
  },
  ar: {
    locale: "ar",
    label: "Arabic",
    nativeLabel: "العربية",
    flag: "🇪🇬",
    dir: "rtl",
    code: "ar-EG",
  },
};

/** Flat key → string mapping. Dot-notation keys are flattened to e.g. `nav.verify`. */
export type Translations = Record<string, string>;

export const en: Translations = {
  // ─── Nav ────────────────────────────────────────────────────────────
  "nav.verify": "Verify",
  "nav.history": "History",
  "nav.training": "Training",
  "nav.specs": "Specs",
  "nav.infra": "Infra",
  "nav.lab": "Lab",
  "nav.apiDocs": "API Docs",
  "nav.apiDocsDesc": "Swagger UI — explore all 50+ endpoints live",

  // ─── Common ────────────────────────────────────────────────────────
  "common.next": "Next",
  "common.back": "Back",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.refresh": "Refresh",
  "common.loading": "Loading…",
  "common.error": "Error",
  "common.success": "Success",
  "common.retry": "Retry",
  "common.close": "Close",
  "common.open": "Open",
  "common.continue": "Continue",
  "common.confirm": "Confirm",

  // ─── Wizard — intro ────────────────────────────────────────────────
  "wizard.intro.title": "Cirkle Identity Verification",
  "wizard.intro.subtitle": "Read Egyptian and Arabic documents, capture a live selfie, and prove liveness with movement challenges. Zero-cost, self-hosted, privacy-first.",
  "wizard.intro.arabicReadingTitle": "Arabic OCR that works",
  "wizard.intro.liveFaceTitle": "Live face match",
  "wizard.intro.liveMovementTitle": "Liveness via movement",
  "wizard.intro.verifiedRecordTitle": "Verifiable records",
  "wizard.intro.startButton": "Start verification",

  // ─── Wizard — doc_type ────────────────────────────────────────────
  "wizard.doc_type.selectDocType": "Select your document type",
  "wizard.doc_type.nationalId": "National ID Card",
  "wizard.doc_type.nationalIdDesc": "Egyptian national ID card (البطاقة الشخصية)",
  "wizard.doc_type.passport": "Passport",
  "wizard.doc_type.passportDesc": "Egyptian or Arabic passport",
  "wizard.doc_type.driverLicense": "Driver License",
  "wizard.doc_type.driverLicenseDesc": "Egyptian driver license",
  "wizard.doc_type.residence": "Residence / Foreigner ID",
  "wizard.doc_type.residenceDesc": "Residence card for foreigners",
  "wizard.doc_type.continue": "Continue to capture",

  // ─── Wizard — doc_capture ─────────────────────────────────────────
  "wizard.doc_capture.captureFront": "Capture front side",
  "wizard.doc_capture.captureBack": "Capture back side",
  "wizard.doc_capture.uploadImage": "Upload image",
  "wizard.doc_capture.camera": "Camera",
  "wizard.doc_capture.upload": "Upload",
  "wizard.doc_capture.retake": "Retake",
  "wizard.doc_capture.tipsTitle": "Tips for a clear capture",
  "wizard.doc_capture.tipsBody": "Place the document on a dark, flat surface in good lighting. Fill the frame with the document and make sure all text is sharp and readable. Avoid glare and shadows.",
  "wizard.doc_capture.readingWithAI": "Reading document with AI…",
  "wizard.doc_capture.processing": "Processing…",

  // ─── Wizard — doc_review ──────────────────────────────────────────
  "wizard.doc_review.reviewDetails": "Review extracted data",
  "wizard.doc_review.fullName": "Name",
  "wizard.doc_review.nationalId": "National ID",
  "wizard.doc_review.birthDate": "Date of birth",
  "wizard.doc_review.gender": "Gender",
  "wizard.doc_review.nationality": "Nationality",
  "wizard.doc_review.confirm": "Confirm and continue",
  "wizard.doc_review.retakePhotos": "Retake photos",
  "wizard.doc_review.noFields": "No fields could be read",
  "wizard.doc_review.enhanceReExtract": "Enhance & re-extract",

  // ─── Wizard — selfie ─────────────────────────────────────────────
  "wizard.selfie.captureSelfie": "Capture a selfie",
  "wizard.selfie.lookAtCamera": "Look at the camera",
  "wizard.selfie.holdStill": "Hold still",

  // ─── Wizard — liveness ───────────────────────────────────────────
  "wizard.liveness.livenessCheck": "Liveness check",
  "wizard.liveness.turnLeft": "Turn left",
  "wizard.liveness.turnRight": "Turn right",
  "wizard.liveness.smile": "Smile",
  "wizard.liveness.blink": "Blink",
  "wizard.liveness.lookUp": "Look up",

  // ─── Wizard — result ─────────────────────────────────────────────
  "wizard.result.verificationComplete": "Verification complete",
  "wizard.result.verified": "Identity Verified",
  "wizard.result.rejected": "Verification Failed",
  "wizard.result.needsReview": "Needs review",
  "wizard.result.score": "Overall verification score",
  "wizard.result.viewCertificate": "View certificate",
  "wizard.result.startNew": "New verification",
  "wizard.result.viewHistory": "View history",
  "wizard.result.downloadReport": "Download report",
  "wizard.result.savingToDatabase": "Saving to database…",
  "wizard.result.savedId": "Saved · ID {id}",
  "wizard.result.notSaved": "Not saved",
  "wizard.result.recordNotSavedTitle": "Record not saved",
  "wizard.result.recordNotSavedBody": "The verification completed but the record could not be saved to the database: {error}",

  // ─── Chatbot ──────────────────────────────────────────────────────
  "chatbot.greeting": "Hi! I'm Cirkle's verification assistant. Ask me about document types, MRZ, liveness, or privacy.",
  "chatbot.placeholder": "Ask about verification, MRZ, liveness…",
  "chatbot.send": "Send",
  "chatbot.clear": "Clear conversation",
  "chatbot.thinking": "Thinking…",
  "chatbot.fallback": "I'm not sure about that. Try asking about document types, MRZ parsing, or liveness checks.",

  // ─── Quality ──────────────────────────────────────────────────────
  "quality.excellent": "Excellent",
  "quality.good": "Good",
  "quality.acceptable": "Acceptable",
  "quality.poor": "Poor",
  "quality.blur": "Blurry",
  "quality.dark": "Too dark",
  "quality.bright": "Too bright",
  "quality.lowContrast": "Low contrast",
  "quality.glare": "Glare detected",
  "quality.skew": "Skewed",

  // ─── Footer ────────────────────────────────────────────────────────
  "footer.tagline": "Cirkle Identity Verification",
  "footer.egyptianId": "Egyptian ID · Passport · License",
  "footer.zeroCost": "Zero-cost · Self-hosted · Privacy-first",
  "footer.privacyFirst": "Privacy-first",

  // ─── Infra ────────────────────────────────────────────────────────
  "infra.providers": "Providers",
  "infra.circuitBreakers": "Circuit breakers",
  "infra.costModel": "Cost model",
  "infra.healthy": "Healthy",
  "infra.degraded": "Degraded",
  "infra.down": "Down",

  // ─── Locale toggle ────────────────────────────────────────────────
  "locale.toggle": "Switch language",
  "locale.english": "English",
  "locale.arabic": "العربية",

  // ─── Verification report (PDF) ────────────────────────────────────
  "report.title": "Identity Verification Report",
  "report.verificationId": "Verification ID",
  "report.issuedAt": "Issued at",
  "report.status": "Status",
  "report.scoreBreakdown": "Score breakdown",
  "report.faceMatch": "Face match",
  "report.liveness": "Liveness",
  "report.ocr": "Document OCR",
  "report.crossField": "Cross-field validation",
  "report.risk": "Risk assessment",
  "report.documentDetails": "Document details",
  "report.aiConsensus": "AI consensus",
  "report.signature": "Cryptographic signature",
  "report.signatureAlgorithm": "Algorithm",
  "report.signatureKey": "Key ID",
  "report.hash": "Content hash (SHA-256)",
  "report.print": "Print",
  "report.downloadPdf": "Download as PDF",
  "report.copyLink": "Copy verification link",
  "report.verifySig": "Verify signature",
  "report.signatureValid": "Signature is valid",
  "report.signatureInvalid": "Signature is INVALID — report may have been tampered with",
  "report.copied": "Link copied to clipboard",
  "report.printHint": "Tip: in the print dialog, choose \"Save as PDF\" as the destination.",
  "report.generatedBy": "Generated by Cirkle self-hosted verification",
  "report.verified": "Verified",
  "report.rejected": "Rejected",
  "report.needsReview": "Needs review",

  // ─── OCR feedback ────────────────────────────────────────────────
  "ocr.feedback.title": "Reading your document…",
  "ocr.feedback.subtitle": "Multi-stage OCR with AI consensus cross-check",
  "ocr.feedback.cancel": "Cancel",
  "ocr.feedback.done": "Done",
  "ocr.feedback.stage.loadingImage": "Loading image",
  "ocr.feedback.stage.preprocessing": "Pre-processing",
  "ocr.feedback.stage.arabicOcr": "Arabic OCR",
  "ocr.feedback.stage.englishOcr": "English OCR",
  "ocr.feedback.stage.mrzParsing": "MRZ parsing",
  "ocr.feedback.stage.crossField": "Cross-field validation",
  "ocr.feedback.stage.done": "Done",
  "ocr.feedback.detected": "Detected",
  "ocr.feedback.noPartialResults": "Working…",
  "ocr.feedback.cancelled": "OCR cancelled",
};

export const ar: Translations = {
  // ─── Nav ────────────────────────────────────────────────────────────
  "nav.verify": "تحقق",
  "nav.history": "السجل",
  "nav.training": "التدريب",
  "nav.specs": "المواصفات",
  "nav.infra": "البنية",
  "nav.lab": "المعمل",
  "nav.apiDocs": "وثائق الـ API",
  "nav.apiDocsDesc": "Swagger UI — استكشف جميع الـ 50+ نقاط النهاية مباشرة",

  // ─── Common ────────────────────────────────────────────────────────
  "common.next": "التالي",
  "common.back": "السابق",
  "common.cancel": "إلغاء",
  "common.save": "حفظ",
  "common.delete": "حذف",
  "common.refresh": "تحديث",
  "common.loading": "جارٍ التحميل…",
  "common.error": "خطأ",
  "common.success": "تم بنجاح",
  "common.retry": "إعادة",
  "common.close": "إغلاق",
  "common.open": "فتح",
  "common.continue": "متابعة",
  "common.confirm": "تأكيد",

  // ─── Wizard — intro ────────────────────────────────────────────────
  "wizard.intro.title": "دواير للتحقق من الهوية",
  "wizard.intro.subtitle": "اقرأ المستندات المصرية والعربية، التقط صورة شخصية حية، وأثبت الحياة من خلال تحديات الحركة. مجاني، مستضاف ذاتيًا، الخصوصية أولًا.",
  "wizard.intro.arabicReadingTitle": "قراءة عربية تعمل بشكل صحيح",
  "wizard.intro.liveFaceTitle": "مطابقة الوجه الحي",
  "wizard.intro.liveMovementTitle": "إثبات الحياة بالحركة",
  "wizard.intro.verifiedRecordTitle": "سجلات قابلة للتحقق",
  "wizard.intro.startButton": "ابدأ التحقق",

  // ─── Wizard — doc_type ────────────────────────────────────────────
  "wizard.doc_type.selectDocType": "اختر نوع المستند",
  "wizard.doc_type.nationalId": "بطاقة الرقم القومي",
  "wizard.doc_type.nationalIdDesc": "البطاقة الشخصية المصرية",
  "wizard.doc_type.passport": "جواز السفر",
  "wizard.doc_type.passportDesc": "جواز سفر مصري أو عربي",
  "wizard.doc_type.driverLicense": "رخصة القيادة",
  "wizard.doc_type.driverLicenseDesc": "رخصة قيادة مصرية",
  "wizard.doc_type.residence": "إقامة / بطاقة أجنبي",
  "wizard.doc_type.residenceDesc": "بطاقة إقامة للأجانب",
  "wizard.doc_type.continue": "متابعة إلى الالتقاط",

  // ─── Wizard — doc_capture ─────────────────────────────────────────
  "wizard.doc_capture.captureFront": "التقط الوجه الأمامي",
  "wizard.doc_capture.captureBack": "التقط الوجه الخلفي",
  "wizard.doc_capture.uploadImage": "رفع صورة",
  "wizard.doc_capture.camera": "الكاميرا",
  "wizard.doc_capture.upload": "رفع",
  "wizard.doc_capture.retake": "إعادة الالتقاط",
  "wizard.doc_capture.tipsTitle": "نصائح لصورة واضحة",
  "wizard.doc_capture.tipsBody": "ضع المستند على سطح داكن ومستوٍ مع إضاءة جيدة. املأ الإطار بالمستند وتأكد من أن كل النص حاد وقابل للقراءة. تجنب الانعكاسات والظلال.",
  "wizard.doc_capture.readingWithAI": "جارٍ قراءة المستند بالذكاء الاصطناعي…",
  "wizard.doc_capture.processing": "جارٍ المعالجة…",

  // ─── Wizard — doc_review ──────────────────────────────────────────
  "wizard.doc_review.reviewDetails": "راجع البيانات المستخرجة",
  "wizard.doc_review.fullName": "الاسم",
  "wizard.doc_review.nationalId": "الرقم القومي",
  "wizard.doc_review.birthDate": "تاريخ الميلاد",
  "wizard.doc_review.gender": "النوع",
  "wizard.doc_review.nationality": "الجنسية",
  "wizard.doc_review.confirm": "تأكيد ومتابعة",
  "wizard.doc_review.retakePhotos": "إعادة التقاط الصور",
  "wizard.doc_review.noFields": "تعذرت قراءة أي بيانات",
  "wizard.doc_review.enhanceReExtract": "تحسين وإعادة استخراج",

  // ─── Wizard — selfie ─────────────────────────────────────────────
  "wizard.selfie.captureSelfie": "التقط صورة شخصية",
  "wizard.selfie.lookAtCamera": "انظر إلى الكاميرا",
  "wizard.selfie.holdStill": "ابقَ ثابتًا",

  // ─── Wizard — liveness ───────────────────────────────────────────
  "wizard.liveness.livenessCheck": "فحص الحياة",
  "wizard.liveness.turnLeft": "أدر لليسار",
  "wizard.liveness.turnRight": "أدر لليمين",
  "wizard.liveness.smile": "ابتسم",
  "wizard.liveness.blink": "ارمش",
  "wizard.liveness.lookUp": "انظر لأعلى",

  // ─── Wizard — result ─────────────────────────────────────────────
  "wizard.result.verificationComplete": "اكتمل التحقق",
  "wizard.result.verified": "تم التحقق من الهوية",
  "wizard.result.rejected": "فشل التحقق",
  "wizard.result.needsReview": "يحتاج إلى مراجعة",
  "wizard.result.score": "النتيجة الإجمالية للتحقق",
  "wizard.result.viewCertificate": "عرض الشهادة",
  "wizard.result.startNew": "تحقق جديد",
  "wizard.result.viewHistory": "عرض السجل",
  "wizard.result.downloadReport": "تنزيل التقرير",
  "wizard.result.savingToDatabase": "جارٍ الحفظ في قاعدة البيانات…",
  "wizard.result.savedId": "تم الحفظ · رقم {id}",
  "wizard.result.notSaved": "لم يُحفظ",
  "wizard.result.recordNotSavedTitle": "لم يُحفظ السجل",
  "wizard.result.recordNotSavedBody": "اكتمل التحقق ولكن تعذر حفظ السجل في قاعدة البيانات: {error}",

  // ─── Chatbot ──────────────────────────────────────────────────────
  "chatbot.greeting": "مرحبًا! أنا مساعد التحقق من دواير. اسألني عن أنواع المستندات، أو الـ MRZ، أو فحص الحياة، أو الخصوصية.",
  "chatbot.placeholder": "اسأل عن التحقق، الـ MRZ، الحياة…",
  "chatbot.send": "إرسال",
  "chatbot.clear": "مسح المحادثة",
  "chatbot.thinking": "يفكّر…",
  "chatbot.fallback": "لست متأكدًا من ذلك. جرّب السؤال عن أنواع المستندات، أو تحليل الـ MRZ، أو فحوصات الحياة.",

  // ─── Quality ──────────────────────────────────────────────────────
  "quality.excellent": "ممتاز",
  "quality.good": "جيد",
  "quality.acceptable": "مقبول",
  "quality.poor": "ضعيف",
  "quality.blur": "ضبابي",
  "quality.dark": "مظلم جدًا",
  "quality.bright": "ساطع جدًا",
  "quality.lowContrast": "تباين منخفض",
  "quality.glare": "انعكاسات",
  "quality.skew": "مائل",

  // ─── Footer ────────────────────────────────────────────────────────
  "footer.tagline": "دواير للتحقق من الهوية",
  "footer.egyptianId": "بطاقة رقم قومي · جواز سفر · رخصة",
  "footer.zeroCost": "مجاني · مستضاف ذاتيًا · الخصوصية أولًا",
  "footer.privacyFirst": "الخصوصية أولًا",

  // ─── Infra ────────────────────────────────────────────────────────
  "infra.providers": "المزودون",
  "infra.circuitBreakers": "قواطع الدائرة",
  "infra.costModel": "نموذج التكلفة",
  "infra.healthy": "سليم",
  "infra.degraded": "متدهور",
  "infra.down": "متوقف",

  // ─── Locale toggle ────────────────────────────────────────────────
  "locale.toggle": "تبديل اللغة",
  "locale.english": "English",
  "locale.arabic": "العربية",

  // ─── Verification report (PDF) ────────────────────────────────────
  "report.title": "تقرير التحقق من الهوية",
  "report.verificationId": "رقم التحقق",
  "report.issuedAt": "تاريخ الإصدار",
  "report.status": "الحالة",
  "report.scoreBreakdown": "تفصيل النتائج",
  "report.faceMatch": "مطابقة الوجه",
  "report.liveness": "فحص الحياة",
  "report.ocr": "قراءة المستند",
  "report.crossField": "التحقق المتقاطع",
  "report.risk": "تقييم المخاطر",
  "report.documentDetails": "تفاصيل المستند",
  "report.aiConsensus": "إجماع الذكاء الاصطناعي",
  "report.signature": "التوقيع الرقمي",
  "report.signatureAlgorithm": "الخوارزمية",
  "report.signatureKey": "معرف المفتاح",
  "report.hash": "بصمة المحتوى (SHA-256)",
  "report.print": "طباعة",
  "report.downloadPdf": "تنزيل PDF",
  "report.copyLink": "نسخ رابط التحقق",
  "report.verifySig": "تحقق من التوقيع",
  "report.signatureValid": "التوقيع صحيح",
  "report.signatureInvalid": "التوقيع غير صالح — قد يكون التقرير معدّلًا",
  "report.copied": "تم نسخ الرابط إلى الحافظة",
  "report.printHint": "نصيحة: في نافذة الطباعة، اختر \"حفظ بصيغة PDF\" كوجهة.",
  "report.generatedBy": "أُنشئ بواسطة نظام التحقق الذاتي المستضاف من دواير",
  "report.verified": "موثّق",
  "report.rejected": "مرفوض",
  "report.needsReview": "يحتاج إلى مراجعة",

  // ─── OCR feedback ────────────────────────────────────────────────
  "ocr.feedback.title": "جارٍ قراءة مستندك…",
  "ocr.feedback.subtitle": "OCR متعدد المراحل مع تحقق متبادل بالذكاء الاصطناعي",
  "ocr.feedback.cancel": "إلغاء",
  "ocr.feedback.done": "تم",
  "ocr.feedback.stage.loadingImage": "تحميل الصورة",
  "ocr.feedback.stage.preprocessing": "المعالجة الأولية",
  "ocr.feedback.stage.arabicOcr": "OCR عربي",
  "ocr.feedback.stage.englishOcr": "OCR إنجليزي",
  "ocr.feedback.stage.mrzParsing": "تحليل MRZ",
  "ocr.feedback.stage.crossField": "التحقق المتقاطع",
  "ocr.feedback.stage.done": "تم",
  "ocr.feedback.detected": "تم اكتشاف",
  "ocr.feedback.noPartialResults": "جارٍ العمل…",
  "ocr.feedback.cancelled": "ألغي الـ OCR",
};

/** Dictionary map: locale → translations. */
export const TRANSLATIONS: Record<Locale, Translations> = { en, ar };

/** Interpolate `{var}` placeholders in a translation string. */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    return v === undefined || v === null ? m : String(v);
  });
}

/** Default locale used before client-side hydration. */
export const DEFAULT_LOCALE: Locale = "en";

/** localStorage key for the persisted locale. */
export const LOCALE_STORAGE_KEY = "cirkle-locale";
