import { describe, expect, it } from "vitest";
import {
  BLEND_COVERAGE_THRESHOLD,
  CATEGORY_WEIGHTS,
  computeDeterministicBaseline,
  computeOverallScore,
  computeReportConfidence,
  scoreAllCategories,
  scoreCategory,
} from "../../src/server/scoring/score-report";
import { AUDIT_CATEGORIES } from "../../src/shared/audit-types";
import type { AuditCategory, DetectedSignal } from "../../src/shared/audit-types";
import { validGeminiAudit } from "../fixtures/gemini-audit";

function signal(
  id: string,
  category: AuditCategory,
  status: DetectedSignal["status"],
  weight: number,
): DetectedSignal {
  return { id, category, status, weight, evidence: `${id} evidence.` };
}

describe("computeDeterministicBaseline", () => {
  it("scores an all-pass category at 100 with full coverage", () => {
    const result = computeDeterministicBaseline(
      [signal("a", "clarity", "pass", 0.6), signal("b", "clarity", "pass", 0.4)],
      "clarity",
    );
    expect(result.baseline).toBe(100);
    expect(result.coverage).toBe(1);
  });

  it("gives warn signals partial credit", () => {
    const result = computeDeterministicBaseline(
      [signal("a", "copy", "pass", 0.5), signal("b", "copy", "warn", 0.5)],
      "copy",
    );
    expect(result.baseline).toBe(75);
    expect(result.coverage).toBe(1);
  });

  it("excludes unknown signals from points AND denominator", () => {
    const result = computeDeterministicBaseline(
      [
        signal("known", "clarity", "pass", 0.4),
        signal("unknowable", "clarity", "unknown", 0.6),
      ],
      "clarity",
    );
    expect(result.baseline).toBe(100);
    expect(result.coverage).toBeCloseTo(0.4);
  });

  it("computes weighted baselines across mixed statuses", () => {
    const result = computeDeterministicBaseline(
      [
        signal("p", "accessibility", "pass", 0.3),
        signal("w", "accessibility", "warn", 0.3),
        signal("u", "accessibility", "unknown", 0.4),
      ],
      "accessibility",
    );
    // Applicable weight 0.6, weighted points 0.3 + 0.15 = 0.45 → 75.
    expect(result.baseline).toBe(75);
    expect(result.coverage).toBeCloseTo(0.6);
  });

  it("returns no baseline when every signal is unknown or none exist", () => {
    const allUnknown = computeDeterministicBaseline(
      [signal("u", "mobileUx", "unknown", 0.9)],
      "mobileUx",
    );
    expect(allUnknown.baseline).toBeNull();
    expect(computeDeterministicBaseline([], "mobileUx").baseline).toBeNull();
  });

  it("ignores signals from other categories", () => {
    const result = computeDeterministicBaseline(
      [signal("other", "trustCredibility", "pass", 0.9)],
      "clarity",
    );
    expect(result.baseline).toBeNull();
    expect(result.coverage).toBe(0);
  });
});

describe("scoreCategory blending", () => {
  const covered = { baseline: 100, coverage: 0.4 };

  it("blends 60/40 when coverage equals the 40% threshold exactly", () => {
    expect(BLEND_COVERAGE_THRESHOLD).toBe(0.4);
    const result = scoreCategory(50, covered);
    expect(result).toEqual({ finalScore: 70, confidence: "blended" });
  });

  it("stays ai-led strictly below the threshold even with a baseline", () => {
    const result = scoreCategory(50, { baseline: 100, coverage: 0.39 });
    expect(result).toEqual({ finalScore: 50, confidence: "ai-led" });
  });

  it("blends above the threshold using rounded arithmetic", () => {
    const result = scoreCategory(80, { baseline: 55, coverage: 0.8 });
    // round(48 + 22) = 70
    expect(result.finalScore).toBe(70);
    expect(result.confidence).toBe("blended");
  });

  it("uses the Gemini score untouched when no baseline exists", () => {
    const result = scoreCategory(66, { baseline: null, coverage: 0 });
    expect(result).toEqual({ finalScore: 66, confidence: "ai-led" });
  });

  it("clamps defensively out-of-band inputs", () => {
    expect(scoreCategory(150, covered).finalScore).toBe(100);
    // Blended arithmetic stays in bounds: round(0.6 * -20 + 40) = 28.
    expect(scoreCategory(-20, covered).finalScore).toBe(28);
    // ai-led path clamps the raw Gemini score directly.
    expect(scoreCategory(150, { baseline: null, coverage: 0 }).finalScore).toBe(100);
    expect(scoreCategory(-20, { baseline: null, coverage: 0 }).finalScore).toBe(0);
  });
});

describe("overall scoring across categories", () => {
  const WEIGHTS_SUM = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
  expect(WEIGHTS_SUM).toBeCloseTo(1);

  function fullyCoveredSignals(): DetectedSignal[] {
    return AUDIT_CATEGORIES.map((category, index) =>
      signal(`sig.${index}`, category, "pass", 0.25),
    );
  }

  it("blends every category against its deterministic baseline", () => {
    const audit = validGeminiAudit();
    const expectedGemini = [70, 80, 90, 60, 50, 40, 30];
    audit.categories.forEach((category, index) => {
      category.score = expectedGemini[index]!;
    });

    const scored = scoreAllCategories(audit, fullyCoveredSignals());

    // Single pass signal per category → baseline 100, coverage 1 → blended.
    const expectedFinal = expectedGemini.map((gemini) => Math.round(0.6 * gemini + 40));
    scored.forEach((category) => {
      const index = AUDIT_CATEGORIES.indexOf(category.key);
      expect(category.confidence).toBe("blended");
      expect(category.finalScore).toBe(expectedFinal[index]);
    });
  });

  it("downgrades only under-covered categories to ai-led", () => {
    const audit = validGeminiAudit();
    const signals = fullyCoveredSignals();
    // Copy becomes unknowable → ai-led for that category alone.
    const copyOnlyUnknown = signals.filter((s) => s.category !== "copy");
    copyOnlyUnknown.push(signal("unknown.copy", "copy", "unknown", 0.9));

    const scored = scoreAllCategories(audit, copyOnlyUnknown);
    expect(scored.get("copy")!.confidence).toBe("ai-led");
    expect(scored.get("copy")!.finalScore).toBe(
      audit.categories.find((c) => c.key === "copy")!.score,
    );
    expect(scored.get("clarity")!.confidence).toBe("blended");
  });

  it("computes the weighted overallScore from final category scores", () => {
    const scores: Record<AuditCategory, number> = {
      clarity: 90,
      visualHierarchy: 80,
      ctaEffectiveness: 70,
      copy: 60,
      accessibility: 50,
      mobileUx: 40,
      trustCredibility: 30,
    };
    const scored = AUDIT_CATEGORIES.map((key) => ({
      key,
      geminiScore: scores[key],
      finalScore: scores[key],
      confidence: "blended" as const,
      baseline: null,
      coverage: 1,
    }));
    // 0.18*90 + 0.15*80 + 0.15*70 + 0.12*60 + 0.15*50 + 0.10*40 + 0.15*30
    const expected = Math.round(16.2 + 12 + 10.5 + 7.2 + 7.5 + 4 + 4.5);
    expect(expected).toBe(62);
    expect(computeOverallScore(scored)).toBe(62);
  });

  it("bounds the overall score at 0 and 100", () => {
    const perfect = AUDIT_CATEGORIES.map((key) => ({
      key,
      geminiScore: 100,
      finalScore: 100,
      confidence: "blended" as const,
      baseline: 100,
      coverage: 1,
    }));
    const zero = perfect.map((category) => ({ ...category, finalScore: 0 }));
    expect(computeOverallScore(perfect)).toBe(100);
    expect(computeOverallScore(zero)).toBe(0);
  });
});

describe("report-level scoreConfidence", () => {
  it("is blended only when every category was blended", () => {
    const blended = AUDIT_CATEGORIES.map((key) => ({
      key,
      geminiScore: 50,
      finalScore: 50,
      confidence: "blended" as const,
      baseline: 50,
      coverage: 1,
    }));
    expect(computeReportConfidence(blended)).toBe("blended");

    const withAiLed = blended.map((c) =>
      c.key === "copy" ? { ...c, confidence: "ai-led" as const } : c,
    );
    expect(computeReportConfidence(withAiLed)).toBe("ai-led");
  });
});
