// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareLinkMetadata, SharedAuditReportResponse } from "@pagepilot/contracts";
import { ShareReportModal } from "../src/features/share/components/share-report-modal";
import { SharedReportPage } from "../src/features/share/components/shared-report-page";
import * as shareApi from "../src/features/share/api";
import { richReport } from "./fixtures/reports";

vi.mock("../src/features/share/api", () => ({
  createShareLink: vi.fn(),
  getActiveShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
  getPublicSharedReport: vi.fn(),
}));

describe("Share UI Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("<ShareReportModal />", () => {
    it("renders creation flow when no active share exists", async () => {
      vi.mocked(shareApi.getActiveShareLink).mockResolvedValueOnce(null);

      const onClose = vi.fn();
      render(
        <ShareReportModal
          projectId="proj-1"
          pageId="page-1"
          auditRunId="run-1"
          role="member"
          onClose={onClose}
        />,
      );

      expect(screen.getByText("Checking share status...")).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText("Share Historical Audit Report")).toBeDefined();
        expect(screen.getByText("Create Share Link")).toBeDefined();
      });

      expect(screen.getByLabelText("Link Expiration")).toBeDefined();
    });

    it("creates a share link and displays copyable URL", async () => {
      vi.mocked(shareApi.getActiveShareLink).mockResolvedValueOnce(null);
      vi.mocked(shareApi.createShareLink).mockResolvedValueOnce({
        shareLink: {
          id: "share-123",
          shareUrl: "/shared/reports/mock-token-xyz",
          token: "mock-token-xyz",
          expiresAt: "2026-09-30T00:00:00.000Z",
          createdAt: "2026-08-30T00:00:00.000Z",
        },
      });

      render(
        <ShareReportModal
          projectId="proj-1"
          pageId="page-1"
          auditRunId="run-1"
          role="admin"
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Create Share Link")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Create Share Link"));

      await waitFor(() => {
        expect(screen.getByDisplayValue(/shared\/reports\/mock-token-xyz/)).toBeDefined();
        expect(screen.getByText("Copy")).toBeDefined();
      });

      fireEvent.click(screen.getByText("Copy"));
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/shared/reports/mock-token-xyz"),
      );

      await waitFor(() => {
        expect(screen.getByText("Copied!")).toBeDefined();
      });
    });

    it("displays active share and handles revocation with confirmation", async () => {
      const activeShare: ShareLinkMetadata = {
        id: "share-123",
        auditRunId: "run-1",
        auditReportId: "report-1",
        expiresAt: "2026-09-30T00:00:00.000Z",
        revokedAt: null,
        isRevoked: false,
        isExpired: false,
        createdAt: "2026-08-30T00:00:00.000Z",
        lastAccessedAt: null,
      };

      vi.mocked(shareApi.getActiveShareLink).mockResolvedValueOnce(activeShare);
      vi.mocked(shareApi.revokeShareLink).mockResolvedValueOnce(true);

      render(
        <ShareReportModal
          projectId="proj-1"
          pageId="page-1"
          auditRunId="run-1"
          role="owner"
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Active Share Link")).toBeDefined();
        expect(screen.getByText("Revoke share link")).toBeDefined();
      });

      // Click revoke link -> triggers confirmation state
      fireEvent.click(screen.getByText("Revoke share link"));
      expect(screen.getByText("Revoke this link immediately?")).toBeDefined();
      expect(screen.getByText("Yes, Revoke")).toBeDefined();

      // Confirm revoke
      fireEvent.click(screen.getByText("Yes, Revoke"));

      await waitFor(() => {
        expect(shareApi.revokeShareLink).toHaveBeenCalledWith("proj-1", "share-123");
        expect(screen.getByText("Create Share Link")).toBeDefined();
      });
    });

    it("disables creation/revocation for viewer role with clear notice", async () => {
      vi.mocked(shareApi.getActiveShareLink).mockResolvedValueOnce(null);

      render(
        <ShareReportModal
          projectId="proj-1"
          pageId="page-1"
          auditRunId="run-1"
          role="viewer"
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText(/You have view-only permissions/i),
        ).toBeDefined();
      });

      expect(screen.queryByText("Create Share Link")).toBeNull();
      expect(screen.queryByText("Revoke share link")).toBeNull();
    });

    it("closes when escape key is pressed", async () => {
      vi.mocked(shareApi.getActiveShareLink).mockResolvedValueOnce(null);
      const onClose = vi.fn();

      render(
        <ShareReportModal
          projectId="proj-1"
          pageId="page-1"
          auditRunId="run-1"
          role="member"
          onClose={onClose}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Share Historical Audit Report")).toBeDefined();
      });

      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("<SharedReportPage />", () => {
    it("renders loading state initially", () => {
      vi.mocked(shareApi.getPublicSharedReport).mockReturnValue(new Promise(() => {}));

      render(<SharedReportPage token="token-123" />);
      expect(screen.getByText("Loading shared audit report...")).toBeDefined();
    });

    it("renders error screen when token lookup returns 404", async () => {
      const notFoundError = new Error("This report link is no longer available.");
      (notFoundError as any).status = 404;
      vi.mocked(shareApi.getPublicSharedReport).mockRejectedValueOnce(notFoundError);

      render(<SharedReportPage token="invalid-token" />);

      await waitFor(() => {
        expect(
          screen.getByText("This report link is no longer available."),
        ).toBeDefined();
        expect(
          screen.getByText(/The link may have expired, been revoked/i),
        ).toBeDefined();
        expect(screen.getByText("Run an audit on PagePilot")).toBeDefined();
      });
    });

    it("renders read-only report view when token is valid", async () => {
      const mockSharedData: SharedAuditReportResponse = {
        report: {
          id: "rep-1",
          auditRunId: "run-1",
          monitoredPageId: "page-1",
          projectId: "proj-1",
          organizationId: "org-1",
          schemaVersion: "1.0.0",
          modelIdentifier: "gemini-2.5-flash",
          checkVersion: "1.0.0",
          scoringVersion: "1.0.0",
          summary: richReport.summary,
          overallScore: richReport.overallScore,
          scoreConfidence: richReport.scoreConfidence,
          reportPayload: richReport,
          createdAt: "2026-08-30T00:00:00.000Z",
        },
        auditRun: {
          id: "run-1",
          monitoredPageId: "page-1",
          projectId: "proj-1",
          organizationId: "org-1",
          invocationType: "manual",
          status: "completed",
          targetUrl: "https://example.com/landing",
          finalUrl: "https://example.com/landing",
          startedAt: "2026-08-30T00:00:00.000Z",
          completedAt: "2026-08-30T00:00:00.000Z",
          failedAt: null,
          errorCode: null,
          errorMessage: null,
          retryable: false,
          modelVersion: "gemini-2.5-flash",
          checkVersion: "1.0.0",
          promptVersion: "1.0.0",
          scoringVersion: "1.0.0",
          retryCount: 0,
          maxRetries: 3,
          createdAt: "2026-08-30T00:00:00.000Z",
          updatedAt: "2026-08-30T00:00:00.000Z",
        },
        scoreSnapshots: [],
        findings: [],
        recommendations: [],
        shareMetadata: {
          id: "share-123",
          createdAt: "2026-08-30T00:00:00.000Z",
          expiresAt: "2026-09-30T00:00:00.000Z",
        },
      };

      vi.mocked(shareApi.getPublicSharedReport).mockResolvedValueOnce(mockSharedData);

      render(<SharedReportPage token="valid-share-token" />);

      await waitFor(() => {
        expect(screen.getByText("Read-Only Shared Report")).toBeDefined();
        expect(screen.getByText("Public Report Viewer")).toBeDefined();
        expect(screen.getByText("https://example.com/landing")).toBeDefined();
        expect(screen.getByText(richReport.summary)).toBeDefined();
      });

      // Pure read-only: no "+ Track Work Item" buttons
      expect(screen.queryByText("+ Track Work Item")).toBeNull();
    });
  });
});
