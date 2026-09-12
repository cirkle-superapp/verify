-- Cirkle Identity Verification — Turso backup
-- Generated: 2026-09-11T22:37:14.561Z
-- Source: libsql://validate-fortleem.aws-us-east-2.turso.io

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Table: Verification (1 rows)
DELETE FROM Verification;
INSERT INTO Verification (id, docType, docSide, docImageFront, docImageBack, fullNameAr, fullNameEn, nationalId, birthDate, address, gender, documentNo, expiryDate, nationality, job, religion, maritalStatus, extraFields, imageQuality, fieldConfidence, selfieImage, livenessFrames, livenessActions, docConfidence, faceMatchScore, livenessScore, status, notes, createdAt, updatedAt) VALUES ('test_1789161164967', 'national_id', 'both', '[object Object]', '[object Object]', 'أحمد محمد عبد الرحمن السيد', 'Ahmed Mohamed', '29001011234567', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.88', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.85', '0.9', '0.78', 'verified', '[object Object]', '2026-09-11 21:12:45', '2026-09-11 21:12:45');

-- Table: DocumentSample (0 rows)
DELETE FROM DocumentSample;

-- Table: EvaluationRun (0 rows)
DELETE FROM EvaluationRun;

-- Table: EvaluationResult (0 rows)
DELETE FROM EvaluationResult;

COMMIT;