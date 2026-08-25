import { z } from "zod";
import type { ParsePayload } from "zod/v4/core";
import {
  AUDIT_CATEGORIES,
  auditCategorySchema,
  severitySchema,
} from "../../shared/audit-types.js";

/**
 * Strict validation for Gemini's structured audit output (Phase 5).
 *
 * The model is untrusted: every field is bounded, enums are closed, the
 * category set is exactly seven unique keys, and unknown properties are
 * rejected. Malformed output is rejected here and mapped to a safe generic
 * AI failure upstream — it is never surfaced to the client.
 *
 * Two shapes exist by design:
 *
 * - The WIRE shape (`geminiWireShapeSchema`) is what Gemini is asked to
 *   produce and is converted into the generation-time responseJsonSchema.
 *   Gemini's structured output rejects arrays of objects nested inside
 *   arrays of objects (verified live: `categories[].findings[]` returns
 *   400 INVALID_ARGUMENT while flat sibling lists pass), so findings are
 *   generated as one flat list tagged with `categoryKey`.
 * - The DOMAIN shape (`geminiAuditShapeSchema` → `GeminiAudit`) groups
 *   findings back under their categories. `parseGeminiAuditOutput` performs
 *   wire validation → grouping → strict domain re-validation, which remains
 *   the single authority every consumer trusts.
 */

/** Hard string bounds enforced on every AI-provided string. */
export const GEMINI_STRING_LIMITS = {
  summaryMin: 20,
  summaryMax: 1200,
  explanationMin: 10,
  explanationMax: 900,
  titleMin: 3,
  titleMax: 160,
  evidenceMin: 10,
  evidenceMax: 600,
  recommendationMin: 10,
  recommendationMax: 600,
  rationaleMin: 10,
  rationaleMax: 500,
  maxFindingsPerCategory: 3,
  maxFindingsTotal: AUDIT_CATEGORIES.length * 3,
  maxSignalIdsPerFinding: 8,
  quickWins: { min: 3, max: 5 },
  detailedRecommendations: { min: 1, max: 10 },
  priorityMax: 100,
} as const;

const basisSchema = z.enum(["observed", "inferred"]);

const geminiFindingSchema = z.strictObject({
  title: z.string().min(GEMINI_STRING_LIMITS.titleMin).max(GEMINI_STRING_LIMITS.titleMax),
  severity: severitySchema,
  evidence: z.string().min(GEMINI_STRING_LIMITS.evidenceMin).max(GEMINI_STRING_LIMITS.evidenceMax),
  basis: basisSchema,
  signalIds: z.array(z.string().min(1)).max(GEMINI_STRING_LIMITS.maxSignalIdsPerFinding),
  recommendation: z
    .string()
    .min(GEMINI_STRING_LIMITS.recommendationMin)
    .max(GEMINI_STRING_LIMITS.recommendationMax),
});

const geminiCategoryAssessmentSchema = z.strictObject({
  key: auditCategorySchema,
  score: z.number().int().min(0).max(100),
  explanation: z
    .string()
    .min(GEMINI_STRING_LIMITS.explanationMin)
    .max(GEMINI_STRING_LIMITS.explanationMax),
  severity: severitySchema,
  findings: z.array(geminiFindingSchema).max(GEMINI_STRING_LIMITS.maxFindingsPerCategory),
});

const geminiTopProblemSchema = z.strictObject({
  category: auditCategorySchema,
  ...geminiFindingSchema.shape,
});

const geminiQuickWinSchema = z.strictObject({
  title: z.string().min(GEMINI_STRING_LIMITS.titleMin).max(GEMINI_STRING_LIMITS.titleMax),
  rationale: z.string().min(GEMINI_STRING_LIMITS.rationaleMin).max(GEMINI_STRING_LIMITS.rationaleMax),
  category: auditCategorySchema,
});

const geminiDetailedRecommendationSchema = z.strictObject({
  title: z.string().min(GEMINI_STRING_LIMITS.titleMin).max(GEMINI_STRING_LIMITS.titleMax),
  rationale: z.string().min(GEMINI_STRING_LIMITS.rationaleMin).max(GEMINI_STRING_LIMITS.rationaleMax),
  category: auditCategorySchema,
  priority: z.number().int().min(1).max(GEMINI_STRING_LIMITS.priorityMax),
});

// ---------------------------------------------------------------------------
// Domain shape (post-grouping) — the type the rest of the server consumes.
// ---------------------------------------------------------------------------

export const geminiAuditShapeSchema = z.strictObject({
  summary: z
    .string()
    .min(GEMINI_STRING_LIMITS.summaryMin)
    .max(GEMINI_STRING_LIMITS.summaryMax)
    .describe("Concise overall interpretation of the page's UX in 2-4 sentences."),
  categories: z
    .array(geminiCategoryAssessmentSchema)
    .length(AUDIT_CATEGORIES.length),
  topProblems: z.array(geminiTopProblemSchema).length(3),
  quickWins: z
    .array(geminiQuickWinSchema)
    .min(GEMINI_STRING_LIMITS.quickWins.min)
    .max(GEMINI_STRING_LIMITS.quickWins.max),
  detailedRecommendations: z
    .array(geminiDetailedRecommendationSchema)
    .min(GEMINI_STRING_LIMITS.detailedRecommendations.min)
    .max(GEMINI_STRING_LIMITS.detailedRecommendations.max),
});

export type GeminiAudit = z.infer<typeof geminiAuditShapeSchema>;
export type GeminiFinding = z.infer<typeof geminiFindingSchema>;
export type GeminiTopProblem = z.infer<typeof geminiTopProblemSchema>;

function rejectDuplicateCategories(ctx: ParsePayload<GeminiAudit>): void {
  const keys = ctx.value.categories.map((category) => category.key);
  if (new Set(keys).size !== keys.length) {
    ctx.issues.push({
      code: "custom",
      message: "categories must contain each of the seven category keys exactly once",
      input: ctx.value,
    });
  }
}

/** Domain gate: shape + duplicate-category rejection. */
export const geminiAuditSchema = geminiAuditShapeSchema.check(rejectDuplicateCategories);

// ---------------------------------------------------------------------------
// Wire shape — exactly what the model is told to emit.
// ---------------------------------------------------------------------------

const geminiWireCategorySchema = z.strictObject({
  key: auditCategorySchema.describe(
    "One of the seven category keys; each key appears exactly once across the array.",
  ),
  score: z.number().int().min(0).max(100).describe("Integer UX score 0-100 for this category."),
  explanation: z
    .string()
    .describe("Two to four sentences explaining the score from the evidence only."),
  severity: severitySchema.describe("Overall problem severity for this category."),
});

const geminiWireFindingSchema = z.strictObject({
  categoryKey: auditCategorySchema.describe(
    "The category this finding belongs to; must match one of the seven keys.",
  ),
  ...geminiFindingSchema.shape,
});

/** Flattened generation shape accepted from the model (see module doc). */
export const geminiWireShapeSchema = z.strictObject({
  summary: z
    .string()
    .describe("Concise overall interpretation of the page's UX in 2-4 sentences."),
  categories: z
    .array(geminiWireCategorySchema)
    .length(AUDIT_CATEGORIES.length)
    .describe("Exactly one entry per category key, no duplicates, no findings here."),
  findings: z
    .array(geminiWireFindingSchema)
    .max(GEMINI_STRING_LIMITS.maxFindingsTotal)
    .describe(
      "All findings in one flat list, at most three per category, each tagged with its categoryKey.",
    ),
  topProblems: z.array(geminiTopProblemSchema).length(3).describe(
    "Exactly three prioritized cross-category problems.",
  ),
  quickWins: z
    .array(geminiQuickWinSchema)
    .min(GEMINI_STRING_LIMITS.quickWins.min)
    .max(GEMINI_STRING_LIMITS.quickWins.max)
    .describe("Three to five low-effort, high-value improvements."),
  detailedRecommendations: z
    .array(geminiDetailedRecommendationSchema)
    .min(GEMINI_STRING_LIMITS.detailedRecommendations.min)
    .max(GEMINI_STRING_LIMITS.detailedRecommendations.max)
    .describe("Specific fixes ordered by priority where priority 1 is most important."),
});

type GeminiWireAudit = z.infer<typeof geminiWireShapeSchema>;

function rejectDuplicateWireCategories(ctx: ParsePayload<GeminiWireAudit>): void {
  const keys = ctx.value.categories.map((category) => category.key);
  if (new Set(keys).size !== keys.length) {
    ctx.issues.push({
      code: "custom",
      message: "categories must contain each of the seven category keys exactly once",
      input: ctx.value,
    });
  }
}

const geminiWireAuditSchema = geminiWireShapeSchema.check(rejectDuplicateWireCategories);

export type ParseOutcome =
  | { ok: true; audit: GeminiAudit }
  | { ok: false; reason: string };

/**
 * Single gate between raw model output and the server:
 * 1. validate the flattened wire shape (closed enums, bounds, exact counts),
 * 2. group flat findings under their categories (order-preserving),
 * 3. re-validate against the stricter domain schema (per-category finding
 *    caps, string bounds, duplicate-category rejection).
 */
export function parseGeminiAuditOutput(raw: unknown): ParseOutcome {
  const wire = geminiWireAuditSchema.safeParse(raw);
  if (!wire.success) return { ok: false, reason: "wire schema validation failed" };

  const grouped = new Map<string, GeminiFinding[]>(AUDIT_CATEGORIES.map((key) => [key, []]));
  for (const finding of wire.data.findings) {
    grouped.get(finding.categoryKey)!.push({
      title: finding.title,
      severity: finding.severity,
      evidence: finding.evidence,
      basis: finding.basis,
      signalIds: finding.signalIds,
      recommendation: finding.recommendation,
    });
  }

  const candidate: GeminiAudit = {
    summary: wire.data.summary,
    categories: wire.data.categories.map((category) => ({
      ...category,
      findings: grouped.get(category.key)!,
    })),
    topProblems: wire.data.topProblems,
    quickWins: wire.data.quickWins,
    detailedRecommendations: wire.data.detailedRecommendations,
  };

  const domain = geminiAuditSchema.safeParse(candidate);
  if (!domain.success) return { ok: false, reason: "domain schema validation failed" };
  return { ok: true, audit: domain.data };
}

/**
 * Gemini's `responseJsonSchema` supports a JSON Schema subset with
 * undocumented rejection rules discovered during live verification:
 * string-length keywords are unsupported, and `maxItems` beyond a small
 * value is rejected on arrays of objects. All such constraints are stripped
 * from the GENERATION schema — the prompt states the expected cardinalities
 * and this module's Zod schemas enforce them authoritatively after parsing.
 */
export function geminiResponseJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(geminiWireShapeSchema, {
    target: "draft-7",
    override: (ctx) => {
      const node = ctx.jsonSchema as Record<string, unknown>;
      delete node.minLength;
      delete node.maxLength;
      delete node.minItems;
      delete node.maxItems;
    },
  }) as Record<string, unknown>;
  // Added by the generator after overrides run.
  delete json.$schema;
  return json;
}

// ---------------------------------------------------------------------------
// Signal-reference validation
// ---------------------------------------------------------------------------

export interface SignalReferenceCheck {
  ok: boolean;
  invalidIds: string[];
}

/**
 * Every signal ID the model references must exist within THIS page's
 * deterministic signal set. Anything else is an invented evidence reference
 * and rejects the whole audit.
 */
export function checkSignalReferences(
  audit: GeminiAudit,
  allowedSignalIds: ReadonlySet<string>,
): SignalReferenceCheck {
  const invalid = new Set<string>();
  const visit = (ids: readonly string[]): void => {
    for (const id of ids) {
      if (!allowedSignalIds.has(id)) invalid.add(id);
    }
  };
  for (const category of audit.categories) {
    for (const finding of category.findings) visit(finding.signalIds);
  }
  for (const problem of audit.topProblems) visit(problem.signalIds);
  return { ok: invalid.size === 0, invalidIds: [...invalid] };
}
