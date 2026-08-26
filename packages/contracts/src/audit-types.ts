import { z } from "zod";

/**
 * Single shared contract for the /api/analyze request/response payloads,
 * the audit report shape, and the stable error envelope.
 *
 * The client renders from these types; the server validates against these
 * schemas; stricter Gemini-output schemas (Phase 5) build on the same shapes
 * in packages/audit-engine (or src/server/schemas/audit.ts).
 */

export const AUDIT_CATEGORIES = [
  "clarity",
  "visualHierarchy",
  "ctaEffectiveness",
  "copy",
  "accessibility",
  "mobileUx",
  "trustCredibility",
] as const;

export const auditCategorySchema = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof auditCategorySchema>;

export const severitySchema = z.enum(["low", "medium", "high"]);
export type Severity = z.infer<typeof severitySchema>;

export const scoreConfidenceSchema = z.enum(["blended", "ai-led"]);
export type ScoreConfidence = z.infer<typeof scoreConfidenceSchema>;

export const signalStatusSchema = z.enum(["pass", "warn", "unknown"]);
export type SignalStatus = z.infer<typeof signalStatusSchema>;

// ---------------------------------------------------------------------------
// API request
// ---------------------------------------------------------------------------

export const analyzeRequestSchema = z.object({
  url: z.string().min(1),
});
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

// ---------------------------------------------------------------------------
// Report building blocks
// ---------------------------------------------------------------------------

export const detectedSignalSchema = z.object({
  id: z.string().min(1),
  category: auditCategorySchema,
  status: signalStatusSchema,
  weight: z.number().min(0).max(1),
  evidence: z.string(),
});
export type DetectedSignal = z.infer<typeof detectedSignalSchema>;

export const findingSchema = z.object({
  title: z.string().min(1),
  severity: severitySchema,
  evidence: z.string(),
  basis: z.enum(["observed", "inferred"]),
  signalIds: z.array(z.string()),
  recommendation: z.string().min(1),
  /**
   * Present on top problems only: category findings inherit their category
   * from their parent CategoryReport. Optional so existing payloads and
   * fixtures stay valid.
   */
  category: auditCategorySchema.optional(),
});
export type Finding = z.infer<typeof findingSchema>;

export const recommendationSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  category: auditCategorySchema.optional(),
});
export type Recommendation = z.infer<typeof recommendationSchema>;

export const categoryReportSchema = z.object({
  category: auditCategorySchema,
  score: z.number().min(0).max(100),
  confidence: scoreConfidenceSchema,
  explanation: z.string(),
  severity: severitySchema,
  findings: z.array(findingSchema).max(3),
});
export type CategoryReport = z.infer<typeof categoryReportSchema>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const reportSourceSchema = z.object({
  requestedUrl: z.string(),
  finalUrl: z.string(),
  analyzedAt: z.iso.datetime(),
  title: z.string().nullable(),
});
export type ReportSource = z.infer<typeof reportSourceSchema>;

export const reportSchema = z.object({
  source: reportSourceSchema,
  overallScore: z.number().min(0).max(100),
  scoreConfidence: scoreConfidenceSchema,
  summary: z.string().min(1),
  categories: z.array(categoryReportSchema).length(AUDIT_CATEGORIES.length),
  topProblems: z.array(findingSchema).length(3),
  quickWins: z.array(recommendationSchema).min(3).max(5),
  detailedRecommendations: z.array(recommendationSchema).min(1),
  observedSignals: z.array(detectedSignalSchema),
});
export type Report = z.infer<typeof reportSchema>;

// ---------------------------------------------------------------------------
// Responses and error envelope
// ---------------------------------------------------------------------------

export const analyzeSuccessResponseSchema = z.object({
  report: reportSchema,
});
export type AnalyzeSuccessResponse = z.infer<typeof analyzeSuccessResponseSchema>;

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const analyzeErrorResponseSchema = z.object({
  error: apiErrorSchema,
});
export type AnalyzeErrorResponse = z.infer<typeof analyzeErrorResponseSchema>;

/**
 * Stable machine-readable error codes. Status mapping lives server-side;
 * the client maps these to recovery copy in a later phase.
 */
export const API_ERROR_CODES = {
  badRequest: "BAD_REQUEST",
  invalidUrl: "INVALID_URL",
  blockedDestination: "BLOCKED_DESTINATION",
  requestTooLarge: "REQUEST_TOO_LARGE",
  pageTooLarge: "PAGE_TOO_LARGE",
  nonHtmlResponse: "NON_HTML_RESPONSE",
  rateLimited: "RATE_LIMITED",
  upstreamFailure: "UPSTREAM_FAILURE",
  timeout: "TIMEOUT",
  missingConfiguration: "MISSING_CONFIGURATION",
  notImplemented: "NOT_IMPLEMENTED",
  notFound: "NOT_FOUND",
  methodNotAllowed: "METHOD_NOT_ALLOWED",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];
