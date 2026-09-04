import { z } from "zod";
import {
  VISUAL_ANALYSIS_PROMPT_VERSION,
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  VISUAL_PROVENANCE_LABEL,
  visualAnalysisReviewSchema,
  visualConfidenceSchema,
  visualDimensionRatingSchema,
  visualDimensionSchema,
  visualSeveritySchema,
  visualViewportSchema,
  visualZoneSchema,
  type ScreenshotDeviceType,
  type VisualAnalysisReview,
  type VisualDimension,
  type VisualDimensionAssessment,
  type VisualFinding,
} from "@pagepilot/contracts";

/**
 * Hard string bounds for visual review output from Gemini Vision
 */
export const GEMINI_VISION_STRING_LIMITS = {
  executiveSummaryMin: 20,
  executiveSummaryMax: 1200,
  explanationMin: 10,
  explanationMax: 600,
  titleMin: 5,
  titleMax: 160,
  observationMin: 10,
  observationMax: 600,
  impactMin: 10,
  impactMax: 600,
  recommendationMin: 10,
  recommendationMax: 600,
  maxFindings: 15,
} as const;

/**
 * Wire dimension assessment schema (what Gemini produces)
 */
export const geminiVisionWireDimensionSchema = z.strictObject({
  rating: visualDimensionRatingSchema.describe(
    "Qualitative rating: 'strong', 'adequate', or 'needs_improvement'."
  ),
  explanation: z
    .string()
    .describe(
      "Concise 1-3 sentence explanation judging this dimension strictly from the screenshots."
    ),
  isAboveFoldCtaVisible: z
    .boolean()
    .optional()
    .describe("Whether a primary CTA is clearly visible above the fold."),
});

/**
 * Wire visual finding schema (what Gemini produces)
 */
export const geminiVisionWireFindingSchema = z.strictObject({
  dimension: visualDimensionSchema.describe("The visual UX dimension."),
  targetViewport: visualViewportSchema.describe(
    "Target viewport where the issue appears: 'desktop', 'mobile', or 'both'."
  ),
  visualZone: visualZoneSchema.describe(
    "The zone on the page: 'above_the_fold', 'header_navigation', 'hero_section', 'body_content', or 'footer'."
  ),
  title: z.string().describe("Clear, concise finding title (5-160 chars)."),
  severity: visualSeveritySchema.describe("Severity: 'high', 'medium', or 'low'."),
  observation: z
    .string()
    .describe(
      "Concrete visual observation of what is rendered on screen (e.g. element placement, contrast, or crowding)."
    ),
  impact: z
    .string()
    .describe(
      "Why this visual pattern creates user confusion, reduces visual flow, or harms conversion."
    ),
  recommendation: z
    .string()
    .describe("Specific, actionable visual layout or styling recommendation."),
  confidence: visualConfidenceSchema.describe(
    "Confidence level ('high', 'medium', 'low') reflecting visual clarity."
  ),
});

/**
 * Wire response shape requested from Gemini Vision
 */
export const geminiVisionWireShapeSchema = z.strictObject({
  executiveSummary: z
    .string()
    .describe(
      "Concise 2-4 sentence executive summary of overall visual UX and layout hierarchy."
    ),
  dimensions: z.strictObject({
    visual_hierarchy: geminiVisionWireDimensionSchema,
    cta_prominence: geminiVisionWireDimensionSchema,
    visual_clutter: geminiVisionWireDimensionSchema,
    contrast_legibility: geminiVisionWireDimensionSchema,
    typography_hierarchy: geminiVisionWireDimensionSchema,
    spacing_layout: geminiVisionWireDimensionSchema,
    mobile_adaptation: geminiVisionWireDimensionSchema,
  }),
  findings: z
    .array(geminiVisionWireFindingSchema)
    .max(GEMINI_VISION_STRING_LIMITS.maxFindings)
    .describe("Prioritized list of up to 15 concrete visual UX findings."),
});

export type GeminiVisionWireReview = z.infer<
  typeof geminiVisionWireShapeSchema
>;

/**
 * Generates JSON Schema for Gemini's responseJsonSchema generationConfig.
 * Strips unsupported length keywords (minLength, maxLength, minItems, maxItems).
 */
export function geminiVisionResponseJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(geminiVisionWireShapeSchema, {
    target: "draft-7",
    override: (ctx) => {
      const node = ctx.jsonSchema as Record<string, unknown>;
      delete node.minLength;
      delete node.maxLength;
      delete node.minItems;
      delete node.maxItems;
    },
  }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export type ParseVisionOutcome =
  | { ok: true; review: VisualAnalysisReview }
  | { ok: false; reason: string };

export interface ParseVisionContext {
  auditRunId: string;
  auditReportId?: string | null;
  modelIdentifier: string;
  viewportsAnalyzed: ScreenshotDeviceType[];
  screenshotIds: string[];
}

/**
 * Parses, transforms, and strictly validates raw Gemini vision output against
 * domain visual analysis schemas.
 */
export function parseGeminiVisionOutput(
  raw: unknown,
  ctx: ParseVisionContext
): ParseVisionOutcome {
  const wireResult = geminiVisionWireShapeSchema.safeParse(raw);
  if (!wireResult.success) {
    return {
      ok: false,
      reason: `Wire schema validation failed: ${wireResult.error.issues[0]?.message ?? "unknown error"}`,
    };
  }

  const wire = wireResult.data;

  // Transform wire findings into domain findings with required basis: "visual_inference" and ids
  const domainFindings: VisualFinding[] = wire.findings.map(
    (finding, index) => ({
      id: `vis-${index + 1}`,
      dimension: finding.dimension,
      targetViewport: finding.targetViewport,
      visualZone: finding.visualZone,
      title: finding.title.trim(),
      severity: finding.severity,
      observation: finding.observation.trim(),
      impact: finding.impact.trim(),
      recommendation: finding.recommendation.trim(),
      confidence: finding.confidence,
      basis: "visual_inference" as const,
    })
  );

  const candidate: VisualAnalysisReview = {
    auditRunId: ctx.auditRunId,
    auditReportId: ctx.auditReportId ?? null,
    provenance: VISUAL_PROVENANCE_LABEL,
    schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
    promptVersion: VISUAL_ANALYSIS_PROMPT_VERSION,
    modelIdentifier: ctx.modelIdentifier,
    status: "completed",
    executiveSummary: wire.executiveSummary.trim(),
    viewportsAnalyzed: ctx.viewportsAnalyzed,
    dimensions: wire.dimensions as Record<
      VisualDimension,
      VisualDimensionAssessment
    >,
    findings: domainFindings,
    screenshotIds: ctx.screenshotIds,
  };

  const domainResult = visualAnalysisReviewSchema.safeParse(candidate);
  if (!domainResult.success) {
    return {
      ok: false,
      reason: `Domain schema validation failed: ${domainResult.error.issues[0]?.message ?? "unknown error"}`,
    };
  }

  return { ok: true, review: domainResult.data };
}
