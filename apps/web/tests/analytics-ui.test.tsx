// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MonitoredPage,
  OrganizationMember,
  PageAnalyticsSnapshot,
  Project,
  WorkItem,
} from "@pagepilot/contracts";
import { PageAnalyticsCard } from "../src/features/analytics/components/page-analytics-card";
import { ImportAnalyticsModal } from "../src/features/analytics/components/import-analytics-modal";
import { PageDetail } from "../src/features/workspace/components/page-detail";
import { ProjectDetail } from "../src/features/workspace/components/project-detail";
import * as analyticsApi from "../src/features/analytics/api.js";
import * as workItemsApi from "../src/features/work-items/api.js";

vi.mock("../src/features/analytics/api.js");
vi.mock("../src/features/work-items/api.js");

describe("Page Analytics UI", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const sampleProject: Project = {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    name: "Growth App",
    domain: "growth.app",
    timezone: "UTC",
    goals: "Improve conversion rate",
    createdBy: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  const samplePage: MonitoredPage = {
    id: "44444444-4444-4444-8444-444444444444",
    projectId: sampleProject.id,
    organizationId: sampleProject.organizationId,
    canonicalUrl: "https://growth.app/pricing",
    cadence: "weekly",
    status: "active",
    ownerId: "33333333-3333-4333-8333-333333333333",
    tags: ["pricing"],
    latestAuditRunId: "55555555-5555-4555-8555-555555555555",
    latestSuccessfulAuditRunId: "55555555-5555-4555-8555-555555555555",
    latestAnalyticsSnapshotId: "66666666-6666-4666-8666-666666666666",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  const sampleSnapshot: PageAnalyticsSnapshot = {
    id: "66666666-6666-4666-8666-666666666666",
    monitoredPageId: samplePage.id,
    projectId: sampleProject.id,
    organizationId: sampleProject.organizationId,
    sourceType: "manual",
    sourceProviderName: "Google Analytics 4",
    schemaVersion: "1.0.0",
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-08-31T23:59:59.000Z",
    sessions: 25000,
    uniqueVisitors: 18000,
    conversions: 750,
    conversionRate: 3.0,
    bounceRate: 42.5,
    avgDurationSeconds: 135,
    currency: "USD",
    customMetrics: {},
    isActive: true,
    provenance: {
      label: "IMPORTED DATA",
      importedAt: "2026-09-01T12:00:00.000Z",
      notes: "Q3 baseline import",
    },
    createdByUserId: "33333333-3333-4333-8333-333333333333",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
  };

  describe("PageAnalyticsCard Component", () => {
    it("renders empty state with IMPORTED DATA provenance badge and Import CTA for member", () => {
      const onOpenImportModal = vi.fn();

      render(
        <PageAnalyticsCard
          analytics={null}
          isLoading={false}
          role="member"
          onOpenImportModal={onOpenImportModal}
          onDeleteAnalytics={vi.fn()}
        />,
      );

      expect(screen.getByText("IMPORTED DATA")).toBeTruthy();
      expect(
        screen.getByText(/No business metrics imported yet/i),
      ).toBeTruthy();
      const importButton = screen.getByRole("button", { name: /\+ Import Analytics/i });
      expect(importButton).toBeTruthy();

      fireEvent.click(importButton);
      expect(onOpenImportModal).toHaveBeenCalledTimes(1);
    });

    it("renders empty state without Import CTA for viewer role", () => {
      render(
        <PageAnalyticsCard
          analytics={null}
          isLoading={false}
          role="viewer"
          onOpenImportModal={vi.fn()}
          onDeleteAnalytics={vi.fn()}
        />,
      );

      expect(screen.getByText("IMPORTED DATA")).toBeTruthy();
      expect(
        screen.getByText(/No business metrics imported yet/i),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: /\+ Import Analytics/i })).toBeNull();
    });

    it("renders all imported metrics and high exposure tier badge", () => {
      render(
        <PageAnalyticsCard
          analytics={sampleSnapshot}
          isLoading={false}
          role="member"
          onOpenImportModal={vi.fn()}
          onDeleteAnalytics={vi.fn()}
        />,
      );

      // Provenance badge
      expect(screen.getByText("IMPORTED DATA")).toBeTruthy();
      expect(screen.getByText("High Business Exposure")).toBeTruthy();

      // Metrics
      expect(screen.getByText("25,000")).toBeTruthy();
      expect(screen.getByText(/18,000/)).toBeTruthy();
      expect(screen.getByText(/750/)).toBeTruthy();
      expect(screen.getByText("3.00%")).toBeTruthy();
      expect(screen.getByText(/42\.5%/)).toBeTruthy();
      expect(screen.getByText("2m 15s")).toBeTruthy();

      // Source attribution
      expect(screen.getByText(/Google Analytics 4/)).toBeTruthy();
    });

    it("renders delete action for owner/admin but not for member/viewer", () => {
      const onDeleteAnalytics = vi.fn().mockResolvedValue(undefined);

      // Render as member
      const { unmount } = render(
        <PageAnalyticsCard
          analytics={sampleSnapshot}
          isLoading={false}
          role="member"
          onOpenImportModal={vi.fn()}
          onDeleteAnalytics={onDeleteAnalytics}
        />,
      );

      expect(screen.queryByRole("button", { name: /^Delete$/i })).toBeNull();
      unmount();

      // Render as admin
      render(
        <PageAnalyticsCard
          analytics={sampleSnapshot}
          isLoading={false}
          role="admin"
          onOpenImportModal={vi.fn()}
          onDeleteAnalytics={onDeleteAnalytics}
        />,
      );

      const deleteBtn = screen.getByRole("button", { name: /^Delete$/i });
      expect(deleteBtn).toBeTruthy();

      // Click delete button
      window.confirm = vi.fn().mockReturnValue(true);
      fireEvent.click(deleteBtn);
      expect(onDeleteAnalytics).toHaveBeenCalledWith(sampleSnapshot.id);
    });

    it("renders stale context warning banner when reporting period is older than 60 days", () => {
      const staleSnapshot: PageAnalyticsSnapshot = {
        ...sampleSnapshot,
        periodEnd: "2025-01-01T00:00:00.000Z", // > 600 days ago
      };

      render(
        <PageAnalyticsCard
          analytics={staleSnapshot}
          isLoading={false}
          role="owner"
          onOpenImportModal={vi.fn()}
          onDeleteAnalytics={vi.fn()}
        />,
      );

      expect(screen.getByText(/Stale Context Warning:/i)).toBeTruthy();
      expect(screen.getByText(/ending over 60 days ago/i)).toBeTruthy();
    });
  });

  describe("ImportAnalyticsModal Component", () => {
    it("renders form inputs and explicit IMPORTED DATA notice", () => {
      render(
        <ImportAnalyticsModal
          projectId={sampleProject.id}
          pageId={samplePage.id}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      expect(screen.getByRole("heading", { name: /Import Page Analytics Context/i })).toBeTruthy();
      expect(screen.getByText(/Data Provenance Notice/i)).toBeTruthy();
      expect(screen.getByLabelText(/Period Start Date/i)).toBeTruthy();
      expect(screen.getByLabelText(/Period End Date/i)).toBeTruthy();
      expect(screen.getByLabelText(/Total Sessions/i)).toBeTruthy();
      expect(screen.getByLabelText(/Unique Visitors/i)).toBeTruthy();
      expect(screen.getByLabelText(/Total Conversions/i)).toBeTruthy();
      expect(screen.getByLabelText(/Conversion Rate/i)).toBeTruthy();
      expect(screen.getByLabelText(/Bounce Rate/i)).toBeTruthy();
      expect(screen.getByLabelText(/Avg\. Session Duration/i)).toBeTruthy();
    });

    it("auto-calculates conversion rate from sessions and conversions", () => {
      render(
        <ImportAnalyticsModal
          projectId={sampleProject.id}
          pageId={samplePage.id}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      const sessionsInput = screen.getByLabelText(/Total Sessions/i);
      const conversionsInput = screen.getByLabelText(/Total Conversions/i);
      const convRateInput = screen.getByLabelText(/Conversion Rate/i) as HTMLInputElement;

      fireEvent.change(sessionsInput, { target: { value: "1000" } });
      fireEvent.change(conversionsInput, { target: { value: "50" } });

      const autoCalcBtn = screen.getByRole("button", { name: /Auto-calculate/i });
      fireEvent.click(autoCalcBtn);

      expect(convRateInput.value).toBe("5.00");
    });

    it("validates that start date cannot be after end date", async () => {
      const onSuccess = vi.fn();
      render(
        <ImportAnalyticsModal
          projectId={sampleProject.id}
          pageId={samplePage.id}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />,
      );

      const startInput = screen.getByLabelText(/Period Start Date/i);
      const endInput = screen.getByLabelText(/Period End Date/i);

      fireEvent.change(startInput, { target: { value: "2026-09-10" } });
      fireEvent.change(endInput, { target: { value: "2026-09-01" } });

      const submitBtn = screen.getByRole("button", { name: /Save Analytics Context/i });
      fireEvent.click(submitBtn);

      expect(screen.getByText(/Period start date must be before or equal to period end date/i)).toBeTruthy();
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it("submits valid form data and triggers onSuccess", async () => {
      vi.mocked(analyticsApi.createPageAnalytics).mockResolvedValue({
        analytics: sampleSnapshot,
      });

      const onSuccess = vi.fn();
      render(
        <ImportAnalyticsModal
          projectId={sampleProject.id}
          pageId={samplePage.id}
          isOpen={true}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />,
      );

      fireEvent.change(screen.getByLabelText(/Period Start Date/i), { target: { value: "2026-08-01" } });
      fireEvent.change(screen.getByLabelText(/Period End Date/i), { target: { value: "2026-08-31" } });
      fireEvent.change(screen.getByLabelText(/Total Sessions/i), { target: { value: "12000" } });
      fireEvent.change(screen.getByLabelText(/Total Conversions/i), { target: { value: "300" } });
      fireEvent.change(screen.getByLabelText(/Conversion Rate/i), { target: { value: "2.5" } });

      const submitBtn = screen.getByRole("button", { name: /Save Analytics Context/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(analyticsApi.createPageAnalytics).toHaveBeenCalledWith(
          sampleProject.id,
          samplePage.id,
          expect.objectContaining({
            sessions: 12000,
            conversions: 300,
            conversionRate: 2.5,
          }),
        );
        expect(onSuccess).toHaveBeenCalledWith(sampleSnapshot);
      });
    });
  });

  describe("PageDetail Integration", () => {
    it("loads and displays analytics card within PageDetail", async () => {
      vi.mocked(analyticsApi.getPageAnalytics).mockResolvedValue({
        current: sampleSnapshot,
        history: [sampleSnapshot],
        total: 1,
      });

      render(
        <PageDetail
          project={sampleProject}
          page={samplePage}
          role="owner"
          history={[]}
          historyTotal={0}
          isLoadingHistory={false}
          historyPage={1}
          pageSize={10}
          onPageChange={vi.fn()}
          onBackToProject={vi.fn()}
          onRunAudit={vi.fn()}
          onViewLatestReport={vi.fn()}
          onViewHistoricalReport={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(analyticsApi.getPageAnalytics).toHaveBeenCalledWith(sampleProject.id, samplePage.id);
      });

      expect(await screen.findByText("25,000")).toBeTruthy();
      expect(screen.getByText("High Business Exposure")).toBeTruthy();
    });
  });

  describe("ProjectDetail Business-Impact Prioritization Integration", () => {
    const mockMembers: OrganizationMember[] = [
      {
        id: "mem-1",
        organizationId: sampleProject.organizationId,
        userId: "user-1",
        role: "owner",
        email: "owner@growth.app",
        fullName: "Owner Name",
        avatarUrl: null,
        createdAt: "2026-08-27T12:00:00.000Z",
        updatedAt: "2026-08-27T12:00:00.000Z",
      },
    ];

    const mockWorkItems: WorkItem[] = [
      {
        id: "item-1",
        organizationId: sampleProject.organizationId,
        projectId: sampleProject.id,
        monitoredPageId: samplePage.id,
        sourceType: "finding",
        findingId: "f-1",
        recommendationId: null,
        title: "Hero value proposition is unclear",
        description: "Clarify main headline",
        category: "clarity",
        severity: "high",
        status: "open",
        assigneeId: null,
        resolutionRationale: null,
        resolvedAt: null,
        resolvedByUserId: null,
        tags: [],
        notes: null,
        createdByUserId: "user-1",
        createdAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    ];

    it("displays Critical Growth priority badge on work items for high UX severity on high exposure page", async () => {
      vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
        workItems: mockWorkItems,
        total: 1,
      });
      vi.mocked(workItemsApi.listOrganizationMembers).mockResolvedValue({
        members: mockMembers,
      });

      // Return high-exposure analytics for the page
      vi.mocked(analyticsApi.getPageAnalytics).mockResolvedValue({
        current: sampleSnapshot, // sessions: 25000 -> High exposure
        history: [sampleSnapshot],
        total: 1,
      });

      render(
        <ProjectDetail
          project={sampleProject}
          pages={[samplePage]}
          role="owner"
          isLoading={false}
          members={mockMembers}
          onBackToProjects={vi.fn()}
          onSelectPage={vi.fn()}
          onComparePage={vi.fn()}
          onCreatePage={vi.fn()}
          onUpdatePage={vi.fn()}
          onDeletePage={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Critical Growth")).toBeTruthy();
      });

      // Also shows high exposure sessions badge in work items list
      expect(screen.getByText(/25k sess\/mo/)).toBeTruthy();
    });

    it("displays imported traffic badge in Landing Page UX Trajectories", async () => {
      vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
        workItems: [],
        total: 0,
      });
      vi.mocked(workItemsApi.listOrganizationMembers).mockResolvedValue({
        members: mockMembers,
      });
      vi.mocked(analyticsApi.getPageAnalytics).mockResolvedValue({
        current: sampleSnapshot,
        history: [sampleSnapshot],
        total: 1,
      });

      render(
        <ProjectDetail
          project={sampleProject}
          pages={[samplePage]}
          role="owner"
          isLoading={false}
          members={mockMembers}
          onBackToProjects={vi.fn()}
          onSelectPage={vi.fn()}
          onComparePage={vi.fn()}
          onCreatePage={vi.fn()}
          onUpdatePage={vi.fn()}
          onDeletePage={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/25k sess/)).toBeTruthy();
      });
      expect(screen.getByText(/3.0% CR/)).toBeTruthy();
    });
  });
});
