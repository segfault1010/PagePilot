// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageDetail } from "../src/features/workspace/components/page-detail";
import type { AuditHistoryItem, MonitoredPage, Project } from "@pagepilot/contracts";

describe("Page Detail & Audit History UI", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleProject: Project = {
    id: "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
    organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
    name: "Growth App",
    domain: "growth.app",
    timezone: "UTC",
    goals: null,
    createdBy: "u-1",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  const samplePage: MonitoredPage = {
    id: "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    projectId: sampleProject.id,
    organizationId: sampleProject.organizationId,
    canonicalUrl: "https://growth.app/pricing",
    cadence: "weekly",
    status: "active",
    ownerId: "u-1",
    tags: ["pricing"],
    latestAuditRunId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    latestSuccessfulAuditRunId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  const sampleHistory: AuditHistoryItem[] = [
    {
      id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
      monitoredPageId: samplePage.id,
      projectId: sampleProject.id,
      organizationId: sampleProject.organizationId,
      invocationType: "manual",
      status: "completed",
      targetUrl: "https://growth.app/pricing",
      finalUrl: "https://growth.app/pricing/",
      overallScore: 84,
      scoreConfidence: "blended",
      summary: "Clear value prop",
      auditReportId: "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66",
      startedAt: "2026-08-27T12:00:00.000Z",
      completedAt: "2026-08-27T12:00:05.000Z",
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      retryable: null,
      modelVersion: "gemini-3.6-flash",
      checkVersion: "1.0.0",
      scoringVersion: "1.0.0",
      createdAt: "2026-08-27T12:00:00.000Z",
    },
  ];

  it("renders page details, latest score, and audit history", () => {
    render(
      <PageDetail
        project={sampleProject}
        page={samplePage}
        role="owner"
        history={sampleHistory}
        historyTotal={1}
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

    expect(screen.getByRole("heading", { name: "https://growth.app/pricing" })).toBeTruthy();
    expect(screen.getAllByText("84").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/blended/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Run Audit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Latest Audit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Report" })).toBeTruthy();
  });

  it("triggers manual audit with generated idempotency key", async () => {
    const onRunAudit = vi.fn().mockImplementation(() => new Promise((res) => setTimeout(res, 50)));

    render(
      <PageDetail
        project={sampleProject}
        page={samplePage}
        role="owner"
        history={sampleHistory}
        historyTotal={1}
        isLoadingHistory={false}
        historyPage={1}
        pageSize={10}
        onPageChange={vi.fn()}
        onBackToProject={vi.fn()}
        onRunAudit={onRunAudit}
        onViewLatestReport={vi.fn()}
        onViewHistoricalReport={vi.fn()}
      />,
    );

    const runBtn = screen.getByRole("button", { name: "Run Audit" });
    fireEvent.click(runBtn);

    // Shows in-progress feedback
    expect(screen.getByRole("status")).toBeTruthy();

    await waitFor(() => {
      expect(onRunAudit).toHaveBeenCalledTimes(1);
    });

    const key = onRunAudit.mock.calls[0][0];
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("preserves previous successful report when latest run in history failed", () => {
    const failedHistory: AuditHistoryItem[] = [
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
        monitoredPageId: samplePage.id,
        projectId: sampleProject.id,
        organizationId: sampleProject.organizationId,
        invocationType: "manual",
        status: "failed",
        targetUrl: "https://growth.app/pricing",
        finalUrl: null,
        overallScore: null,
        scoreConfidence: null,
        summary: null,
        auditReportId: null,
        startedAt: "2026-08-27T13:00:00.000Z",
        completedAt: null,
        failedAt: "2026-08-27T13:00:05.000Z",
        errorCode: "TIMEOUT",
        errorMessage: "Target server timed out.",
        retryable: true,
        modelVersion: "gemini-3.6-flash",
        checkVersion: "1.0.0",
        scoringVersion: "1.0.0",
        createdAt: "2026-08-27T13:00:00.000Z",
      },
      ...sampleHistory,
    ];

    render(
      <PageDetail
        project={sampleProject}
        page={samplePage}
        role="member"
        history={failedHistory}
        historyTotal={2}
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

    // Shows failure alert
    expect(screen.getByRole("alert").textContent).toMatch(/latest audit attempt failed/i);
    expect(screen.getByText(/target server timed out/i)).toBeTruthy();

    // Still renders button to view last successful audit!
    expect(screen.getByRole("button", { name: "View Last Successful Audit" })).toBeTruthy();
  });

  it("hides 'Run Audit' button for viewer role", () => {
    render(
      <PageDetail
        project={sampleProject}
        page={samplePage}
        role="viewer"
        history={sampleHistory}
        historyTotal={1}
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

    expect(screen.queryByRole("button", { name: "Run Audit" })).toBeNull();
    // But viewer can still view reports
    expect(screen.getByRole("button", { name: "View Latest Audit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View Report" })).toBeTruthy();
  });
});
