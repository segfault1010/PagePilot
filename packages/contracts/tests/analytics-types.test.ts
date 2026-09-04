import { describe, expect, it } from "vitest";
import {
  ANALYTICS_SCHEMA_VERSION,
  IMPORTED_DATA_LABEL,
  STALE_ANALYTICS_DAYS_THRESHOLD,
  HIGH_EXPOSURE_SESSIONS_THRESHOLD,
  HIGH_EXPOSURE_CONVERSIONS_THRESHOLD,
  MEDIUM_EXPOSURE_SESSIONS_THRESHOLD,
  MEDIUM_EXPOSURE_CONVERSIONS_THRESHOLD,
  pageAnalyticsSnapshotSchema,
  createPageAnalyticsSchema,
  updatePageAnalyticsSchema,
  calculateBusinessExposureTier,
  calculateBusinessImpactPriority,
  isAnalyticsStale,
  BUSINESS_IMPACT_METADATA,
} from "../src/index.js";
import type { PageAnalyticsSnapshot } from "../src/index.js";

describe("Page Analytics Contracts & Prioritization Rules", () => {
  it("defines standard constants and thresholds", () => {
    expect(ANALYTICS_SCHEMA_VERSION).toBe("1.0.0");
    expect(IMPORTED_DATA_LABEL).toBe("IMPORTED DATA");
    expect(STALE_ANALYTICS_DAYS_THRESHOLD).toBe(60);
    expect(HIGH_EXPOSURE_SESSIONS_THRESHOLD).toBe(20000);
    expect(HIGH_EXPOSURE_CONVERSIONS_THRESHOLD).toBe(500);
    expect(MEDIUM_EXPOSURE_SESSIONS_THRESHOLD).toBe(5000);
    expect(MEDIUM_EXPOSURE_CONVERSIONS_THRESHOLD).toBe(100);
  });

  describe("pageAnalyticsSnapshotSchema", () => {
    const validSnapshot: PageAnalyticsSnapshot = {
      id: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      monitoredPageId: "33333333-3333-4333-8333-333333333333",
      sourceType: "manual",
      sourceProviderName: "Manual Entry",
      schemaVersion: "1.0.0",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T23:59:59.000Z",
      sessions: 45000,
      uniqueVisitors: 38000,
      conversions: 1200,
      conversionRate: 2.67,
      bounceRate: 48.5,
      avgDurationSeconds: 125,
      currency: "USD",
      customMetrics: {},
      provenance: {
        label: "IMPORTED DATA",
        importedByUserId: "44444444-4444-4444-8444-444444444444",
        importedByUserName: "Alex Analyst",
        importedAt: "2026-09-01T12:00:00.000Z",
        notes: "Post-launch 30-day baseline",
      },
      isActive: true,
      createdByUserId: "44444444-4444-4444-8444-444444444444",
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };

    it("accepts valid snapshot entity", () => {
      const parsed = pageAnalyticsSnapshotSchema.safeParse(validSnapshot);
      expect(parsed.success).toBe(true);
    });

    it("strictly enforces 'IMPORTED DATA' label in provenance", () => {
      const invalid = {
        ...validSnapshot,
        provenance: {
          ...validSnapshot.provenance,
          label: "PAGEPILOT INFERENCE" as any,
        },
      };
      const parsed = pageAnalyticsSnapshotSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("allows optional nullable metrics without fabricating numbers", () => {
      const partial = {
        ...validSnapshot,
        uniqueVisitors: null,
        conversions: null,
        conversionRate: null,
        bounceRate: null,
        avgDurationSeconds: null,
      };
      const parsed = pageAnalyticsSnapshotSchema.safeParse(partial);
      expect(parsed.success).toBe(true);
    });
  });

  describe("createPageAnalyticsSchema", () => {
    it("accepts valid creation payload", () => {
      const parsed = createPageAnalyticsSchema.safeParse({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T23:59:59.000Z",
        sessions: 25000,
        conversions: 600,
        conversionRate: 2.4,
        bounceRate: 52.1,
        notes: "Baseline measurements",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.sourceType).toBe("manual");
        expect(parsed.data.sourceProviderName).toBe("Manual Entry");
      }
    });

    it("rejects periodStart after periodEnd", () => {
      const parsed = createPageAnalyticsSchema.safeParse({
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        sessions: 1000,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toContain(
          "Period start date must be before or equal to period end date",
        );
      }
    });

    it("rejects negative metrics", () => {
      const parsed = createPageAnalyticsSchema.safeParse({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T00:00:00.000Z",
        sessions: -10,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects conversion rate over 100%", () => {
      const parsed = createPageAnalyticsSchema.safeParse({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T00:00:00.000Z",
        conversionRate: 105,
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects notes exceeding 1000 characters", () => {
      const parsed = createPageAnalyticsSchema.safeParse({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T00:00:00.000Z",
        notes: "a".repeat(1001),
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("updatePageAnalyticsSchema", () => {
    it("accepts valid partial update", () => {
      const parsed = updatePageAnalyticsSchema.safeParse({
        sessions: 30000,
        conversionRate: 3.1,
        notes: "Updated with full month data",
      });
      expect(parsed.success).toBe(true);
    });

    it("validates period ordering when both dates are provided", () => {
      const parsed = updatePageAnalyticsSchema.safeParse({
        periodStart: "2026-10-01T00:00:00.000Z",
        periodEnd: "2026-09-01T00:00:00.000Z",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("calculateBusinessExposureTier", () => {
    const baseSnapshot: PageAnalyticsSnapshot = {
      id: "a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d",
      organizationId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      monitoredPageId: "33333333-3333-4333-8333-333333333333",
      sourceType: "manual",
      sourceProviderName: "Manual Entry",
      schemaVersion: "1.0.0",
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T23:59:59.000Z",
      sessions: 0,
      uniqueVisitors: 0,
      conversions: 0,
      conversionRate: 0,
      bounceRate: 0,
      avgDurationSeconds: 0,
      currency: "USD",
      customMetrics: {},
      provenance: {
        label: "IMPORTED DATA",
        importedAt: "2026-09-01T12:00:00.000Z",
      },
      isActive: true,
      createdAt: "2026-09-01T12:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };

    it("returns 'unknown' when analytics is null or undefined", () => {
      expect(calculateBusinessExposureTier(null)).toBe("unknown");
      expect(calculateBusinessExposureTier(undefined)).toBe("unknown");
    });

    it("returns 'unknown' when traffic counts are 0", () => {
      expect(calculateBusinessExposureTier(baseSnapshot)).toBe("unknown");
    });

    it("classifies high exposure based on sessions >= 20,000", () => {
      const snap = { ...baseSnapshot, sessions: 20000, conversions: 50 };
      expect(calculateBusinessExposureTier(snap)).toBe("high_exposure");
    });

    it("classifies high exposure based on conversions >= 500", () => {
      const snap = { ...baseSnapshot, sessions: 3000, conversions: 500 };
      expect(calculateBusinessExposureTier(snap)).toBe("high_exposure");
    });

    it("classifies medium exposure based on sessions >= 5,000", () => {
      const snap = { ...baseSnapshot, sessions: 5000, conversions: 40 };
      expect(calculateBusinessExposureTier(snap)).toBe("medium_exposure");
    });

    it("classifies medium exposure based on conversions >= 100", () => {
      const snap = { ...baseSnapshot, sessions: 2000, conversions: 100 };
      expect(calculateBusinessExposureTier(snap)).toBe("medium_exposure");
    });

    it("classifies low exposure when traffic is below 5,000 sessions and 100 conversions", () => {
      const snap = { ...baseSnapshot, sessions: 1500, conversions: 20 };
      expect(calculateBusinessExposureTier(snap)).toBe("low_exposure");
    });
  });

  describe("calculateBusinessImpactPriority", () => {
    it("returns critical_growth for High UX Severity on high_exposure page", () => {
      expect(calculateBusinessImpactPriority("high", "high_exposure")).toBe(
        "critical_growth",
      );
    });

    it("returns high for High UX Severity on medium_exposure", () => {
      expect(calculateBusinessImpactPriority("high", "medium_exposure")).toBe(
        "high",
      );
    });

    it("returns high for Medium UX Severity on high_exposure", () => {
      expect(calculateBusinessImpactPriority("medium", "high_exposure")).toBe(
        "high",
      );
    });

    it("returns medium for Medium UX Severity on medium_exposure", () => {
      expect(calculateBusinessImpactPriority("medium", "medium_exposure")).toBe(
        "medium",
      );
    });

    it("returns medium for High UX Severity on low_exposure", () => {
      expect(calculateBusinessImpactPriority("high", "low_exposure")).toBe(
        "medium",
      );
    });

    it("returns low for Low UX Severity across all exposure tiers", () => {
      expect(calculateBusinessImpactPriority("low", "high_exposure")).toBe(
        "medium",
      );
      expect(calculateBusinessImpactPriority("low", "medium_exposure")).toBe(
        "low",
      );
      expect(calculateBusinessImpactPriority("low", "low_exposure")).toBe(
        "low",
      );
    });

    it("falls back cleanly to UX severity when exposure is unknown (never fabricates)", () => {
      expect(calculateBusinessImpactPriority("high", "unknown")).toBe("high");
      expect(calculateBusinessImpactPriority("medium", "unknown")).toBe(
        "medium",
      );
      expect(calculateBusinessImpactPriority("low", "unknown")).toBe("low");
    });
  });

  describe("isAnalyticsStale", () => {
    it("returns true when periodEnd is older than 60 days", () => {
      const now = new Date("2026-09-04T12:00:00.000Z");
      const seventyDaysAgo = "2026-06-25T00:00:00.000Z";
      expect(isAnalyticsStale(seventyDaysAgo, now)).toBe(true);
    });

    it("returns false when periodEnd is within 60 days", () => {
      const now = new Date("2026-09-04T12:00:00.000Z");
      const thirtyDaysAgo = "2026-08-05T00:00:00.000Z";
      expect(isAnalyticsStale(thirtyDaysAgo, now)).toBe(false);
    });

    it("returns false for invalid date string", () => {
      expect(isAnalyticsStale("invalid-date")).toBe(false);
    });
  });

  describe("BUSINESS_IMPACT_METADATA", () => {
    it("provides metadata for all priority levels", () => {
      expect(BUSINESS_IMPACT_METADATA.critical_growth.label).toBe(
        "Critical Growth Priority",
      );
      expect(BUSINESS_IMPACT_METADATA.high.label).toBe("High Priority");
      expect(BUSINESS_IMPACT_METADATA.medium.label).toBe("Medium Priority");
      expect(BUSINESS_IMPACT_METADATA.low.label).toBe("Low Priority");
    });
  });
});
