import { describe, expect, it } from "vitest";
import {
  BLOCK_NOISE_THRESHOLD,
  HERO_CHANGE_THRESHOLD,
  INSIGNIFICANT_CHANGE_THRESHOLD,
  MEANINGFUL_CHANGED_BLOCKS_THRESHOLD,
  MEANINGFUL_HEIGHT_DELTA_PX,
  MINOR_CHANGE_THRESHOLD,
  MODERATE_CHANGE_THRESHOLD,
  SIGNIFICANT_CHANGE_THRESHOLD,
  TOTAL_GRID_BLOCKS,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_REGRESSION_SCHEMA_VERSION,
  visualBlockDiffSchema,
  visualChangeSeveritySchema,
  visualDiffResponseSchema,
  visualDiffResultSchema,
  visualDiffStatusSchema,
  visualDiffSummarySchema,
  visualZoneDiffSchema,
} from "../src/visual-regression-types.js";
import { auditScreenshotMetadataSchema } from "../src/screenshot-types.js";

describe("Visual Regression Contracts", () => {
  it("exports stable schema versions and threshold constants", () => {
    expect(VISUAL_REGRESSION_SCHEMA_VERSION).toBe("1.0.0");
    expect(VISUAL_DIFF_ALGORITHM).toBe("block_perceptual_hash_v1");
    expect(TOTAL_GRID_BLOCKS).toBe(32);
    expect(BLOCK_NOISE_THRESHOLD).toBe(12);
    expect(INSIGNIFICANT_CHANGE_THRESHOLD).toBe(5);
    expect(MINOR_CHANGE_THRESHOLD).toBe(15);
    expect(MODERATE_CHANGE_THRESHOLD).toBe(30);
    expect(SIGNIFICANT_CHANGE_THRESHOLD).toBe(60);
    expect(HERO_CHANGE_THRESHOLD).toBe(20);
    expect(MEANINGFUL_CHANGED_BLOCKS_THRESHOLD).toBe(8);
    expect(MEANINGFUL_HEIGHT_DELTA_PX).toBe(300);
  });

  it("validates visual change severity enum", () => {
    expect(visualChangeSeveritySchema.parse("negligible")).toBe("negligible");
    expect(visualChangeSeveritySchema.parse("minor")).toBe("minor");
    expect(visualChangeSeveritySchema.parse("moderate")).toBe("moderate");
    expect(visualChangeSeveritySchema.parse("significant")).toBe("significant");
    expect(visualChangeSeveritySchema.parse("major")).toBe("major");
    expect(() => visualChangeSeveritySchema.parse("critical")).toThrow();
  });

  it("validates visual block diff schema", () => {
    const validBlock = {
      index: 0,
      row: 0,
      col: 0,
      zone: "hero",
      distancePercent: 18.5,
      isChanged: true,
    };
    const parsed = visualBlockDiffSchema.parse(validBlock);
    expect(parsed.index).toBe(0);
    expect(parsed.zone).toBe("hero");
    expect(parsed.isChanged).toBe(true);

    // Out of bounds index
    expect(() =>
      visualBlockDiffSchema.parse({ ...validBlock, index: 32 })
    ).toThrow();
  });

  it("validates visual zone diff schema", () => {
    const validZone = {
      zone: "hero",
      changePercent: 24.5,
      blockCount: 12,
      changedBlockCount: 3,
    };
    const parsed = visualZoneDiffSchema.parse(validZone);
    expect(parsed.zone).toBe("hero");
    expect(parsed.changePercent).toBe(24.5);
  });

  it("validates visual diff result schema with defaults", () => {
    const validResult = {
      currentAuditRunId: "550e8400-e29b-41d4-a716-446655440000",
      baselineAuditRunId: "550e8400-e29b-41d4-a716-446655440001",
      deviceType: "desktop",
      captureType: "viewport",
      status: "completed",
      isBaseline: false,
      isMeaningfulChange: true,
      visualChangeScore: 22.5,
      changeSeverity: "moderate",
      heroZoneChange: 35.0,
      bodyZoneChange: 15.0,
      footerZoneChange: 0.0,
      changedBlocksCount: 6,
      changeReasons: ["hero_section_modified"],
    };

    const parsed = visualDiffResultSchema.parse(validResult);
    expect(parsed.schemaVersion).toBe("1.0.0");
    expect(parsed.diffAlgorithm).toBe("block_perceptual_hash_v1");
    expect(parsed.totalBlocksCount).toBe(32);
    expect(parsed.heightDeltaPx).toBe(0);
    expect(parsed.isMeaningfulChange).toBe(true);
    expect(parsed.visualChangeScore).toBe(22.5);
  });

  it("validates baseline visual diff result", () => {
    const baselineResult = {
      currentAuditRunId: "550e8400-e29b-41d4-a716-446655440000",
      baselineAuditRunId: null,
      deviceType: "mobile",
      captureType: "viewport",
      status: "baseline",
      isBaseline: true,
      isMeaningfulChange: false,
      visualChangeScore: 0,
      changeSeverity: "negligible",
      heroZoneChange: 0,
      bodyZoneChange: 0,
      footerZoneChange: 0,
      changedBlocksCount: 0,
      changeReasons: ["baseline_established"],
    };

    const parsed = visualDiffResultSchema.parse(baselineResult);
    expect(parsed.isBaseline).toBe(true);
    expect(parsed.baselineAuditRunId).toBeNull();
    expect(parsed.status).toBe("baseline");
    expect(parsed.visualChangeScore).toBe(0);
  });

  it("validates visual diff summary and response schema", () => {
    const response = {
      diffs: [
        {
          currentAuditRunId: "550e8400-e29b-41d4-a716-446655440000",
          baselineAuditRunId: "550e8400-e29b-41d4-a716-446655440001",
          deviceType: "desktop",
          captureType: "viewport",
          status: "completed",
          isBaseline: false,
          isMeaningfulChange: true,
          visualChangeScore: 28.0,
          changeSeverity: "moderate",
          heroZoneChange: 40.0,
          bodyZoneChange: 20.0,
          footerZoneChange: 5.0,
          changedBlocksCount: 7,
          changeReasons: ["hero_section_modified"],
        },
      ],
      summary: {
        hasVisualDiff: true,
        isBaseline: false,
        isMeaningfulChange: true,
        maxChangeScore: 28.0,
        maxChangeSeverity: "moderate",
        desktopChangeScore: 28.0,
        mobileChangeScore: null,
        changeReasons: ["hero_section_modified"],
      },
      baselineRunId: "550e8400-e29b-41d4-a716-446655440001",
      currentRunId: "550e8400-e29b-41d4-a716-446655440000",
    };

    const parsed = visualDiffResponseSchema.parse(response);
    expect(parsed.diffs).toHaveLength(1);
    expect(parsed.summary.maxChangeScore).toBe(28.0);
    expect(parsed.summary.isMeaningfulChange).toBe(true);
  });

  it("verifies screenshot metadata schema includes optional perceptualHash and blockHashes", () => {
    const screenshotMeta = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      auditRunId: "550e8400-e29b-41d4-a716-446655440001",
      monitoredPageId: "550e8400-e29b-41d4-a716-446655440002",
      projectId: "550e8400-e29b-41d4-a716-446655440003",
      organizationId: "550e8400-e29b-41d4-a716-446655440004",
      deviceType: "desktop",
      captureType: "viewport",
      storagePath: "orgs/1/projects/2/pages/3/runs/4/desktop-viewport.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 120000,
      mimeType: "image/webp",
      width: 1280,
      height: 800,
      capturedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      perceptualHash: "a1b2c3d4e5f60718",
      blockHashes: Array.from({ length: 32 }, (_, i) => `hash_${i}`),
    };

    const parsed = auditScreenshotMetadataSchema.parse(screenshotMeta);
    expect(parsed.perceptualHash).toBe("a1b2c3d4e5f60718");
    expect(parsed.blockHashes).toHaveLength(32);
  });

  it("validates visualDiffStatusSchema and visualDiffSummarySchema", () => {
    expect(visualDiffStatusSchema.parse("completed")).toBe("completed");
    expect(visualDiffStatusSchema.parse("baseline")).toBe("baseline");
    expect(() => visualDiffStatusSchema.parse("invalid_status")).toThrow();

    const summary = visualDiffSummarySchema.parse({
      hasVisualDiff: true,
      isBaseline: false,
      isMeaningfulChange: true,
      maxChangeScore: 25.5,
      maxChangeSeverity: "moderate",
      desktopChangeScore: 25.5,
      mobileChangeScore: null,
      changeReasons: ["Hero section layout shifted"],
    });
    expect(summary.hasVisualDiff).toBe(true);
    expect(summary.maxChangeScore).toBe(25.5);
    expect(summary.maxChangeSeverity).toBe("moderate");
  });
});
