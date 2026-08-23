import { describe, expect, it } from "vitest";
import { buildReport } from "../../src/server/scoring/score-report";
import { analyzeSuccessResponseSchema } from "../../src/shared/audit-types";
import { AUDIT_CATEGORIES } from "../../src/shared/audit-types";
import type { DetectedSignal } from "../../src/shared/audit-types";
import { auditWith, validGeminiAudit } from "../fixtures/gemini-audit";

const GEMINI_SCORES = [70, 80, 90, 60, 50, 40, 30];

function coveredSignals(): DetectedSignal[] {
  // One determinable pass signal per category → coverage 1.0 everywhere.
  return AUDIT_CATEGORIES.map((category) => ({
    id: `sig.${category}`,
    category,
    status: "pass",
    weight: 0.25,
    evidence: `${category} evidence`,
  }));
}

function auditForBuilder() {
  const audit = validGeminiAudit();
  audit.categories.forEach((category, index) => {
    category.score = GEMINI_SCORES[index]!;
  });
  return audit;
}

function buildDefaultReport() {
  const signals = coveredSignals();
  return {
    signals,
    report: buildReport({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      title: "Example landing page",
      analyzedAt: new Date("2026-08-23T10:00:00.000Z"),
      signals,
      audit: auditForBuilder(),
    }),
  };
}

describe("buildReport", () => {
  it("carries source metadata through unchanged", () => {
    const { report } = buildDefaultReport();
    expect(report.source).toEqual({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      analyzedAt: "2026-08-23T10:00:00.000Z",
      title: "Example landing page",
    });
  });

  it("produces exactly seven categories in canonical order with blended scores", () => {
    const { report } = buildDefaultReport();
    expect(report.categories.map((c) => c.category)).toEqual([
      ...AUDIT_CATEGORIES,
    ]);
    report.categories.forEach((category, index) => {
      expect(category.confidence).toBe("blended");
      expect(category.score).toBe(Math.round(0.6 * GEMINI_SCORES[index]! + 40));
      expect(category.findings.length).toBeGreaterThan(0);
      expect(category.explanation).toBeTruthy();
    });
  });

  it("computes overallScore server-side and never trusts a model-provided score", () => {
    const { report } = buildDefaultReport();
    const expectedFinals = GEMINI_SCORES.map((g) => Math.round(0.6 * g + 40));
    const weighted = expectedFinals.reduce(
      (sum, score, index) =>
        sum +
        [
          0.18, 0.15, 0.15, 0.12, 0.15, 0.1, 0.15,
        ][index]! *
          score,
      0,
    );
    expect(report.overallScore).toBe(Math.round(weighted));
    // The audit carries no overallScore field at all — the server owns it.
    expect(validGeminiAudit()).not.toHaveProperty("overallScore");
  });

  it("maps exactly three top problems into contract findings", () => {
    const { report } = buildDefaultReport();
    expect(report.topProblems).toHaveLength(3);
    for (const problem of report.topProblems) {
      expect(Object.keys(problem).sort()).toEqual([
        "basis",
        "evidence",
        "recommendation",
        "severity",
        "signalIds",
        "title",
      ]);
    }
  });

  it("maps quick wins and priority-sorted detailed recommendations", () => {
    const { report } = buildDefaultReport();
    expect(report.quickWins).toHaveLength(3);
    expect(report.quickWins[0]).toMatchObject({
      title: "Add a meta description",
      category: "clarity",
    });

    const unsorted = auditWith((a) => {
      a.detailedRecommendations.reverse();
    });
    const sorted = buildReport({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      title: null,
      analyzedAt: new Date(),
      signals: coveredSignals(),
      audit: unsorted,
    });
    expect(sorted.detailedRecommendations[0]?.title).toContain(
      "Restructure the heading outline",
    );
    expect(sorted.detailedRecommendations.every((r) => r.detail.length > 0)).toBe(
      true,
    );
  });

  it("passes observed signals through verbatim and keeps observed/inferred distinct", () => {
    const { signals, report } = buildDefaultReport();
    expect(report.observedSignals).toEqual(signals);

    const inferredProblem = report.topProblems.find((p) => p.basis === "inferred");
    const observedProblem = report.topProblems.find((p) => p.basis === "observed");
    expect(inferredProblem).toBeDefined();
    expect(observedProblem).toBeDefined();
  });

  it("labels the whole report ai-led when any category lacks coverage", () => {
    const signals = coveredSignals().filter((s) => s.category !== "copy");
    signals.push({
      id: "sig.unknown-copy",
      category: "copy",
      status: "unknown",
      weight: 0.9,
      evidence: "cannot assess",
    });
    const report = buildReport({
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      title: null,
      analyzedAt: new Date(),
      signals,
      audit: auditForBuilder(),
    });
    const copyCategory = report.categories.find((c) => c.category === "copy")!;
    expect(copyCategory.confidence).toBe("ai-led");
    expect(copyCategory.score).toBe(60); // raw Gemini score
    expect(report.scoreConfidence).toBe("ai-led");
  });

  it("emits a payload that satisfies the shared API success contract", () => {
    const { report } = buildDefaultReport();
    expect(analyzeSuccessResponseSchema.safeParse({ report }).success).toBe(true);
  });
});
