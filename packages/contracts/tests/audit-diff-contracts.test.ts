import { describe, expect, it } from "vitest";
import {
  AUDIT_CATEGORIES,
  DIFF_SCHEMA_VERSION,
  MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD,
  MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD,
  auditDiffSchema,
  findingDiffStatusSchema,
  scoreDirectionSchema,
  severityChangeDirectionSchema,
  signalChangeTypeSchema,
} from "../src/index.js";
import type { AuditDiff } from "../src/index.js";

describe("audit diff contracts", () => {
  it("exports expected threshold and version constants", () => {
    expect(DIFF_SCHEMA_VERSION).toBe("1.0.0");
    expect(MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD).toBe(10);
    expect(MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD).toBe(15);
  });

  it("validates enum schemas", () => {
    expect(scoreDirectionSchema.safeParse("improved").success).toBe(true);
    expect(scoreDirectionSchema.safeParse("regressed").success).toBe(true);
    expect(scoreDirectionSchema.safeParse("unchanged").success).toBe(true);
    expect(scoreDirectionSchema.safeParse("invalid").success).toBe(false);

    expect(severityChangeDirectionSchema.safeParse("increased").success).toBe(true);
    expect(severityChangeDirectionSchema.safeParse("decreased").success).toBe(true);
    expect(severityChangeDirectionSchema.safeParse("unchanged").success).toBe(true);
    expect(severityChangeDirectionSchema.safeParse("worse").success).toBe(false);

    expect(signalChangeTypeSchema.safeParse("improved").success).toBe(true);
    expect(signalChangeTypeSchema.safeParse("regressed").success).toBe(true);
    expect(signalChangeTypeSchema.safeParse("became_measured").success).toBe(true);
    expect(signalChangeTypeSchema.safeParse("became_unknown").success).toBe(true);
    expect(signalChangeTypeSchema.safeParse("unchanged").success).toBe(true);
    expect(signalChangeTypeSchema.safeParse("new").success).toBe(true);
    expect(signalChangeTypeSchema.safeParse("unknown").success).toBe(false);

    expect(findingDiffStatusSchema.safeParse("new").success).toBe(true);
    expect(findingDiffStatusSchema.safeParse("resolved").success).toBe(true);
    expect(findingDiffStatusSchema.safeParse("changed").success).toBe(true);
    expect(findingDiffStatusSchema.safeParse("unchanged").success).toBe(true);
    expect(findingDiffStatusSchema.safeParse("modified").success).toBe(false);
  });

  it("validates a full comprehensive AuditDiff payload", () => {
    const fullDiff: AuditDiff = {
      summary: {
        schemaVersion: "1.0.0",
        isBaseline: false,
        hasPreviousReport: true,
        hasMeaningfulRegression: true,
        overallScoreDelta: -12,
        overallScoreDirection: "regressed",
        regressedCategoriesCount: 2,
        improvedCategoriesCount: 1,
        unchangedCategoriesCount: 4,
        newFindingsCount: 1,
        newHighSeverityFindingsCount: 1,
        resolvedFindingsCount: 1,
        changedFindingsCount: 1,
        unchangedFindingsCount: 1,
        regressedSignalsCount: 1,
        improvedSignalsCount: 1,
        totalRegressionsCount: 3,
        totalImprovementsCount: 3,
        observedRegressionsCount: 2,
        inferredRegressionsCount: 1,
      },
      metadata: {
        previousAnalyzedAt: "2026-08-20T10:00:00.000Z",
        currentAnalyzedAt: "2026-08-27T10:00:00.000Z",
        previousAuditRunId: "a1111111-1111-4111-8111-111111111111",
        currentAuditRunId: "b2222222-2222-4222-8222-222222222222",
        previousModelVersion: "gemini-3.6-flash",
        currentModelVersion: "gemini-3.6-flash",
        scoringVersion: "1.0.0",
      },
      scoreChanges: {
        overall: {
          previousScore: 82,
          currentScore: 70,
          delta: -12,
          direction: "regressed",
          isMeaningfulRegression: true,
        },
        categories: AUDIT_CATEGORIES.map((category) => ({
          category,
          previousScore: 80,
          currentScore: category === "clarity" ? 64 : 80,
          delta: category === "clarity" ? -16 : 0,
          direction: category === "clarity" ? "regressed" : "unchanged",
          previousSeverity: "low",
          currentSeverity: category === "clarity" ? "high" : "low",
          severityChange: category === "clarity" ? "increased" : "unchanged",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: category === "clarity",
        })),
      },
      newFindings: [
        {
          id: "top_problem:clarity:signal:meta.description.present",
          findingType: "top_problem",
          category: "clarity",
          status: "new",
          basis: "observed",
          signalIds: ["meta.description.present"],
          previousTitle: null,
          previousSeverity: null,
          previousEvidence: null,
          previousRecommendation: null,
          currentTitle: "Missing Meta Description",
          currentSeverity: "high",
          currentEvidence: "No meta description found.",
          currentRecommendation: "Add meta description tag.",
          severityChange: "unchanged",
          isMaterialChange: true,
          isSeverityRegression: true,
        },
      ],
      resolvedFindings: [
        {
          id: "category_finding:visualHierarchy:signal:h1.single-meaningful",
          findingType: "category_finding",
          category: "visualHierarchy",
          status: "resolved",
          basis: "observed",
          signalIds: ["h1.single-meaningful"],
          previousTitle: "Multiple H1 tags",
          previousSeverity: "medium",
          previousEvidence: "2 H1 headings found.",
          previousRecommendation: "Keep exactly one H1.",
          currentTitle: null,
          currentSeverity: null,
          currentEvidence: null,
          currentRecommendation: null,
          severityChange: "unchanged",
          isMaterialChange: true,
          isSeverityRegression: false,
        },
      ],
      changedFindings: [
        {
          id: "top_problem:ctaEffectiveness:signal:cta.candidates",
          findingType: "top_problem",
          category: "ctaEffectiveness",
          status: "changed",
          basis: "observed",
          signalIds: ["cta.candidates"],
          previousTitle: "Primary CTA lacks contrast",
          previousSeverity: "low",
          previousEvidence: "Button is light gray.",
          previousRecommendation: "Increase contrast.",
          currentTitle: "Primary CTA lacks contrast and clear label",
          currentSeverity: "high",
          currentEvidence: "Button is light gray and unlabeled.",
          currentRecommendation: "Increase contrast and add action copy.",
          severityChange: "increased",
          isMaterialChange: true,
          isSeverityRegression: true,
        },
      ],
      unchangedFindings: [
        {
          id: "category_finding:accessibility:signal:document.lang",
          findingType: "category_finding",
          category: "accessibility",
          status: "unchanged",
          basis: "observed",
          signalIds: ["document.lang"],
          previousTitle: "Document language declared",
          previousSeverity: "low",
          previousEvidence: 'Document lang is "en".',
          previousRecommendation: "Keep declared language.",
          currentTitle: "Document language declared",
          currentSeverity: "low",
          currentEvidence: 'Document lang is "en".',
          currentRecommendation: "Keep declared language.",
          severityChange: "unchanged",
          isMaterialChange: false,
          isSeverityRegression: false,
        },
      ],
      signalChanges: [
        {
          signalId: "meta.description.present",
          category: "clarity",
          weight: 0.4,
          previousStatus: "pass",
          currentStatus: "warn",
          changeType: "regressed",
          previousEvidence: "Meta description present.",
          currentEvidence: "No meta description found.",
          isRegression: true,
          isImprovement: false,
        },
      ],
      regressions: [
        {
          type: "overall_score_drop",
          category: null,
          description: "Overall score dropped by 12 points (82 -> 70).",
          basis: "observed",
          severity: "high",
          scoreDelta: -12,
        },
        {
          type: "category_score_drop",
          category: "clarity",
          description: "Clarity score dropped by 16 points (80 -> 64).",
          basis: "observed",
          severity: "high",
          scoreDelta: -16,
        },
        {
          type: "new_high_severity_finding",
          category: "clarity",
          description: "New high severity finding: Missing Meta Description",
          basis: "observed",
          severity: "high",
          findingId: "top_problem:clarity:signal:meta.description.present",
        },
      ],
      improvements: [
        {
          type: "finding_resolved",
          category: "visualHierarchy",
          description: "Resolved finding: Multiple H1 tags",
          basis: "observed",
          findingId: "category_finding:visualHierarchy:signal:h1.single-meaningful",
        },
      ],
    };

    const parsed = auditDiffSchema.safeParse(fullDiff);
    expect(parsed.success).toBe(true);
  });

  it("validates a baseline AuditDiff payload (first-ever audit)", () => {
    const baselineDiff: AuditDiff = {
      summary: {
        schemaVersion: "1.0.0",
        isBaseline: true,
        hasPreviousReport: false,
        hasMeaningfulRegression: false,
        overallScoreDelta: null,
        overallScoreDirection: "unchanged",
        regressedCategoriesCount: 0,
        improvedCategoriesCount: 0,
        unchangedCategoriesCount: 7,
        newFindingsCount: 3,
        newHighSeverityFindingsCount: 0,
        resolvedFindingsCount: 0,
        changedFindingsCount: 0,
        unchangedFindingsCount: 0,
        regressedSignalsCount: 0,
        improvedSignalsCount: 0,
        totalRegressionsCount: 0,
        totalImprovementsCount: 0,
        observedRegressionsCount: 0,
        inferredRegressionsCount: 0,
      },
      metadata: {
        previousAnalyzedAt: null,
        currentAnalyzedAt: "2026-08-27T10:00:00.000Z",
        previousAuditRunId: null,
        currentAuditRunId: "b2222222-2222-4222-8222-222222222222",
        previousModelVersion: null,
        currentModelVersion: "gemini-3.6-flash",
        scoringVersion: "1.0.0",
      },
      scoreChanges: {
        overall: {
          previousScore: null,
          currentScore: 78,
          delta: null,
          direction: "unchanged",
          isMeaningfulRegression: false,
        },
        categories: AUDIT_CATEGORIES.map((category) => ({
          category,
          previousScore: null,
          currentScore: 78,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        })),
      },
      newFindings: [],
      resolvedFindings: [],
      changedFindings: [],
      unchangedFindings: [],
      signalChanges: [],
      regressions: [],
      improvements: [],
    };

    const parsed = auditDiffSchema.safeParse(baselineDiff);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid score values or missing required categories", () => {
    // Missing categories (e.g. only 6 instead of 7)
    const invalidCategories = {
      overall: {
        previousScore: 80,
        currentScore: 70,
        delta: -10,
        direction: "regressed" as const,
        isMeaningfulRegression: true,
      },
      categories: AUDIT_CATEGORIES.slice(0, 6).map((category) => ({
        category,
        previousScore: 80,
        currentScore: 70,
        delta: -10,
        direction: "regressed" as const,
        previousSeverity: "low" as const,
        currentSeverity: "high" as const,
        severityChange: "increased" as const,
        previousConfidence: "blended" as const,
        currentConfidence: "blended" as const,
        isMeaningfulRegression: false,
      })),
    };

    const parsed = auditDiffSchema.safeParse({
      summary: {
        schemaVersion: "1.0.0",
        isBaseline: false,
        hasPreviousReport: true,
        hasMeaningfulRegression: false,
        overallScoreDelta: 0,
        overallScoreDirection: "unchanged",
        regressedCategoriesCount: 0,
        improvedCategoriesCount: 0,
        unchangedCategoriesCount: 7,
        newFindingsCount: 0,
        newHighSeverityFindingsCount: 0,
        resolvedFindingsCount: 0,
        changedFindingsCount: 0,
        unchangedFindingsCount: 0,
        regressedSignalsCount: 0,
        improvedSignalsCount: 0,
        totalRegressionsCount: 0,
        totalImprovementsCount: 0,
        observedRegressionsCount: 0,
        inferredRegressionsCount: 0,
      },
      metadata: {
        currentAnalyzedAt: "2026-08-27T10:00:00.000Z",
        scoringVersion: "1.0.0",
      },
      scoreChanges: invalidCategories,
      newFindings: [],
      resolvedFindings: [],
      changedFindings: [],
      unchangedFindings: [],
      signalChanges: [],
      regressions: [],
      improvements: [],
    });

    expect(parsed.success).toBe(false);
  });
});
