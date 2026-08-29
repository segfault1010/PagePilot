import { z } from "zod";
import {
  AUDIT_CATEGORIES,
  auditCategorySchema,
  scoreConfidenceSchema,
  severitySchema,
  signalStatusSchema,
} from "./audit-types.js";
import {
  AUDIT_ENGINE_SCORING_VERSION,
  findingTypeSchema,
} from "./database-types.js";

/**
 * Version constant for the diff contract schema.
 */
export const DIFF_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Thresholds for meaningful regressions:
 * - Overall score drop >= 10 points is a meaningful overall regression.
 * - Category score drop >= 15 points is a meaningful category regression.
 */
export const MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD = 10 as const;
export const MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD = 15 as const;

/**
 * Score change direction for overall score or individual category scores.
 */
export const scoreDirectionSchema = z.enum([
  "improved",
  "regressed",
  "unchanged",
]);
export type ScoreDirection = z.infer<typeof scoreDirectionSchema>;

/**
 * Severity movement direction between low (1), medium (2), and high (3).
 */
export const severityChangeDirectionSchema = z.enum([
  "increased",
  "decreased",
  "unchanged",
]);
export type SeverityChangeDirection = z.infer<
  typeof severityChangeDirectionSchema
>;

/**
 * Signal-level transition type.
 * Note: transitions to/from unknown are neutral evidence states and are never
 * classified as regressions.
 */
export const signalChangeTypeSchema = z.enum([
  "improved", // warn -> pass
  "regressed", // pass -> warn
  "became_measured", // unknown -> pass | warn
  "became_unknown", // pass | warn -> unknown
  "unchanged", // pass -> pass | warn -> warn | unknown -> unknown
  "new", // newly introduced signal
]);
export type SignalChangeType = z.infer<typeof signalChangeTypeSchema>;

/**
 * Finding comparison status.
 */
export const findingDiffStatusSchema = z.enum([
  "new",
  "resolved",
  "changed",
  "unchanged",
]);
export type FindingDiffStatus = z.infer<typeof findingDiffStatusSchema>;

/**
 * Types of meaningful regressions.
 */
export const regressionTypeSchema = z.enum([
  "overall_score_drop", // overall score drop >= 10 points
  "category_score_drop", // category score drop >= 15 points
  "new_high_severity_finding", // newly detected high-severity finding
  "finding_severity_increased", // existing finding escalated in severity
  "signal_regressed", // deterministic signal pass -> warn
]);
export type RegressionType = z.infer<typeof regressionTypeSchema>;

/**
 * Types of improvements.
 */
export const improvementTypeSchema = z.enum([
  "overall_score_increase",
  "category_score_increase",
  "finding_resolved",
  "finding_severity_decreased",
  "signal_improved",
]);
export type ImprovementType = z.infer<typeof improvementTypeSchema>;

// ---------------------------------------------------------------------------
// Component Schemas
// ---------------------------------------------------------------------------

export const scoreChangeSchema = z.object({
  previousScore: z.number().min(0).max(100).nullable(),
  currentScore: z.number().min(0).max(100),
  delta: z.number().nullable(),
  direction: scoreDirectionSchema,
  isMeaningfulRegression: z.boolean(),
});
export type ScoreChange = z.infer<typeof scoreChangeSchema>;

export const categoryChangeSchema = z.object({
  category: auditCategorySchema,
  previousScore: z.number().min(0).max(100).nullable(),
  currentScore: z.number().min(0).max(100),
  delta: z.number().nullable(),
  direction: scoreDirectionSchema,
  previousSeverity: severitySchema.nullable(),
  currentSeverity: severitySchema,
  severityChange: severityChangeDirectionSchema,
  previousConfidence: scoreConfidenceSchema.nullable(),
  currentConfidence: scoreConfidenceSchema,
  isMeaningfulRegression: z.boolean(),
});
export type CategoryChange = z.infer<typeof categoryChangeSchema>;

export const findingDiffItemSchema = z.object({
  id: z.string().min(1),
  findingType: findingTypeSchema,
  category: auditCategorySchema,
  status: findingDiffStatusSchema,
  basis: z.enum(["observed", "inferred"]),
  signalIds: z.array(z.string()),

  previousTitle: z.string().nullable(),
  previousSeverity: severitySchema.nullable(),
  previousEvidence: z.string().nullable(),
  previousRecommendation: z.string().nullable(),

  currentTitle: z.string().nullable(),
  currentSeverity: severitySchema.nullable(),
  currentEvidence: z.string().nullable(),
  currentRecommendation: z.string().nullable(),

  severityChange: severityChangeDirectionSchema,
  isMaterialChange: z.boolean(),
  isSeverityRegression: z.boolean(),
});
export type FindingDiffItem = z.infer<typeof findingDiffItemSchema>;

export const signalChangeItemSchema = z.object({
  signalId: z.string().min(1),
  category: auditCategorySchema,
  weight: z.number().min(0).max(1),
  previousStatus: signalStatusSchema.nullable(),
  currentStatus: signalStatusSchema,
  changeType: signalChangeTypeSchema,
  previousEvidence: z.string().nullable(),
  currentEvidence: z.string(),
  isRegression: z.boolean(),
  isImprovement: z.boolean(),
});
export type SignalChangeItem = z.infer<typeof signalChangeItemSchema>;

export const regressionItemSchema = z.object({
  type: regressionTypeSchema,
  category: auditCategorySchema.nullable().optional(),
  description: z.string().min(1),
  basis: z.enum(["observed", "inferred"]),
  severity: severitySchema,
  scoreDelta: z.number().nullable().optional(),
  findingId: z.string().nullable().optional(),
  signalId: z.string().nullable().optional(),
});
export type RegressionItem = z.infer<typeof regressionItemSchema>;

export const improvementItemSchema = z.object({
  type: improvementTypeSchema,
  category: auditCategorySchema.nullable().optional(),
  description: z.string().min(1),
  basis: z.enum(["observed", "inferred"]),
  scoreDelta: z.number().nullable().optional(),
  findingId: z.string().nullable().optional(),
  signalId: z.string().nullable().optional(),
});
export type ImprovementItem = z.infer<typeof improvementItemSchema>;

export const auditDiffSummarySchema = z.object({
  schemaVersion: z.string().default(DIFF_SCHEMA_VERSION),
  isBaseline: z.boolean(),
  hasPreviousReport: z.boolean(),
  hasMeaningfulRegression: z.boolean(),

  overallScoreDelta: z.number().nullable(),
  overallScoreDirection: scoreDirectionSchema,

  regressedCategoriesCount: z.number().int().min(0),
  improvedCategoriesCount: z.number().int().min(0),
  unchangedCategoriesCount: z.number().int().min(0),

  newFindingsCount: z.number().int().min(0),
  newHighSeverityFindingsCount: z.number().int().min(0),
  resolvedFindingsCount: z.number().int().min(0),
  changedFindingsCount: z.number().int().min(0),
  unchangedFindingsCount: z.number().int().min(0),

  regressedSignalsCount: z.number().int().min(0),
  improvedSignalsCount: z.number().int().min(0),

  totalRegressionsCount: z.number().int().min(0),
  totalImprovementsCount: z.number().int().min(0),

  observedRegressionsCount: z.number().int().min(0),
  inferredRegressionsCount: z.number().int().min(0),
});
export type AuditDiffSummary = z.infer<typeof auditDiffSummarySchema>;

export const auditDiffMetadataSchema = z.object({
  previousAnalyzedAt: z.string().datetime().nullable().optional(),
  currentAnalyzedAt: z.string().datetime(),
  previousAuditRunId: z.string().uuid().nullable().optional(),
  currentAuditRunId: z.string().uuid().nullable().optional(),
  previousModelVersion: z.string().nullable().optional(),
  currentModelVersion: z.string().nullable().optional(),
  scoringVersion: z.string().default(AUDIT_ENGINE_SCORING_VERSION),
});
export type AuditDiffMetadata = z.infer<typeof auditDiffMetadataSchema>;

// ---------------------------------------------------------------------------
// Aggregate Schema
// ---------------------------------------------------------------------------

export const auditDiffSchema = z.object({
  summary: auditDiffSummarySchema,
  metadata: auditDiffMetadataSchema,
  scoreChanges: z.object({
    overall: scoreChangeSchema,
    categories: z.array(categoryChangeSchema).length(AUDIT_CATEGORIES.length),
  }),
  newFindings: z.array(findingDiffItemSchema),
  resolvedFindings: z.array(findingDiffItemSchema),
  changedFindings: z.array(findingDiffItemSchema),
  unchangedFindings: z.array(findingDiffItemSchema),
  signalChanges: z.array(signalChangeItemSchema),
  regressions: z.array(regressionItemSchema),
  improvements: z.array(improvementItemSchema),
});
export type AuditDiff = z.infer<typeof auditDiffSchema>;
