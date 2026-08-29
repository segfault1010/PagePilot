import {
  ALERT_SCHEMA_VERSION,
  DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD,
  MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD,
  MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD,
  alertDecisionSchema,
  alertEvaluationResultSchema,
} from "@pagepilot/contracts";
import type {
  AlertDecision,
  AlertEvaluationContext,
  AlertEvaluationResult,
  AlertRuleType,
  AlertSeverity,
  AuditDiff,
} from "@pagepilot/contracts";

/**
 * Options to customize thresholds for alert evaluation.
 */
export interface AlertEvaluationOptions {
  overallScoreThreshold?: number;
  categoryScoreThreshold?: number;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  high: 1,
  medium: 2,
  low: 3,
};

const RULE_ORDER: Record<AlertRuleType, number> = {
  overall_score_drop: 1,
  new_high_severity_finding: 2,
  finding_severity_increased: 3,
  category_score_drop: 4,
  signal_regressed: 5,
  repeated_scan_failure: 6,
};

/**
 * Derives a deterministic deduplication key for an alert decision.
 * Identifies the logical alert condition rather than the transient auditRunId.
 */
export function buildAlertDeduplicationKey(params: {
  monitoredPageId: string;
  ruleType: AlertRuleType;
  targetId?: string | null;
}): string {
  const targetSuffix = params.targetId ? `:${params.targetId}` : "";
  return `alert:${params.monitoredPageId}:${params.ruleType}${targetSuffix}`;
}

/**
 * Sorts alert decisions in a deterministic priority order:
 * 1. Severity (high > medium > low)
 * 2. Rule Type priority (overall drop > new high finding > severity increased > category drop > signal regressed > repeated failures)
 * 3. Deduplication Key (alphabetical tie-breaker)
 */
export function sortAlertDecisions(decisions: readonly AlertDecision[]): AlertDecision[] {
  return [...decisions].sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sevDiff !== 0) return sevDiff;

    const ruleDiff = RULE_ORDER[a.ruleType] - RULE_ORDER[b.ruleType];
    if (ruleDiff !== 0) return ruleDiff;

    return a.deduplicationKey.localeCompare(b.deduplicationKey);
  });
}

/**
 * Evaluates audit regression rules against an AuditDiff.
 *
 * Requirements:
 * - Pure, deterministic, side-effect free.
 * - evaluatedAt is passed in via context.
 * - Zero alerts generated when isBaseline === true.
 * - Transitions to/from unknown signals never generate alerts.
 */
export function evaluateAuditAlerts(
  diff: AuditDiff,
  context: AlertEvaluationContext,
  options?: AlertEvaluationOptions,
): AlertEvaluationResult {
  const decisions: AlertDecision[] = [];

  const isBaseline = diff.summary.isBaseline || !diff.summary.hasPreviousReport;
  const overallThreshold =
    options?.overallScoreThreshold ?? MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD;
  const categoryThreshold =
    options?.categoryScoreThreshold ?? MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD;

  if (!isBaseline) {
    // -------------------------------------------------------------------------
    // Rule 1: Overall Score Drop (>= 10 points)
    // -------------------------------------------------------------------------
    const overallDelta = diff.scoreChanges.overall.delta;
    if (
      overallDelta !== null &&
      overallDelta <= -overallThreshold
    ) {
      const dropPoints = Math.abs(overallDelta);
      decisions.push({
        schemaVersion: ALERT_SCHEMA_VERSION,
        shouldAlert: true,
        ruleType: "overall_score_drop",
        severity: "high",
        title: "Overall UX Score Regressed",
        reason: {
          code: "SCORE_DROP_EXCEEDED",
          summary: `Overall UX score dropped by ${dropPoints} points (${diff.scoreChanges.overall.previousScore} -> ${diff.scoreChanges.overall.currentScore}).`,
          details: `Score drop exceeded the meaningful regression threshold of ${overallThreshold} points.`,
        },
        category: null,
        targetId: null,
        scoreDelta: overallDelta,
        previousValue: diff.scoreChanges.overall.previousScore,
        currentValue: diff.scoreChanges.overall.currentScore,
        deduplicationKey: buildAlertDeduplicationKey({
          monitoredPageId: context.monitoredPageId,
          ruleType: "overall_score_drop",
        }),
        evaluatedAt: context.evaluatedAt,
      });
    }

    // -------------------------------------------------------------------------
    // Rule 2: Category Score Drop (>= 15 points)
    // -------------------------------------------------------------------------
    for (const catChange of diff.scoreChanges.categories) {
      if (
        catChange.delta !== null &&
        catChange.delta <= -categoryThreshold
      ) {
        const dropPoints = Math.abs(catChange.delta);
        const severity: AlertSeverity = dropPoints >= 25 ? "high" : "medium";
        decisions.push({
          schemaVersion: ALERT_SCHEMA_VERSION,
          shouldAlert: true,
          ruleType: "category_score_drop",
          severity,
          title: `${catChange.category} Score Regressed`,
          reason: {
            code: "CATEGORY_SCORE_DROP_EXCEEDED",
            summary: `${catChange.category} category score dropped by ${dropPoints} points (${catChange.previousScore} -> ${catChange.currentScore}).`,
            details: `Category drop exceeded the regression threshold of ${categoryThreshold} points.`,
          },
          category: catChange.category,
          targetId: catChange.category,
          scoreDelta: catChange.delta,
          previousValue: catChange.previousScore,
          currentValue: catChange.currentScore,
          deduplicationKey: buildAlertDeduplicationKey({
            monitoredPageId: context.monitoredPageId,
            ruleType: "category_score_drop",
            targetId: catChange.category,
          }),
          evaluatedAt: context.evaluatedAt,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Rule 3: New High-Severity Finding
    // -------------------------------------------------------------------------
    for (const newFinding of diff.newFindings) {
      if (newFinding.currentSeverity === "high") {
        decisions.push({
          schemaVersion: ALERT_SCHEMA_VERSION,
          shouldAlert: true,
          ruleType: "new_high_severity_finding",
          severity: "high",
          title: `New High-Severity Finding in ${newFinding.category}`,
          reason: {
            code: "NEW_HIGH_SEVERITY_FINDING",
            summary: `Newly detected high-severity finding: "${newFinding.currentTitle}".`,
            details: newFinding.currentEvidence ?? undefined,
          },
          category: newFinding.category,
          targetId: newFinding.id,
          scoreDelta: null,
          previousValue: null,
          currentValue: newFinding.currentSeverity,
          deduplicationKey: buildAlertDeduplicationKey({
            monitoredPageId: context.monitoredPageId,
            ruleType: "new_high_severity_finding",
            targetId: newFinding.id,
          }),
          evaluatedAt: context.evaluatedAt,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Rule 4: Finding Severity Escalated
    // -------------------------------------------------------------------------
    for (const changedFinding of diff.changedFindings) {
      if (changedFinding.severityChange === "increased") {
        const severity: AlertSeverity =
          changedFinding.currentSeverity === "high" ? "high" : "medium";
        decisions.push({
          schemaVersion: ALERT_SCHEMA_VERSION,
          shouldAlert: true,
          ruleType: "finding_severity_increased",
          severity,
          title: `Finding Severity Escalated in ${changedFinding.category}`,
          reason: {
            code: "FINDING_SEVERITY_ESCALATED",
            summary: `Finding severity escalated from ${changedFinding.previousSeverity} to ${changedFinding.currentSeverity}: "${changedFinding.currentTitle}".`,
            details: changedFinding.currentEvidence ?? undefined,
          },
          category: changedFinding.category,
          targetId: changedFinding.id,
          scoreDelta: null,
          previousValue: changedFinding.previousSeverity,
          currentValue: changedFinding.currentSeverity,
          deduplicationKey: buildAlertDeduplicationKey({
            monitoredPageId: context.monitoredPageId,
            ruleType: "finding_severity_increased",
            targetId: changedFinding.id,
          }),
          evaluatedAt: context.evaluatedAt,
        });
      }
    }

    // -------------------------------------------------------------------------
    // Rule 5: Deterministic Signal Regressed (pass -> warn)
    // -------------------------------------------------------------------------
    for (const sigChange of diff.signalChanges) {
      if (sigChange.isRegression) {
        decisions.push({
          schemaVersion: ALERT_SCHEMA_VERSION,
          shouldAlert: true,
          ruleType: "signal_regressed",
          severity: "medium",
          title: `Deterministic Signal Regressed: ${sigChange.signalId}`,
          reason: {
            code: "DETERMINISTIC_SIGNAL_REGRESSED",
            summary: `Deterministic signal "${sigChange.signalId}" in ${sigChange.category} regressed from pass to warn.`,
            details: sigChange.currentEvidence,
          },
          category: sigChange.category,
          targetId: sigChange.signalId,
          scoreDelta: null,
          previousValue: sigChange.previousStatus,
          currentValue: sigChange.currentStatus,
          deduplicationKey: buildAlertDeduplicationKey({
            monitoredPageId: context.monitoredPageId,
            ruleType: "signal_regressed",
            targetId: sigChange.signalId,
          }),
          evaluatedAt: context.evaluatedAt,
        });
      }
    }
  }

  const sortedDecisions = sortAlertDecisions(decisions);

  const highSeverityAlertsCount = sortedDecisions.filter(
    (d) => d.severity === "high",
  ).length;
  const mediumSeverityAlertsCount = sortedDecisions.filter(
    (d) => d.severity === "medium",
  ).length;
  const lowSeverityAlertsCount = sortedDecisions.filter(
    (d) => d.severity === "low",
  ).length;

  const result: AlertEvaluationResult = {
    schemaVersion: ALERT_SCHEMA_VERSION,
    monitoredPageId: context.monitoredPageId,
    organizationId: context.organizationId,
    projectId: context.projectId,
    auditRunId: context.auditRunId ?? null,
    hasAlerts: sortedDecisions.length > 0,
    totalAlertsCount: sortedDecisions.length,
    highSeverityAlertsCount,
    mediumSeverityAlertsCount,
    lowSeverityAlertsCount,
    decisions: sortedDecisions,
    evaluatedAt: context.evaluatedAt,
  };

  return alertEvaluationResultSchema.parse(result);
}

/**
 * Evaluates scan failure history to trigger an alert if consecutive failure count
 * reaches or exceeds the threshold.
 */
export function evaluateScanFailureAlert(
  context: AlertEvaluationContext,
  failureInfo?: {
    errorCode?: string;
    errorMessage?: string;
    threshold?: number;
  },
): AlertDecision | null {
  const threshold =
    failureInfo?.threshold ?? DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD;
  const failureCount = context.consecutiveFailureCount ?? 0;

  if (failureCount < threshold) {
    return null;
  }

  const decision: AlertDecision = {
    schemaVersion: ALERT_SCHEMA_VERSION,
    shouldAlert: true,
    ruleType: "repeated_scan_failure",
    severity: "high",
    title: "Repeated Audit Scan Failures",
    reason: {
      code: "REPEATED_SCAN_FAILURES",
      summary: `Monitored page has failed ${failureCount} consecutive scheduled audit scan attempts.`,
      details: failureInfo?.errorMessage
        ? `Latest error [${failureInfo.errorCode || "FAILURE"}]: ${failureInfo.errorMessage}`
        : undefined,
    },
    category: null,
    targetId: null,
    scoreDelta: null,
    previousValue: null,
    currentValue: failureCount,
    deduplicationKey: buildAlertDeduplicationKey({
      monitoredPageId: context.monitoredPageId,
      ruleType: "repeated_scan_failure",
    }),
    evaluatedAt: context.evaluatedAt,
  };

  return alertDecisionSchema.parse(decision);
}
