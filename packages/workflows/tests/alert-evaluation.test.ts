import { describe, expect, it } from "vitest";
import {
  AUDIT_CATEGORIES,
  DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD,
  MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD,
} from "@pagepilot/contracts";
import type {
  AlertEvaluationContext,
  DetectedSignal,
  Report,
  Severity,
} from "@pagepilot/contracts";
import { buildReport, computeAuditDiff } from "@pagepilot/audit-engine";
import type { GeminiAudit } from "@pagepilot/audit-engine";
import {
  buildAlertDeduplicationKey,
  evaluateAuditAlerts,
  evaluateScanFailureAlert,
} from "../src/index.js";

function coveredSignals(): DetectedSignal[] {
  return AUDIT_CATEGORIES.map((category) => ({
    id: `sig.${category}`,
    category,
    status: "pass",
    weight: 0.5,
    evidence: `${category} deterministic evidence.`,
  }));
}

function baseAuditFixture(): GeminiAudit {
  return {
    summary: "Base landing page summary.",
    categories: AUDIT_CATEGORIES.map((key) => ({
      key,
      score: 75,
      explanation: `${key} explanation.`,
      severity: "low" as Severity,
      findings: [
        {
          title: `${key} baseline finding`,
          severity: "low" as Severity,
          evidence: "Deterministic evidence baseline.",
          basis: "observed" as const,
          signalIds: [`sig.${key}`],
          recommendation: "Maintain standard baseline.",
        },
      ],
    })),
    topProblems: [
      {
        category: "ctaEffectiveness",
        title: "CTA wording is weak",
        severity: "medium" as Severity,
        evidence: "Button reads 'Submit'.",
        basis: "observed" as const,
        signalIds: ["cta.candidates"],
        recommendation: "Rewrite button label.",
      },
      {
        category: "clarity",
        title: "Meta description missing",
        severity: "medium" as Severity,
        evidence: "No meta description found.",
        basis: "observed" as const,
        signalIds: ["meta.description.present"],
        recommendation: "Add meta description.",
      },
      {
        category: "trustCredibility",
        title: "Trust links missing",
        severity: "low" as Severity,
        evidence: "No contact link found.",
        basis: "inferred" as const,
        signalIds: [],
        recommendation: "Add contact page.",
      },
    ],
    quickWins: [
      {
        title: "Add meta description",
        rationale: "Improves search clarity.",
        category: "clarity",
      },
      {
        title: "Add contact link",
        rationale: "Improves trust.",
        category: "trustCredibility",
      },
      {
        title: "Add button action text",
        rationale: "Improves CTA clarity.",
        category: "ctaEffectiveness",
      },
    ],
    detailedRecommendations: [
      {
        title: "Restructure headings",
        rationale: "Hierarchy fix.",
        category: "visualHierarchy",
        priority: 1,
      },
    ],
  };
}

function createReport(overrides?: {
  signals?: DetectedSignal[];
  mutateAudit?: (audit: GeminiAudit) => void;
  analyzedAt?: string;
}): Report {
  const audit = baseAuditFixture();
  if (overrides?.mutateAudit) {
    overrides.mutateAudit(audit);
  }

  const signals = overrides?.signals ?? coveredSignals();
  return buildReport({
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    title: "Example Landing Page",
    analyzedAt: new Date(overrides?.analyzedAt ?? "2026-08-20T10:00:00.000Z"),
    signals,
    audit,
  });
}

function createTestContext(overrides?: Partial<AlertEvaluationContext>): AlertEvaluationContext {
  return {
    organizationId: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    monitoredPageId: "33333333-3333-4333-8333-333333333333",
    auditRunId: "44444444-4444-4444-8444-444444444444",
    consecutiveFailureCount: 0,
    evaluatedAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildAlertDeduplicationKey", () => {
  it("generates stable deduplication key identifying the logical alert condition independent of auditRunId", () => {
    const key1 = buildAlertDeduplicationKey({
      monitoredPageId: "page-123",
      ruleType: "overall_score_drop",
    });
    expect(key1).toBe("alert:page-123:overall_score_drop");

    const key2 = buildAlertDeduplicationKey({
      monitoredPageId: "page-123",
      ruleType: "category_score_drop",
      targetId: "clarity",
    });
    expect(key2).toBe("alert:page-123:category_score_drop:clarity");

    const key3 = buildAlertDeduplicationKey({
      monitoredPageId: "page-123",
      ruleType: "new_high_severity_finding",
      targetId: "top_problem:ctaEffectiveness:signal:cta.candidates",
    });
    expect(key3).toBe(
      "alert:page-123:new_high_severity_finding:top_problem:ctaEffectiveness:signal:cta.candidates",
    );
  });
});

describe("evaluateAuditAlerts — Rules & Triggers", () => {
  it("suppresses alerts completely for baseline first-ever audits", () => {
    const report = createReport();
    const diff = computeAuditDiff({
      previousReport: null,
      currentReport: report,
    });

    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    expect(result.hasAlerts).toBe(false);
    expect(result.totalAlertsCount).toBe(0);
    expect(result.decisions).toHaveLength(0);
  });

  it("suppresses alerts when diff is unchanged", () => {
    const report = createReport();
    const diff = computeAuditDiff({
      previousReport: report,
      currentReport: report,
    });

    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    expect(result.hasAlerts).toBe(false);
    expect(result.totalAlertsCount).toBe(0);
    expect(result.decisions).toHaveLength(0);
  });

  it("Rule 1: triggers high-severity alert when overall score drops >= 10 points", () => {
    const prev = createReport({
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 90;
        });
      },
    });
    const curr = createReport({
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 65;
        });
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    expect(diff.scoreChanges.overall.delta!).toBeLessThanOrEqual(-MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD);

    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    expect(result.hasAlerts).toBe(true);
    const overallAlert = result.decisions.find((d) => d.ruleType === "overall_score_drop");
    expect(overallAlert).toBeDefined();
    expect(overallAlert?.severity).toBe("high");
    expect(overallAlert?.reason.code).toBe("SCORE_DROP_EXCEEDED");
    expect(overallAlert?.deduplicationKey).toBe(
      `alert:${context.monitoredPageId}:overall_score_drop`,
    );
  });

  it("Rule 1 (Negative): does NOT trigger overall score alert when drop is < 10 points", () => {
    const prev = createReport({
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 80;
        });
      },
    });
    const curr = createReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "copy")!.score = 65;
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    expect(diff.scoreChanges.overall.delta!).toBeLessThan(0);
    expect(diff.scoreChanges.overall.delta!).toBeGreaterThan(-MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD);

    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    const overallAlert = result.decisions.find((d) => d.ruleType === "overall_score_drop");
    expect(overallAlert).toBeUndefined();
  });

  it("Rule 2: triggers alert for category score drop >= 15 points; suppresses for drop < 15 points", () => {
    const prev = createReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "clarity")!.score = 90;
        a.categories.find((c) => c.key === "trustCredibility")!.score = 80;
      },
    });
    const curr = createReport({
      mutateAudit: (a) => {
        // Clarity drops 90 -> 50 (blended drop >= 15)
        a.categories.find((c) => c.key === "clarity")!.score = 50;
        // Trust drops 80 -> 70 (blended drop < 15)
        a.categories.find((c) => c.key === "trustCredibility")!.score = 70;
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    const clarityAlert = result.decisions.find(
      (d) => d.ruleType === "category_score_drop" && d.category === "clarity",
    );
    expect(clarityAlert).toBeDefined();
    expect(clarityAlert?.reason.code).toBe("CATEGORY_SCORE_DROP_EXCEEDED");
    expect(clarityAlert?.deduplicationKey).toBe(
      `alert:${context.monitoredPageId}:category_score_drop:clarity`,
    );

    // Trust drop was smaller than 15 -> must NOT trigger alert
    const trustAlert = result.decisions.find(
      (d) => d.ruleType === "category_score_drop" && d.category === "trustCredibility",
    );
    expect(trustAlert).toBeUndefined();
  });

  it("Rule 3: triggers high-severity alert for new high-severity findings; ignores low/medium findings", () => {
    const prev = createReport();
    const curr = createReport({
      mutateAudit: (a) => {
        // Replace top problem with a brand new high-severity finding with distinct identity (forms.present)
        a.topProblems[0] = {
          category: "ctaEffectiveness",
          title: "Missing Primary CTA",
          severity: "high",
          evidence: "No call-to-action button exists in hero.",
          basis: "observed",
          signalIds: ["forms.present"],
          recommendation: "Add primary button.",
        };
        // Add low-severity category finding
        a.categories.find((c) => c.key === "copy")!.findings.push({
          title: "Minor typo in footer",
          severity: "low",
          evidence: "Spelling error in terms link.",
          basis: "observed",
          signalIds: [],
          recommendation: "Fix typo.",
        });
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    const highFindingAlert = result.decisions.find(
      (d) => d.ruleType === "new_high_severity_finding",
    );
    expect(highFindingAlert).toBeDefined();
    expect(highFindingAlert?.severity).toBe("high");
    expect(highFindingAlert?.category).toBe("ctaEffectiveness");
    expect(highFindingAlert?.reason.code).toBe("NEW_HIGH_SEVERITY_FINDING");

    // The low severity finding must NOT trigger a new_high_severity_finding alert
    const lowFindingAlert = result.decisions.find(
      (d) => d.targetId?.includes("minor-typo"),
    );
    expect(lowFindingAlert).toBeUndefined();
  });

  it("Rule 4: triggers alert when finding severity increases; ignores severity decreases", () => {
    const prev = createReport({
      mutateAudit: (a) => {
        a.topProblems[0]!.severity = "low";
        a.topProblems[1]!.severity = "high";
      },
    });
    const curr = createReport({
      mutateAudit: (a) => {
        // Problem 0 escalated from low -> high
        a.topProblems[0]!.severity = "high";
        // Problem 1 de-escalated from high -> low (improvement)
        a.topProblems[1]!.severity = "low";
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    const escalatedAlert = result.decisions.find(
      (d) => d.ruleType === "finding_severity_increased",
    );
    expect(escalatedAlert).toBeDefined();
    expect(escalatedAlert?.severity).toBe("high");
    expect(escalatedAlert?.previousValue).toBe("low");
    expect(escalatedAlert?.currentValue).toBe("high");

    // De-escalation must not trigger an alert
    const deescalatedAlerts = result.decisions.filter(
      (d) => d.ruleType === "finding_severity_increased" && d.category === a11yCategory(diff),
    );
    expect(deescalatedAlerts).toHaveLength(0);
  });

  function a11yCategory(_diff: unknown) {
    return "clarity";
  }

  it("Rule 5: triggers alert when deterministic signal regresses (pass -> warn)", () => {
    const prevSignals: DetectedSignal[] = [
      {
        id: "meta.description.present",
        category: "clarity",
        status: "pass",
        weight: 0.4,
        evidence: "Meta description present.",
      },
    ];
    const currSignals: DetectedSignal[] = [
      {
        id: "meta.description.present",
        category: "clarity",
        status: "warn",
        weight: 0.4,
        evidence: "No meta description found.",
      },
    ];

    const prev = createReport({ signals: prevSignals });
    const curr = createReport({ signals: currSignals });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    const signalAlert = result.decisions.find(
      (d) => d.ruleType === "signal_regressed" && d.targetId === "meta.description.present",
    );
    expect(signalAlert).toBeDefined();
    expect(signalAlert?.severity).toBe("medium");
    expect(signalAlert?.reason.code).toBe("DETERMINISTIC_SIGNAL_REGRESSED");
    expect(signalAlert?.deduplicationKey).toBe(
      `alert:${context.monitoredPageId}:signal_regressed:meta.description.present`,
    );
  });

  it("suppresses alerts for unknown signal transitions (unknown <-> measured)", () => {
    const prevSignals: DetectedSignal[] = [
      {
        id: "forms.labels",
        category: "accessibility",
        status: "unknown",
        weight: 0.25,
        evidence: "Cannot assess.",
      },
    ];
    const currSignals: DetectedSignal[] = [
      {
        id: "forms.labels",
        category: "accessibility",
        status: "warn",
        weight: 0.25,
        evidence: "Form fields lack labels.",
      },
    ];

    const prev = createReport({ signals: prevSignals });
    const curr = createReport({ signals: currSignals });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const context = createTestContext();
    const result = evaluateAuditAlerts(diff, context);

    const signalAlerts = result.decisions.filter((d) => d.ruleType === "signal_regressed");
    expect(signalAlerts).toHaveLength(0);
  });
});

describe("evaluateScanFailureAlert — Repeated Failures Rule", () => {
  it("triggers repeated scan failure alert when consecutive failure count reaches threshold of 3", () => {
    const context = createTestContext({
      consecutiveFailureCount: DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD,
    });

    const decision = evaluateScanFailureAlert(context, {
      errorCode: "UPSTREAM_FAILURE",
      errorMessage: "Target server returned 502 Bad Gateway.",
    });

    expect(decision).not.toBeNull();
    expect(decision?.ruleType).toBe("repeated_scan_failure");
    expect(decision?.severity).toBe("high");
    expect(decision?.reason.code).toBe("REPEATED_SCAN_FAILURES");
    expect(decision?.currentValue).toBe(3);
    expect(decision?.deduplicationKey).toBe(
      `alert:${context.monitoredPageId}:repeated_scan_failure`,
    );
  });

  it("returns null when consecutive failure count is below threshold of 3", () => {
    const context = createTestContext({
      consecutiveFailureCount: 2,
    });

    const decision = evaluateScanFailureAlert(context, {
      errorCode: "TIMEOUT",
      errorMessage: "Target timed out.",
    });

    expect(decision).toBeNull();
  });
});

describe("sortAlertDecisions & Determinism", () => {
  it("sorts multiple simultaneous alert decisions deterministically (high severity first)", () => {
    const context = createTestContext();
    const prev = createReport({
      mutateAudit: (a) => {
        a.categories.find((c) => c.key === "clarity")!.score = 90;
      },
    });
    const curr = createReport({
      mutateAudit: (a) => {
        // Overall and category drop
        a.categories.find((c) => c.key === "clarity")!.score = 50;
        // New high severity finding
        a.topProblems[0] = {
          category: "ctaEffectiveness",
          title: "Broken Hero CTA Button",
          severity: "high",
          evidence: "Button does not respond.",
          basis: "observed",
          signalIds: ["forms.present"],
          recommendation: "Fix button handler.",
        };
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const result = evaluateAuditAlerts(diff, context);

    expect(result.decisions.length).toBeGreaterThan(1);

    // Verify ordering: high severities are at the top
    for (let i = 0; i < result.decisions.length - 1; i++) {
      const current = result.decisions[i]!;
      const next = result.decisions[i + 1]!;
      const sevOrder = { high: 1, medium: 2, low: 3 };
      expect(sevOrder[current.severity]).toBeLessThanOrEqual(sevOrder[next.severity]);
    }
  });

  it("guarantees 100% determinism: 100 consecutive evaluations return byte-identical results", () => {
    const prev = createReport({ analyzedAt: "2026-08-20T10:00:00.000Z" });
    const curr = createReport({
      analyzedAt: "2026-08-27T10:00:00.000Z",
      mutateAudit: (a) => {
        a.categories.forEach((c) => {
          c.score = 50;
        });
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });
    const context = createTestContext();

    const baselineJson = JSON.stringify(evaluateAuditAlerts(diff, context));

    for (let i = 0; i < 100; i++) {
      const runJson = JSON.stringify(evaluateAuditAlerts(diff, context));
      expect(runJson).toBe(baselineJson);
    }
  });

  it("produces identical deduplication keys across different audit runs for the same page regression", () => {
    const prev = createReport();
    const curr = createReport({
      mutateAudit: (a) => {
        a.topProblems[0] = {
          category: "ctaEffectiveness",
          title: "Primary Button Ineffective",
          severity: "high",
          evidence: "Button lacks action text.",
          basis: "observed",
          signalIds: ["forms.present"],
          recommendation: "Change text.",
        };
      },
    });

    const diff = computeAuditDiff({ previousReport: prev, currentReport: curr });

    // Evaluate in Run A
    const contextA = createTestContext({
      auditRunId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const resultA = evaluateAuditAlerts(diff, contextA);

    // Evaluate in Run B
    const contextB = createTestContext({
      auditRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    const resultB = evaluateAuditAlerts(diff, contextB);

    expect(resultA.decisions[0]?.deduplicationKey).toBe(
      resultB.decisions[0]?.deduplicationKey,
    );
  });
});
