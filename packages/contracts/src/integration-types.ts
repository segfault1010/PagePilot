import { z } from "zod";
import { isoDateTimeSchema } from "./database-types.js";
import { alertRuleTypeSchema } from "./alert-types.js";
import { enforceUrlPolicy } from "./url-policy.js";

/**
 * Supported integration providers for outbound alerts.
 */
export const INTEGRATION_PROVIDERS = ["slack", "webhook"] as const;
export const integrationProviderSchema = z.enum(INTEGRATION_PROVIDERS);
export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

/**
 * Integration connection statuses.
 */
export const INTEGRATION_STATUSES = ["active", "disabled", "error"] as const;
export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

/**
 * Webhook signature and timestamp HTTP header constants.
 */
export const PAGEPILOT_SIGNATURE_HEADER = "x-pagepilot-signature" as const;
export const PAGEPILOT_TIMESTAMP_HEADER = "x-pagepilot-timestamp" as const;
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300 as const; // 5 minutes

/**
 * Persisted integration entity schema matching public.integration_connections.
 * Safe for client projection: targetUrl is masked, encrypted credentials omitted.
 */
export const integrationConnectionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  provider: integrationProviderSchema,
  name: z.string().min(1),
  status: integrationStatusSchema.default("active"),
  config: z.record(z.string(), z.unknown()).default({}),
  maskedTargetUrl: z.string().min(1),
  hasSigningSecret: z.boolean().default(false),
  events: z
    .array(alertRuleTypeSchema)
    .default(["overall_score_drop", "new_high_severity_finding"]),
  createdByUserId: z.string().uuid().nullable().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;

/**
 * Request schema for creating a new integration connection.
 */
export const createIntegrationConnectionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Integration name is required.")
    .max(100, "Integration name must be 100 characters or fewer."),
  provider: integrationProviderSchema,
  targetUrl: z
    .string()
    .trim()
    .min(1, "Target URL is required.")
    .superRefine((url, ctx) => {
      const res = enforceUrlPolicy(url);
      if (!res.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: res.message,
        });
      }
    }),
  signingSecret: z
    .string()
    .trim()
    .max(256, "Signing secret must be 256 characters or fewer.")
    .optional()
    .nullable(),
  events: z
    .array(alertRuleTypeSchema)
    .min(1, "At least one alert event must be selected.")
    .default(["overall_score_drop", "new_high_severity_finding"])
    .optional(),
  config: z.record(z.string(), z.unknown()).default({}).optional(),
  isOrganizationWide: z.boolean().optional(),
});
export type CreateIntegrationInput = z.input<
  typeof createIntegrationConnectionSchema
>;
export type CreateIntegrationOutput = z.output<
  typeof createIntegrationConnectionSchema
>;

/**
 * Request schema for updating an existing integration connection.
 */
export const updateIntegrationConnectionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Integration name cannot be empty.")
    .max(100, "Integration name must be 100 characters or fewer.")
    .optional(),
  status: integrationStatusSchema.optional(),
  targetUrl: z
    .string()
    .trim()
    .min(1, "Target URL cannot be empty.")
    .superRefine((url, ctx) => {
      const res = enforceUrlPolicy(url);
      if (!res.ok) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: res.message,
        });
      }
    })
    .optional(),
  signingSecret: z
    .string()
    .trim()
    .max(256, "Signing secret must be 256 characters or fewer.")
    .optional()
    .nullable(),
  events: z
    .array(alertRuleTypeSchema)
    .min(1, "At least one alert event must be selected.")
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateIntegrationInput = z.input<
  typeof updateIntegrationConnectionSchema
>;
export type UpdateIntegrationOutput = z.output<
  typeof updateIntegrationConnectionSchema
>;

/**
 * Options for testing an integration connection via test ping.
 */
export const testIntegrationConnectionSchema = z.object({
  ruleType: alertRuleTypeSchema.optional(),
});
export type TestIntegrationInput = z.infer<
  typeof testIntegrationConnectionSchema
>;

/**
 * Response schema for test ping dispatch.
 */
export const testIntegrationResponseSchema = z.object({
  success: z.boolean(),
  statusCode: z.number().int().optional(),
  latencyMs: z.number().int().min(0),
  error: z.string().optional(),
});
export type TestIntegrationResponse = z.infer<
  typeof testIntegrationResponseSchema
>;

/**
 * API response envelopes.
 */
export const integrationConnectionResponseSchema = z.object({
  integration: integrationConnectionSchema,
});
export type IntegrationConnectionResponse = z.infer<
  typeof integrationConnectionResponseSchema
>;

export const integrationConnectionListResponseSchema = z.object({
  integrations: z.array(integrationConnectionSchema),
  total: z.number().int().min(0),
});
export type IntegrationConnectionListResponse = z.infer<
  typeof integrationConnectionListResponseSchema
>;
