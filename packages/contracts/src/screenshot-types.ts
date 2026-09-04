import { z } from "zod";
import { isoDateTimeSchema } from "./audit-types.js";

/**
 * Visual Analysis Schema Version and Labels
 */
export const VISUAL_ANALYSIS_SCHEMA_VERSION = "1.0.0" as const;
export const VISUAL_EVIDENCE_LABEL = "BROWSER-RENDERED EVIDENCE" as const;

/**
 * Storage Constants and Limits
 */
export const SCREENSHOT_STORAGE_BUCKET = "audit-screenshots" as const;
export const SIGNED_URL_TTL_SECONDS = 900 as const; // 15 minutes
export const MAX_CAPTURE_HEIGHT = 4000 as const;
export const MAX_SCREENSHOT_BYTES = 5242880 as const; // 5 MB

export const DESKTOP_VIEWPORT: { width: number; height: number } = {
  width: 1280,
  height: 800,
};

export const MOBILE_VIEWPORT: { width: number; height: number } = {
  width: 375,
  height: 812,
};

/**
 * Supported device types for screenshot capture
 */
export const SCREENSHOT_DEVICE_TYPES = ["desktop", "mobile"] as const;
export const screenshotDeviceTypeSchema = z.enum(SCREENSHOT_DEVICE_TYPES);
export type ScreenshotDeviceType = z.infer<typeof screenshotDeviceTypeSchema>;

/**
 * Supported capture types
 */
export const SCREENSHOT_CAPTURE_TYPES = ["viewport", "full_page"] as const;
export const screenshotCaptureTypeSchema = z.enum(SCREENSHOT_CAPTURE_TYPES);
export type ScreenshotCaptureType = z.infer<typeof screenshotCaptureTypeSchema>;

/**
 * Supported image MIME types
 */
export const SCREENSHOT_MIME_TYPES = [
  "image/webp",
  "image/png",
  "image/jpeg",
] as const;
export const screenshotMimeTypeSchema = z.enum(SCREENSHOT_MIME_TYPES);
export type ScreenshotMimeType = z.infer<typeof screenshotMimeTypeSchema>;

/**
 * Screenshot processing status
 */
export const SCREENSHOT_STATUSES = ["pending", "completed", "failed"] as const;
export const screenshotStatusSchema = z.enum(SCREENSHOT_STATUSES);
export type ScreenshotStatus = z.infer<typeof screenshotStatusSchema>;

/**
 * Screenshot metadata entity stored in public.audit_screenshots
 */
export const auditScreenshotMetadataSchema = z.object({
  id: z.string().uuid(),
  auditRunId: z.string().uuid(),
  auditReportId: z.string().uuid().nullable().optional(),
  monitoredPageId: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  deviceType: screenshotDeviceTypeSchema,
  captureType: screenshotCaptureTypeSchema,
  storagePath: z.string().min(1),
  storageBucket: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative(),
  mimeType: screenshotMimeTypeSchema,
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(MAX_CAPTURE_HEIGHT),
  capturedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  signedUrl: z.string().url().optional(),
  perceptualHash: z.string().nullable().optional(),
  blockHashes: z.array(z.string()).nullable().optional(),
});
export type AuditScreenshotMetadata = z.infer<typeof auditScreenshotMetadataSchema>;

/**
 * API response for audit run screenshots
 */
export const auditScreenshotsResponseSchema = z.object({
  screenshots: z.array(auditScreenshotMetadataSchema),
});
export type AuditScreenshotsResponse = z.infer<typeof auditScreenshotsResponseSchema>;

/**
 * Deterministic storage path builder
 */
export function buildScreenshotStoragePath(params: {
  organizationId: string;
  projectId: string;
  monitoredPageId: string;
  auditRunId: string;
  deviceType: ScreenshotDeviceType;
  captureType: ScreenshotCaptureType;
  extension?: string;
}): string {
  const ext = params.extension?.replace(/^\./, "") || "webp";
  return `organizations/${params.organizationId}/projects/${params.projectId}/pages/${params.monitoredPageId}/runs/${params.auditRunId}/${params.deviceType}-${params.captureType}.${ext}`;
}
