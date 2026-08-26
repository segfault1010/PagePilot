import { describe, expect, it } from "vitest";
import {
  analyzeErrorResponseSchema,
  analyzeRequestSchema,
  reportSchema,
} from "../src/index.js";

const sampleReport = {
  source: {
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    analyzedAt: "2026-08-21T12:00:00.000Z",
    title: "Example Domain",
  },
  overallScore: 70,
  scoreConfidence: "blended" as const,
  summary: "Sample fixture report used by contract tests.",
  categories: [
    "clarity",
    "visualHierarchy",
    "ctaEffectiveness",
    "copy",
    "accessibility",
    "mobileUx",
    "trustCredibility",
  ].map((category) => ({
    category: category as never,
    score: 70,
    confidence: "blended" as const,
    explanation: `${category} explanation`,
    severity: "low" as const,
    findings: [],
  })),
  topProblems: [
    {
      title: "Problem 1",
      severity: "high" as const,
      evidence: "evidence",
      basis: "observed" as const,
      signalIds: [],
      recommendation: "rec",
    },
    {
      title: "Problem 2",
      severity: "medium" as const,
      evidence: "evidence",
      basis: "inferred" as const,
      signalIds: [],
      recommendation: "rec",
    },
    {
      title: "Problem 3",
      severity: "low" as const,
      evidence: "evidence",
      basis: "observed" as const,
      signalIds: [],
      recommendation: "rec",
    },
  ],
  quickWins: [
    { title: "Win 1", detail: "detail" },
    { title: "Win 2", detail: "detail" },
    { title: "Win 3", detail: "detail" },
  ],
  detailedRecommendations: [
    { title: "Rec 1", detail: "detail" },
  ],
  observedSignals: [
    {
      id: "title.present",
      category: "clarity" as const,
      status: "pass" as const,
      weight: 0.5,
      evidence: "Title present.",
    },
  ],
};

describe("@pagepilot/contracts - audit schemas", () => {
  it("accepts a well-formed report fixture", () => {
    expect(() => reportSchema.parse(sampleReport)).not.toThrow();
  });

  it("rejects unsupported severities", () => {
    const invalid = structuredClone(sampleReport);
    (invalid.categories[0]!.findings as unknown[])[0] = {
      title: "Invalid",
      severity: "critical",
      evidence: "ev",
      basis: "observed",
      signalIds: [],
      recommendation: "rec",
    };
    expect(reportSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects out-of-range overall scores", () => {
    const invalid = { ...sampleReport, overallScore: 150 };
    expect(reportSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects reports missing a category", () => {
    const invalid = { ...sampleReport, categories: sampleReport.categories.slice(1) };
    expect(reportSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates the analyze request shape", () => {
    expect(analyzeRequestSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(analyzeRequestSchema.safeParse({}).success).toBe(false);
  });

  it("validates the error envelope shape", () => {
    const envelope = {
      error: { code: "NOT_IMPLEMENTED", message: "Analysis is not implemented yet.", retryable: false },
    };
    expect(analyzeErrorResponseSchema.parse(envelope)).toEqual(envelope);
    expect(
      analyzeErrorResponseSchema.safeParse({ error: { code: "X", message: "y" } }).success,
    ).toBe(false);
  });
});
