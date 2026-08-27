import { z } from "zod";
import {
  auditCategorySchema,
  reportSchema,
  scoreConfidenceSchema,
  severitySchema,
} from "./audit-types.js";

/**
 * Single source of truth for persistent multi-tenant database contracts
 * matching the PostgreSQL/Supabase schema in supabase/migrations/.
 */

export const REPORT_SCHEMA_VERSION = "1.0.0" as const;

export const ORGANIZATION_ROLES = ["owner", "admin", "member", "viewer"] as const;
export const roleSchema = z.enum(ORGANIZATION_ROLES);
export type Role = z.infer<typeof roleSchema>;

export const CADENCE_OPTIONS = ["weekly", "manual"] as const;
export const cadenceSchema = z.enum(CADENCE_OPTIONS);
export type Cadence = z.infer<typeof cadenceSchema>;

export const MONITORED_PAGE_STATUSES = ["active", "paused", "archived"] as const;
export const monitoredPageStatusSchema = z.enum(MONITORED_PAGE_STATUSES);
export type MonitoredPageStatus = z.infer<typeof monitoredPageStatusSchema>;

export const INVOCATION_TYPES = ["manual", "scheduled"] as const;
export const invocationTypeSchema = z.enum(INVOCATION_TYPES);
export type InvocationType = z.infer<typeof invocationTypeSchema>;

export const AUDIT_RUN_STATUSES = [
  "requested",
  "queued",
  "running",
  "completed",
  "failed",
] as const;
export const auditRunStatusSchema = z.enum(AUDIT_RUN_STATUSES);
export type AuditRunStatus = z.infer<typeof auditRunStatusSchema>;

export const FINDING_TYPES = ["top_problem", "category_finding"] as const;
export const findingTypeSchema = z.enum(FINDING_TYPES);
export type FindingType = z.infer<typeof findingTypeSchema>;

export const RECOMMENDATION_TYPES = ["quick_win", "detailed"] as const;
export const recommendationTypeSchema = z.enum(RECOMMENDATION_TYPES);
export type RecommendationType = z.infer<typeof recommendationTypeSchema>;

export const WORK_STATUSES = ["open", "in_progress", "resolved", "dismissed"] as const;
export const workStatusSchema = z.enum(WORK_STATUSES);
export type WorkStatus = z.infer<typeof workStatusSchema>;

// ---------------------------------------------------------------------------
// Entity Schemas & Types
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Profile = z.infer<typeof profileSchema>;

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const membershipSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: roleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  domain: z.string().nullable().optional(),
  timezone: z.string().default("UTC"),
  goals: z.string().nullable().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;

export const monitoredPageSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  canonicalUrl: z.string().url(),
  cadence: cadenceSchema.default("weekly"),
  status: monitoredPageStatusSchema.default("active"),
  ownerId: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).default([]),
  latestAuditRunId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type MonitoredPage = z.infer<typeof monitoredPageSchema>;

export const auditRunSchema = z.object({
  id: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  invocationType: invocationTypeSchema,
  status: auditRunStatusSchema.default("requested"),
  targetUrl: z.string().url(),
  finalUrl: z.string().url().nullable().optional(),
  triggeredByUserId: z.string().uuid().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  failedAt: z.string().datetime().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  retryable: z.boolean().nullable().optional(),
  modelVersion: z.string().min(1),
  checkVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  scoringVersion: z.string().min(1),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AuditRun = z.infer<typeof auditRunSchema>;

export const auditReportSchema = z.object({
  id: z.string().uuid(),
  auditRunId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  schemaVersion: z.string().default(REPORT_SCHEMA_VERSION),
  modelIdentifier: z.string().min(1),
  checkVersion: z.string().min(1),
  scoringVersion: z.string().min(1),
  summary: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  scoreConfidence: scoreConfidenceSchema,
  reportPayload: reportSchema,
  createdAt: z.string().datetime(),
});
export type AuditReport = z.infer<typeof auditReportSchema>;

export const scoreSnapshotSchema = z.object({
  id: z.string().uuid(),
  auditReportId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  category: auditCategorySchema,
  score: z.number().min(0).max(100),
  confidence: scoreConfidenceSchema,
  explanation: z.string(),
  severity: severitySchema,
  scoringVersion: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type ScoreSnapshot = z.infer<typeof scoreSnapshotSchema>;

export const findingEntitySchema = z.object({
  id: z.string().uuid(),
  auditReportId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  findingType: findingTypeSchema,
  category: auditCategorySchema,
  title: z.string().min(1),
  severity: severitySchema,
  evidence: z.string(),
  basis: z.enum(["observed", "inferred"]),
  signalIds: z.array(z.string()).default([]),
  recommendation: z.string().min(1),
  displayOrder: z.number().int().min(0).default(0),
  workStatus: workStatusSchema.default("open"),
  resolvedAt: z.string().datetime().nullable().optional(),
  resolvedByUserId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type FindingEntity = z.infer<typeof findingEntitySchema>;

export const recommendationEntitySchema = z.object({
  id: z.string().uuid(),
  auditReportId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  recommendationType: recommendationTypeSchema,
  category: auditCategorySchema.nullable().optional(),
  title: z.string().min(1),
  detail: z.string().min(1),
  displayOrder: z.number().int().min(0).default(0),
  createdAt: z.string().datetime(),
});
export type RecommendationEntity = z.infer<typeof recommendationEntitySchema>;
