import { z } from "zod";
import { isoDateTimeSchema } from "./audit-types.js";
import type { Severity } from "./audit-types.js";

/**
 * Supported analytics source types.
 */
export const ANALYTICS_SOURCE_TYPES = [
  "manual",
  "posthog",
  "ga4",
  "custom_api",
  "webhook",
] as const;
export const analyticsSourceTypeSchema = z.enum(ANALYTICS_SOURCE_TYPES);
export type AnalyticsSourceType = z.infer<typeof analyticsSourceTypeSchema>;

/**
 * Canonical constant versions and invariants.
 */
export const ANALYTICS_SCHEMA_VERSION = "1.0.0" as const;
export const IMPORTED_DATA_LABEL = "IMPORTED DATA" as const;
export const STALE_ANALYTICS_DAYS_THRESHOLD = 60 as const;

/**
 * Traffic and exposure tier thresholds.
 */
export const HIGH_EXPOSURE_SESSIONS_THRESHOLD = 20000 as const;
export const HIGH_EXPOSURE_CONVERSIONS_THRESHOLD = 500 as const;
export const MEDIUM_EXPOSURE_SESSIONS_THRESHOLD = 5000 as const;
export const MEDIUM_EXPOSURE_CONVERSIONS_THRESHOLD = 100 as const;

/**
 * Analytics provenance metadata schema.
 * Must include the mandatory "IMPORTED DATA" label to ensure
 * external business metrics are never confused with PagePilot UX inference.
 */
export const analyticsProvenanceSchema = z.object({
  label: z.literal(IMPORTED_DATA_LABEL),
  importedByUserId: z.string().uuid().nullable().optional(),
  importedByUserName: z.string().nullable().optional(),
  importedAt: isoDateTimeSchema,
  integrationConnectionId: z.string().uuid().nullable().optional(),
  externalPropertyId: z.string().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});
export type AnalyticsProvenance = z.infer<typeof analyticsProvenanceSchema>;

/**
 * Persisted page analytics snapshot entity schema matching public.page_analytics_snapshots.
 */
export const pageAnalyticsSnapshotSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid(),
  monitoredPageId: z.string().uuid(),
  sourceType: analyticsSourceTypeSchema,
  sourceProviderName: z.string().min(1),
  schemaVersion: z.string().default(ANALYTICS_SCHEMA_VERSION),
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
  sessions: z.number().int().min(0).nullable().optional(),
  uniqueVisitors: z.number().int().min(0).nullable().optional(),
  conversions: z.number().int().min(0).nullable().optional(),
  conversionRate: z.number().min(0).max(100).nullable().optional(),
  bounceRate: z.number().min(0).max(100).nullable().optional(),
  avgDurationSeconds: z.number().int().min(0).nullable().optional(),
  currency: z.string().default("USD"),
  customMetrics: z.record(z.string(), z.unknown()).default({}),
  provenance: analyticsProvenanceSchema,
  isActive: z.boolean().default(true),
  createdByUserId: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PageAnalyticsSnapshot = z.infer<typeof pageAnalyticsSnapshotSchema>;

/**
 * Request schema for creating / importing a page analytics snapshot.
 */
export const createPageAnalyticsSchema = z
  .object({
    sourceType: analyticsSourceTypeSchema.default("manual").optional(),
    sourceProviderName: z
      .string()
      .trim()
      .min(1, "Provider name cannot be empty.")
      .max(100, "Provider name must be 100 characters or fewer.")
      .default("Manual Entry")
      .optional(),
    periodStart: isoDateTimeSchema,
    periodEnd: isoDateTimeSchema,
    sessions: z.number().int().min(0, "Sessions must be 0 or greater.").optional().nullable(),
    uniqueVisitors: z.number().int().min(0, "Unique visitors must be 0 or greater.").optional().nullable(),
    conversions: z.number().int().min(0, "Conversions must be 0 or greater.").optional().nullable(),
    conversionRate: z
      .number()
      .min(0, "Conversion rate cannot be negative.")
      .max(100, "Conversion rate cannot exceed 100%.")
      .optional()
      .nullable(),
    bounceRate: z
      .number()
      .min(0, "Bounce rate cannot be negative.")
      .max(100, "Bounce rate cannot exceed 100%.")
      .optional()
      .nullable(),
    avgDurationSeconds: z.number().int().min(0, "Average duration must be 0 or greater.").optional().nullable(),
    currency: z.string().trim().max(10).default("USD").optional(),
    customMetrics: z.record(z.string(), z.unknown()).default({}).optional(),
    notes: z
      .string()
      .trim()
      .max(1000, "Notes cannot exceed 1000 characters.")
      .optional()
      .nullable(),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.periodStart).getTime();
    const end = new Date(data.periodEnd).getTime();
    if (!isNaN(start) && !isNaN(end) && start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Period start date must be before or equal to period end date.",
        path: ["periodStart"],
      });
    }
  });
export type CreatePageAnalyticsInput = z.input<typeof createPageAnalyticsSchema>;
export type CreatePageAnalyticsOutput = z.output<typeof createPageAnalyticsSchema>;

/**
 * Request schema for updating an existing page analytics snapshot.
 */
export const updatePageAnalyticsSchema = z
  .object({
    sessions: z.number().int().min(0).optional().nullable(),
    uniqueVisitors: z.number().int().min(0).optional().nullable(),
    conversions: z.number().int().min(0).optional().nullable(),
    conversionRate: z.number().min(0).max(100).optional().nullable(),
    bounceRate: z.number().min(0).max(100).optional().nullable(),
    avgDurationSeconds: z.number().int().min(0).optional().nullable(),
    periodStart: isoDateTimeSchema.optional(),
    periodEnd: isoDateTimeSchema.optional(),
    notes: z.string().trim().max(1000).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.periodStart && data.periodEnd) {
      const start = new Date(data.periodStart).getTime();
      const end = new Date(data.periodEnd).getTime();
      if (!isNaN(start) && !isNaN(end) && start > end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Period start date must be before or equal to period end date.",
          path: ["periodStart"],
        });
      }
    }
  });
export type UpdatePageAnalyticsInput = z.input<typeof updatePageAnalyticsSchema>;
export type UpdatePageAnalyticsOutput = z.output<typeof updatePageAnalyticsSchema>;

/**
 * API response envelopes.
 */
export const pageAnalyticsResponseSchema = z.object({
  analytics: pageAnalyticsSnapshotSchema.nullable(),
});
export type PageAnalyticsResponse = z.infer<typeof pageAnalyticsResponseSchema>;

export const pageAnalyticsHistoryResponseSchema = z.object({
  current: pageAnalyticsSnapshotSchema.nullable(),
  history: z.array(pageAnalyticsSnapshotSchema),
  total: z.number().int().min(0),
});
export type PageAnalyticsHistoryResponse = z.infer<
  typeof pageAnalyticsHistoryResponseSchema
>;

/**
 * Business Exposure Tiers and Impact Prioritization
 */
export type BusinessExposureTier =
  | "high_exposure"
  | "medium_exposure"
  | "low_exposure"
  | "unknown";

export type BusinessImpactPriority =
  | "critical_growth"
  | "high"
  | "medium"
  | "low";

/**
 * Calculates the business exposure tier from imported analytics.
 * Rules:
 * - high_exposure: sessions >= 20,000 OR conversions >= 500
 * - medium_exposure: sessions >= 5,000 OR conversions >= 100
 * - low_exposure: sessions < 5,000 (and sessions > 0 or conversions > 0)
 * - unknown: no analytics imported or no metric counts available
 */
export function calculateBusinessExposureTier(
  analytics: PageAnalyticsSnapshot | null | undefined,
): BusinessExposureTier {
  if (!analytics) return "unknown";
  const sessions = analytics.sessions ?? 0;
  const conversions = analytics.conversions ?? 0;

  if (
    sessions >= HIGH_EXPOSURE_SESSIONS_THRESHOLD ||
    conversions >= HIGH_EXPOSURE_CONVERSIONS_THRESHOLD
  ) {
    return "high_exposure";
  }

  if (
    sessions >= MEDIUM_EXPOSURE_SESSIONS_THRESHOLD ||
    conversions >= MEDIUM_EXPOSURE_CONVERSIONS_THRESHOLD
  ) {
    return "medium_exposure";
  }

  if (sessions > 0 || conversions > 0) {
    return "low_exposure";
  }

  return "unknown";
}

/**
 * Combines UX severity (immutable from audit) with business exposure tier (imported data)
 * to determine deterministic prioritization rank.
 *
 * Invariant: Never alters underlying UX scores or findings.
 */
export function calculateBusinessImpactPriority(
  severity: Severity | null | undefined,
  exposure: BusinessExposureTier,
): BusinessImpactPriority {
  const sev = severity ?? "medium";

  if (exposure === "high_exposure") {
    if (sev === "high") return "critical_growth";
    if (sev === "medium") return "high";
    return "medium";
  }

  if (exposure === "medium_exposure") {
    if (sev === "high") return "high";
    if (sev === "medium") return "medium";
    return "low";
  }

  if (exposure === "low_exposure") {
    if (sev === "high") return "medium";
    return "low";
  }

  // Fallback when exposure is unknown: strictly map UX severity
  if (sev === "high") return "high";
  if (sev === "medium") return "medium";
  return "low";
}

/**
 * Checks whether analytics data is stale (> 60 days old).
 */
export function isAnalyticsStale(
  periodEnd: string,
  now = new Date(),
): boolean {
  const endDate = new Date(periodEnd);
  if (isNaN(endDate.getTime())) return false;
  const diffMs = now.getTime() - endDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > STALE_ANALYTICS_DAYS_THRESHOLD;
}

/**
 * Human-readable labels and descriptions for prioritization.
 */
export const BUSINESS_IMPACT_METADATA: Record<
  BusinessImpactPriority,
  { label: string; description: string; badgeColor: string }
> = {
  critical_growth: {
    label: "Critical Growth Priority",
    description: "High UX Severity on high-exposure page (maximum revenue unlock)",
    badgeColor: "bg-rose-950/70 text-rose-300 border-rose-700/60",
  },
  high: {
    label: "High Priority",
    description: "High UX Severity on medium exposure, or Medium UX Severity on high exposure",
    badgeColor: "bg-amber-950/70 text-amber-300 border-amber-700/60",
  },
  medium: {
    label: "Medium Priority",
    description: "Medium UX Severity on medium exposure, or High UX Severity on low exposure",
    badgeColor: "bg-blue-950/70 text-blue-300 border-blue-700/60",
  },
  low: {
    label: "Low Priority",
    description: "Low UX Severity or low business exposure",
    badgeColor: "bg-neutral-800 text-neutral-300 border-neutral-700",
  },
};
