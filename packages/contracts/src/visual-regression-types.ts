import { z } from "zod";
import { isoDateTimeSchema } from "./audit-types.js";
import {
  screenshotCaptureTypeSchema,
  screenshotDeviceTypeSchema,
} from "./screenshot-types.js";

/**
 * Visual Regression Schema Version & Algorithm Constants
 */
export const VISUAL_REGRESSION_SCHEMA_VERSION = "1.0.0" as const;
export const VISUAL_DIFF_ALGORITHM = "block_perceptual_hash_v1" as const;

/**
 * Grid Partition Constants (4 columns x 8 rows = 32 blocks)
 * Zone distribution:
 * - Hero Zone: rows 0, 1, 2 (top 37.5% of viewport)
 * - Body Zone: rows 3, 4, 5 (middle 37.5% of viewport)
 * - Footer Zone: rows 6, 7 (bottom 25% of viewport)
 */
export const GRID_COLUMNS = 4 as const;
export const GRID_ROWS = 8 as const;
export const TOTAL_GRID_BLOCKS = 32 as const; // 4 * 8

export const HERO_ZONE_ROWS = [0, 1, 2] as const;
export const BODY_ZONE_ROWS = [3, 4, 5] as const;
export const FOOTER_ZONE_ROWS = [6, 7] as const;

/**
 * Thresholds for Visual Regression Evaluation
 * - BLOCK_NOISE_THRESHOLD: block Hamming distance <= 12% is treated as benign rendering/compression noise.
 * - INSIGNIFICANT_CHANGE_THRESHOLD: overall change < 5% is negligible.
 * - MINOR_CHANGE_THRESHOLD: 5% <= change < 15% is minor.
 * - MODERATE_CHANGE_THRESHOLD: 15% <= change < 30% is moderate.
 * - SIGNIFICANT_CHANGE_THRESHOLD: 30% <= change < 60% is significant.
 * - MAJOR_CHANGE_THRESHOLD: change >= 60% is major redesign.
 * - HERO_CHANGE_THRESHOLD: hero zone change >= 20% produces an above-the-fold shift indicator.
 * - MEANINGFUL_CHANGED_BLOCKS_THRESHOLD: >= 8 changed blocks out of 32 triggers meaningful change.
 * - MEANINGFUL_HEIGHT_DELTA_PX: |heightDeltaPx| >= 300px triggers meaningful change.
 */
export const BLOCK_NOISE_THRESHOLD = 12 as const;
export const INSIGNIFICANT_CHANGE_THRESHOLD = 5 as const;
export const MINOR_CHANGE_THRESHOLD = 15 as const;
export const MODERATE_CHANGE_THRESHOLD = 30 as const;
export const SIGNIFICANT_CHANGE_THRESHOLD = 60 as const;
export const HERO_CHANGE_THRESHOLD = 20 as const;
export const HERO_SHIFT_THRESHOLD_PERCENT = HERO_CHANGE_THRESHOLD;
export const MEANINGFUL_CHANGED_BLOCKS_THRESHOLD = 8 as const;
export const MEANINGFUL_HEIGHT_DELTA_PX = 300 as const;
export const VISUAL_DIFF_METHOD_LABEL = "32-Block Perceptual Hash" as const;

/**
 * Visual change severity classification tiers
 */
export const VISUAL_CHANGE_SEVERITIES = [
  "negligible",
  "minor",
  "moderate",
  "significant",
  "major",
] as const;
export const visualChangeSeveritySchema = z.enum(VISUAL_CHANGE_SEVERITIES);
export type VisualChangeSeverity = z.infer<typeof visualChangeSeveritySchema>;

/**
 * Visual diff zone names
 */
export const VISUAL_DIFF_ZONES = ["hero", "body", "footer"] as const;
export const visualDiffZoneNameSchema = z.enum(VISUAL_DIFF_ZONES);
export type VisualDiffZoneName = z.infer<typeof visualDiffZoneNameSchema>;

/**
 * Zone-level difference aggregation
 */
export const visualZoneDiffSchema = z.object({
  zone: visualDiffZoneNameSchema,
  changePercent: z.number().min(0).max(100),
  blockCount: z.number().int().nonnegative(),
  changedBlockCount: z.number().int().nonnegative(),
});
export type VisualZoneDiff = z.infer<typeof visualZoneDiffSchema>;

/**
 * Individual spatial block difference in the 4x8 grid
 */
export const visualBlockDiffSchema = z.object({
  index: z.number().int().min(0).max(TOTAL_GRID_BLOCKS - 1),
  row: z.number().int().min(0).max(GRID_ROWS - 1),
  col: z.number().int().min(0).max(GRID_COLUMNS - 1),
  zone: visualDiffZoneNameSchema,
  distancePercent: z.number().min(0).max(100),
  isChanged: z.boolean(),
});
export type VisualBlockDiff = z.infer<typeof visualBlockDiffSchema>;

/**
 * Visual diff status
 */
export const VISUAL_DIFF_STATUSES = [
  "completed",
  "baseline",
  "failed",
  "skipped",
] as const;
export const visualDiffStatusSchema = z.enum(VISUAL_DIFF_STATUSES);
export type VisualDiffStatus = z.infer<typeof visualDiffStatusSchema>;

/**
 * Full Visual Diff Result for an individual viewport/capture type
 */
export const visualDiffResultSchema = z.object({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  monitoredPageId: z.string().uuid().optional(),
  currentAuditRunId: z.string().uuid(),
  baselineAuditRunId: z.string().uuid().nullable().optional(),
  currentScreenshotId: z.string().uuid().nullable().optional(),
  baselineScreenshotId: z.string().uuid().nullable().optional(),
  deviceType: screenshotDeviceTypeSchema,
  captureType: screenshotCaptureTypeSchema,
  schemaVersion: z
    .literal(VISUAL_REGRESSION_SCHEMA_VERSION)
    .default(VISUAL_REGRESSION_SCHEMA_VERSION),
  diffAlgorithm: z
    .literal(VISUAL_DIFF_ALGORITHM)
    .default(VISUAL_DIFF_ALGORITHM),
  status: visualDiffStatusSchema,
  isBaseline: z.boolean(),
  isMeaningfulChange: z.boolean(),
  visualChangeScore: z.number().min(0).max(100),
  changeSeverity: visualChangeSeveritySchema,
  heroZoneChange: z.number().min(0).max(100),
  bodyZoneChange: z.number().min(0).max(100),
  footerZoneChange: z.number().min(0).max(100),
  changedBlocksCount: z.number().int().nonnegative(),
  totalBlocksCount: z.number().int().positive().default(TOTAL_GRID_BLOCKS),
  heightDeltaPx: z.number().int().default(0),
  changeReasons: z.array(z.string()).default([]),
  blockDiffs: z.array(visualBlockDiffSchema).optional(),
  currentSignedUrl: z.string().url().optional(),
  baselineSignedUrl: z.string().url().optional(),
  errorMessage: z.string().nullable().optional(),
  createdAt: isoDateTimeSchema.optional(),
});
export type VisualDiffResult = z.infer<typeof visualDiffResultSchema>;

/**
 * Summary rollup embedded in diff views and API responses
 */
export const visualDiffSummarySchema = z.object({
  hasVisualDiff: z.boolean(),
  isBaseline: z.boolean(),
  isMeaningfulChange: z.boolean(),
  maxChangeScore: z.number().min(0).max(100),
  maxChangeSeverity: visualChangeSeveritySchema,
  desktopChangeScore: z.number().min(0).max(100).nullable(),
  mobileChangeScore: z.number().min(0).max(100).nullable(),
  changeReasons: z.array(z.string()).default([]),
});
export type VisualDiffSummary = z.infer<typeof visualDiffSummarySchema>;

/**
 * API Response for GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/visual-diff
 */
export const visualDiffResponseSchema = z.object({
  diffs: z.array(visualDiffResultSchema),
  summary: visualDiffSummarySchema,
  baselineRunId: z.string().uuid().nullable().optional(),
  currentRunId: z.string().uuid(),
});
export type VisualDiffResponse = z.infer<typeof visualDiffResponseSchema>;
