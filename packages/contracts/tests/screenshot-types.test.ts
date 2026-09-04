import { describe, expect, it } from "vitest";
import {
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  VISUAL_EVIDENCE_LABEL,
  SCREENSHOT_STORAGE_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  MAX_CAPTURE_HEIGHT,
  MAX_SCREENSHOT_BYTES,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  SCREENSHOT_DEVICE_TYPES,
  SCREENSHOT_CAPTURE_TYPES,
  SCREENSHOT_MIME_TYPES,
  screenshotDeviceTypeSchema,
  screenshotCaptureTypeSchema,
  screenshotMimeTypeSchema,
  auditScreenshotMetadataSchema,
  auditScreenshotsResponseSchema,
  buildScreenshotStoragePath,
} from "../src/index.js";
import type { AuditScreenshotMetadata } from "../src/index.js";

describe("Screenshot Contracts & Visual Schemas", () => {
  it("defines standard constants and boundaries", () => {
    expect(VISUAL_ANALYSIS_SCHEMA_VERSION).toBe("1.0.0");
    expect(VISUAL_EVIDENCE_LABEL).toBe("BROWSER-RENDERED EVIDENCE");
    expect(SCREENSHOT_STORAGE_BUCKET).toBe("audit-screenshots");
    expect(SIGNED_URL_TTL_SECONDS).toBe(900);
    expect(MAX_CAPTURE_HEIGHT).toBe(4000);
    expect(MAX_SCREENSHOT_BYTES).toBe(5 * 1024 * 1024);
    expect(DESKTOP_VIEWPORT).toEqual({ width: 1280, height: 800 });
    expect(MOBILE_VIEWPORT).toEqual({ width: 375, height: 812 });
  });

  describe("Enum Schemas", () => {
    it("validates device types", () => {
      expect(SCREENSHOT_DEVICE_TYPES).toContain("desktop");
      expect(SCREENSHOT_DEVICE_TYPES).toContain("mobile");
      expect(screenshotDeviceTypeSchema.safeParse("desktop").success).toBe(true);
      expect(screenshotDeviceTypeSchema.safeParse("mobile").success).toBe(true);
      expect(screenshotDeviceTypeSchema.safeParse("tablet").success).toBe(false);
    });

    it("validates capture types", () => {
      expect(SCREENSHOT_CAPTURE_TYPES).toContain("viewport");
      expect(SCREENSHOT_CAPTURE_TYPES).toContain("full_page");
      expect(screenshotCaptureTypeSchema.safeParse("viewport").success).toBe(true);
      expect(screenshotCaptureTypeSchema.safeParse("full_page").success).toBe(true);
      expect(screenshotCaptureTypeSchema.safeParse("partial").success).toBe(false);
    });

    it("validates mime types", () => {
      expect(SCREENSHOT_MIME_TYPES).toContain("image/webp");
      expect(SCREENSHOT_MIME_TYPES).toContain("image/png");
      expect(SCREENSHOT_MIME_TYPES).toContain("image/jpeg");
      expect(screenshotMimeTypeSchema.safeParse("image/webp").success).toBe(true);
      expect(screenshotMimeTypeSchema.safeParse("image/png").success).toBe(true);
      expect(screenshotMimeTypeSchema.safeParse("image/gif").success).toBe(false);
    });
  });

  describe("auditScreenshotMetadataSchema", () => {
    const validMetadata: AuditScreenshotMetadata = {
      id: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      auditRunId: "11111111-1111-4111-8111-111111111111",
      auditReportId: "22222222-2222-4222-8222-222222222222",
      monitoredPageId: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
      organizationId: "55555555-5555-4555-8555-555555555555",
      deviceType: "desktop",
      captureType: "viewport",
      storagePath: "organizations/555/projects/444/pages/333/runs/111/desktop-viewport.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 154200,
      mimeType: "image/webp",
      width: 1280,
      height: 800,
      capturedAt: "2026-09-06T12:00:00.000Z",
      createdAt: "2026-09-06T12:00:05.000Z",
      signedUrl: "https://example.supabase.co/storage/v1/object/sign/audit-screenshots/test.webp?token=xyz",
    };

    it("parses valid screenshot metadata", () => {
      const parsed = auditScreenshotMetadataSchema.parse(validMetadata);
      expect(parsed.id).toBe(validMetadata.id);
      expect(parsed.deviceType).toBe("desktop");
      expect(parsed.captureType).toBe("viewport");
      expect(parsed.signedUrl).toBeDefined();
    });

    it("allows optional auditReportId and signedUrl", () => {
      const minimal = {
        ...validMetadata,
        auditReportId: null,
        signedUrl: undefined,
      };
      const parsed = auditScreenshotMetadataSchema.parse(minimal);
      expect(parsed.auditReportId).toBeNull();
      expect(parsed.signedUrl).toBeUndefined();
    });

    it("rejects height exceeding MAX_CAPTURE_HEIGHT (4000px)", () => {
      const invalid = {
        ...validMetadata,
        height: 4001,
      };
      const res = auditScreenshotMetadataSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });

    it("rejects invalid UUIDs", () => {
      const invalid = {
        ...validMetadata,
        auditRunId: "not-a-uuid",
      };
      expect(auditScreenshotMetadataSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("auditScreenshotsResponseSchema", () => {
    it("validates array of screenshot metadata", () => {
      const payload = {
        screenshots: [
          {
            id: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
            auditRunId: "11111111-1111-4111-8111-111111111111",
            monitoredPageId: "33333333-3333-4333-8333-333333333333",
            projectId: "44444444-4444-4444-8444-444444444444",
            organizationId: "55555555-5555-4555-8555-555555555555",
            deviceType: "mobile" as const,
            captureType: "viewport" as const,
            storagePath: "organizations/555/projects/444/pages/333/runs/111/mobile-viewport.webp",
            storageBucket: "audit-screenshots",
            fileSizeBytes: 89400,
            mimeType: "image/webp" as const,
            width: 375,
            height: 812,
            capturedAt: "2026-09-06T12:00:00.000Z",
            createdAt: "2026-09-06T12:00:05.000Z",
          },
        ],
      };

      const parsed = auditScreenshotsResponseSchema.parse(payload);
      expect(parsed.screenshots).toHaveLength(1);
      expect(parsed.screenshots[0].deviceType).toBe("mobile");
    });
  });

  describe("buildScreenshotStoragePath", () => {
    it("builds consistent deterministic storage path", () => {
      const path = buildScreenshotStoragePath({
        organizationId: "org-123",
        projectId: "proj-456",
        monitoredPageId: "page-789",
        auditRunId: "run-abc",
        deviceType: "desktop",
        captureType: "viewport",
      });

      expect(path).toBe(
        "organizations/org-123/projects/proj-456/pages/page-789/runs/run-abc/desktop-viewport.webp"
      );
    });

    it("respects custom extension without double dot", () => {
      const path = buildScreenshotStoragePath({
        organizationId: "org-1",
        projectId: "proj-1",
        monitoredPageId: "page-1",
        auditRunId: "run-1",
        deviceType: "mobile",
        captureType: "full_page",
        extension: ".png",
      });

      expect(path).toBe(
        "organizations/org-1/projects/proj-1/pages/page-1/runs/run-1/mobile-full_page.png"
      );
    });
  });
});
