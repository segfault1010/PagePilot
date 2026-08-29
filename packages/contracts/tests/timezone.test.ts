import { describe, expect, it } from "vitest";
import { getWeeklyWindow } from "../src/timezone.js";
import {
  AUDIT_SCHEDULE_WEEKLY_EVENT,
  auditScheduleWeeklyEventSchema,
  auditScheduleWeeklyPayloadSchema,
} from "../src/events.js";

describe("Timezone & Weekly Window Calculations", () => {
  it("computes standard ISO week in UTC", () => {
    // 2026-08-29 is a Saturday in Week 35
    const d = new Date("2026-08-29T12:00:00Z");
    expect(getWeeklyWindow(d, "UTC")).toBe("2026-W35");
  });

  it("handles week boundary (Monday start)", () => {
    // 2026-08-24 is Monday in Week 35
    const monday = new Date("2026-08-24T00:00:00Z");
    expect(getWeeklyWindow(monday, "UTC")).toBe("2026-W35");

    // 2026-08-30 is Sunday in Week 35
    const sunday = new Date("2026-08-30T23:59:59Z");
    expect(getWeeklyWindow(sunday, "UTC")).toBe("2026-W35");

    // 2026-08-31 is Monday in Week 36
    const nextMonday = new Date("2026-08-31T00:00:00Z");
    expect(getWeeklyWindow(nextMonday, "UTC")).toBe("2026-W36");
  });

  it("handles different timezones consistently around week boundaries", () => {
    // Sunday 23:30 UTC is already Monday 08:30 in Tokyo (Asia/Tokyo)
    const sundayNightUtc = new Date("2026-08-30T23:30:00Z");

    // In UTC, it's still Week 35
    expect(getWeeklyWindow(sundayNightUtc, "UTC")).toBe("2026-W35");

    // In Tokyo, it's Monday morning, so it's Week 36
    expect(getWeeklyWindow(sundayNightUtc, "Asia/Tokyo")).toBe("2026-W36");

    // In New York, Sunday evening is still Week 35
    expect(getWeeklyWindow(sundayNightUtc, "America/New_York")).toBe("2026-W35");
  });

  it("handles DST transitions without crashing or double counting", () => {
    // Spring DST transition in US (March 8, 2026)
    const dstSpring = new Date("2026-03-08T07:00:00Z");
    expect(getWeeklyWindow(dstSpring, "America/New_York")).toBe("2026-W10");

    // Fall DST transition in US (November 1, 2026)
    const dstFall = new Date("2026-11-01T06:00:00Z");
    expect(getWeeklyWindow(dstFall, "America/New_York")).toBe("2026-W44");
  });

  it("handles year crossover weeks correctly", () => {
    // Dec 31, 2026 (Thursday) -> 2026-W53
    const dec31 = new Date("2026-12-31T12:00:00Z");
    expect(getWeeklyWindow(dec31, "UTC")).toBe("2026-W53");

    // Jan 1, 2027 (Friday) -> belongs to 2026-W53
    const jan1 = new Date("2027-01-01T12:00:00Z");
    expect(getWeeklyWindow(jan1, "UTC")).toBe("2026-W53");

    // Jan 4, 2027 (Monday) -> 2027-W01
    const jan4 = new Date("2027-01-04T12:00:00Z");
    expect(getWeeklyWindow(jan4, "UTC")).toBe("2027-W01");
  });

  it("gracefully falls back to UTC for invalid or empty timezone strings", () => {
    const d = new Date("2026-08-29T12:00:00Z");
    expect(getWeeklyWindow(d, "Invalid/Timezone")).toBe("2026-W35");
    expect(getWeeklyWindow(d, "")).toBe("2026-W35");
  });
});

describe("Schedule Weekly Event Contracts", () => {
  it("validates audit/schedule-weekly event schema", () => {
    const valid = {
      name: AUDIT_SCHEDULE_WEEKLY_EVENT,
      data: {
        triggeredAt: new Date().toISOString(),
      },
    };
    const result = auditScheduleWeeklyEventSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("allows empty data payload for audit/schedule-weekly", () => {
    const valid = {
      name: AUDIT_SCHEDULE_WEEKLY_EVENT,
    };
    const result = auditScheduleWeeklyEventSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("validates audit/schedule-weekly payload with optional org/project filters", () => {
    const valid = {
      triggeredAt: new Date().toISOString(),
      organizationId: "550e8400-e29b-41d4-a716-446655440001",
      projectId: "550e8400-e29b-41d4-a716-446655440002",
    };
    const result = auditScheduleWeeklyPayloadSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});
