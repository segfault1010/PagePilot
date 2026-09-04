import { describe, expect, it } from "vitest";
import {
  AUDIT_REPORT_CSV_HEADERS,
  escapeCsvField,
  exportAuditReportToCsv,
  exportWorkItemsToCsv,
  formatUtcDateTime,
  mapCategoryToLabel,
  mapEffortToLabel,
  mapSeverityToLabel,
  mapWorkItemStatusToLabel,
  serializeCsvRow,
  UTF8_BOM,
  WORK_ITEM_CSV_HEADERS,
  type WorkItemExportRow,
} from "../src/csv.js";
import type { Report } from "../src/audit-types.js";

describe("CSV Export Helpers (@pagepilot/contracts/csv)", () => {
  describe("escapeCsvField & Formula Injection Protection", () => {
    it("handles null and undefined as empty strings", () => {
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });

    it("handles numbers and booleans safely", () => {
      expect(escapeCsvField(42)).toBe("42");
      expect(escapeCsvField(0)).toBe("0");
      expect(escapeCsvField(-10)).toBe("-10");
      expect(escapeCsvField(true)).toBe("true");
      expect(escapeCsvField(false)).toBe("false");
    });

    it("leaves regular strings unquoted when no special characters are present", () => {
      expect(escapeCsvField("Simple Title")).toBe("Simple Title");
      expect(escapeCsvField("Clarity")).toBe("Clarity");
    });

    it("quotes fields containing commas per RFC 4180", () => {
      expect(escapeCsvField("Hello, world")).toBe('"Hello, world"');
      expect(escapeCsvField("Item 1, Item 2, Item 3")).toBe('"Item 1, Item 2, Item 3"');
    });

    it("escapes quotes within strings as double double-quotes per RFC 4180", () => {
      expect(escapeCsvField('Click "Submit" button')).toBe('"Click ""Submit"" button"');
      expect(escapeCsvField('"Quoted"')).toBe('"""Quoted"""');
    });

    it("quotes multiline text and normalizes carriage returns per RFC 4180", () => {
      expect(escapeCsvField("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvField("Line 1\r\nLine 2")).toBe('"Line 1\nLine 2"');
    });

    it("neutralizes spreadsheet formula injection characters (=, +, -, @, \\t, \\r, %)", () => {
      // Equals formula
      const equalsFormula = escapeCsvField("=SUM(A1:A10)");
      expect(equalsFormula).toBe("\"'=SUM(A1:A10)\"");

      // Plus formula
      const plusFormula = escapeCsvField("+1+1");
      expect(plusFormula).toBe("\"'+1+1\"");

      // Minus formula
      const minusFormula = escapeCsvField("-cmd|' /C calc'!A0");
      expect(minusFormula).toBe("\"'-cmd|' /C calc'!A0\"");

      // At sign function
      const atFormula = escapeCsvField("@SUM(B1:B5)");
      expect(atFormula).toBe("\"'@SUM(B1:B5)\"");

      // Tab character trigger
      const tabTrigger = escapeCsvField("\tTabPrefixed");
      expect(tabTrigger).toBe("\"'\tTabPrefixed\"");

      // Percent trigger
      const percentTrigger = escapeCsvField("%Total");
      expect(percentTrigger).toBe("\"'%Total\"");
    });

    it("handles arrays by joining with semicolon and space", () => {
      expect(escapeCsvField(["mobile", "ux", "cta"])).toBe("mobile; ux; cta");
    });
  });

  describe("serializeCsvRow", () => {
    it("joins cells with commas and appends CRLF (\\r\\n)", () => {
      const row = serializeCsvRow(["Item 1", "Item, 2", 100]);
      expect(row).toBe('Item 1,"Item, 2",100\r\n');
    });
  });

  describe("Mapping Helpers", () => {
    it("maps severity to human labels", () => {
      expect(mapSeverityToLabel("high")).toBe("High");
      expect(mapSeverityToLabel("medium")).toBe("Medium");
      expect(mapSeverityToLabel("low")).toBe("Low");
      expect(mapSeverityToLabel(null)).toBe("N/A");
      expect(mapSeverityToLabel(undefined)).toBe("N/A");
    });

    it("maps categories to canonical labels", () => {
      expect(mapCategoryToLabel("clarity")).toBe("Clarity");
      expect(mapCategoryToLabel("visualHierarchy")).toBe("Visual Hierarchy");
      expect(mapCategoryToLabel("ctaEffectiveness")).toBe("CTA Effectiveness");
      expect(mapCategoryToLabel("copy")).toBe("Copy");
      expect(mapCategoryToLabel("accessibility")).toBe("Accessibility");
      expect(mapCategoryToLabel("mobileUx")).toBe("Mobile UX");
      expect(mapCategoryToLabel("trustCredibility")).toBe("Trust & Credibility");
      expect(mapCategoryToLabel(null)).toBe("N/A");
    });

    it("maps work item statuses to labels", () => {
      expect(mapWorkItemStatusToLabel("open")).toBe("Open");
      expect(mapWorkItemStatusToLabel("in_progress")).toBe("In Progress");
      expect(mapWorkItemStatusToLabel("resolved")).toBe("Resolved");
      expect(mapWorkItemStatusToLabel("dismissed")).toBe("Dismissed");
    });

    it("maps effort based on recommendationType, sourceType, and severity", () => {
      expect(mapEffortToLabel({ recommendationType: "quick_win" })).toBe("Low (Quick Win)");
      expect(mapEffortToLabel({ recommendationType: "detailed" })).toBe("Medium (Detailed Fix)");
      expect(mapEffortToLabel({ sourceType: "recommendation" })).toBe("Medium (Detailed Fix)");
      expect(mapEffortToLabel({ sourceType: "finding", severity: "high" })).toBe("High");
      expect(mapEffortToLabel({ sourceType: "finding", severity: "medium" })).toBe("Medium");
      expect(mapEffortToLabel({ sourceType: "finding", severity: "low" })).toBe("Low");
      expect(mapEffortToLabel({ sourceType: "finding", severity: null })).toBe("Standard");
      expect(mapEffortToLabel()).toBe("N/A");
    });

    it("formats UTC ISO datetimes correctly", () => {
      expect(formatUtcDateTime("2026-09-04T12:30:00Z")).toBe("2026-09-04T12:30:00.000Z");
      expect(formatUtcDateTime(new Date("2026-09-04T12:30:00Z"))).toBe("2026-09-04T12:30:00.000Z");
      expect(formatUtcDateTime(null)).toBe("");
      expect(formatUtcDateTime(undefined)).toBe("");
    });
  });

  describe("Work Items CSV Export", () => {
    it("exports work items with UTF-8 BOM, 18 column headers, and valid rows", () => {
      const mockItems: WorkItemExportRow[] = [
        {
          id: "11111111-1111-1111-1111-111111111111",
          organizationId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          monitoredPageId: "44444444-4444-4444-4444-444444444444",
          sourceType: "finding",
          findingId: "55555555-5555-5555-5555-555555555555",
          title: "Low contrast on CTA button",
          description: "Button text contrast ratio is 2.1:1, failing WCAG AA.",
          category: "accessibility",
          severity: "high",
          status: "open",
          assigneeId: "66666666-6666-6666-6666-666666666666",
          notes: "Need design approval on new color.",
          tags: ["accessibility", "q3-priority"],
          createdAt: "2026-09-01T10:00:00Z",
          updatedAt: "2026-09-02T11:00:00Z",
          pageUrl: "https://example.com/pricing",
          assigneeEmail: "dev@example.com",
        },
        {
          id: "77777777-7777-7777-7777-777777777777",
          organizationId: "22222222-2222-2222-2222-222222222222",
          projectId: "33333333-3333-3333-3333-333333333333",
          monitoredPageId: "44444444-4444-4444-4444-444444444444",
          sourceType: "recommendation",
          recommendationId: "88888888-8888-8888-8888-888888888888",
          title: "=1+1 Formula Injection Attempt",
          description: "Verify that Excel does not execute this.",
          category: "ctaEffectiveness",
          severity: null,
          status: "resolved",
          resolutionRationale: "Fixed by adjusting text.",
          resolvedAt: "2026-09-03T15:00:00Z",
          tags: [],
          createdAt: "2026-09-01T10:00:00Z",
          updatedAt: "2026-09-03T15:00:00Z",
          pageUrl: "https://example.com/landing",
        },
      ];

      const csv = exportWorkItemsToCsv(mockItems);

      // Verify UTF-8 BOM
      expect(csv.startsWith(UTF8_BOM)).toBe(true);

      // Verify Headers
      expect(WORK_ITEM_CSV_HEADERS.length).toBe(18);
      const lines = csv.slice(UTF8_BOM.length).trimEnd().split("\r\n");
      expect(lines.length).toBe(3); // 1 header + 2 items

      const headerLine = lines[0];
      expect(headerLine).toBe(WORK_ITEM_CSV_HEADERS.join(","));

      // Verify Row 1 content
      expect(lines[1]).toContain("Low contrast on CTA button");
      expect(lines[1]).toContain("Accessibility");
      expect(lines[1]).toContain("High");
      expect(lines[1]).toContain("Finding");
      expect(lines[1]).toContain("https://example.com/pricing");
      expect(lines[1]).toContain("dev@example.com");
      expect(lines[1]).toContain("accessibility; q3-priority");

      // Verify Row 2 formula sanitization
      expect(lines[2]).toContain("\"'=1+1 Formula Injection Attempt\"");
      expect(lines[2]).toContain("Resolved");
      expect(lines[2]).toContain("Unassigned");
    });

    it("returns only header line when items array is empty", () => {
      const csv = exportWorkItemsToCsv([]);
      expect(csv.startsWith(UTF8_BOM)).toBe(true);
      const lines = csv.slice(UTF8_BOM.length).trimEnd().split("\r\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe(WORK_ITEM_CSV_HEADERS.join(","));
    });
  });

  describe("Audit Report CSV Export", () => {
    const mockReport: Report = {
      source: {
        requestedUrl: "https://example.com",
        finalUrl: "https://example.com/",
        analyzedAt: "2026-09-04T08:00:00Z",
        title: "Example Landing",
      },
      overallScore: 82,
      scoreConfidence: "blended",
      summary: "Good overall UX with a few CTA improvements needed.",
      categories: [
        {
          category: "clarity",
          score: 85,
          confidence: "blended",
          explanation: "Clear headline and value proposition.",
          severity: "low",
          findings: [
            {
              title: "Value prop is strong",
              severity: "low",
              evidence: "The main headline communicates the product purpose.",
              basis: "observed",
              signalIds: ["heading-h1"],
              recommendation: "Maintain current phrasing.",
            },
          ],
        },
        {
          category: "visualHierarchy",
          score: 80,
          confidence: "blended",
          explanation: "Good spacing.",
          severity: "low",
          findings: [],
        },
        {
          category: "ctaEffectiveness",
          score: 70,
          confidence: "blended",
          explanation: "Secondary CTA competes with primary.",
          severity: "medium",
          findings: [
            {
              title: "Secondary CTA creates distraction",
              severity: "medium",
              evidence: "Both buttons have identical high-contrast styling.",
              basis: "observed",
              signalIds: ["cta-contrast"],
              recommendation: "De-emphasize secondary button styling.",
            },
          ],
        },
        {
          category: "copy",
          score: 88,
          confidence: "ai-led",
          explanation: "Engaging copy.",
          severity: "low",
          findings: [],
        },
        {
          category: "accessibility",
          score: 75,
          confidence: "blended",
          explanation: "Alt text present, small font in footer.",
          severity: "medium",
          findings: [],
        },
        {
          category: "mobileUx",
          score: 85,
          confidence: "blended",
          explanation: "Responsive viewport configured.",
          severity: "low",
          findings: [],
        },
        {
          category: "trustCredibility",
          score: 90,
          confidence: "blended",
          explanation: "Social proof present.",
          severity: "low",
          findings: [],
        },
      ],
      topProblems: [
        {
          title: "Secondary CTA creates distraction",
          severity: "medium",
          evidence: "Both buttons have identical high-contrast styling.",
          basis: "observed",
          signalIds: ["cta-contrast"],
          recommendation: "De-emphasize secondary button styling.",
          category: "ctaEffectiveness",
        },
        {
          title: "Footer links are small",
          severity: "low",
          evidence: "Footer text size is below 12px.",
          basis: "inferred",
          signalIds: [],
          recommendation: "Increase footer font size.",
          category: "accessibility",
        },
        {
          title: "Heading hierarchy skips h2",
          severity: "low",
          evidence: "H1 followed directly by H3.",
          basis: "observed",
          signalIds: ["heading-order"],
          recommendation: "Include an H2 section heading.",
          category: "visualHierarchy",
        },
      ],
      quickWins: [
        {
          title: "Add ghost styling to secondary button",
          detail: "Reduces visual competition with primary CTA.",
          category: "ctaEffectiveness",
        },
        {
          title: "Increase footer font to 14px",
          detail: "Improves legibility on high-density displays.",
          category: "accessibility",
        },
        {
          title: "Add missing H2 header tag",
          detail: "Improves semantic hierarchy.",
          category: "visualHierarchy",
        },
      ],
      detailedRecommendations: [
        {
          title: "Establish systematic button hierarchy",
          detail: "Document primary, secondary, and tertiary button guidelines in design system.",
          category: "visualHierarchy",
        },
      ],
      observedSignals: [],
    };

    it("exports audit report with UTF-8 BOM, 13 column headers, and deduplicated findings", () => {
      const csv = exportAuditReportToCsv(mockReport, {
        targetUrl: "https://example.com",
      });

      // Verify UTF-8 BOM
      expect(csv.startsWith(UTF8_BOM)).toBe(true);

      // Verify Headers
      expect(AUDIT_REPORT_CSV_HEADERS.length).toBe(13);
      const lines = csv.slice(UTF8_BOM.length).trimEnd().split("\r\n");

      expect(lines[0]).toBe(AUDIT_REPORT_CSV_HEADERS.join(","));

      // Verify rows contain Top Problems, Category Findings, Quick Wins, and Detailed Recommendations
      expect(csv).toContain("Top Problem");
      expect(csv).toContain("Category Finding");
      expect(csv).toContain("Quick Win");
      expect(csv).toContain("Detailed Recommendation");

      // Verify values
      expect(csv).toContain("Secondary CTA creates distraction");
      expect(csv).toContain("CTA Effectiveness");
      expect(csv).toContain("Medium");
      expect(csv).toContain("Low (Quick Win)");
      expect(csv).toContain("Medium (Detailed Fix)");
      expect(csv).toContain("82"); // Overall score
      expect(csv).toContain("70"); // CTA category score
    });
  });
});
