-- Cirkle Identity Verification — Turso backup
-- Generated: 2026-09-11T22:35:43.437Z
-- Source: libsql://cirkle-fortleem.aws-us-east-1.turso.io

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

-- Table: Verification (1 rows)
DELETE FROM Verification;
INSERT INTO Verification (id, docType, docSide, docImageFront, docImageBack, fullNameAr, fullNameEn, nationalId, birthDate, address, gender, documentNo, expiryDate, nationality, job, religion, maritalStatus, extraFields, imageQuality, fieldConfidence, selfieImage, livenessFrames, livenessActions, docConfidence, faceMatchScore, livenessScore, status, notes, createdAt, updatedAt) VALUES ('cirkle_test_1789163470375', 'national_id', 'both', '[object Object]', '[object Object]', 'أحمد محمد عبد الرحمن السيد', 'Ahmed Mohamed', '29001011234567', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.88', '[object Object]', '[object Object]', '[object Object]', '[object Object]', '0.85', '0.9', '0.78', 'verified', '[object Object]', '2026-09-11 21:51:10', '2026-09-11 21:51:10');

-- Table: DocumentSample (0 rows)
DELETE FROM DocumentSample;

-- Table: EvaluationRun (0 rows)
DELETE FROM EvaluationRun;

-- Table: EvaluationResult (0 rows)
DELETE FROM EvaluationResult;

COMMIT;