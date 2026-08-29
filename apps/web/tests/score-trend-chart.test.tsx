// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditHistoryItem } from "@pagepilot/contracts";
import { ScoreTrendChart } from "../src/features/workspace/components/score-trend-chart.js";

describe("ScoreTrendChart Component", () => {
  afterEach(() => {
    cleanup();
  });
  const baseRun: AuditHistoryItem = {
    id: "run-1",
    monitoredPageId: "page-1",
    projectId: "proj-1",
    organizationId: "org-1",
    invocationType: "manual",
    status: "completed",
    targetUrl: "https://example.com",
    finalUrl: "https://example.com/",
    overallScore: 70,
    scoreConfidence: "blended",
    categoryScores: {
      clarity: 65,
      visualHierarchy: 70,
      ctaEffectiveness: 75,
      copy: 68,
      accessibility: 80,
      mobileUx: 72,
      trustCredibility: 60,
    },
    summary: "Initial baseline audit.",
    auditReportId: "rep-1",
    startedAt: "2026-08-20T10:00:00Z",
    completedAt: "2026-08-20T10:00:05Z",
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    retryable: null,
    modelVersion: "gemini-3.6-flash",
    checkVersion: "1.0.0",
    scoringVersion: "1.0.0",
    createdAt: "2026-08-20T10:00:00Z",
  };

  it("renders empty state placeholder when history is empty or contains no completed scores", () => {
    render(<ScoreTrendChart history={[]} />);
    expect(screen.getByText("No Score History Available")).toBeTruthy();
    expect(
      screen.getByText(/Run your first landing page audit to establish a baseline score/),
    ).toBeTruthy();
  });

  it("renders baseline established state for a single audit run", () => {
    render(<ScoreTrendChart history={[baseRun]} />);

    expect(screen.getByRole("region", { name: /UX Score Trend/i })).toBeTruthy();
    expect(screen.getByText("Baseline Established")).toBeTruthy();
    expect(screen.getByText("Baseline: 70 pts")).toBeTruthy();
    expect(screen.getByText(/Baseline score established/)).toBeTruthy();

    // Verify all 7 categories render
    expect(screen.getByText("Clarity & Value")).toBeTruthy();
    expect(screen.getByText("Visual Hierarchy")).toBeTruthy();
    expect(screen.getByText("Call to Action")).toBeTruthy();
    expect(screen.getByText("Copywriting")).toBeTruthy();
    expect(screen.getByText("Accessibility")).toBeTruthy();
    expect(screen.getByText("Mobile UX")).toBeTruthy();
    expect(screen.getByText("Trust & Proof")).toBeTruthy();
  });

  it("renders multi-audit score trend line with deltas and category trajectory changes", () => {
    const history: AuditHistoryItem[] = [
      // Latest audit (index 0 in API desc order)
      {
        ...baseRun,
        id: "run-3",
        overallScore: 84,
        categoryScores: {
          clarity: 80, // +15 vs run-2
          visualHierarchy: 85,
          ctaEffectiveness: 88,
          copy: 78,
          accessibility: 90,
          mobileUx: 86,
          trustCredibility: 81,
        },
        summary: "Latest optimized page version.",
        createdAt: "2026-08-27T10:00:00Z",
      },
      // Intermediate audit
      {
        ...baseRun,
        id: "run-2",
        invocationType: "scheduled",
        overallScore: 78,
        categoryScores: {
          clarity: 65,
          visualHierarchy: 75,
          ctaEffectiveness: 80,
          copy: 72,
          accessibility: 85,
          mobileUx: 80,
          trustCredibility: 69,
        },
        createdAt: "2026-08-24T10:00:00Z",
      },
      // Baseline audit (oldest)
      baseRun,
    ];

    const onSelectRun = vi.fn();
    render(<ScoreTrendChart history={history} onSelectRun={onSelectRun} />);

    // Total delta: 84 - 70 = +14 pts
    expect(
      screen.getByText(/Overall UX score improved by \+14 pts since baseline/),
    ).toBeTruthy();

    // Recent delta: 84 - 78 = +6 pts
    expect(screen.getByText("+6 pts")).toBeTruthy();
    expect(screen.getByText("vs previous")).toBeTruthy();

    // SVG elements
    const svg = screen.getByRole("img", { name: /Score trend line chart/i });
    expect(svg).toBeTruthy();

    // Category deltas
    expect(screen.getByText("+15")).toBeTruthy(); // Clarity improved from 65 to 80

    // Hover interaction on data point
    const dots = screen.getAllByRole("button", { name: /Audit on/i });
    expect(dots).toHaveLength(3);

    fireEvent.mouseEnter(dots[2]!); // Hover latest dot (run-3)
    expect(screen.getByText("Latest optimized page version.")).toBeTruthy();

    // Click data point
    fireEvent.click(dots[2]!);
    expect(onSelectRun).toHaveBeenCalledWith("run-3");
  });

  it("filters out failed scans so the score trajectory reflects successful audits only", () => {
    const history: AuditHistoryItem[] = [
      {
        ...baseRun,
        id: "run-failed",
        status: "failed",
        overallScore: null,
        errorCode: "TIMEOUT",
        errorMessage: "Request timed out",
        createdAt: "2026-08-28T10:00:00Z",
      },
      baseRun,
    ];

    render(<ScoreTrendChart history={history} />);

    // Only 1 successful audit is tracked in the trend line
    expect(screen.getByText("(1 audit tracked)")).toBeTruthy();
    expect(screen.getByText("Baseline Established")).toBeTruthy();
  });
});
