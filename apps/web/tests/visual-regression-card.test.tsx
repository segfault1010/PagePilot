// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VisualDiffResponse } from "@pagepilot/contracts";
import {
  TOTAL_GRID_BLOCKS,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_DIFF_METHOD_LABEL,
  VISUAL_REGRESSION_SCHEMA_VERSION,
} from "@pagepilot/contracts";
import { VisualRegressionCard } from "../src/features/audits/components/visual-regression-card";
import * as auditsApi from "../src/features/audits/api.js";

vi.mock("../src/features/audits/api.js");

describe("VisualRegressionCard Component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sampleDiffResponse: VisualDiffResponse = {
    diffs: [
      {
        id: "diff-1",
        organizationId: "org-1",
        projectId: "proj-1",
        monitoredPageId: "page-1",
        currentAuditRunId: "run-curr",
        baselineAuditRunId: "run-base",
        currentScreenshotId: "scr-curr-desk",
        baselineScreenshotId: "scr-base-desk",
        deviceType: "desktop",
        captureType: "full_page",
        schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
        diffAlgorithm: VISUAL_DIFF_ALGORITHM,
        status: "completed",
        isBaseline: false,
        isMeaningfulChange: true,
        visualChangeScore: 24.5,
        changeSeverity: "moderate",
        heroZoneChange: 22.0,
        bodyZoneChange: 15.0,
        footerZoneChange: 5.0,
        changedBlocksCount: 6,
        totalBlocksCount: TOTAL_GRID_BLOCKS,
        heightDeltaPx: 50,
        changeReasons: [
          "Moderate overall visual difference (25% perceptual change)",
          "Hero section modified by 22% (above-the-fold shift detected)",
        ],
        currentSignedUrl: "https://storage.supabase.co/signed-desktop-current.png",
        baselineSignedUrl: "https://storage.supabase.co/signed-desktop-baseline.png",
        createdAt: "2026-09-08T12:00:00.000Z",
      },
      {
        id: "diff-2",
        organizationId: "org-1",
        projectId: "proj-1",
        monitoredPageId: "page-1",
        currentAuditRunId: "run-curr",
        baselineAuditRunId: "run-base",
        currentScreenshotId: "scr-curr-mob",
        baselineScreenshotId: "scr-base-mob",
        deviceType: "mobile",
        captureType: "full_page",
        schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
        diffAlgorithm: VISUAL_DIFF_ALGORITHM,
        status: "completed",
        isBaseline: false,
        isMeaningfulChange: false,
        visualChangeScore: 3.2,
        changeSeverity: "negligible",
        heroZoneChange: 1.0,
        bodyZoneChange: 4.0,
        footerZoneChange: 0.0,
        changedBlocksCount: 0,
        totalBlocksCount: TOTAL_GRID_BLOCKS,
        heightDeltaPx: 0,
        changeReasons: ["Negligible visual difference below noise threshold"],
        currentSignedUrl: "https://storage.supabase.co/signed-mobile-current.png",
        baselineSignedUrl: "https://storage.supabase.co/signed-mobile-baseline.png",
        createdAt: "2026-09-08T12:00:00.000Z",
      },
    ],
    summary: {
      hasVisualDiff: true,
      isBaseline: false,
      isMeaningfulChange: true,
      maxChangeScore: 24.5,
      maxChangeSeverity: "moderate",
      desktopChangeScore: 24.5,
      mobileChangeScore: 3.2,
      changeReasons: [
        "Moderate overall visual difference (25% perceptual change)",
        "Hero section modified by 22% (above-the-fold shift detected)",
      ],
    },
    baselineRunId: "run-base",
    currentRunId: "run-curr",
  };

  const baselineDiffResponse: VisualDiffResponse = {
    diffs: [],
    summary: {
      hasVisualDiff: false,
      isBaseline: true,
      isMeaningfulChange: false,
      maxChangeScore: 0,
      maxChangeSeverity: "negligible",
      desktopChangeScore: null,
      mobileChangeScore: null,
      changeReasons: [],
    },
    baselineRunId: null,
    currentRunId: "run-curr",
  };

  it("renders card with 32-Block Perceptual Hash method badge", () => {
    render(<VisualRegressionCard visualDiff={sampleDiffResponse} />);

    expect(screen.getByText("Visual Regression & Perceptual Diff")).toBeDefined();
    const badge = screen.getByTestId("visual-diff-method-badge");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain(VISUAL_DIFF_METHOD_LABEL);
    expect(screen.getByText(VISUAL_DIFF_ALGORITHM)).toBeDefined();
  });

  it("renders loading state when isLoading is true", () => {
    render(<VisualRegressionCard isLoading={true} />);

    expect(screen.getByTestId("visual-diff-loading")).toBeDefined();
    expect(
      screen.getByText(/Computing deterministic visual difference matrix/i)
    ).toBeDefined();
  });

  it("renders error state when error is provided", () => {
    render(<VisualRegressionCard error="Failed network connection" />);

    const err = screen.getByTestId("visual-diff-error");
    expect(err).toBeDefined();
    expect(err.textContent).toContain("Failed network connection");
  });

  it("renders explicit baseline explanation when run is a baseline audit", () => {
    render(<VisualRegressionCard visualDiff={baselineDiffResponse} />);

    const baselineBox = screen.getByTestId("visual-diff-baseline");
    expect(baselineBox).toBeDefined();
    expect(screen.getByText("Baseline Visual Snapshot")).toBeDefined();
    expect(
      screen.getByText(/No prior compatible screenshot was available/i)
    ).toBeDefined();
  });

  it("renders overall change score, severity, meaningful change badge, and hero shift badge", () => {
    render(<VisualRegressionCard visualDiff={sampleDiffResponse} />);

    const score = screen.getByTestId("visual-change-score");
    expect(score.textContent).toBe("24.5%");

    const severity = screen.getByTestId("visual-severity-badge");
    expect(severity.textContent).toBe("Moderate Change");

    expect(screen.getByTestId("meaningful-change-badge")).toBeDefined();
    expect(screen.getByTestId("hero-shift-badge")).toBeDefined();
  });

  it("renders 3-Zone breakdown (Hero, Body, Footer) and block metrics", () => {
    render(<VisualRegressionCard visualDiff={sampleDiffResponse} />);

    expect(screen.getByTestId("hero-zone-card")).toBeDefined();
    expect(screen.getByTestId("hero-zone-change").textContent).toBe("22.0%");

    expect(screen.getByTestId("body-zone-card")).toBeDefined();
    expect(screen.getByTestId("body-zone-change").textContent).toBe("15.0%");

    expect(screen.getByTestId("footer-zone-card")).toBeDefined();
    expect(screen.getByTestId("footer-zone-change").textContent).toBe("5.0%");

    expect(screen.getByTestId("changed-blocks-metric").textContent).toContain("6 of 32");
    expect(screen.getByTestId("height-delta-metric").textContent).toContain("+50px");
  });

  it("renders explainable observations list", () => {
    render(<VisualRegressionCard visualDiff={sampleDiffResponse} />);

    const reasonsBox = screen.getByTestId("visual-diff-reasons");
    expect(reasonsBox).toBeDefined();
    expect(reasonsBox.textContent).toContain("Hero section modified by 22%");
  });

  it("renders before vs after visual comparison with signed URLs", () => {
    render(<VisualRegressionCard visualDiff={sampleDiffResponse} />);

    const beforeView = screen.getByTestId("diff-baseline-view");
    expect(beforeView).toBeDefined();
    const beforeImg = beforeView.querySelector("img");
    expect(beforeImg).toBeDefined();
    expect(beforeImg?.getAttribute("src")).toBe(
      "https://storage.supabase.co/signed-desktop-baseline.png"
    );

    const afterView = screen.getByTestId("diff-current-view");
    expect(afterView).toBeDefined();
    const afterImg = afterView.querySelector("img");
    expect(afterImg).toBeDefined();
    expect(afterImg?.getAttribute("src")).toBe(
      "https://storage.supabase.co/signed-desktop-current.png"
    );
  });

  it("switches viewports between desktop and mobile on toggle click", () => {
    const onSelect = vi.fn();
    render(
      <VisualRegressionCard
        visualDiff={sampleDiffResponse}
        onSelectViewport={onSelect}
      />
    );

    expect(screen.getByTestId("visual-change-score").textContent).toBe("24.5%");

    const mobileBtn = screen.getByTestId("device-toggle-mobile");
    fireEvent.click(mobileBtn);

    expect(onSelect).toHaveBeenCalledWith("mobile");
    expect(screen.getByTestId("visual-change-score").textContent).toBe("3.2%");
    expect(screen.getByTestId("visual-severity-badge").textContent).toBe("Negligible");
    expect(screen.queryByTestId("meaningful-change-badge")).toBeNull();
  });

  it("fetches visual diff from API when IDs are provided", async () => {
    vi.mocked(auditsApi.fetchVisualDiff).mockResolvedValueOnce(sampleDiffResponse);

    render(
      <VisualRegressionCard
        projectId="proj-123"
        pageId="page-456"
        auditRunId="run-789"
        compareRunId="run-base"
      />
    );

    await waitFor(() => {
      expect(auditsApi.fetchVisualDiff).toHaveBeenCalledWith(
        "proj-123",
        "page-456",
        "run-789",
        { compareRunId: "run-base" }
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("visual-change-score").textContent).toBe("24.5%");
    });
  });
});
