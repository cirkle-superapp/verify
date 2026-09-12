/**
 * Edge Database Schema (Turso libSQL)
 *
 * Managed by: edgeDb (drizzle-orm/libsql)
 * Used for: edge-cached verification reads, document specs, session data,
 *           low-latency API routes that need global edge proximity.
 *
 * Schema mirrors the central (Neon) tables for read redundancy.
 */

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// ─── Verification (edge cache copy) ────────────────────────────────
export const edgeVerifications = sqliteTable("Verification", {
  id: text("id").primaryKey().notNull(),
  docType: text("docType").notNull(),
  docSide: text("docSide").default("front").notNull(),
  docImageFront: text("docImageFront"),
  docImageBack: text("docImageBack"),
  fullNameAr: text("fullNameAr"),
  fullNameEn: text("fullNameEn"),
  nationalId: text("nationalId"),
  birthDate: text("birthDate"),
  address: text("address"),
  gender: text("gender"),
  documentNo: text("documentNo"),
  expiryDate: text("expiryDate"),
  nationality: text("nationality"),
  job: text("job"),
  religion: text("religion"),
  maritalStatus: text("maritalStatus"),
  extraFields: text("extraFields"),
  imageQuality: real("imageQuality").default(0).notNull(),
  fieldConfidence: text("fieldConfidence"),
  selfieImage: text("selfieImage"),
  livenessFrames: text("livenessFrames"),
  livenessActions: text("livenessActions"),
  docConfidence: real("docConfidence").default(0).notNull(),
  faceMatchScore: real("faceMatchScore").default(0).notNull(),
  livenessScore: real("livenessScore").default(0).notNull(),
  status: text("status").default("pending").notNull(),
  notes: text("notes"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

// ─── DocumentSample (training data — edge read) ──────────────────
export const edgeDocumentSamples = sqliteTable("DocumentSample", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  docType: text("docType").notNull(),
  source: text("source").default("manual").notNull(),
  imageData: text("imageData").notNull(),
  backImageData: text("backImageData"),
  fullNameAr: text("fullNameAr"),
  fullNameEn: text("fullNameEn"),
  nationalId: text("nationalId"),
  birthDate: text("birthDate"),
  address: text("address"),
  gender: text("gender"),
  documentNo: text("documentNo"),
  expiryDate: text("expiryDate"),
  nationality: text("nationality"),
  job: text("job"),
  religion: text("religion"),
  maritalStatus: text("maritalStatus"),
  notes: text("notes"),
  tags: text("tags"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

// ─── EvaluationRun (edge read) ─────────────────────────────────────
export const edgeEvaluationRuns = sqliteTable("EvaluationRun", {
  id: text("id").primaryKey().notNull(),
  name: text("name"),
  status: text("status").default("running").notNull(),
  totalSamples: integer("totalSamples").default(0).notNull(),
  completedSamples: integer("completedSamples").default(0).notNull(),
  passedSamples: integer("passedSamples").default(0).notNull(),
  avgDocTimeMs: real("avgDocTimeMs").default(0).notNull(),
  avgQualityScore: real("avgQualityScore").default(0).notNull(),
  overallAccuracy: real("overallAccuracy").default(0).notNull(),
  fieldAccuracy: text("fieldAccuracy"),
  concurrency: integer("concurrency").default(1).notNull(),
  startedAt: text("startedAt").notNull(),
  completedAt: text("completedAt"),
});

// ─── EvaluationResult (edge read) ──────────────────────────────────
export const edgeEvaluationResults = sqliteTable("EvaluationResult", {
  id: text("id").primaryKey().notNull(),
  runId: text("runId").notNull(),
  sampleId: text("sampleId"),
  sampleName: text("sampleName"),
  docType: text("docType").notNull(),
  expectedNameAr: text("expectedNameAr"),
  actualNameAr: text("actualNameAr"),
  nameArCorrect: integer("nameArCorrect").default(0).notNull(),
  expectedNameEn: text("expectedNameEn"),
  actualNameEn: text("actualNameEn"),
  nameEnCorrect: integer("nameEnCorrect").default(0).notNull(),
  expectedNationalId: text("expectedNationalId"),
  actualNationalId: text("actualNationalId"),
  nationalIdCorrect: integer("nationalIdCorrect").default(0).notNull(),
  expectedDocumentNo: text("expectedDocumentNo"),
  actualDocumentNo: text("actualDocumentNo"),
  documentNoCorrect: integer("documentNoCorrect").default(0).notNull(),
  expectedBirthDate: text("expectedBirthDate"),
  actualBirthDate: text("actualBirthDate"),
  birthDateCorrect: integer("birthDateCorrect").default(0).notNull(),
  expectedGender: text("expectedGender"),
  actualGender: text("actualGender"),
  genderCorrect: integer("genderCorrect").default(0).notNull(),
  expectedExpiry: text("expectedExpiry"),
  actualExpiry: text("actualExpiry"),
  expiryCorrect: integer("expiryCorrect").default(0).notNull(),
  responseTimeMs: integer("responseTimeMs").default(0).notNull(),
  confidence: real("confidence").default(0).notNull(),
  imageQuality: real("imageQuality").default(0).notNull(),
  fieldsTotal: integer("fieldsTotal").default(0).notNull(),
  fieldsCorrect: integer("fieldsCorrect").default(0).notNull(),
  passed: integer("passed").default(0).notNull(),
  error: text("error"),
  createdAt: text("createdAt").notNull(),
});
