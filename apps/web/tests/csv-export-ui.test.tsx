// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MonitoredPage,
  OrganizationMember,
  PersistedAuditReportResponse,
  Project,
  WorkItem,
} from "@pagepilot/contracts";
import { WorkItemsBacklog } from "../src/features/work-items/components/work-items-backlog";
import { HistoricalReportView } from "../src/features/workspace/components/historical-report-view";
import * as workItemsApi from "../src/features/work-items/api.js";
import * as auditsApi from "../src/features/audits/api.js";

// Mock work-items API
vi.mock("../src/features/work-items/api.js", () => {
  class WorkItemsApiClientError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "WorkItemsApiClientError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    listWorkItems: vi.fn(),
    exportWorkItemsCsv: vi.fn(),
    triggerBlobDownload: vi.fn(),
    updateWorkItem: vi.fn(),
    WorkItemsApiClientError,
  };
});

// Mock audits API
vi.mock("../src/features/audits/api.js", () => {
  class AuditApiClientError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "AuditApiClientError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    exportAuditReportCsv: vi.fn(),
    AuditApiClientError,
  };
});

const sampleProject: Project = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  name: "Acme Landing Pages",
  domain: "acme.com",
  timezone: "UTC",
  goals: "Improve conversion",
  createdBy: "33333333-3333-4333-8333-333333333333",
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const samplePage: MonitoredPage = {
  id: "44444444-4444-4444-8444-444444444444",
  projectId: sampleProject.id,
  organizationId: sampleProject.organizationId,
  canonicalUrl: "https://acme.com/pricing",
  cadence: "weekly",
  status: "active",
  tags: ["pricing"],
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const sampleMember: OrganizationMember = {
  id: "55555555-5555-4555-8555-555555555555",
  organizationId: sampleProject.organizationId,
  userId: "66666666-6666-4666-8666-666666666666",
  role: "member",
  email: "dev@acme.com",
  fullName: "Dev Member",
  avatarUrl: null,
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-28T10:00:00.000Z",
};

const sampleWorkItem: WorkItem = {
  id: "77777777-7777-4777-8777-777777777777",
  organizationId: sampleProject.organizationId,
  projectId: sampleProject.id,
  monitoredPageId: samplePage.id,
  sourceType: "finding",
  findingId: "88888888-8888-4888-8888-888888888888",
  title: "CTA button contrast is too low",
  description: "Contrast ratio is below 4.5:1.",
  category: "accessibility",
  severity: "high",
  status: "open",
  assigneeId: sampleMember.userId,
  notes: "Needs design review.",
  tags: ["cta", "accessibility"],
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

const samplePersistedReport: PersistedAuditReportResponse = {
  auditRun: {
    id: "run-1111-1111-1111",
    monitoredPageId: samplePage.id,
    projectId: sampleProject.id,
    organizationId: sampleProject.organizationId,
    invocationType: "manual",
    status: "completed",
    targetUrl: "https://acme.com/pricing",
    completedAt: "2026-09-02T10:00:00.000Z",
    modelVersion: "gemini-3.6-flash",
    checkVersion: "1.0.0",
    promptVersion: "1.0.0",
    scoringVersion: "1.0.0",
    retryCount: 0,
    maxRetries: 3,
    createdAt: "2026-09-02T09:59:00.000Z",
    updatedAt: "2026-09-02T10:00:00.000Z",
  },
  report: {
    id: "rep-1111-1111-1111",
    auditRunId: "run-1111-1111-1111",
    monitoredPageId: samplePage.id,
    projectId: sampleProject.id,
    organizationId: sampleProject.organizationId,
    schemaVersion: "1.0.0",
    modelIdentifier: "gemini-3.6-flash",
    checkVersion: "1.0.0",
    scoringVersion: "1.0.0",
    summary: "Good page.",
    overallScore: 82,
    scoreConfidence: "blended",
    reportPayload: {
      source: {
        requestedUrl: "https://acme.com/pricing",
        finalUrl: "https://acme.com/pricing",
        analyzedAt: "2026-09-02T10:00:00.000Z",
        title: "Pricing",
      },
      overallScore: 82,
      scoreConfidence: "blended",
      summary: "Good page.",
      categories: [
        { category: "clarity", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
        { category: "visualHierarchy", score: 80, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
        { category: "ctaEffectiveness", score: 75, confidence: "blended", explanation: "Ok", severity: "medium", findings: [] },
        { category: "copy", score: 85, confidence: "ai-led", explanation: "Ok", severity: "low", findings: [] },
        { category: "accessibility", score: 80, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
        { category: "mobileUx", score: 85, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
        { category: "trustCredibility", score: 90, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
      ],
      topProblems: [
        {
          title: "CTA button contrast is too low",
          severity: "medium",
          evidence: "Contrast ratio is below 4.5:1.",
          basis: "observed",
          signalIds: ["cta-contrast"],
          recommendation: "Increase contrast.",
          category: "ctaEffectiveness",
        },
      ],
      quickWins: [
        {
          title: "Make CTA brighter",
          detail: "Use brighter accent color.",
          category: "ctaEffectiveness",
        },
      ],
      detailedRecommendations: [
        {
          title: "Adjust site theme colors",
          detail: "Ensure WCAG AA contrast.",
          category: "accessibility",
        },
      ],
      observedSignals: [],
    },
    createdAt: "2026-09-02T10:00:00.000Z",
  },
  scoreSnapshots: [],
  findings: [],
  recommendations: [],
};

describe("CSV Export UI Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("WorkItemsBacklog CSV Export", () => {
    it("renders 'Export CSV' button in header and triggers export on click", async () => {
      vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
        workItems: [sampleWorkItem],
        total: 1,
      });

      const mockBlob = new Blob(["test-csv"], { type: "text/csv" });
      vi.mocked(workItemsApi.exportWorkItemsCsv).mockResolvedValue(mockBlob);

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={[sampleMember]}
          role="member"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("CTA button contrast is too low")).toBeDefined();
      });

      const exportBtn = screen.getByRole("button", { name: /export csv/i });
      expect(exportBtn).toBeDefined();

      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(workItemsApi.exportWorkItemsCsv).toHaveBeenCalledWith(
          sampleProject.id,
          expect.objectContaining({
            status: undefined,
            severity: undefined,
          }),
        );
        expect(workItemsApi.triggerBlobDownload).toHaveBeenCalledWith(
          mockBlob,
          expect.stringContaining("pagepilot-work-items-acme-landing-pages-"),
        );
      });
    });

    it("allows 'viewer' role to export CSV", async () => {
      vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
        workItems: [sampleWorkItem],
        total: 1,
      });

      const mockBlob = new Blob(["test-csv"], { type: "text/csv" });
      vi.mocked(workItemsApi.exportWorkItemsCsv).mockResolvedValue(mockBlob);

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={[sampleMember]}
          role="viewer"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("CTA button contrast is too low")).toBeDefined();
      });

      // + Create Work Item should be hidden for viewer
      expect(screen.queryByRole("button", { name: /\+ create work item/i })).toBeNull();

      // Export CSV should still be visible and clickable for viewer
      const exportBtn = screen.getByRole("button", { name: /export csv/i });
      expect(exportBtn).toBeDefined();

      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(workItemsApi.exportWorkItemsCsv).toHaveBeenCalledWith(
          sampleProject.id,
          expect.any(Object),
        );
      });
    });

    it("displays error alert when export fails", async () => {
      vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
        workItems: [sampleWorkItem],
        total: 1,
      });

      vi.mocked(workItemsApi.exportWorkItemsCsv).mockRejectedValue(
        new (workItemsApi as any).WorkItemsApiClientError(500, "INTERNAL_ERROR", "Server export failed."),
      );

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={[sampleMember]}
          role="member"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("CTA button contrast is too low")).toBeDefined();
      });

      const exportBtn = screen.getByRole("button", { name: /export csv/i });
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
        expect(screen.getByText("Server export failed.")).toBeDefined();
      });
    });
  });

  describe("HistoricalReportView CSV Export", () => {
    it("renders 'Export CSV' button and triggers exportAuditReportCsv on click", async () => {
      const mockBlob = new Blob(["test-report-csv"], { type: "text/csv" });
      vi.mocked(auditsApi.exportAuditReportCsv).mockResolvedValue(mockBlob);

      render(
        <HistoricalReportView
          persistedReport={samplePersistedReport}
          onBack={vi.fn()}
          role="member"
        />,
      );

      const exportBtn = screen.getByRole("button", { name: /export csv/i });
      expect(exportBtn).toBeDefined();

      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(auditsApi.exportAuditReportCsv).toHaveBeenCalledWith(
          sampleProject.id,
          samplePage.id,
          samplePersistedReport.auditRun.id,
        );
        expect(workItemsApi.triggerBlobDownload).toHaveBeenCalledWith(
          mockBlob,
          expect.stringContaining("pagepilot-audit-acme-com-pricing-"),
        );
      });
    });

    it("allows 'viewer' role to export audit report CSV", async () => {
      const mockBlob = new Blob(["test-report-csv"], { type: "text/csv" });
      vi.mocked(auditsApi.exportAuditReportCsv).mockResolvedValue(mockBlob);

      render(
        <HistoricalReportView
          persistedReport={samplePersistedReport}
          onBack={vi.fn()}
          role="viewer"
        />,
      );

      const exportBtn = screen.getByRole("button", { name: /export csv/i });
      expect(exportBtn).toBeDefined();

      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(auditsApi.exportAuditReportCsv).toHaveBeenCalledWith(
          sampleProject.id,
          samplePage.id,
          samplePersistedReport.auditRun.id,
        );
      });
    });

    it("displays error banner when audit report export fails", async () => {
      vi.mocked(auditsApi.exportAuditReportCsv).mockRejectedValue(
        new Error("Failed to export audit report."),
      );

      render(
        <HistoricalReportView
          persistedReport={samplePersistedReport}
          onBack={vi.fn()}
          role="member"
        />,
      );

      const exportBtn = screen.getByRole("button", { name: /export csv/i });
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(screen.getByRole("alert")).toBeDefined();
        expect(screen.getByText("Failed to export audit report.")).toBeDefined();
      });
    });
  });
});
