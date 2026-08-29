import { describe, expect, it } from "vitest";
import {
  ALERT_SCHEMA_VERSION,
  DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD,
  alertDecisionSchema,
  alertEvaluationContextSchema,
  alertEvaluationResultSchema,
  alertReasonCodeSchema,
  alertReasonSchema,
  alertRuleTypeSchema,
  alertSeveritySchema,
} from "../src/index.js";
import type { AlertDecision, AlertEvaluationResult } from "../src/index.js";

describe("alert contracts", () => {
  it("exports expected threshold and version constants", () => {
    expect(ALERT_SCHEMA_VERSION).toBe("1.0.0");
    expect(DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD).toBe(3);
  });

  it("validates alert enum schemas", () => {
    expect(alertRuleTypeSchema.safeParse("overall_score_drop").success).toBe(true);
    expect(alertRuleTypeSchema.safeParse("category_score_drop").success).toBe(true);
    expect(alertRuleTypeSchema.safeParse("new_high_severity_finding").success).toBe(true);
    expect(alertRuleTypeSchema.safeParse("finding_severity_increased").success).toBe(true);
    expect(alertRuleTypeSchema.safeParse("signal_regressed").success).toBe(true);
    expect(alertRuleTypeSchema.safeParse("repeated_scan_failure").success).toBe(true);
    expect(alertRuleTypeSchema.safeParse("unknown_rule").success).toBe(false);

    expect(alertSeveritySchema.safeParse("high").success).toBe(true);
    expect(alertSeveritySchema.safeParse("medium").success).toBe(true);
    expect(alertSeveritySchema.safeParse("low").success).toBe(true);
    expect(alertSeveritySchema.safeParse("critical").success).toBe(false);

    expect(alertReasonCodeSchema.safeParse("SCORE_DROP_EXCEEDED").success).toBe(true);
    expect(alertReasonCodeSchema.safeParse("CATEGORY_SCORE_DROP_EXCEEDED").success).toBe(true);
    expect(alertReasonCodeSchema.safeParse("NEW_HIGH_SEVERITY_FINDING").success).toBe(true);
    expect(alertReasonCodeSchema.safeParse("FINDING_SEVERITY_ESCALATED").success).toBe(true);
    expect(alertReasonCodeSchema.safeParse("DETERMINISTIC_SIGNAL_REGRESSED").success).toBe(true);
    expect(alertReasonCodeSchema.safeParse("REPEATED_SCAN_FAILURES").success).toBe(true);
  });

  it("validates alert reason schema", () => {
    const validReason = alertReasonSchema.safeParse({
      code: "SCORE_DROP_EXCEEDED",
      summary: "Overall score dropped by 12 points.",
      details: "Exceeded threshold of 10 points.",
    });
    expect(validReason.success).toBe(true);

    const invalidReason = alertReasonSchema.safeParse({
      code: "INVALID_CODE",
      summary: "",
    });
    expect(invalidReason.success).toBe(false);
  });

  it("validates an AlertDecision payload with stable deduplication key", () => {
    const decision: AlertDecision = {
      schemaVersion: "1.0.0",
      shouldAlert: true,
      ruleType: "overall_score_drop",
      severity: "high",
      title: "Overall UX Score Drop",
      reason: {
        code: "SCORE_DROP_EXCEEDED",
        summary: "Overall score dropped by 12 points (82 -> 70).",
        details: "Exceeded regression threshold of 10 points.",
      },
      category: null,
      targetId: null,
      scoreDelta: -12,
      previousValue: 82,
      currentValue: 70,
      deduplicationKey: "alert:a1111111-1111-4111-8111-111111111111:overall_score_drop",
      evaluatedAt: "2026-08-27T10:00:00.000Z",
      metadata: {
        organizationId: "o1111111-1111-4111-8111-111111111111",
        projectId: "p1111111-1111-4111-8111-111111111111",
      },
    };

    const parsed = alertDecisionSchema.safeParse(decision);
    expect(parsed.success).toBe(true);
  });

  it("validates AlertEvaluationContext", () => {
    const validContext = alertEvaluationContextSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      monitoredPageId: "33333333-3333-4333-8333-333333333333",
      auditRunId: "44444444-4444-4444-8444-444444444444",
      consecutiveFailureCount: 2,
      evaluatedAt: "2026-08-27T10:00:00.000Z",
    });
    expect(validContext.success).toBe(true);

    const invalidContext = alertEvaluationContextSchema.safeParse({
      organizationId: "non-uuid",
      projectId: "22222222-2222-4222-8222-222222222222",
      monitoredPageId: "33333333-3333-4333-8333-333333333333",
      evaluatedAt: "invalid-date",
    });
    expect(invalidContext.success).toBe(false);
  });

  it("validates AlertEvaluationResult aggregate", () => {
    const result: AlertEvaluationResult = {
      schemaVersion: "1.0.0",
      monitoredPageId: "33333333-3333-4333-8333-333333333333",
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      auditRunId: "44444444-4444-4444-8444-444444444444",
      hasAlerts: true,
      totalAlertsCount: 1,
      highSeverityAlertsCount: 1,
      mediumSeverityAlertsCount: 0,
      lowSeverityAlertsCount: 0,
      decisions: [
        {
          schemaVersion: "1.0.0",
          shouldAlert: true,
          ruleType: "new_high_severity_finding",
          severity: "high",
          title: "New High-Severity Finding in ctaEffectiveness",
          reason: {
            code: "NEW_HIGH_SEVERITY_FINDING",
            summary: "Missing primary CTA button.",
          },
          category: "ctaEffectiveness",
          targetId: "top_problem:ctaEffectiveness:signal:cta.candidates",
          deduplicationKey:
            "alert:33333333-3333-4333-8333-333333333333:new_high_severity_finding:top_problem:ctaEffectiveness:signal:cta.candidates",
          evaluatedAt: "2026-08-27T10:00:00.000Z",
        },
      ],
      evaluatedAt: "2026-08-27T10:00:00.000Z",
    };

    const parsed = alertEvaluationResultSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });
});
