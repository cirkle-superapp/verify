/**
 * Central Database Schema (Neon PostgreSQL)
 *
 * Managed by: centralDb (drizzle-orm/neon-http)
 * Used for: permanent verification records, audit logs, billing,
 *           evaluation runs, evaluation results — relational data
 *           that benefits from PostgreSQL's ACID guarantees.
 *
 * Tables mirror the edge (Turso) schema but use PostgreSQL-native types.
 */

import { pgTable, pgSchema, text, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

// ─── Verification (permanent record) ────────────────────────────────
export const verifications = pgTable("Verification", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── DocumentSample (training data) ────────────────────────────────
export const documentSamples = pgTable("DocumentSample", {
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

// ─── EvaluationRun ─────────────────────────────────────────────────
export const evaluationRuns = pgTable("EvaluationRun", {
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
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

// ─── EvaluationResult ──────────────────────────────────────────────
export const evaluationResults = pgTable("EvaluationResult", {
  id: text("id").primaryKey().notNull(),
  runId: text("runId").notNull().references(() => evaluationRuns.id, { onDelete: "cascade" }),
  sampleId: text("sampleId"),
  sampleName: text("sampleName"),
  docType: text("docType").notNull(),
  expectedNameAr: text("expectedNameAr"),
  actualNameAr: text("actualNameAr"),
  nameArCorrect: boolean("nameArCorrect").default(false).notNull(),
  expectedNameEn: text("expectedNameEn"),
  actualNameEn: text("actualNameEn"),
  nameEnCorrect: boolean("nameEnCorrect").default(false).notNull(),
  expectedNationalId: text("expectedNationalId"),
  actualNationalId: text("actualNationalId"),
  nationalIdCorrect: boolean("nationalIdCorrect").default(false).notNull(),
  expectedDocumentNo: text("expectedDocumentNo"),
  actualDocumentNo: text("actualDocumentNo"),
  documentNoCorrect: boolean("documentNoCorrect").default(false).notNull(),
  expectedBirthDate: text("expectedBirthDate"),
  actualBirthDate: text("actualBirthDate"),
  birthDateCorrect: boolean("birthDateCorrect").default(false).notNull(),
  expectedGender: text("expectedGender"),
  actualGender: text("actualGender"),
  genderCorrect: boolean("genderCorrect").default(false).notNull(),
  expectedExpiry: text("expectedExpiry"),
  actualExpiry: text("actualExpiry"),
  expiryCorrect: boolean("expiryCorrect").default(false).notNull(),
  responseTimeMs: integer("responseTimeMs").default(0).notNull(),
  confidence: real("confidence").default(0).notNull(),
  imageQuality: real("imageQuality").default(0).notNull(),
  fieldsTotal: integer("fieldsTotal").default(0).notNull(),
  fieldsCorrect: integer("fieldsCorrect").default(0).notNull(),
  passed: boolean("passed").default(false).notNull(),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// ─── AuditLog (central-only — permanent audit trail) ───────────────
export const auditLogs = pgTable("AuditLog", {
  id: text("id").primaryKey().notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  eventType: text("eventType").notNull(),
  ip: text("ip"),
  success: boolean("success").notNull(),
  durationMs: integer("durationMs"),
  docType: text("docType"),
  recordId: text("recordId"),
  country: text("country"),
  error: text("error"),
  metadata: jsonb("metadata"),
});
