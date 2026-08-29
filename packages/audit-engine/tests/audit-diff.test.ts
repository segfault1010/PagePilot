import { describe, expect, it } from "vitest";
import {
  AUDIT_CATEGORIES,
  MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD,
  MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD,
  auditDiffSchema,
} from "@pagepilot/contracts";
import type { DetectedSignal, Report } from "@pagepilot/contracts";
import {
  buildFindingIdentityKey,
  compareSeverity,
  computeAuditDiff,
  normalizeFindingTitleSlug,
} from "../src/index.js";
import { buildReport } from "../src/scoring/score-report.js";
import { validGeminiAudit } from "./fixtures/gemini-audit.js";

function coveredSignals(): DetectedSignal[] {
  return AUDIT_CATEGORIES.map((category) => ({
    id: `sig.${category}`,
    category,
    status: "pass",
    weight: 0.5,
    evidence: `${category} deterministic evidence.`,
  }));
}

function createSampleReport(overrides?: {
  overallScoreOffset?: number;
  analyzedAt?: string;
  signals?: DetectedSignal[];
  mutateAudit?: (audit: ReturnType<typeof validGeminiAudit>) => void;
}): Report {
  const audit = validGeminiAudit();
  if (overrides?.mutateAudit) {
    overrides.mutateAudit(audit);
  }

  const signals = overrides?.signals ?? coveredSignals();
  const report = buildReport({
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    title: "Example Landing Page",
    analyzedAt: new Date(overrides?.analyzedAt ?? "2026-08-20T10:00:00.000Z"),
    signals,
    audit,
  });

  return report;
}

describe("normalizeFindingTitleSlug & buildFindingIdentityKey", () => {
  it("normalizes finding title into clean slug ignoring punctuation and stop words", () => {
    expect(
      normalizeFindingTitleSlug("Primary CTA is not prominent and clear!"),
    ).toBe("primary-cta-not-prominent-clear");
    expect(
      normalizeFindingTitleSlug("The Meta Description Tag is Missing."),
    ).toBe("meta-description-tag-missing");
  });

  it("prioritizes sorted deterministic signalIds for observed findings", () => {
    const key1 = buildFindingIdentityKey(
      "top_problem",
      "ctaEffectiveness",
      ["cta.candidates", "links.action"],
      "Primary CTA lacks prominence",
    );
    const key2 = buildFindingIdentityKey(
      "top_problem",
      "ctaEffectiveness",
      ["links.action", "cta.candidates"],
      "Action buttons are not noticeable",
    );

    // Both match on sorted signal IDs regardless of AI wording differences
    expect(key1).toBe("top_problem:ctaEffectiveness:signal:cta.candidates+links.action");
    expect(key2).toBe("top_problem:ctaEffectiveness:signal:cta.candidates+links.action");
    expect(key1).toBe(key2);
  });

  it("uses normalized slug for inferred findings without signalIds", () => {
    const key = buildFindingIdentityKey(
      "top_problem",
      "trustCredibility",
      [],
      "Trust links are not discoverable",
    );
    expect(key).toBe("top_problem:trustCredibility:inferred:trust-links-not-discoverable");
  });
});

describe("compareSeverity", () => {
  it("detects severity increases, decreases, and unchanged states", () => {
    expect(compareSeverity("low", "medium")).toBe("increased");
    expect(compareSeverity("low", "high")).toBe("increased");
    expect(compareSeverity("medium", "high")).toBe("increased");

    expect(compareSeverity("high", "medium")).toBe("decreased");
    expect(compareSeverity("high", "low")).toBe("decreased");
    expect(compareSeverity("medium", "low")).toBe("decreased");

    expect(compareSeverity("medium", "medium")).toBe("unchanged");
    expect(compareSeverity(null, "high")).toBe("unchanged");
  });
});

describe("computeAuditDiff — Comprehensive Scenarios", () => {
  // ---------------------------------------------------------------------------
  // Scenario 1: Baseline / First Audit (no previous report)
  // ---------------------------------------------------------------------------
  it("Scenario 1: returns explicit baseline state with zero false regressions when previousReport is null", () => {
    const currentReport = createSampleReport();

    const diff = computeAuditDiff({
      previousReport: null,
      currentReport,
      currentRunMeta: {
        auditRunId: "b2222222-2222-4222-8222-222222222222",
        modelVersion: "gemini-3.6-flash",
      },
    });

    expect(diff.summary.isBaseline).toBe(true);
    expect(diff.summary.hasPreviousReport).toBe(false);
    expect(diff.summary.hasMeaningfulRegression).toBe(false);
    expect(diff.summary.overallScoreDelta).toBeNull();
    expect(diff.summary.overallScoreDirection).toBe("unchanged");
    expect(diff.summary.totalRegressionsCount).toBe(0);
    expect(diff.summary.totalImprovementsCount).toBe(0);
    expect(diff.regressions).toEqual([]);
    expect(diff.improvements).toEqual([]);

    expect(diff.scoreChanges.overall.previousScore).toBeNull();
    expect(diff.scoreChanges.overall.delta).toBeNull();
    expect(diff.scoreChanges.overall.direction).toBe("unchanged");
    expect(diff.scoreChanges.overall.isMeaningfulRegression).toBe(false);

    for (const cat of diff.scoreChanges.categories) {
      expect(cat.previousScore).toBeNull();
      expect(cat.delta).toBeNull();
      expect(cat.direction).toBe("unchanged");
      expect(cat.isMeaningfulRegression).toBe(false);
    }

    expect(diff.metadata.previousAuditRunId).toBeNull();
    expect(diff.metadata.currentAuditRunId).toBe("b2222222-2222-4222-8222-222222222222");

    expect(auditDiffSchema.safeParse(diff).success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Scenario 2: Identical Reports
  // ---------------------------------------------------------------------------
  it("Scenario 2: diffing identical reports produces 0 score deltas and zero regressions", () => {
    const report = createSampleReport();

    const diff = computeAuditDiff({
      previousReport: report,
      currentReport: report,
    });

    expect(diff.summary.isBaseline).toBe(false);
    expect(diff.summary.hasPreviousReport).toBe(true);
    expect(diff.summary.hasMeaningfulRegression).toBe(false);
    expect(diff.summary.overallScoreDelta).toBe(0);
    expect(diff.summary.overallScoreDirection).toBe("unchanged");

    expect(diff.scoreChanges.overall.delta).toBe(0);
    expect(diff.scoreChanges.overall.direction).toBe("unchanged");
    expect(diff.scoreChanges.overall.isMeaningfulRegression).toBe(false);

    for (const cat of diff.scoreChanges.categories) {
      expect(cat.delta).toBe(0);
      expect(cat.direction).toBe("unchanged");
      expect(cat.isMeaningfulRegression).toBe(false);
    }

    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
    expect(diff.changedFindings).toHaveLength(0);
    expect(diff.unchangedFindings.length).toBeGreaterThan(0);

    for (const sig of diff.signalChanges) {
      expect(sig.changeType).toBe("unchanged");
      expect(sig.isRegression).toBe(false);
      expect(sig.isImprovement).toBe(false);
    }

    expect(diff.regressions).toHaveLength(0);
    expect(diff.improvements).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Scenario 3: Overall Score Drop >= 10 (Meaningful Regression)
  // ---------------------------------------------------------------------------
  it("Scenario 3: overall score drop >= 10 points triggers meaningful regression", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 90;
        });
      },
    });
    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 65;
        });
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const delta = currentReport.overallScore - previousReport.overallScore;
    expect(delta).toBeLessThanOrEqual(-MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD);

    expect(diff.scoreChanges.overall.delta).toBe(delta);
    expect(diff.scoreChanges.overall.direction).toBe("regressed");
    expect(diff.scoreChanges.overall.isMeaningfulRegression).toBe(true);
    expect(diff.summary.hasMeaningfulRegression).toBe(true);

    const overallDropItem = diff.regressions.find((r) => r.type === "overall_score_drop");
    expect(overallDropItem).toBeDefined();
    expect(overallDropItem?.scoreDelta).toBe(delta);
    expect(overallDropItem?.severity).toBe("high");
  });

  // ---------------------------------------------------------------------------
  // Scenario 4: Overall Score Drop < 10 (Minor drop, not meaningful regression)
  // ---------------------------------------------------------------------------
  it("Scenario 4: overall score drop < 10 points has direction=regressed but is NOT a meaningful regression", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 80;
        });
      },
    });
    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        // Drop copy slightly by 5 points (blends to ~3 points overall)
        const copyCat = a.categories.find((c) => c.key === "copy")!;
        copyCat.score = 60;
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const delta = currentReport.overallScore - previousReport.overallScore;
    expect(delta).toBeLessThan(0);
    expect(delta).toBeGreaterThan(-MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD);

    expect(diff.scoreChanges.overall.direction).toBe("regressed");
    expect(diff.scoreChanges.overall.isMeaningfulRegression).toBe(false);
    expect(diff.summary.hasMeaningfulRegression).toBe(false);

    // Must NOT contain overall_score_drop regression item
    const overallDropItem = diff.regressions.find((r) => r.type === "overall_score_drop");
    expect(overallDropItem).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 5: Category Score Regressions (Meaningful >= 15 vs Minor < 15)
  // ---------------------------------------------------------------------------
  it("Scenario 5: category score drop >= 15 is meaningful and included in regressions; smaller drop is excluded from regressions", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "clarity")!.score = 90;
        a.categories.find((c) => c.key === "trustCredibility")!.score = 80;
      },
    });

    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        // Clarity drops heavily: 90 -> 50 (blended score drops by 24 points >= 15)
        a.categories.find((c) => c.key === "clarity")!.score = 50;
        // Trust drops slightly: 80 -> 70 (blended score drops by 6 points < 15)
        a.categories.find((c) => c.key === "trustCredibility")!.score = 70;
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const clarityChange = diff.scoreChanges.categories.find((c) => c.category === "clarity")!;
    expect(clarityChange.delta).toBeLessThanOrEqual(-MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD);
    expect(clarityChange.direction).toBe("regressed");
    expect(clarityChange.isMeaningfulRegression).toBe(true);

    const trustChange = diff.scoreChanges.categories.find(
      (c) => c.category === "trustCredibility",
    )!;
    expect(trustChange.delta).toBeLessThan(0);
    expect(trustChange.delta).toBeGreaterThan(-MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD);
    expect(trustChange.direction).toBe("regressed");
    expect(trustChange.isMeaningfulRegression).toBe(false);

    // Clarity regression item MUST exist
    const clarityRegression = diff.regressions.find(
      (r) => r.type === "category_score_drop" && r.category === "clarity",
    );
    expect(clarityRegression).toBeDefined();
    expect(clarityRegression?.scoreDelta).toBe(clarityChange.delta);

    // Trust regression item must NOT exist in regressions
    const trustRegression = diff.regressions.find(
      (r) => r.type === "category_score_drop" && r.category === "trustCredibility",
    );
    expect(trustRegression).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 6: Category Score Improvements
  // ---------------------------------------------------------------------------
  it("Scenario 6: category score improvement is tracked and added to improvements", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "accessibility")!.score = 40;
      },
    });
    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "accessibility")!.score = 85;
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const a11yChange = diff.scoreChanges.categories.find(
      (c) => c.category === "accessibility",
    )!;
    expect(a11yChange.delta).toBeGreaterThan(0);
    expect(a11yChange.direction).toBe("improved");

    const improvement = diff.improvements.find(
      (i) => i.type === "category_score_increase" && i.category === "accessibility",
    );
    expect(improvement).toBeDefined();
    expect(improvement?.scoreDelta).toBe(a11yChange.delta);
  });

  // ---------------------------------------------------------------------------
  // Scenario 7: New Finding (Low vs High Severity)
  // ---------------------------------------------------------------------------
  it("Scenario 7: newly detected high-severity finding triggers meaningful regression; low severity does not", () => {
    const previousReport = createSampleReport();

    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        // Replace topProblems[0] with a brand new high-severity finding with distinct identity
        a.topProblems[0] = {
          category: "ctaEffectiveness",
          title: "Critical Missing Primary Action",
          severity: "high",
          evidence: "No interactive CTA button exists in the hero viewport.",
          basis: "observed",
          signalIds: ["forms.present"],
          recommendation: "Add a high-contrast primary CTA above the fold.",
        };
        // Add a new low severity category finding (category finding list can have up to 3)
        a.categories.find((c) => c.key === "copy")!.findings.push({
          title: "Subtle punctuation inconsistency",
          severity: "low",
          evidence: "Footer text uses mixed period styles.",
          basis: "observed",
          signalIds: [],
          recommendation: "Standardize punctuation.",
        });
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    expect(diff.newFindings.length).toBeGreaterThan(0);

    const highSeverityFinding = diff.newFindings.find(
      (f) => f.currentTitle === "Critical Missing Primary Action",
    );
    expect(highSeverityFinding).toBeDefined();
    expect(highSeverityFinding?.isSeverityRegression).toBe(true);

    const lowSeverityFinding = diff.newFindings.find(
      (f) => f.currentTitle === "Subtle punctuation inconsistency",
    );
    expect(lowSeverityFinding).toBeDefined();
    expect(lowSeverityFinding?.isSeverityRegression).toBe(false);

    // Meaningful regression must be true due to new high severity finding
    expect(diff.summary.hasMeaningfulRegression).toBe(true);
    expect(diff.summary.newHighSeverityFindingsCount).toBeGreaterThanOrEqual(1);

    const highSeverityRegression = diff.regressions.find(
      (r) => r.type === "new_high_severity_finding",
    );
    expect(highSeverityRegression).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 8: Resolved Finding
  // ---------------------------------------------------------------------------
  it("Scenario 8: resolved finding is detected and added to improvements", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        a.topProblems[0] = {
          category: "clarity",
          title: "Missing H1 Tag",
          severity: "medium",
          evidence: "No H1 element found.",
          basis: "observed",
          signalIds: ["h1.single-meaningful"],
          recommendation: "Add an H1 heading.",
        };
      },
    });

    // Current report replaces that problem with another one, so Missing H1 is resolved
    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        a.topProblems[0] = {
          category: "clarity",
          title: "Alternative Problem Tag",
          severity: "low",
          evidence: "Alternative evidence.",
          basis: "observed",
          signalIds: ["title.present"],
          recommendation: "Review title.",
        };
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const resolved = diff.resolvedFindings.find(
      (f) => f.signalIds.includes("h1.single-meaningful"),
    );
    expect(resolved).toBeDefined();
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.previousTitle).toBe("Missing H1 Tag");
    expect(resolved?.currentTitle).toBeNull();

    const improvement = diff.improvements.find(
      (i) => i.type === "finding_resolved" && i.findingId === resolved?.id,
    );
    expect(improvement).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 9: Changed Finding Severity (Escalation vs De-escalation)
  // ---------------------------------------------------------------------------
  it("Scenario 9: detects severity increases (regression) and decreases (improvement)", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        const problem = a.topProblems.find((p) => p.category === "clarity")!;
        problem.severity = "low";
      },
    });

    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        const problem = a.topProblems.find((p) => p.category === "clarity")!;
        problem.severity = "high";
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const changed = diff.changedFindings.find((f) => f.category === "clarity");
    expect(changed).toBeDefined();
    expect(changed?.severityChange).toBe("increased");
    expect(changed?.isSeverityRegression).toBe(true);

    const severityRegression = diff.regressions.find(
      (r) => r.type === "finding_severity_increased" && r.findingId === changed?.id,
    );
    expect(severityRegression).toBeDefined();
    expect(severityRegression?.severity).toBe("high");
  });

  // ---------------------------------------------------------------------------
  // Scenario 10: Changed Evidence / Recommendation (Wording change with same severity)
  // ---------------------------------------------------------------------------
  it("Scenario 10: detects material evidence and recommendation updates as changed findings", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        const problem = a.topProblems.find((p) => p.category === "ctaEffectiveness")!;
        problem.evidence = "Old evidence snippet A.";
        problem.recommendation = "Old recommendation A.";
      },
    });

    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        const problem = a.topProblems.find((p) => p.category === "ctaEffectiveness")!;
        problem.evidence = "New evidence snippet B.";
        problem.recommendation = "New recommendation B.";
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const changed = diff.changedFindings.find(
      (f) => f.category === "ctaEffectiveness",
    );
    expect(changed).toBeDefined();
    expect(changed?.isMaterialChange).toBe(true);
    expect(changed?.severityChange).toBe("unchanged");
    expect(changed?.isSeverityRegression).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Scenario 11: Observed Signal Regression (pass -> warn)
  // ---------------------------------------------------------------------------
  it("Scenario 11: signal status transition pass -> warn is a regression", () => {
    const previousSignals: DetectedSignal[] = [
      {
        id: "meta.description.present",
        category: "clarity",
        status: "pass",
        weight: 0.4,
        evidence: "Meta description present.",
      },
    ];
    const currentSignals: DetectedSignal[] = [
      {
        id: "meta.description.present",
        category: "clarity",
        status: "warn",
        weight: 0.4,
        evidence: "No meta description found.",
      },
    ];

    const previousReport = createSampleReport({ signals: previousSignals });
    const currentReport = createSampleReport({ signals: currentSignals });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const sigChange = diff.signalChanges.find(
      (s) => s.signalId === "meta.description.present",
    );
    expect(sigChange).toBeDefined();
    expect(sigChange?.changeType).toBe("regressed");
    expect(sigChange?.isRegression).toBe(true);
    expect(sigChange?.isImprovement).toBe(false);

    const signalRegression = diff.regressions.find(
      (r) => r.type === "signal_regressed" && r.signalId === "meta.description.present",
    );
    expect(signalRegression).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 12: Unknown Signal (unknown -> unknown)
  // ---------------------------------------------------------------------------
  it("Scenario 12: unknown signals persisting in unknown state do not trigger regressions or penalties", () => {
    const previousSignals: DetectedSignal[] = [
      {
        id: "images.alt-coverage",
        category: "accessibility",
        status: "unknown",
        weight: 0.35,
        evidence: "No images on page.",
      },
    ];
    const currentSignals: DetectedSignal[] = [
      {
        id: "images.alt-coverage",
        category: "accessibility",
        status: "unknown",
        weight: 0.35,
        evidence: "No images on page.",
      },
    ];

    const previousReport = createSampleReport({ signals: previousSignals });
    const currentReport = createSampleReport({ signals: currentSignals });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const sigChange = diff.signalChanges.find(
      (s) => s.signalId === "images.alt-coverage",
    );
    expect(sigChange).toBeDefined();
    expect(sigChange?.changeType).toBe("unchanged");
    expect(sigChange?.isRegression).toBe(false);
    expect(sigChange?.isImprovement).toBe(false);

    const reg = diff.regressions.find((r) => r.signalId === "images.alt-coverage");
    expect(reg).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Scenario 13: Unknown -> Measured (unknown -> pass | warn)
  // ---------------------------------------------------------------------------
  it("Scenario 13: unknown transitioning to pass or warn is became_measured and NOT a regression", () => {
    const previousSignals: DetectedSignal[] = [
      {
        id: "forms.labels",
        category: "accessibility",
        status: "unknown",
        weight: 0.25,
        evidence: "No form fields found.",
      },
      {
        id: "links.text-quality",
        category: "copy",
        status: "unknown",
        weight: 0.2,
        evidence: "No links found.",
      },
    ];
    const currentSignals: DetectedSignal[] = [
      {
        id: "forms.labels",
        category: "accessibility",
        status: "pass",
        weight: 0.25,
        evidence: "All form fields have labels.",
      },
      {
        id: "links.text-quality",
        category: "copy",
        status: "warn",
        weight: 0.2,
        evidence: "Generic click here link found.",
      },
    ];

    const previousReport = createSampleReport({ signals: previousSignals });
    const currentReport = createSampleReport({ signals: currentSignals });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const formsChange = diff.signalChanges.find((s) => s.signalId === "forms.labels")!;
    expect(formsChange.changeType).toBe("became_measured");
    expect(formsChange.isRegression).toBe(false);

    const linksChange = diff.signalChanges.find(
      (s) => s.signalId === "links.text-quality",
    )!;
    expect(linksChange.changeType).toBe("became_measured");
    expect(linksChange.isRegression).toBe(false);

    // Zero false regressions created by unknown transitions
    expect(diff.regressions.filter((r) => r.type === "signal_regressed")).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Scenario 14: Measured -> Unknown (pass | warn -> unknown)
  // ---------------------------------------------------------------------------
  it("Scenario 14: measured transitioning to unknown is became_unknown and NOT a regression", () => {
    const previousSignals: DetectedSignal[] = [
      {
        id: "title.length",
        category: "clarity",
        status: "pass",
        weight: 0.3,
        evidence: "Title is 40 characters.",
      },
    ];
    const currentSignals: DetectedSignal[] = [
      {
        id: "title.length",
        category: "clarity",
        status: "unknown",
        weight: 0.3,
        evidence: "Title length cannot be assessed.",
      },
    ];

    const previousReport = createSampleReport({ signals: previousSignals });
    const currentReport = createSampleReport({ signals: currentSignals });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    const titleChange = diff.signalChanges.find((s) => s.signalId === "title.length")!;
    expect(titleChange.changeType).toBe("became_unknown");
    expect(titleChange.isRegression).toBe(false);
    expect(diff.regressions.filter((r) => r.type === "signal_regressed")).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Scenario 15: Multiple Simultaneous Changes
  // ---------------------------------------------------------------------------
  it("Scenario 15: accurately computes multi-dimensional changes across scores, findings, and signals", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "clarity")!.score = 90;
        a.categories.find((c) => c.key === "visualHierarchy")!.score = 50;
      },
    });

    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        // Clarity drops heavily
        a.categories.find((c) => c.key === "clarity")!.score = 55;
        // Visual hierarchy improves
        a.categories.find((c) => c.key === "visualHierarchy")!.score = 90;
        // Replace top problem with new high severity problem
        a.topProblems[0] = {
          category: "ctaEffectiveness",
          title: "New blocker in CTA",
          severity: "high",
          evidence: "Form is broken.",
          basis: "observed",
          signalIds: ["forms.present"],
          recommendation: "Fix form submission.",
        };
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    expect(diff.summary.isBaseline).toBe(false);
    expect(diff.summary.hasPreviousReport).toBe(true);
    expect(diff.summary.hasMeaningfulRegression).toBe(true);
    expect(diff.summary.regressedCategoriesCount).toBeGreaterThanOrEqual(1);
    expect(diff.summary.improvedCategoriesCount).toBeGreaterThanOrEqual(1);
    expect(diff.summary.newHighSeverityFindingsCount).toBeGreaterThanOrEqual(1);
    expect(diff.summary.totalRegressionsCount).toBeGreaterThanOrEqual(1);
    expect(diff.summary.totalImprovementsCount).toBeGreaterThanOrEqual(1);

    expect(auditDiffSchema.safeParse(diff).success).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Determinism & Immutability Guarantees
  // ---------------------------------------------------------------------------
  it("guarantees 100% determinism: 100 consecutive diff calls produce byte-identical JSON", () => {
    const prev = createSampleReport({ analyzedAt: "2026-08-20T10:00:00.000Z" });
    const curr = createSampleReport({ analyzedAt: "2026-08-27T10:00:00.000Z" });

    const baselineJson = JSON.stringify(
      computeAuditDiff({ previousReport: prev, currentReport: curr }),
    );

    for (let i = 0; i < 100; i++) {
      const outputJson = JSON.stringify(
        computeAuditDiff({ previousReport: prev, currentReport: curr }),
      );
      expect(outputJson).toBe(baselineJson);
    }
  });

  it("guarantees historical report immutability: input reports are never mutated", () => {
    const prev = createSampleReport({ analyzedAt: "2026-08-20T10:00:00.000Z" });
    const curr = createSampleReport({ analyzedAt: "2026-08-27T10:00:00.000Z" });

    const prevClone = structuredClone(prev);
    const currClone = structuredClone(curr);

    computeAuditDiff({
      previousReport: prev,
      currentReport: curr,
    });

    expect(prev).toEqual(prevClone);
    expect(curr).toEqual(currClone);
  });

  // ---------------------------------------------------------------------------
  // Gemini AI Wording Resilience
  // ---------------------------------------------------------------------------
  it("matches observed findings across minor LLM wording rewrites via stable signalIds", () => {
    const previousReport = createSampleReport({
      mutateAudit: (a) => {
        const topCta = a.topProblems.find((p) => p.category === "ctaEffectiveness")!;
        topCta.title = "Primary CTA lacks prominence";
        topCta.signalIds = ["cta.candidates"];
      },
    });

    const currentReport = createSampleReport({
      mutateAudit: (a) => {
        const topCta = a.topProblems.find((p) => p.category === "ctaEffectiveness")!;
        topCta.title = "Main call-to-action button is not sufficiently prominent";
        topCta.signalIds = ["cta.candidates"];
      },
    });

    const diff = computeAuditDiff({
      previousReport,
      currentReport,
    });

    // Wording changed, but it matched the same identity so it's NOT a brand new finding
    expect(diff.newFindings.filter((f) => f.category === "ctaEffectiveness")).toHaveLength(0);
    const changed = diff.changedFindings.find((f) => f.category === "ctaEffectiveness");
    expect(changed).toBeDefined();
    expect(changed?.id).toBe("top_problem:ctaEffectiveness:signal:cta.candidates");
  });
});
