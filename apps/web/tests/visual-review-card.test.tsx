// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VisualAnalysisReview } from "@pagepilot/contracts";
import { VisualReviewCard } from "../src/features/audits/components/visual-review-card";
import * as auditsApi from "../src/features/audits/api.js";

vi.mock("../src/features/audits/api.js");

describe("VisualReviewCard Component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sampleReview: VisualAnalysisReview = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    auditRunId: "550e8400-e29b-41d4-a716-446655440002",
    monitoredPageId: "550e8400-e29b-41d4-a716-446655440003",
    projectId: "550e8400-e29b-41d4-a716-446655440004",
    organizationId: "550e8400-e29b-41d4-a716-446655440005",
    provenance: "VISION-ASSISTED AI REVIEW",
    modelIdentifier: "gemini-1.5-pro",
    promptVersion: "1.0.0",
    schemaVersion: "1.0.0",
    status: "completed",
    executiveSummary:
      "Clear visual hierarchy with strong desktop presence, though mobile CTA loses contrast against hero background.",
    viewportsAnalyzed: ["desktop", "mobile"],
    screenshotIds: [],
    dimensions: {
      visual_hierarchy: {
        rating: "strong",
        explanation: "Clear headline hierarchy and visual flow toward the primary action.",
      },
      cta_prominence: {
        rating: "adequate",
        explanation: "Primary button is visible above fold on desktop but lacks sufficient color pop on mobile.",
        isAboveFoldCtaVisible: true,
      },
      visual_clutter: {
        rating: "strong",
        explanation: "Minimal decorative noise; focus remains on the value proposition.",
      },
      contrast_legibility: {
        rating: "needs_improvement",
        explanation: "Apparent contrast between secondary text and background may be difficult to read in bright environments.",
      },
      typography_hierarchy: {
        rating: "strong",
        explanation: "Good scale ratio between h1, h2, and body copy.",
      },
      spacing_layout: {
        rating: "adequate",
        explanation: "Even margins on desktop, slightly compressed on mobile.",
      },
      mobile_adaptation: {
        rating: "needs_improvement",
        explanation: "Hero image pushes main benefits list well below the 812px viewport line.",
      },
    },
    findings: [
      {
        id: "vis-1",
        dimension: "cta_prominence",
        severity: "medium",
        targetViewport: "mobile",
        visualZone: "hero_section",
        title: "Mobile Primary CTA Lacks Contrast Against Hero Gradient",
        observation: "The 'Get Started' button uses an orange-to-pink gradient against a warm background.",
        impact: "Visitors on mobile devices may overlook the primary action, dampening conversion rates.",
        recommendation: "Increase luminance contrast with a solid dark or high-contrast border around the button.",
        confidence: "medium",
        basis: "visual_inference",
      },
      {
        id: "vis-2",
        dimension: "visual_clutter",
        severity: "low",
        targetViewport: "desktop",
        visualZone: "header_navigation",
        title: "Header Navigation Links Compete for Visual Attention",
        observation: "Six navigation links of identical font weight crowd the upper right banner.",
        impact: "Minor cognitive friction before eye lands on hero headline.",
        recommendation: "Consolidate secondary links into a menu drawer or de-emphasize styling.",
        confidence: "high",
        basis: "visual_inference",
      },
    ],
    createdAt: "2026-09-07T12:00:05.000Z",
  };

  it("renders card with VISION-ASSISTED AI REVIEW provenance badge", () => {
    render(<VisualReviewCard visualAnalysis={sampleReview} />);

    expect(screen.getByText("Visual Hierarchy Review")).toBeDefined();
    const badge = screen.getByTestId("visual-provenance-badge");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("VISION-ASSISTED AI REVIEW");
    expect(screen.getByText(/Model: gemini-1.5-pro • v1.0.0/i)).toBeDefined();
  });

  it("renders executive summary", () => {
    render(<VisualReviewCard visualAnalysis={sampleReview} />);

    const summary = screen.getByTestId("visual-executive-summary");
    expect(summary).toBeDefined();
    expect(summary.textContent).toContain(
      "Clear visual hierarchy with strong desktop presence"
    );
  });

  it("renders dimension assessments with ratings and CTA status", () => {
    render(<VisualReviewCard visualAnalysis={sampleReview} />);

    expect(screen.getByTestId("visual-dimensions-grid")).toBeDefined();

    // Check Visual Hierarchy dimension
    const hierCard = screen.getByTestId("dimension-visual_hierarchy");
    expect(hierCard).toBeDefined();
    expect(hierCard.textContent).toContain("Visual Hierarchy");
    expect(hierCard.textContent).toContain("strong");

    // Check CTA Prominence dimension and CTA above fold badge
    const ctaCard = screen.getByTestId("dimension-cta_prominence");
    expect(ctaCard).toBeDefined();
    expect(ctaCard.textContent).toContain("CTA Prominence");
    expect(ctaCard.textContent).toContain("adequate");
    expect(ctaCard.textContent).toContain("CTA visible above fold");

    // Check Contrast & Legibility dimension
    const contrastCard = screen.getByTestId("dimension-contrast_legibility");
    expect(contrastCard).toBeDefined();
    expect(contrastCard.textContent).toContain("Contrast & Legibility");
    expect(contrastCard.textContent).toContain("needs improvement");
  });

  it("renders visual findings with 3-tier breakdown and visual_inference basis", () => {
    render(<VisualReviewCard visualAnalysis={sampleReview} />);

    expect(screen.getByText(/Basis: visual_inference/i)).toBeDefined();
    expect(screen.getByTestId("visual-findings-list")).toBeDefined();

    const finding1 = screen.getByTestId("visual-finding-vis-1");
    expect(finding1).toBeDefined();
    expect(finding1.textContent).toContain("Mobile Primary CTA Lacks Contrast Against Hero Gradient");
    expect(finding1.textContent).toContain("medium Severity");
    expect(finding1.textContent).toContain("Confidence: medium");
    expect(finding1.textContent).toContain("Zone: hero section");

    // 3-tier sections
    expect(finding1.textContent).toContain("Visual Observation");
    expect(finding1.textContent).toContain("The 'Get Started' button uses an orange-to-pink gradient");
    expect(finding1.textContent).toContain("Conversion Impact");
    expect(finding1.textContent).toContain("Visitors on mobile devices may overlook the primary action");
    expect(finding1.textContent).toContain("Recommended Adjustment");
    expect(finding1.textContent).toContain("Increase luminance contrast with a solid dark or high-contrast border");
  });

  it("triggers onSelectViewport callback when viewport button is clicked", () => {
    const handleSelectViewport = vi.fn();
    render(
      <VisualReviewCard
        visualAnalysis={sampleReview}
        onSelectViewport={handleSelectViewport}
      />
    );

    const mobileViewportBtn = screen.getByRole("button", {
      name: /viewport: mobile/i,
    });
    fireEvent.click(mobileViewportBtn);

    expect(handleSelectViewport).toHaveBeenCalledWith("mobile");
  });

  it("renders loading state when isLoading is true", () => {
    render(<VisualReviewCard isLoading={true} />);

    expect(screen.getByTestId("visual-review-loading")).toBeDefined();
    expect(screen.getByText(/analyzing browser visual hierarchy/i)).toBeDefined();
  });

  it("renders empty state when visualAnalysis is null", () => {
    render(<VisualReviewCard visualAnalysis={null} />);

    expect(screen.getByTestId("visual-review-empty")).toBeDefined();
    expect(
      screen.getByText(/no visual hierarchy review recorded for this audit/i)
    ).toBeDefined();
  });

  it("renders error state when error is passed", () => {
    render(
      <VisualReviewCard error="Gemini API rate limit exceeded" />
    );

    expect(screen.getByTestId("visual-review-error")).toBeDefined();
    expect(
      screen.getByText(/unable to load visual hierarchy review: Gemini API rate limit exceeded/i)
    ).toBeDefined();
  });

  it("auto-fetches visual review via fetchVisualAnalysis when IDs are provided", async () => {
    vi.mocked(auditsApi.fetchVisualAnalysis).mockResolvedValueOnce({
      visualAnalysis: sampleReview,
    });

    render(
      <VisualReviewCard
        projectId="550e8400-e29b-41d4-a716-446655440004"
        pageId="550e8400-e29b-41d4-a716-446655440003"
        auditRunId="550e8400-e29b-41d4-a716-446655440002"
      />
    );

    expect(screen.getByTestId("visual-review-loading")).toBeDefined();

    await waitFor(() => {
      expect(auditsApi.fetchVisualAnalysis).toHaveBeenCalledWith(
        "550e8400-e29b-41d4-a716-446655440004",
        "550e8400-e29b-41d4-a716-446655440003",
        "550e8400-e29b-41d4-a716-446655440002"
      );
      expect(screen.getByTestId("visual-executive-summary")).toBeDefined();
    });
  });
});
