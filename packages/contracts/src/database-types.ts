import { z } from "zod";
import {
  auditCategorySchema,
  isoDateTimeSchema,
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
// Shared Datetime Schema
// ---------------------------------------------------------------------------

/**
 * Shared ISO-8601 datetime schema.
 * Accepts both canonical UTC strings (ending in 'Z') and valid ISO-8601 offset strings (e.g. '+00:00', '-05:00')
 * as produced by PostgreSQL timestamptz columns in Supabase.
 */
export { isoDateTimeSchema };

// ---------------------------------------------------------------------------
// Entity Schemas
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Profile = z.infer<typeof profileSchema>;

export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Organization = z.infer<typeof organizationSchema>;

export const membershipSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: roleSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

export const organizationMemberSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: roleSchema,
  email: z.string().email(),
  fullName: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const organizationMemberListResponseSchema = z.object({
  members: z.array(organizationMemberSchema),
});
export type OrganizationMemberListResponse = z.infer<
  typeof organizationMemberListResponseSchema
>;

export const projectSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  domain: z.string().nullable().optional(),
  timezone: z.string().default("UTC"),
  goals: z.string().nullable().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
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
  latestAnalyticsSnapshotId: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
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
  startedAt: isoDateTimeSchema.nullable().optional(),
  completedAt: isoDateTimeSchema.nullable().optional(),
  failedAt: isoDateTimeSchema.nullable().optional(),
  errorCode: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  retryable: z.boolean().nullable().optional(),
  modelVersion: z.string().min(1),
  checkVersion: z.string().min(1),
  promptVersion: z.string().min(1),
  scoringVersion: z.string().min(1),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
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
  createdAt: isoDateTimeSchema,
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
  createdAt: isoDateTimeSchema,
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
  resolvedAt: isoDateTimeSchema.nullable().optional(),
  resolvedByUserId: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
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
  createdAt: isoDateTimeSchema,
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

// ---------------------------------------------------------------------------
// Work Items & Collaboration Schemas
// ---------------------------------------------------------------------------

export const WORK_ITEM_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "dismissed",
] as const;
export const workItemStatusSchema = z.enum(WORK_ITEM_STATUSES);
export type WorkItemStatus = z.infer<typeof workItemStatusSchema>;

export const WORK_ITEM_SOURCE_TYPES = ["finding", "recommendation"] as const;
export const workItemSourceTypeSchema = z.enum(WORK_ITEM_SOURCE_TYPES);
export type WorkItemSourceType = z.infer<typeof workItemSourceTypeSchema>;

export const WORK_ITEM_ACTIONS = [
  "created",
  "status_changed",
  "assigned",
  "unassigned",
  "updated",
  "notes_updated",
] as const;
export const workItemActionSchema = z.enum(WORK_ITEM_ACTIONS);
export type WorkItemAction = z.infer<typeof workItemActionSchema>;

export const workItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  auditRunId: z.string().uuid().nullable().optional(),
  auditReportId: z.string().uuid().nullable().optional(),
  sourceType: workItemSourceTypeSchema,
  findingId: z.string().uuid().nullable().optional(),
  recommendationId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  category: auditCategorySchema.nullable().optional(),
  severity: severitySchema.nullable().optional(),
  status: workItemStatusSchema.default("open"),
  assigneeId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  resolutionRationale: z.string().nullable().optional(),
  resolvedAt: isoDateTimeSchema.nullable().optional(),
  resolvedByUserId: z.string().uuid().nullable().optional(),
  createdByUserId: z.string().uuid().nullable().optional(),
  lastModifiedByUserId: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WorkItem = z.infer<typeof workItemSchema>;

export const workItemActivitySchema = z.object({
  id: z.string().uuid(),
  workItemId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  actorUserId: z.string().uuid().nullable().optional(),
  action: workItemActionSchema,
  fromStatus: workItemStatusSchema.nullable().optional(),
  toStatus: workItemStatusSchema.nullable().optional(),
  details: z.record(z.string(), z.any()).default({}),
  createdAt: isoDateTimeSchema,
});
export type WorkItemActivity = z.infer<typeof workItemActivitySchema>;

export const createWorkItemSchema = z
  .object({
    sourceType: workItemSourceTypeSchema,
    findingId: z.string().uuid("Invalid finding ID.").optional(),
    recommendationId: z.string().uuid("Invalid recommendation ID.").optional(),
    monitoredPageId: z.string().uuid("Invalid monitored page ID.").optional(),
    title: z
      .string()
      .trim()
      .min(1, "Title cannot be empty.")
      .max(300, "Title must be 300 characters or fewer.")
      .optional(),
    description: z
      .string()
      .trim()
      .max(5000, "Description must be 5000 characters or fewer.")
      .optional()
      .nullable(),
    category: auditCategorySchema.optional().nullable(),
    severity: severitySchema.optional().nullable(),
    status: workItemStatusSchema.default("open").optional(),
    assigneeId: z.string().uuid("Invalid assignee ID.").nullable().optional(),
    notes: z
      .string()
      .trim()
      .max(5000, "Notes must be 5000 characters or fewer.")
      .nullable()
      .optional(),
    tags: z
      .array(z.string().trim().max(50, "Tag must be 50 characters or fewer."))
      .max(20, "Cannot exceed 20 tags.")
      .default([])
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.sourceType === "finding" && !data.findingId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "findingId is required when sourceType is 'finding'.",
        path: ["findingId"],
      });
    }
    if (data.sourceType === "recommendation" && !data.recommendationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "recommendationId is required when sourceType is 'recommendation'.",
        path: ["recommendationId"],
      });
    }
  });
export type CreateWorkItemInput = z.input<typeof createWorkItemSchema>;
export type CreateWorkItemOutput = z.output<typeof createWorkItemSchema>;

export const updateWorkItemSchema = z.object({
  status: workItemStatusSchema.optional(),
  assigneeId: z.string().uuid("Invalid assignee ID.").nullable().optional(),
  notes: z
    .string()
    .trim()
    .max(5000, "Notes must be 5000 characters or fewer.")
    .nullable()
    .optional(),
  tags: z
    .array(z.string().trim().max(50, "Tag must be 50 characters or fewer."))
    .max(20, "Cannot exceed 20 tags.")
    .optional(),
  resolutionRationale: z
    .string()
    .trim()
    .max(2000, "Resolution rationale must be 2000 characters or fewer.")
    .nullable()
    .optional(),
});
export type UpdateWorkItemInput = z.input<typeof updateWorkItemSchema>;
export type UpdateWorkItemOutput = z.output<typeof updateWorkItemSchema>;

export const workItemResponseSchema = z.object({
  workItem: workItemSchema,
  activities: z.array(workItemActivitySchema).optional(),
});
export type WorkItemResponse = z.infer<typeof workItemResponseSchema>;

export const workItemListResponseSchema = z.object({
  workItems: z.array(workItemSchema),
  total: z.number().int().min(0),
});
export type WorkItemListResponse = z.infer<typeof workItemListResponseSchema>;

export const workItemFiltersSchema = z.object({
  pageId: z.string().uuid().optional(),
  status: workItemStatusSchema.optional(),
  assigneeId: z.string().uuid().optional(),
  sourceType: workItemSourceTypeSchema.optional(),
  category: auditCategorySchema.optional(),
  severity: severitySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
  offset: z.coerce.number().int().min(0).default(0).optional(),
});
export type WorkItemFilters = z.infer<typeof workItemFiltersSchema>;

// ---------------------------------------------------------------------------
// Report Share Links Schemas (Task 4.3)
// ---------------------------------------------------------------------------

export const reportShareLinkSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  auditRunId: z.string().uuid(),
  auditReportId: z.string().uuid(),
  tokenHash: z.string().min(1),
  createdByUserId: z.string().uuid().nullable().optional(),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  revokedAt: isoDateTimeSchema.nullable().optional(),
  createdAt: isoDateTimeSchema,
  lastAccessedAt: isoDateTimeSchema.nullable().optional(),
});
export type ReportShareLink = z.infer<typeof reportShareLinkSchema>;

export const createShareLinkRequestSchema = z.object({
  expiresInDays: z
    .number()
    .int("Expiration must be an integer number of days.")
    .min(1, "Expiration must be at least 1 day.")
    .max(365, "Expiration cannot exceed 365 days.")
    .default(30)
    .optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkRequestSchema>;

export const shareLinkMetadataSchema = z.object({
  id: z.string().uuid(),
  auditRunId: z.string().uuid(),
  auditReportId: z.string().uuid(),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  revokedAt: isoDateTimeSchema.nullable().optional(),
  isRevoked: z.boolean().default(false),
  isExpired: z.boolean().default(false),
  createdAt: isoDateTimeSchema,
  lastAccessedAt: isoDateTimeSchema.nullable().optional(),
});
export type ShareLinkMetadata = z.infer<typeof shareLinkMetadataSchema>;

export const createShareLinkResponseSchema = z.object({
  shareLink: z.object({
    id: z.string().uuid(),
    shareUrl: z.string(),
    token: z.string().min(1),
    expiresAt: isoDateTimeSchema.nullable().optional(),
    createdAt: isoDateTimeSchema,
  }),
});
export type CreateShareLinkResponse = z.infer<typeof createShareLinkResponseSchema>;

export const sharedScoreSnapshotSchema = z.object({
  id: z.string().uuid(),
  auditReportId: z.string().uuid(),
  auditRunId: z.string().uuid().optional(),
  monitoredPageId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  category: auditCategorySchema,
  score: z.number().min(0).max(100),
  confidence: scoreConfidenceSchema,
  explanation: z.string().optional(),
  severity: severitySchema.optional(),
  scoringVersion: z.string().min(1).optional(),
  observedSignalsCount: z.number().nullable().optional(),
  warningCount: z.number().nullable().optional(),
  neutralCount: z.number().nullable().optional(),
  createdAt: isoDateTimeSchema,
});
export type SharedScoreSnapshot = z.infer<typeof sharedScoreSnapshotSchema>;

export const sharedFindingEntitySchema = z.object({
  id: z.string().uuid(),
  auditReportId: z.string().uuid(),
  auditRunId: z.string().uuid().optional(),
  monitoredPageId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  findingType: findingTypeSchema,
  category: auditCategorySchema,
  title: z.string().min(1),
  severity: severitySchema,
  evidence: z.string(),
  basis: z.enum(["observed", "inferred"]).optional(),
  signalIds: z.array(z.string()).default([]),
  recommendation: z.string(),
  displayOrder: z.number().int().min(0).default(0),
  createdAt: isoDateTimeSchema,
});
export type SharedFindingEntity = z.infer<typeof sharedFindingEntitySchema>;

export const sharedAuditReportResponseSchema = z.object({
  report: auditReportSchema,
  auditRun: auditRunSchema,
  scoreSnapshots: z.array(sharedScoreSnapshotSchema),
  findings: z.array(sharedFindingEntitySchema),
  recommendations: z.array(recommendationEntitySchema),
  shareMetadata: z.object({
    id: z.string().uuid(),
    createdAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.nullable().optional(),
  }),
});
export type SharedAuditReportResponse = z.infer<typeof sharedAuditReportResponseSchema>;



