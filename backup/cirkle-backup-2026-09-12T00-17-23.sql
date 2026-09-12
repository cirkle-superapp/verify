-- Cirkle Identity Verification — Turso backup
-- Generated: 2026-09-12T00:17:21.334Z
-- Source: libsql://validate-fortleem.aws-us-east-2.turso.io

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Table: Verification (3 rows)
DELETE FROM Verification;
INSERT INTO Verification (id, docType, docSide, docImageFront, docImageBack, fullNameAr, fullNameEn, nationalId, birthDate, address, gender, documentNo, expiryDate, nationality, job, religion, maritalStatus, extraFields, imageQuality, fieldConfidence, selfieImage, livenessFrames, livenessActions, docConfidence, faceMatchScore, livenessScore, status, notes, createdAt, updatedAt) VALUES ('test_1789161164967', 'national_id', 'both', '[object Object]', '[object Object]', 'أحمد محمد عبد الرحمن السيد', 'Ahmed Mohamed', '29001011234567', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.88', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.85', '0.9', '0.78', 'verified', '[object Object]', '2026-09-11 21:12:45', '2026-09-11 21:12:45');
INSERT INTO Verification (id, docType, docSide, docImageFront, docImageBack, fullNameAr, fullNameEn, nationalId, birthDate, address, gender, documentNo, expiryDate, nationality, job, religion, maritalStatus, extraFields, imageQuality, fieldConfidence, selfieImage, livenessFrames, livenessActions, docConfidence, faceMatchScore, livenessScore, status, notes, createdAt, updatedAt) VALUES ('verify_1789166236243', 'national_id', 'both', '[object Object]', '[object Object]', 'محمد صلاح محمد التونسي سليمان', 'Mohamed Salah Mohamed Eltunsi Suleiman', '29312272700019', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.88', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.85', '0.9', '0.78', 'verified', '[object Object]', '2026-09-11 22:37:17', '2026-09-11 22:37:17');
INSERT INTO Verification (id, docType, docSide, docImageFront, docImageBack, fullNameAr, fullNameEn, nationalId, birthDate, address, gender, documentNo, expiryDate, nationality, job, religion, maritalStatus, extraFields, imageQuality, fieldConfidence, selfieImage, livenessFrames, livenessActions, docConfidence, faceMatchScore, livenessScore, status, notes, createdAt, updatedAt) VALUES ('cmtxk5lgpnp7lz3qe', 'national_id', 'front', '[object Object]', '[object Object]', 'اختبار الإنتاج', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0', '[object Object]', '[object Object]', '{"count":0,"note":"frames analyzed live, not persisted"}', '[object Object]', '0.9', '85', '80', 'verified', '[object Object]', '2026-09-11T22:58:55.081Z', '2026-09-11T22:58:55.082Z');

-- Table: DocumentSample (0 rows)
DELETE FROM DocumentSample;

-- Table: EvaluationRun (0 rows)
DELETE FROM EvaluationRun;

-- Table: EvaluationResult (0 rows)
DELETE FROM EvaluationResult;

COMMIT;