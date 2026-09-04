// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditScreenshotMetadata } from "@pagepilot/contracts";
import { ScreenshotPreviewCard } from "../src/features/audits/components/screenshot-preview-card";
import * as auditsApi from "../src/features/audits/api.js";

vi.mock("../src/features/audits/api.js");

describe("ScreenshotPreviewCard Component", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sampleScreenshots: AuditScreenshotMetadata[] = [
    {
      id: "screen-1",
      auditRunId: "run-1",
      monitoredPageId: "page-1",
      projectId: "proj-1",
      organizationId: "org-1",
      deviceType: "desktop",
      captureType: "viewport",
      storagePath: "orgs/1/desktop.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 142000,
      mimeType: "image/webp",
      width: 1280,
      height: 800,
      capturedAt: "2026-09-06T12:00:00.000Z",
      createdAt: "2026-09-06T12:00:05.000Z",
      signedUrl: "https://example.supabase.co/storage/v1/sign/desktop.webp?token=xyz",
    },
    {
      id: "screen-2",
      auditRunId: "run-1",
      monitoredPageId: "page-1",
      projectId: "proj-1",
      organizationId: "org-1",
      deviceType: "mobile",
      captureType: "viewport",
      storagePath: "orgs/1/mobile.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 82000,
      mimeType: "image/webp",
      width: 375,
      height: 812,
      capturedAt: "2026-09-06T12:00:00.000Z",
      createdAt: "2026-09-06T12:00:05.000Z",
      signedUrl: "https://example.supabase.co/storage/v1/sign/mobile.webp?token=abc",
    },
  ];

  it("renders card with BROWSER-RENDERED EVIDENCE badge", () => {
    render(<ScreenshotPreviewCard screenshots={sampleScreenshots} />);

    expect(screen.getByText("Visual Page Capture")).toBeDefined();
    const badge = screen.getByTestId("visual-evidence-badge");
    expect(badge).toBeDefined();
    expect(badge.textContent).toContain("BROWSER-RENDERED EVIDENCE");
  });

  it("defaults to desktop viewport and displays desktop screenshot", () => {
    render(<ScreenshotPreviewCard screenshots={sampleScreenshots} />);

    const desktopTab = screen.getByRole("tab", { name: /desktop/i });
    expect(desktopTab.getAttribute("aria-selected")).toBe("true");

    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe(
      "https://example.supabase.co/storage/v1/sign/desktop.webp?token=xyz"
    );
    expect(screen.getByText(/1280 × 800 px/i)).toBeDefined();
  });

  it("switches to mobile viewport on tab click", () => {
    render(<ScreenshotPreviewCard screenshots={sampleScreenshots} />);

    const mobileTab = screen.getByRole("tab", { name: /mobile/i });
    fireEvent.click(mobileTab);

    expect(mobileTab.getAttribute("aria-selected")).toBe("true");
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe(
      "https://example.supabase.co/storage/v1/sign/mobile.webp?token=abc"
    );
    expect(screen.getByText(/375 × 812 px/i)).toBeDefined();
  });

  it("opens and closes lightbox modal via click and Escape key", () => {
    render(<ScreenshotPreviewCard screenshots={sampleScreenshots} />);

    // Click Expand View
    const expandBtn = screen.getByRole("button", { name: /expand view/i });
    fireEvent.click(expandBtn);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    // Press Escape to close
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    // Click image to open again
    const img = screen.getByRole("img");
    fireEvent.click(img);
    expect(screen.getByRole("dialog")).toBeDefined();

    // Click Close (Esc) button
    const closeBtn = screen.getByRole("button", {
      name: /close screenshot preview/i,
    });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders loading state when isLoading is true", () => {
    render(<ScreenshotPreviewCard isLoading={true} />);

    expect(screen.getByTestId("screenshot-loading")).toBeDefined();
    expect(screen.getByText(/loading browser visual evidence/i)).toBeDefined();
  });

  it("renders empty state when screenshots array is empty", () => {
    render(<ScreenshotPreviewCard screenshots={[]} />);

    expect(screen.getByTestId("screenshot-empty")).toBeDefined();
    expect(
      screen.getByText(/no browser visual evidence captured for this audit/i)
    ).toBeDefined();
  });

  it("renders error state when error is passed", () => {
    render(
      <ScreenshotPreviewCard error="Failed to fetch storage credentials" />
    );

    expect(screen.getByTestId("screenshot-error")).toBeDefined();
    expect(
      screen.getByText(/unable to load visual evidence: Failed to fetch storage credentials/i)
    ).toBeDefined();
  });

  it("auto-fetches screenshots using fetchAuditScreenshots when IDs provided", async () => {
    vi.mocked(auditsApi.fetchAuditScreenshots).mockResolvedValueOnce({
      screenshots: sampleScreenshots,
    });

    render(
      <ScreenshotPreviewCard
        projectId="proj-1"
        pageId="page-1"
        auditRunId="run-1"
      />
    );

    expect(screen.getByTestId("screenshot-loading")).toBeDefined();

    await waitFor(() => {
      expect(auditsApi.fetchAuditScreenshots).toHaveBeenCalledWith(
        "proj-1",
        "page-1",
        "run-1"
      );
      expect(screen.getByRole("tab", { name: /desktop/i })).toBeDefined();
    });
  });
});
