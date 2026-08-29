import { z } from "zod";

/**
 * Inngest Event Names for PagePilot durable workflows.
 */
export const AUDIT_REQUESTED_EVENT = "audit/requested" as const;
export const AUDIT_COMPLETED_EVENT = "audit/completed" as const;
export const AUDIT_FAILED_EVENT = "audit/failed" as const;

/**
 * Payload contract for the `audit/requested` event.
 * 
 * Contains only the minimal identifiers needed to load and execute
 * the persisted audit run. Strictly excludes secrets, raw HTML,
 * target responses, and Gemini payloads.
 */
export const auditRequestedPayloadSchema = z.object({
  auditRunId: z.string().uuid("auditRunId must be a valid UUID"),
  organizationId: z.string().uuid("organizationId must be a valid UUID"),
  projectId: z.string().uuid("projectId must be a valid UUID"),
  monitoredPageId: z.string().uuid("monitoredPageId must be a valid UUID"),
  requestedByUserId: z
    .string()
    .uuid("requestedByUserId must be a valid UUID")
    .nullable()
    .optional(),
});

export type AuditRequestedPayload = z.infer<typeof auditRequestedPayloadSchema>;

/**
 * Inngest event schema for `audit/requested`.
 */
export const auditRequestedEventSchema = z.object({
  name: z.literal(AUDIT_REQUESTED_EVENT),
  data: auditRequestedPayloadSchema,
  id: z.string().optional(),
  ts: z.number().optional(),
});

export type AuditRequestedEvent = z.infer<typeof auditRequestedEventSchema>;

/**
 * Payload contract for the `audit/completed` event.
 */
export const auditCompletedPayloadSchema = z.object({
  auditRunId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  auditReportId: z.string().uuid(),
  overallScore: z.number().min(0).max(100),
  completedAt: z.string().datetime(),
});

export type AuditCompletedPayload = z.infer<typeof auditCompletedPayloadSchema>;

/**
 * Inngest event schema for `audit/completed`.
 */
export const auditCompletedEventSchema = z.object({
  name: z.literal(AUDIT_COMPLETED_EVENT),
  data: auditCompletedPayloadSchema,
  id: z.string().optional(),
  ts: z.number().optional(),
});

export type AuditCompletedEvent = z.infer<typeof auditCompletedEventSchema>;

/**
 * Payload contract for the `audit/failed` event.
 */
export const auditFailedPayloadSchema = z.object({
  auditRunId: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  errorCode: z.string(),
  errorMessage: z.string(),
  retryable: z.boolean(),
  failedAt: z.string().datetime(),
});

export type AuditFailedPayload = z.infer<typeof auditFailedPayloadSchema>;

/**
 * Inngest event schema for `audit/failed`.
 */
export const auditFailedEventSchema = z.object({
  name: z.literal(AUDIT_FAILED_EVENT),
  data: auditFailedPayloadSchema,
  id: z.string().optional(),
  ts: z.number().optional(),
});

export type AuditFailedEvent = z.infer<typeof auditFailedEventSchema>;
