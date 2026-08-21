import { describe, expect, it } from "vitest";
import {
  analyzeErrorResponseSchema,
  analyzeRequestSchema,
  reportSchema,
} from "../../src/shared/audit-types";
import { sampleReport } from "../fixtures/sample-report";

describe("shared audit contract", () => {
  it("accepts a well-formed report fixture", () => {
    expect(() => reportSchema.parse(sampleReport)).not.toThrow();
  });

  it("rejects unsupported severities", () => {
    const invalid = structuredClone(sampleReport);
    invalid.categories[0]!.findings[0]!.severity = "critical" as never;
    expect(reportSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects out-of-range overall scores", () => {
    const invalid = { ...sampleReport, overallScore: 150 };
    expect(reportSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects reports missing a category", () => {
    const invalid = { ...sampleReport, categories: sampleReport.categories.slice(1) };
    expect(reportSchema.safeParse(invalid).success).toBe(false);
  });

  it("validates the analyze request shape", () => {
    expect(analyzeRequestSchema.safeParse({ url: "https://example.com" }).success).toBe(true);
    expect(analyzeRequestSchema.safeParse({}).success).toBe(false);
  });

  it("validates the error envelope shape", () => {
    const envelope = {
      error: { code: "NOT_IMPLEMENTED", message: "Analysis is not implemented yet.", retryable: false },
    };
    expect(analyzeErrorResponseSchema.parse(envelope)).toEqual(envelope);
    expect(
      analyzeErrorResponseSchema.safeParse({ error: { code: "X", message: "y" } }).success,
    ).toBe(false);
  });
});
