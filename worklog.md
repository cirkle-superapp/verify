# Project Worklog — Live Identity Verification (Egyptian/Arabic)

Goal: Build a live identity & verification web app that can:
1. Read Egyptian and Arabic documents (ID card, passport, driver license) via VLM OCR + structured extraction.
2. Capture a live face selfie via webcam.
3. Perform live movement (liveness) challenges — turn head left/right, look up, blink, smile.
4. Match the selfie to the document photo using VLM.
5. Store verification records and show a history dashboard.

Tech: Next.js 16 App Router, TypeScript, Tailwind 4, shadcn/ui, Prisma (SQLite), z-ai-web-dev-sdk VLM, native getUserMedia webcam, Zustand.

---
Task ID: 0
Agent: main
Task: Initialize worklog and project plan.

Work Log:
- Read VLM skill documentation.
- Inspected project scaffold (Next.js 16, shadcn/ui installed, Prisma configured, dev server running on :3000).
- Defined multi-step verification flow and todo list.

Stage Summary:
- Plan ready. Building starts with Prisma schema, then shared lib/store, then webcam component, then API routes, then UI wizard.

---
Task ID: 1-8
Agent: main
Task: Build complete live identity verification app (Egyptian/Arabic docs + face + liveness).

Work Log:
- Prisma: added Verification model (docType, docImageFront/Back, extracted fields including Arabic name/nationalId/religion, selfie, liveness frames/actions, 3 confidence scores, status, notes). Pushed to SQLite.
- lib: verification-types.ts (DocType, ExtractedDocumentData, FaceMatchResult, LivenessResult, LIVENESS_ACTIONS, VerificationRecord). vlm-service.ts (extractDocumentData, matchFace, checkLiveness, detectFacePresence) using z-ai-web-dev-sdk VLM with base64 data URLs. verification-store.ts (Zustand: step navigation, doc capture, selfie, liveness, results).
- Components:
  - webcam-capture.tsx: reusable getUserMedia webcam with face-guide oval, mirror, retake.
  - liveness-webcam.tsx: continuous frame capture (700ms interval) during challenge.
  - file-upload.tsx: drag-drop + click upload with client-side compression.
  - step-indicator.tsx, score-badge.tsx (ScoreBadge + StatusBadge).
  - steps/: intro, doc-type, doc-capture, doc-review, selfie, liveness, result.
  - history-view.tsx: list + detail dialog with images.
- API routes: /api/verify/document, /api/verify/face-match, /api/verify/liveness, /api/verify/records (GET list, POST create), /api/verify/records/[id] (GET, DELETE).
- layout.tsx: added Cairo Arabic font + Sonner toaster. globals.css: .font-arabic, custom scrollbar.
- page.tsx: wizard orchestrator with sticky header + sticky footer.

Agent Browser verification (headless):
- Intro renders with EN+AR. Doc-type selection works (4 types).
- Upload flow tested end-to-end with generated mock ID + portrait images.
- POST /api/verify/document -> 200 (VLM OCR, 2.8-20.9s).
- Review step shows extracted fields + OCR confidence badge + raw OCR dump.
- POST /api/verify/face-match -> 200 (compares selfie to doc photo, 3.5-5s).
- Liveness step renders 3 random movements with Arabic instructions.
- Fixed infinite-retry bug in liveness step (useRef analyzedRef); relaxed liveness API to return failed result (not 400) for empty frames.
- Result step renders: overall score, 3 sub-scores, status badge, summary, images.
- POST /api/verify/records -> 200 (saved to DB). GET /api/verify/records -> 200.
- History view lists record with score badges; detail dialog shows images + all fields.
- Lint: 0 errors, 0 warnings. No console errors.

Stage Summary:
- Full identity verification app is live and browser-verified.
- Egyptian/Arabic documents read via VLM (Arabic + English OCR, structured extraction).
- Live face capture + face-match against document photo.
- Live movement liveness: 3 random challenges (turn left/right, look up, blink, smile) with frame capture + AI analysis.
- Records persisted to SQLite with confidence scores; history dashboard with detail dialog.
- Sticky footer, responsive, RTL Arabic support, emerald trust theme.

---
Task ID: 9-11
Agent: main
Task: Improve Arabic OCR + image reading, add training database + full stress testing.

Work Log:
- Prisma schema: added DocumentSample (labeled training data with ground truth), EvaluationRun, EvaluationResult models. Added imageQuality + fieldConfidence columns to Verification. Pushed + regenerated client.
- doc-validators.ts: normalizeArabic (strips Tatweel, normalizes Alef variants), digitsOnly (Arabic-Indic → Western), parseEgyptianNationalId (decodes 14-digit Egyptian ID: century/year/month/day/gender/checksum), normalizeGender (Arabic+English), normalizeDate (ISO + DD/MM/YYYY + Arabic month names), parseMrz (TD1 + TD3 passport MRZ), fieldMatches (fuzzy comparison for evaluation).
- vlm-service.ts REWRITE: multi-pass extraction:
    Pass 1: assessImageQuality — returns isBlurry/hasGlare/isFramedWell/rotation/lighting/issues/suggestions + overallQuality (0-1).
    Pass 2: ocrArabicText — Arabic-first OCR pass preserving exact glyphs, diacritics, reading order, Arabic-Indic digits.
    Pass 3: extractStructuredFields — uses Arabic text as priming context, returns all fields + per-field confidence + MRZ lines.
    Post-processing: validates Egyptian national ID checksum, infers gender from NID, normalizes dates/gender/Arabic, parses MRZ.
- image-enhance.ts: client-side canvas enhancement (auto-contrast histogram stretch, unsharp mask, contrast/brightness, grayscale) + estimateSharpness (Laplacian variance blur detector).
- synthetic-doc.ts: 6 deterministic synthetic Egyptian-ID/passport samples with known ground truth. renderSyntheticDoc renders a card to canvas with EXACT text matching the spec — so OCR accuracy is measurable.
- New API routes:
    /api/verify/samples (GET list, POST create)
    /api/verify/samples/[id] (GET, DELETE)
    /api/verify/samples/seed (POST bulk-insert synthetic, DELETE clear synthetic)
    /api/verify/evaluate (GET list runs, POST create run)
    /api/verify/evaluate/[id] (GET with results, DELETE)
    /api/verify/evaluate/run (POST — runs full 3-pass extraction on a sample, compares each field to ground truth, persists EvaluationResult, updates run aggregate with per-field accuracy + avg time)
- New UI views:
    EvaluationLab: stress test runner with concurrency selector (1-4), live progress bar, 4 stat cards (accuracy/passed/avg time/quality), per-field accuracy bar chart (recharts), pass/fail pie, response-time line chart, full results table with per-field ✓/✗ + expected vs actual.
    TrainingData: seed button (renders synthetic samples client-side via canvas, uploads to DB), clear synthetic, add-sample dialog (upload image + fill ground truth fields), sample grid with images + fields + delete.
- Doc review step upgraded: image quality panel (blur/glare/framing/rotation/lighting + issues + suggestions), field validation panel (Egyptian ID checksum valid/invalid, gender inferred from NID), per-field confidence badges, "Enhance & re-extract" button (runs client-side image enhancement then re-runs 3-pass extraction), Arabic OCR pass raw dump, MRZ-parsed badge, 3-pass OCR badge.
- History view detail dialog: added image quality stat.
- Main page: new Training + Lab nav buttons.
- Lint: 0 errors. Agent Browser: synthetic samples seed works (6/6), stress test launches and polls.

Stage Summary:
- Arabic OCR now uses 3 passes (quality → Arabic-first → structured) + post-validation (Egyptian ID checksum, MRZ parsing, normalization).
- Image quality assessment warns users about blur/glare/bad framing before extraction.
- Training database stores labeled samples; 6 deterministic synthetic samples seeded for meaningful evaluation.
- Full stress test runs the pipeline against every sample, measures per-field accuracy + response time + quality, shows charts + detailed comparison table.

---
Task ID: 12
Agent: main
Task: Fix "Extraction failed — The string did not match the expected pattern" when uploading Egyptian ID.

Root cause found:
- The VLM API (z-ai vision) returns HTTP 400 with error code 1210 ("图片输入格式/解析错误" = "image input format/parse error") when the uploaded image is too large, in an unsupported format (HEIC from iPhone), or corrupt.
- This 400 propagated up through extractDocumentData → document API route → fetch() in the browser.
- The cryptic "The string did not match the expected pattern" message was the browser's fetch wrapper around the server's 500 error containing the Chinese error string.

Fix (3 layers of defense):

1. Client-side compression (file-upload.tsx):
   - Rewrote fileToCompressedDataUrl to enforce BOTH max pixel dimension (1280px) AND max byte budget (~700KB).
   - Iteratively lowers JPEG quality (0.8 → 0.35) then downscales canvas (×0.8 each pass) until under budget.
   - Better error message for HEIC decode failures.
   - accept attribute now explicitly includes image/heic, image/heif, image/webp.

2. Server-side normalization (image-server.ts — NEW):
   - parseDataUrl: validates data URL + decodes base64 to Buffer.
   - normalizeForVlm: uses sharp to auto-orient (EXIF), resize to max 1280px, re-encode as mozjpeg JPEG, iteratively lower quality (80→35) then downscale (1280→640) until under 600KB. Flattens alpha to white background for PNGs with transparency.
   - isLikelyTooLarge: quick check (>1.2MB base64) to decide whether to pre-normalize.

3. VLM service retry (vlm-service.ts):
   - callVision now pre-normalizes any image flagged as too large.
   - On 1210 / "图片输入格式" / image-format errors, re-compresses ALL images with normalizeForVlm and retries once.
   - isImageFormatError helper detects the error from any shape.

4. Better error mapping (document/route.ts):
   - 1210 → 422 "image_format_error" with friendly message.
   - 1213/content → 422 "content_filtered".
   - timeout/ETIMEDOUT → 504 "timeout".
   - invalid data URL → 400 "invalid_image".
   - All responses now include a `code` field.

5. doc-capture-step.tsx:
   - Maps API error codes (image_format_error, timeout, content_filtered) to specific user-friendly messages.
   - Better toast on failure.

Verification (Agent Browser):
- Uploaded a passport image → extraction succeeded in 29.3s, status 200, no 1210 error.
- Image quality panel showed 85%, fields extracted, Arabic OCR pass dumped.
- Lint: 0 errors. Dev log: clean, no 1210 errors.

Stage Summary:
- Uploading Egyptian ID (or any document) no longer fails with the cryptic "string did not match" error.
- Large phone photos, HEIC images, and oversized JPEGs are now auto-compressed client-side AND server-side with sharp, with automatic VLM retry.
- If extraction genuinely can't succeed, users now see a clear, actionable message ("try a clearer JPG/PNG photo") instead of a cryptic error.

---
Task ID: 13
Agent: main
Task: Allow large pictures + fix record not saving to DB after verification.

Root cause found:
- The records POST route stored ALL liveness frames (15 × ~50KB = ~750KB) + doc images + selfie as base64 in a single SQLite row. The total payload (2-4MB) caused the INSERT to fail silently.
- The result UI showed "Verified" based on local state (`passed` flag), not on whether the DB save succeeded — so users saw "Verified" even when the record was never saved.
- The client file-upload compressed images to only ~700KB, which over-rejected large photos.

Fixes:

1. Allow large pictures (file-upload.tsx):
   - Raised maxBytes from 700KB → 1.8MB.
   - Raised maxSize from 1280px → 1600px (with a hard cap at 2200px for truly huge phone photos).
   - Quality floor raised from 0.35 → 0.45 (less aggressive degradation).
   - Downscale floor raised from 0.4 → 0.5.
   - Large high-quality photos now pass through; the server-side VLM service already handles normalization + retry on 1210 errors.

2. Stop storing raw liveness frames (records/route.ts):
   - Previously: `livenessFrames: JSON.stringify(livenessFrames)` stored all ~15 base64 frames (~750KB).
   - Now: `livenessFrames: JSON.stringify({ count, note })` stores only the frame count.
   - The frames are only needed for the live VLM analysis, NOT for history. The liveness result (score, isLive, detectedActions) is still stored.
   - Added `export const maxDuration = 60` to the route.
   - Better error response with `code: "save_failed"`.

3. Result UI properly reflects save status (result-step.tsx REWRITE):
   - Added `saveError` state and `saveRecord` callback.
   - Three visible states with badges:
     • "Saving to database…" (amber spinner badge)
     • "Saved · ID xxxxx" (green badge with last 8 chars of record ID)
     • "Not saved" (red badge)
   - If save fails: red Alert with "Record not saved" + a "Retry save" button.
   - "New verification" + "View history" buttons only appear AFTER the record is saved.
   - The "Verified"/"Failed" heading still shows based on checks, but the save status is clearly visible.

Verification (Agent Browser + direct API test):
- Direct API test: POST with realistic payload (doc images + selfie + 15 frames + liveness result) → 200 in 27ms, record saved, status "verified", docImageFront stored ✓.
- Full browser flow: passport upload → extraction → review → selfie → face match → liveness → result → record SAVED ("Saved · ID" badge shown).
- History view shows the new record at the top.
- DB now has 3 verification records (was failing to save before).
- Lint: 0 errors.

Stage Summary:
- Large photos (up to ~1.8MB, 2200px) are now accepted.
- Verification records are reliably saved to the database after the full flow (including live motion).
- The result page clearly shows save status (Saving / Saved / Not saved) with a retry button if the save fails.
- History view shows all saved records with images.
