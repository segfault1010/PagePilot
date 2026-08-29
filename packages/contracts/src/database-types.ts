import { z } from "zod";
import {
  auditCategorySchema,
  reportSchema,
  scoreConfidenceSchema,
  severitySchema,
} from "./audit-types.js";
import { enforceUrlPolicy } from "./url-policy.js";

/**
 * Normalizes a user-entered domain or host string for project metadata.
 * Strips scheme (http://, https://), trailing path/query/hashes, and lowercases.
 * This is strictly metadata canonicalization and does not replace or merge with
 * the authoritative security validation in enforceUrlPolicy.
 */
export function normalizeDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) return "";

  let candidate = trimmed;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      candidate = parsed.hostname;
    } catch {
      candidate = candidate.replace(/^https?:\/\//i, "");
    }
  }

  candidate = candidate.split("/")[0] || "";
  candidate = candidate.split("?")[0] || "";
  candidate = candidate.split("#")[0] || "";
  candidate = candidate.split(":")[0] || "";

  return candidate.trim();
}

/**
 * Single source of truth for persistent multi-tenant database contracts
 * matching the PostgreSQL/Supabase schema in supabase/migrations/.
 */

export const REPORT_SCHEMA_VERSION = "1.0.0" as const;
export const AUDIT_ENGINE_CHECK_VERSION = "1.0.0" as const;
export const AUDIT_ENGINE_PROMPT_VERSION = "1.0.0" as const;
export const AUDIT_ENGINE_SCORING_VERSION = "1.0.0" as const;

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

export const WORK_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "dismissed",
] as const;
export const workStatusSchema = z.enum(WORK_STATUSES);
export type WorkStatus = z.infer<typeof workStatusSchema>;

// ---------------------------------------------------------------------------
// Entity Schemas
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
  latestSuccessfulAuditRunId: z.string().uuid().nullable().optional(),
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
  idempotencyKey: z.string().nullable().optional(),
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

// ---------------------------------------------------------------------------
// Workspace Context & API Response
// ---------------------------------------------------------------------------

export const workspaceUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
});
export type WorkspaceUser = z.infer<typeof workspaceUserSchema>;

export const workspaceContextSchema = z.object({
  user: workspaceUserSchema,
  profile: profileSchema.nullable(),
  organization: organizationSchema,
  membership: membershipSchema,
  role: roleSchema,
});
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;

export const workspaceResponseSchema = z.object({
  workspace: workspaceContextSchema,
});
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;

// ---------------------------------------------------------------------------
// Project API Request & Response Schemas
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required.")
    .max(100, "Project name must be 100 characters or fewer."),
  domain: z
    .string()
    .trim()
    .max(255, "Domain must be 255 characters or fewer.")
    .optional()
    .nullable()
    .transform((val) => (val && val.length > 0 ? normalizeDomain(val) : null)),
  timezone: z
    .string()
    .trim()
    .max(64, "Timezone must be 64 characters or fewer.")
    .default("UTC"),
  goals: z
    .string()
    .trim()
    .max(2000, "Goals must be 2000 characters or fewer.")
    .optional()
    .nullable(),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type CreateProjectOutput = z.output<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name cannot be empty.")
    .max(100, "Project name must be 100 characters or fewer.")
    .optional(),
  domain: z
    .string()
    .trim()
    .max(255, "Domain must be 255 characters or fewer.")
    .optional()
    .nullable()
    .transform((val) =>
      val !== undefined && val !== null
        ? val.length > 0
          ? normalizeDomain(val)
          : null
        : val,
    ),
  timezone: z
    .string()
    .trim()
    .max(64, "Timezone must be 64 characters or fewer.")
    .optional(),
  goals: z
    .string()
    .trim()
    .max(2000, "Goals must be 2000 characters or fewer.")
    .optional()
    .nullable(),
});
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
export type UpdateProjectOutput = z.output<typeof updateProjectSchema>;

export const projectResponseSchema = z.object({
  project: projectSchema,
});
export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const projectListResponseSchema = z.object({
  projects: z.array(projectSchema),
  total: z.number().int().min(0),
});
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>;

// ---------------------------------------------------------------------------
// Monitored Page API Request & Response Schemas
// ---------------------------------------------------------------------------

export const createMonitoredPageSchema = z.object({
  canonicalUrl: z
    .string()
    .trim()
    .min(1, "Canonical URL is required.")
    .superRefine((url, ctx) => {
      const res = enforceUrlPolicy(url);
      if (!res.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: res.message,
        });
      }
    })
    .transform((url) => {
      const res = enforceUrlPolicy(url);
      return res.ok ? res.url : url;
    }),
  cadence: cadenceSchema.default("weekly"),
  status: monitoredPageStatusSchema.default("active"),
  tags: z
    .array(z.string().trim().max(50, "Tag must be 50 characters or fewer."))
    .max(20, "Cannot exceed 20 tags.")
    .default([]),
});
export type CreateMonitoredPageInput = z.input<typeof createMonitoredPageSchema>;
export type CreateMonitoredPageOutput = z.output<typeof createMonitoredPageSchema>;

export const updateMonitoredPageSchema = z.object({
  canonicalUrl: z
    .string()
    .trim()
    .min(1, "Canonical URL cannot be empty.")
    .superRefine((url, ctx) => {
      const res = enforceUrlPolicy(url);
      if (!res.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: res.message,
        });
      }
    })
    .transform((url) => {
      const res = enforceUrlPolicy(url);
      return res.ok ? res.url : url;
    })
    .optional(),
  cadence: cadenceSchema.optional(),
  status: monitoredPageStatusSchema.optional(),
  tags: z
    .array(z.string().trim().max(50, "Tag must be 50 characters or fewer."))
    .max(20, "Cannot exceed 20 tags.")
    .optional(),
  ownerId: z.string().uuid("Invalid owner user ID.").optional().nullable(),
});
export type UpdateMonitoredPageInput = z.input<typeof updateMonitoredPageSchema>;
export type UpdateMonitoredPageOutput = z.output<typeof updateMonitoredPageSchema>;

export const monitoredPageResponseSchema = z.object({
  page: monitoredPageSchema,
});
export type MonitoredPageResponse = z.infer<typeof monitoredPageResponseSchema>;

export const monitoredPageListResponseSchema = z.object({
  pages: z.array(monitoredPageSchema),
  total: z.number().int().min(0),
});
export type MonitoredPageListResponse = z.infer<typeof monitoredPageListResponseSchema>;

// ---------------------------------------------------------------------------
// Audit Execution & History API Request & Response Schemas
// ---------------------------------------------------------------------------

export const triggerAuditRequestSchema = z.object({
  idempotencyKey: z
    .string()
    .trim()
    .max(128, "Idempotency key must be 128 characters or fewer.")
    .optional(),
});
export type TriggerAuditRequest = z.infer<typeof triggerAuditRequestSchema>;

export const auditRunResponseSchema = z.object({
  auditRun: auditRunSchema,
  report: reportSchema.optional(),
  auditReportId: z.string().uuid().optional(),
  isIdempotentReplay: z.boolean().optional(),
});
export type AuditRunResponse = z.infer<typeof auditRunResponseSchema>;

export const auditHistoryItemSchema = z.object({
  id: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  invocationType: invocationTypeSchema,
  status: auditRunStatusSchema,
  targetUrl: z.string(),
  finalUrl: z.string().nullable().optional(),
  overallScore: z.number().int().min(0).max(100).nullable().optional(),
  scoreConfidence: scoreConfidenceSchema.nullable().optional(),
  categoryScores: z.record(auditCategorySchema, z.number().min(0).max(100)).optional(),
  summary: z.string().nullable().optional(),
  auditReportId: z.string().uuid().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  retryable: z.boolean().nullable().optional(),
  modelVersion: z.string(),
  checkVersion: z.string(),
  scoringVersion: z.string(),
  createdAt: z.string(),
});
export type AuditHistoryItem = z.infer<typeof auditHistoryItemSchema>;

export const auditHistoryListResponseSchema = z.object({
  audits: z.array(auditHistoryItemSchema),
  total: z.number().int().min(0),
});
export type AuditHistoryListResponse = z.infer<typeof auditHistoryListResponseSchema>;

export const persistedAuditReportResponseSchema = z.object({
  auditRun: auditRunSchema,
  report: auditReportSchema,
  scoreSnapshots: z.array(scoreSnapshotSchema),
  findings: z.array(findingEntitySchema),
  recommendations: z.array(recommendationEntitySchema),
});
export type PersistedAuditReportResponse = z.infer<
  typeof persistedAuditReportResponseSchema
>;

