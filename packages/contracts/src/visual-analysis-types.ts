import { z } from "zod";
import { isoDateTimeSchema } from "./audit-types.js";
import {
  screenshotDeviceTypeSchema,
  VISUAL_ANALYSIS_SCHEMA_VERSION,
} from "./screenshot-types.js";

/**
 * Visual Analysis Version & Provenance Constants
 */
export { VISUAL_ANALYSIS_SCHEMA_VERSION };
export const VISUAL_ANALYSIS_PROMPT_VERSION = "1.0.0" as const;
export const VISUAL_PROVENANCE_LABEL = "VISION-ASSISTED AI REVIEW" as const;
export const VISUAL_ANALYSIS_DEFAULT_MODEL = "gemini-3.6-flash" as const;

/**
 * Closed set of visual dimensions analyzed by the multimodal vision reviewer.
 */
export const VISUAL_DIMENSIONS = [
  "visual_hierarchy",
  "cta_prominence",
  "visual_clutter",
  "contrast_legibility",
  "typography_hierarchy",
  "spacing_layout",
  "mobile_adaptation",
] as const;

export const visualDimensionSchema = z.enum(VISUAL_DIMENSIONS);
export type VisualDimension = z.infer<typeof visualDimensionSchema>;

/**
 * Dimension qualitative rating
 */
export const VISUAL_DIMENSION_RATINGS = [
  "strong",
  "adequate",
  "needs_improvement",
] as const;

export const visualDimensionRatingSchema = z.enum(VISUAL_DIMENSION_RATINGS);
export type VisualDimensionRating = z.infer<typeof visualDimensionRatingSchema>;

/**
 * Dimension assessment details
 */
export const visualDimensionAssessmentSchema = z.object({
  rating: visualDimensionRatingSchema,
  explanation: z.string().min(10).max(600),
  isAboveFoldCtaVisible: z.boolean().optional(),
});
export type VisualDimensionAssessment = z.infer<
  typeof visualDimensionAssessmentSchema
>;

/**
 * Visual zones on the rendered page
 */
export const VISUAL_ZONES = [
  "above_the_fold",
  "header_navigation",
  "hero_section",
  "body_content",
  "footer",
] as const;

export const visualZoneSchema = z.enum(VISUAL_ZONES);
export type VisualZone = z.infer<typeof visualZoneSchema>;

/**
 * Target viewport for a visual finding
 */
export const VISUAL_VIEWPORTS = ["desktop", "mobile", "both"] as const;
export const visualViewportSchema = z.enum(VISUAL_VIEWPORTS);
export type VisualViewport = z.infer<typeof visualViewportSchema>;

/**
 * Visual finding severity
 */
export const visualSeveritySchema = z.enum(["low", "medium", "high"]);
export type VisualSeverity = z.infer<typeof visualSeveritySchema>;

/**
 * Visual finding confidence level
 */
export const visualConfidenceSchema = z.enum(["low", "medium", "high"]);
export type VisualConfidence = z.infer<typeof visualConfidenceSchema>;

/**
 * Visual Finding: an individual visual UX finding derived from screenshot inspection.
 * Basis is strictly 'visual_inference' to distinguish from deterministic code checks.
 */
export const visualFindingSchema = z.object({
  id: z.string().min(1),
  dimension: visualDimensionSchema,
  targetViewport: visualViewportSchema,
  visualZone: visualZoneSchema,
  title: z.string().min(5).max(160),
  severity: visualSeveritySchema,
  observation: z.string().min(10).max(600),
  impact: z.string().min(10).max(600),
  recommendation: z.string().min(10).max(600),
  confidence: visualConfidenceSchema,
  basis: z.literal("visual_inference"),
});
export type VisualFinding = z.infer<typeof visualFindingSchema>;

/**
 * Status of the visual analysis review
 */
export const VISUAL_ANALYSIS_STATUSES = [
  "completed",
  "failed",
  "skipped",
] as const;
export const visualAnalysisStatusSchema = z.enum(VISUAL_ANALYSIS_STATUSES);
export type VisualAnalysisStatus = z.infer<typeof visualAnalysisStatusSchema>;

/**
 * Complete Visual Analysis Review entity stored in public.visual_analysis_reviews
 */
export const visualAnalysisReviewSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  monitoredPageId: z.string().uuid().optional(),
  auditRunId: z.string().uuid(),
  auditReportId: z.string().uuid().nullable().optional(),
  provenance: z.literal(VISUAL_PROVENANCE_LABEL).default(VISUAL_PROVENANCE_LABEL),
  schemaVersion: z.literal(VISUAL_ANALYSIS_SCHEMA_VERSION),
  promptVersion: z.literal(VISUAL_ANALYSIS_PROMPT_VERSION),
  modelIdentifier: z.string().min(1),
  status: visualAnalysisStatusSchema,
  executiveSummary: z.string().min(20).max(1200).nullable().optional(),
  viewportsAnalyzed: z.array(screenshotDeviceTypeSchema).default([]),
  dimensions: z
    .record(visualDimensionSchema, visualDimensionAssessmentSchema)
    .default({} as Record<VisualDimension, VisualDimensionAssessment>),
  findings: z.array(visualFindingSchema).max(15).default([]),
  screenshotIds: z.array(z.string().uuid()).default([]),
  errorMessage: z.string().nullable().optional(),
  createdAt: isoDateTimeSchema.optional(),
  updatedAt: isoDateTimeSchema.optional(),
});
export type VisualAnalysisReview = z.infer<typeof visualAnalysisReviewSchema>;

/**
 * API Response for visual analysis review
 */
export const visualAnalysisResponseSchema = z.object({
  visualAnalysis: visualAnalysisReviewSchema.nullable(),
});
export type VisualAnalysisResponse = z.infer<
  typeof visualAnalysisResponseSchema
>;
