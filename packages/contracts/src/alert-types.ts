import { z } from "zod";
import { auditCategorySchema } from "./audit-types.js";

/**
 * Version constant for the alert contract schema.
 */
export const ALERT_SCHEMA_VERSION = "1.0.0" as const;

/**
 * Default threshold for repeated scan failure alerting:
 * Page must fail 3 consecutive scans before triggering an alert.
 */
export const DEFAULT_REPEATED_FAILURE_ALERT_THRESHOLD = 3 as const;

/**
 * Alert rule types supported by PagePilot continuous monitoring.
 */
export const ALERT_RULE_TYPES = [
  "overall_score_drop",
  "category_score_drop",
  "new_high_severity_finding",
  "finding_severity_increased",
  "signal_regressed",
  "repeated_scan_failure",
] as const;
export const alertRuleTypeSchema = z.enum(ALERT_RULE_TYPES);
export type AlertRuleType = z.infer<typeof alertRuleTypeSchema>;

/**
 * Alert severity hierarchy: high, medium, low.
 */
export const ALERT_SEVERITIES = ["high", "medium", "low"] as const;
export const alertSeveritySchema = z.enum(ALERT_SEVERITIES);
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;

/**
 * Standard machine-readable alert reason codes.
 */
export const ALERT_REASON_CODES = [
  "SCORE_DROP_EXCEEDED",
  "CATEGORY_SCORE_DROP_EXCEEDED",
  "NEW_HIGH_SEVERITY_FINDING",
  "FINDING_SEVERITY_ESCALATED",
  "DETERMINISTIC_SIGNAL_REGRESSED",
  "REPEATED_SCAN_FAILURES",
] as const;
export const alertReasonCodeSchema = z.enum(ALERT_REASON_CODES);
export type AlertReasonCode = z.infer<typeof alertReasonCodeSchema>;

/**
 * Structured explanation for why an alert was triggered.
 */
export const alertReasonSchema = z.object({
  code: alertReasonCodeSchema,
  summary: z.string().min(1),
  details: z.string().optional(),
});
export type AlertReason = z.infer<typeof alertReasonSchema>;

/**
 * Evaluation context passed into pure alert evaluation functions.
 * All properties are explicit inputs to preserve 100% determinism.
 */
export const alertEvaluationContextSchema = z.object({
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  auditRunId: z.string().uuid().nullable().optional(),
  consecutiveFailureCount: z.number().int().min(0).default(0),
  evaluatedAt: z.string().datetime(),
  windowId: z.string().optional(),
});
export type AlertEvaluationContext = z.infer<
  typeof alertEvaluationContextSchema
>;

/**
 * Individual alert decision produced by rule evaluation.
 * Contains a stable deduplicationKey referencing the logical regression condition
 * rather than any transient auditRunId.
 */
export const alertDecisionSchema = z.object({
  schemaVersion: z.string().default(ALERT_SCHEMA_VERSION),
  shouldAlert: z.boolean(),
  ruleType: alertRuleTypeSchema,
  severity: alertSeveritySchema,
  title: z.string().min(1),
  reason: alertReasonSchema,
  category: auditCategorySchema.nullable().optional(),
  targetId: z.string().nullable().optional(),
  scoreDelta: z.number().nullable().optional(),
  previousValue: z.union([z.string(), z.number()]).nullable().optional(),
  currentValue: z.union([z.string(), z.number()]).nullable().optional(),
  deduplicationKey: z.string().min(1),
  evaluatedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AlertDecision = z.infer<typeof alertDecisionSchema>;

/**
 * Aggregate result of evaluating all alert rules for an audit comparison or scan failure.
 */
export const alertEvaluationResultSchema = z.object({
  schemaVersion: z.string().default(ALERT_SCHEMA_VERSION),
  monitoredPageId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  auditRunId: z.string().uuid().nullable().optional(),
  hasAlerts: z.boolean(),
  totalAlertsCount: z.number().int().min(0),
  highSeverityAlertsCount: z.number().int().min(0),
  mediumSeverityAlertsCount: z.number().int().min(0),
  lowSeverityAlertsCount: z.number().int().min(0),
  decisions: z.array(alertDecisionSchema),
  evaluatedAt: z.string().datetime(),
});
export type AlertEvaluationResult = z.infer<
  typeof alertEvaluationResultSchema
>;
