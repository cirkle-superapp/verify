-- Cirkle Identity Verification — Turso schema
-- Apply with: turso db shell identity-fortleem < prisma/schema.sql
-- Or via libsql client once you have a valid token.

CREATE TABLE IF NOT EXISTS Verification (
  id TEXT PRIMARY KEY NOT NULL,
  docType TEXT NOT NULL,
  docSide TEXT NOT NULL DEFAULT 'front',
  docImageFront TEXT,
  docImageBack TEXT,
  fullNameAr TEXT,
  fullNameEn TEXT,
  nationalId TEXT,
  birthDate TEXT,
  address TEXT,
  gender TEXT,
  documentNo TEXT,
  expiryDate TEXT,
  nationality TEXT,
  job TEXT,
  religion TEXT,
  maritalStatus TEXT,
  extraFields TEXT,
  imageQuality REAL NOT NULL DEFAULT 0,
  fieldConfidence TEXT,
  selfieImage TEXT,
  livenessFrames TEXT,
  livenessActions TEXT,
  docConfidence REAL NOT NULL DEFAULT 0,
  faceMatchScore REAL NOT NULL DEFAULT 0,
  livenessScore REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS DocumentSample (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  docType TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  imageData TEXT NOT NULL,
  backImageData TEXT,
  fullNameAr TEXT,
  fullNameEn TEXT,
  nationalId TEXT,
  birthDate TEXT,
  address TEXT,
  gender TEXT,
  documentNo TEXT,
  expiryDate TEXT,
  nationality TEXT,
  job TEXT,
  religion TEXT,
  maritalStatus TEXT,
  notes TEXT,
  tags TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS EvaluationRun (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  totalSamples INTEGER NOT NULL DEFAULT 0,
  completedSamples INTEGER NOT NULL DEFAULT 0,
  passedSamples INTEGER NOT NULL DEFAULT 0,
  avgDocTimeMs REAL NOT NULL DEFAULT 0,
  avgQualityScore REAL NOT NULL DEFAULT 0,
  overallAccuracy REAL NOT NULL DEFAULT 0,
  fieldAccuracy TEXT,
  concurrency INTEGER NOT NULL DEFAULT 1,
  startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completedAt DATETIME
);

CREATE TABLE IF NOT EXISTS EvaluationResult (
  id TEXT PRIMARY KEY NOT NULL,
  runId TEXT NOT NULL,
  sampleId TEXT,
  sampleName TEXT,
  docType TEXT NOT NULL,
  expectedNameAr TEXT,
  actualNameAr TEXT,
  nameArCorrect INTEGER NOT NULL DEFAULT 0,
  expectedNameEn TEXT,
  actualNameEn TEXT,
  nameEnCorrect INTEGER NOT NULL DEFAULT 0,
  expectedNationalId TEXT,
  actualNationalId TEXT,
  nationalIdCorrect INTEGER NOT NULL DEFAULT 0,
  expectedDocumentNo TEXT,
  actualDocumentNo TEXT,
  documentNoCorrect INTEGER NOT NULL DEFAULT 0,
  expectedBirthDate TEXT,
  actualBirthDate TEXT,
  birthDateCorrect INTEGER NOT NULL DEFAULT 0,
  expectedGender TEXT,
  actualGender TEXT,
  genderCorrect INTEGER NOT NULL DEFAULT 0,
  expectedExpiry TEXT,
  actualExpiry TEXT,
  expiryCorrect INTEGER NOT NULL DEFAULT 0,
  responseTimeMs INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0,
  imageQuality REAL NOT NULL DEFAULT 0,
  fieldsTotal INTEGER NOT NULL DEFAULT 0,
  fieldsCorrect INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (runId) REFERENCES EvaluationRun(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_verification_createdAt ON Verification(createdAt);
CREATE INDEX IF NOT EXISTS idx_sample_source ON DocumentSample(source);
CREATE INDEX IF NOT EXISTS idx_evalrun_status ON EvaluationRun(status);
CREATE INDEX IF NOT EXISTS idx_evalresult_runId ON EvaluationResult(runId);
