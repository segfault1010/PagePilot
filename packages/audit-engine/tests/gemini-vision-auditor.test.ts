import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createGeminiVisionAuditor,
  MockVisionAuditor,
  type VisualAnalysisInput,
} from "../src/ai/gemini-vision-auditor.js";
import {
  geminiVisionResponseJsonSchema,
  parseGeminiVisionOutput,
} from "../src/schemas/vision-audit-schema.js";
import { AiError } from "../src/ai/gemini-auditor.js";

function sampleWireReview() {
  return {
    executiveSummary:
      "The page provides a clear desktop visual structure with high headline readability, though mobile viewport suffers from cramped action links.",
    dimensions: {
      visual_hierarchy: {
        rating: "strong",
        explanation: "Clear focal hierarchy directing attention to the primary headline.",
      },
      cta_prominence: {
        rating: "adequate",
        explanation: "Primary CTA is visible above the fold on desktop viewports.",
        isAboveFoldCtaVisible: true,
      },
      visual_clutter: {
        rating: "strong",
        explanation: "Generous whitespace with minimal competing background visual noise.",
      },
      contrast_legibility: {
        rating: "adequate",
        explanation: "High apparent text-to-background contrast on hero typography.",
      },
      typography_hierarchy: {
        rating: "strong",
        explanation: "Substantial heading scale ratio establishes clear typographic structure.",
      },
      spacing_layout: {
        rating: "strong",
        explanation: "Consistent layout grid with balanced vertical padding.",
      },
      mobile_adaptation: {
        rating: "needs_improvement",
        explanation: "Action buttons crowd adjacent links on 375px mobile breakpoint.",
        isAboveFoldCtaVisible: false,
      },
    },
    findings: [
      {
        dimension: "cta_prominence",
        targetViewport: "desktop",
        visualZone: "above_the_fold",
        title: "Secondary Actions Compete with Main CTA",
        severity: "medium",
        observation:
          "Hero section features two ghost buttons of identical size adjacent to primary CTA.",
        impact:
          "Splits user attention during the first critical scanning seconds.",
        recommendation:
          "Style secondary options as text links to maintain single primary focal point.",
        confidence: "high",
      },
    ],
  };
}

describe("GeminiVisionAuditor & Vision Schemas", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("geminiVisionResponseJsonSchema strips length and bounds keywords for wire compatibility", () => {
    const jsonSchema = geminiVisionResponseJsonSchema();
    expect(jsonSchema).toBeTypeOf("object");
    expect(jsonSchema).not.toHaveProperty("$schema");
    expect(jsonSchema).not.toHaveProperty("minLength");
    expect(jsonSchema).not.toHaveProperty("maxLength");
    expect(jsonSchema).not.toHaveProperty("minItems");
    expect(jsonSchema).not.toHaveProperty("maxItems");
  });

  it("parseGeminiVisionOutput transforms wire output into domain model with basis='visual_inference'", () => {
    const wire = sampleWireReview();
    const outcome = parseGeminiVisionOutput(wire, {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      auditReportId: "550e8400-e29b-41d4-a716-446655440001",
      modelIdentifier: "gemini-3.6-flash",
      viewportsAnalyzed: ["desktop", "mobile"],
      screenshotIds: ["550e8400-e29b-41d4-a716-446655440002"],
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.review.schemaVersion).toBe("1.0.0");
      expect(outcome.review.promptVersion).toBe("1.0.0");
      expect(outcome.review.findings).toHaveLength(1);
      expect(outcome.review.findings[0]?.basis).toBe("visual_inference");
      expect(outcome.review.findings[0]?.id).toBe("vis-1");
      expect(outcome.review.viewportsAnalyzed).toEqual(["desktop", "mobile"]);
    }
  });

  it("rejects wire output with missing dimensions", () => {
    const incomplete = sampleWireReview();
    // @ts-expect-error intentionally incomplete
    delete incomplete.dimensions.mobile_adaptation;

    const outcome = parseGeminiVisionOutput(incomplete, {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      modelIdentifier: "gemini-3.6-flash",
      viewportsAnalyzed: ["desktop"],
      screenshotIds: [],
    });

    expect(outcome.ok).toBe(false);
  });

  it("fails fast when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;
    const auditor = createGeminiVisionAuditor({ apiKey: "" });

    const input: VisualAnalysisInput = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      targetUrl: "https://example.com",
      desktopScreenshot: {
        buffer: Buffer.from("fake-webp"),
        mimeType: "image/webp",
        width: 1280,
        height: 800,
      },
    };

    await expect(auditor.runVisualReview(input)).rejects.toThrow(AiError);
    await expect(auditor.runVisualReview(input)).rejects.toMatchObject({
      kind: "configuration",
    });
  });

  it("fails when no screenshots are supplied", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const auditor = createGeminiVisionAuditor();

    const input: VisualAnalysisInput = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      targetUrl: "https://example.com",
    };

    await expect(auditor.runVisualReview(input)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("constructs multimodal request with base64 inlineData and returns validated review", async () => {
    const desktopBuffer = Buffer.from("fake-desktop-webp");
    const mobileBuffer = Buffer.from("fake-mobile-webp");

    let capturedRequestBody: any = null;

    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedRequestBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [{ text: JSON.stringify(sampleWireReview()) }],
              },
            },
          ],
        }),
      };
    });

    const auditor = createGeminiVisionAuditor({
      apiKey: "test-api-key",
      model: "gemini-3.6-flash",
      fetchFn: mockFetch as any,
    });

    const input: VisualAnalysisInput = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      auditReportId: "550e8400-e29b-41d4-a716-446655440001",
      targetUrl: "https://example.com",
      pageTitle: "Example Domain",
      desktopScreenshot: {
        buffer: desktopBuffer,
        mimeType: "image/webp",
        width: 1280,
        height: 800,
        screenshotId: "550e8400-e29b-41d4-a716-446655440002",
      },
      mobileScreenshot: {
        buffer: mobileBuffer,
        mimeType: "image/webp",
        width: 375,
        height: 812,
        screenshotId: "550e8400-e29b-41d4-a716-446655440003",
      },
    };

    const review = await auditor.runVisualReview(input);

    expect(review.auditRunId).toBe(input.auditRunId);
    expect(review.schemaVersion).toBe("1.0.0");
    expect(review.viewportsAnalyzed).toEqual(["desktop", "mobile"]);
    expect(review.screenshotIds).toEqual([
      "550e8400-e29b-41d4-a716-446655440002",
      "550e8400-e29b-41d4-a716-446655440003",
    ]);
    expect(review.findings[0]?.basis).toBe("visual_inference");

    // Verify multimodal body structure
    const contents = capturedRequestBody.contents;
    expect(contents).toHaveLength(1);
    const parts = contents[0].parts;

    // Check inlineData parts for desktop and mobile
    const desktopPart = parts.find(
      (p: any) =>
        p.inlineData && p.inlineData.data === desktopBuffer.toString("base64")
    );
    expect(desktopPart).toBeDefined();
    expect(desktopPart.inlineData.mimeType).toBe("image/webp");

    const mobilePart = parts.find(
      (p: any) =>
        p.inlineData && p.inlineData.data === mobileBuffer.toString("base64")
    );
    expect(mobilePart).toBeDefined();
    expect(mobilePart.inlineData.mimeType).toBe("image/webp");
  });

  it("maps HTTP error responses properly to AiError", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const auditor = createGeminiVisionAuditor({
      apiKey: "test-api-key",
      fetchFn: mockFetch as any,
    });

    const input: VisualAnalysisInput = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      targetUrl: "https://example.com",
      desktopScreenshot: {
        buffer: Buffer.from("test"),
        mimeType: "image/webp",
        width: 1280,
        height: 800,
      },
    };

    await expect(auditor.runVisualReview(input)).rejects.toMatchObject({
      kind: "configuration",
    });
  });

  it("handles model non-JSON or malformed output gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [{ text: "This is not valid JSON" }],
            },
          },
        ],
      }),
    });

    const auditor = createGeminiVisionAuditor({
      apiKey: "test-api-key",
      fetchFn: mockFetch as any,
    });

    const input: VisualAnalysisInput = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      targetUrl: "https://example.com",
      desktopScreenshot: {
        buffer: Buffer.from("test"),
        mimeType: "image/webp",
        width: 1280,
        height: 800,
      },
    };

    await expect(auditor.runVisualReview(input)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("MockVisionAuditor returns deterministic contract-valid review", async () => {
    const mockAuditor = new MockVisionAuditor();
    const input: VisualAnalysisInput = {
      auditRunId: "550e8400-e29b-41d4-a716-446655440000",
      targetUrl: "https://example.com",
      desktopScreenshot: {
        buffer: Buffer.from("test"),
        mimeType: "image/webp",
        width: 1280,
        height: 800,
        screenshotId: "550e8400-e29b-41d4-a716-446655440001",
      },
    };

    const review = await mockAuditor.runVisualReview(input);
    expect(review.auditRunId).toBe(input.auditRunId);
    expect(review.schemaVersion).toBe("1.0.0");
    expect(review.dimensions.visual_hierarchy.rating).toBe("strong");
    expect(review.findings[0]?.basis).toBe("visual_inference");
  });
});
