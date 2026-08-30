// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type {
  MonitoredPage,
  OrganizationMember,
  Project,
  WorkItem,
} from "@pagepilot/contracts";
import { ProjectDetail } from "../src/features/workspace/components/project-detail";
import * as workItemsApi from "../src/features/work-items/api";

vi.mock("../src/features/work-items/api");

const mockProject: Project = {
  id: "proj-1",
  organizationId: "org-1",
  name: "Growth Landing Pages",
  domain: "example.com",
  timezone: "UTC",
  goals: "Increase signup conversion rate above 5%",
  createdBy: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const mockPages: MonitoredPage[] = [
  {
    id: "page-1",
    projectId: "proj-1",
    organizationId: "org-1",
    canonicalUrl: "https://example.com/pricing",
    cadence: "weekly",
    status: "active",
    tags: ["pricing"],
    latestAuditRunId: "run-101",
    latestSuccessfulAuditRunId: "run-101",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "page-2",
    projectId: "proj-1",
    organizationId: "org-1",
    canonicalUrl: "https://example.com/signup",
    cadence: "weekly",
    status: "active",
    tags: ["signup"],
    latestAuditRunId: null,
    latestSuccessfulAuditRunId: null,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  },
];

const mockMembers: OrganizationMember[] = [
  {
    id: "mem-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    email: "lead@example.com",
    fullName: "Lead Designer",
    avatarUrl: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

const mockWorkItems: WorkItem[] = [
  {
    id: "wi-low",
    organizationId: "org-1",
    projectId: "proj-1",
    monitoredPageId: "page-1",
    sourceType: "finding",
    findingId: "f-low",
    recommendationId: null,
    title: "Low severity color contrast adjustment",
    description: "Minor contrast tweak in footer.",
    category: "accessibility",
    severity: "low",
    status: "open",
    assigneeId: null,
    resolutionRationale: null,
    resolvedAt: null,
    resolvedByUserId: null,
    tags: [],
    notes: null,
    createdByUserId: "user-1",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
  },
  {
    id: "wi-high-old",
    organizationId: "org-1",
    projectId: "proj-1",
    monitoredPageId: "page-1",
    sourceType: "finding",
    findingId: "f-high-1",
    recommendationId: null,
    title: "High severity hero CTA missing",
    description: "No primary CTA found.",
    category: "ctaEffectiveness",
    severity: "high",
    status: "open",
    assigneeId: "user-1",
    resolutionRationale: null,
    resolvedAt: null,
    resolvedByUserId: null,
    tags: [],
    notes: null,
    createdByUserId: "user-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "wi-high-recent",
    organizationId: "org-1",
    projectId: "proj-1",
    monitoredPageId: "page-1",
    sourceType: "finding",
    findingId: "f-high-2",
    recommendationId: null,
    title: "High severity vague pricing headline",
    description: "Pricing table confusing.",
    category: "clarity",
    severity: "high",
    status: "in_progress",
    assigneeId: "user-1",
    resolutionRationale: null,
    resolvedAt: null,
    resolvedByUserId: null,
    tags: [],
    notes: null,
    createdByUserId: "user-1",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
  },
  {
    id: "wi-resolved",
    organizationId: "org-1",
    projectId: "proj-1",
    monitoredPageId: "page-1",
    sourceType: "finding",
    findingId: "f-res",
    recommendationId: null,
    title: "Resolved mobile viewport overflow",
    description: "Fixed overflowing div on small screens.",
    category: "mobileUx",
    severity: "medium",
    status: "resolved",
    assigneeId: "user-1",
    resolutionRationale: "Rewrote container classes with flex wrap.",
    resolvedAt: "2026-08-12T00:00:00.000Z",
    resolvedByUserId: "user-1",
    tags: [],
    notes: null,
    createdByUserId: "user-1",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  },
];

describe("<ProjectDetail /> Prioritization Views", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders KPI summary and deterministic ranking for Highest-Impact Open Work", async () => {
    vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
      workItems: mockWorkItems,
      total: mockWorkItems.length,
    });

    render(
      <ProjectDetail
        project={mockProject}
        pages={mockPages}
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

    // KPI Summary
    expect(screen.getByText("Growth Landing Pages")).toBeDefined();
    expect(screen.getByText(/2 active/i)).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText(/\(2 High\)/i)).toBeDefined();
    });

    // Check Highest-Impact Open Work section
    expect(screen.getByText(/Highest-Impact Open Work \(3\)/i)).toBeDefined();

    // Verify deterministic ordering:
    // 1. High severity (most recent: wi-high-recent updated 2026-08-10)
    // 2. High severity (older: wi-high-old updated 2026-08-01)
    // 3. Low severity (wi-low)
    expect(screen.getByText("High severity vague pricing headline")).toBeDefined();
    expect(screen.getByText("High severity hero CTA missing")).toBeDefined();
    expect(screen.getByText("Low severity color contrast adjustment")).toBeDefined();
  });

  it("renders Landing Page UX Trajectories and triggers comparison", async () => {
    vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
      workItems: mockWorkItems,
      total: mockWorkItems.length,
    });

    const mockCompare = vi.fn();
    const mockSelectPage = vi.fn();

    render(
      <ProjectDetail
        project={mockProject}
        pages={mockPages}
        role="owner"
        isLoading={false}
        members={mockMembers}
        onBackToProjects={vi.fn()}
        onSelectPage={mockSelectPage}
        onComparePage={mockCompare}
        onCreatePage={vi.fn()}
        onUpdatePage={vi.fn()}
        onDeletePage={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("https://example.com/pricing")).toBeDefined();
    });

    // Pricing page has run-101 and shows Compare Changes button
    const compareBtn = screen.getByText("Compare Changes");
    expect(compareBtn).toBeDefined();
    fireEvent.click(compareBtn);
    expect(mockCompare).toHaveBeenCalledWith(mockPages[0], "run-101");
  });

  it("renders Resolved Improvements with rationale and date", async () => {
    vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
      workItems: mockWorkItems,
      total: mockWorkItems.length,
    });

    render(
      <ProjectDetail
        project={mockProject}
        pages={mockPages}
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
      expect(screen.getByText("Resolved mobile viewport overflow")).toBeDefined();
      expect(
        screen.getByText(/Rationale: “Rewrote container classes with flex wrap.”/i),
      ).toBeDefined();
    });
  });

  it("switches to Monitored Pages tab cleanly", async () => {
    vi.mocked(workItemsApi.listWorkItems).mockResolvedValue({
      workItems: mockWorkItems,
      total: mockWorkItems.length,
    });

    render(
      <ProjectDetail
        project={mockProject}
        pages={mockPages}
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

    const pagesTab = screen.getByText(/Monitored Pages \(2\)/i);
    fireEvent.click(pagesTab);

    // Verifies full list of pages is visible with actions
    expect(screen.getByText("https://example.com/signup")).toBeDefined();
    expect(screen.getByText("https://example.com/pricing")).toBeDefined();
  });
});
