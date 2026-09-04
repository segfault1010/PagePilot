import { describe, it, expect } from "vitest";
import {
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  VISUAL_ANALYSIS_PROMPT_VERSION,
  VISUAL_PROVENANCE_LABEL,
  VISUAL_ANALYSIS_DEFAULT_MODEL,
  VISUAL_DIMENSIONS,
  visualDimensionSchema,
  visualDimensionAssessmentSchema,
  visualFindingSchema,
  visualAnalysisReviewSchema,
  visualAnalysisResponseSchema,
  type VisualAnalysisReview,
  type VisualFinding,
} from "../src/visual-analysis-types.js";

describe("Visual Analysis Contracts", () => {
  it("defines canonical version constants and labels", () => {
    expect(VISUAL_ANALYSIS_SCHEMA_VERSION).toBe("1.0.0");
    expect(VISUAL_ANALYSIS_PROMPT_VERSION).toBe("1.0.0");
    expect(VISUAL_PROVENANCE_LABEL).toBe("VISION-ASSISTED AI REVIEW");
    expect(VISUAL_ANALYSIS_DEFAULT_MODEL).toBe("gemini-3.6-flash");
  });

  it("defines the closed set of 7 visual dimensions", () => {
    expect(VISUAL_DIMENSIONS).toHaveLength(7);
    expect(VISUAL_DIMENSIONS).toEqual([
      "visual_hierarchy",
      "cta_prominence",
      "visual_clutter",
      "contrast_legibility",
      "typography_hierarchy",
      "spacing_layout",
      "mobile_adaptation",
    ]);

    for (const dim of VISUAL_DIMENSIONS) {
      expect(visualDimensionSchema.safeParse(dim).success).toBe(true);
    }
    expect(visualDimensionSchema.safeParse("unknown_dimension").success).toBe(false);
  });

  it("validates dimension assessment schema with qualitative ratings", () => {
    const validAssessment = {
      rating: "strong",
      explanation: "The primary headline immediately draws user attention with balanced visual weight.",
      isAboveFoldCtaVisible: true,
    };
    const parsed = visualDimensionAssessmentSchema.safeParse(validAssessment);
    expect(parsed.success).toBe(true);

    const invalidRating = {
      rating: "exceptional", // not in closed enum
      explanation: "Too good.",
    };
    expect(visualDimensionAssessmentSchema.safeParse(invalidRating).success).toBe(false);

    const tooShortExplanation = {
      rating: "needs_improvement",
      explanation: "Bad", // < 10 chars
    };
    expect(visualDimensionAssessmentSchema.safeParse(tooShortExplanation).success).toBe(false);
  });

  it("validates visual finding schema and strictly enforces basis='visual_inference'", () => {
    const validFinding: VisualFinding = {
      id: "vf-1",
      dimension: "cta_prominence",
      targetViewport: "desktop",
      visualZone: "above_the_fold",
      title: "Primary Hero CTA Has Insufficient Visual Contrast",
      severity: "high",
      observation: "The 'Start Free Trial' button uses light cyan text on a white card background.",
      impact: "Visitors are likely to miss the primary conversion goal within the initial 5-second scan.",
      recommendation: "Switch button background to high-contrast brand indigo with solid white typography.",
      confidence: "high",
      basis: "visual_inference",
    };

    const parsed = visualFindingSchema.safeParse(validFinding);
    expect(parsed.success).toBe(true);

    // Reject invalid basis (must be 'visual_inference', not 'observed' or 'inferred')
    const invalidBasis = {
      ...validFinding,
      basis: "observed",
    };
    expect(visualFindingSchema.safeParse(invalidBasis).success).toBe(false);

    // Reject title that is too short
    const shortTitle = {
      ...validFinding,
      title: "Bad",
    };
    expect(visualFindingSchema.safeParse(shortTitle).success).toBe(false);
  });

  it("validates complete visual analysis review schema", () => {
    const validReview: VisualAnalysisReview = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      provenance: VISUAL_PROVENANCE_LABEL,
      schemaVersion: "1.0.0",
      promptVersion: "1.0.0",
      modelIdentifier: "gemini-3.6-flash",
      status: "completed",
      executiveSummary: "The landing page presents a strong visual hierarchy on desktop, but suffers from low hero CTA contrast and cramped touch targets on mobile viewports.",
      viewportsAnalyzed: ["desktop", "mobile"],
      dimensions: {
        visual_hierarchy: {
          rating: "strong",
          explanation: "Clear top-to-bottom reading path with prominent headline.",
        },
        cta_prominence: {
          rating: "needs_improvement",
          explanation: "Hero button blends into ambient background tones.",
          isAboveFoldCtaVisible: true,
        },
        visual_clutter: {
          rating: "adequate",
          explanation: "Clean overall, though secondary trust badges crowd the fold.",
        },
        contrast_legibility: {
          rating: "needs_improvement",
          explanation: "Subhead copy lacks sufficient apparent contrast against gradient.",
        },
        typography_hierarchy: {
          rating: "strong",
          explanation: "Good scale disparity between H1 and section labels.",
        },
        spacing_layout: {
          rating: "adequate",
          explanation: "Consistent horizontal margins on 1280px.",
        },
        mobile_adaptation: {
          rating: "needs_improvement",
          explanation: "Primary action button is pushed below the fold on 375px mobile viewport.",
          isAboveFoldCtaVisible: false,
        },
      },
      findings: [
        {
          id: "vf-cta",
          dimension: "cta_prominence",
          targetViewport: "both",
          visualZone: "above_the_fold",
          title: "Low Visual Weight on Main Action Button",
          severity: "high",
          observation: "Ghost button outline blends into hero illustration.",
          impact: "Reduces primary action prominence for scanning visitors.",
          recommendation: "Apply solid fill and drop-shadow to emphasize primary CTA.",
          confidence: "high",
          basis: "visual_inference",
        },
      ],
      screenshotIds: ["550e8400-e29b-41d4-a716-446655440001"],
    };

    const parsed = visualAnalysisReviewSchema.safeParse(validReview);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.schemaVersion).toBe("1.0.0");
      expect(parsed.data.promptVersion).toBe("1.0.0");
      expect(parsed.data.findings).toHaveLength(1);
    }
  });

  it("enforces max 15 visual findings limit", () => {
    const findingSample: VisualFinding = {
      id: "vf-x",
      dimension: "visual_hierarchy",
      targetViewport: "desktop",
      visualZone: "hero_section",
      title: "Sample Visual Hierarchy Finding Title",
      severity: "medium",
      observation: "Observation detail exceeds the ten character minimum bound.",
      impact: "Impact description exceeds the ten character minimum bound.",
      recommendation: "Recommendation text exceeds the ten character minimum bound.",
      confidence: "medium",
      basis: "visual_inference",
    };

    const review = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      schemaVersion: "1.0.0",
      promptVersion: "1.0.0",
      modelIdentifier: "gemini-3.6-flash",
      status: "completed",
      executiveSummary: "Summary meeting the minimum requirement of twenty characters.",
      findings: Array.from({ length: 16 }, (_, i) => ({ ...findingSample, id: `vf-${i}` })),
    };

    expect(visualAnalysisReviewSchema.safeParse(review).success).toBe(false);
  });

  it("validates API response schema supporting null review", () => {
    const nullResponse = { visualAnalysis: null };
    expect(visualAnalysisResponseSchema.safeParse(nullResponse).success).toBe(true);

    const invalidResponse = { visualAnalysis: "not-an-object" };
    expect(visualAnalysisResponseSchema.safeParse(invalidResponse).success).toBe(false);
  });
});
