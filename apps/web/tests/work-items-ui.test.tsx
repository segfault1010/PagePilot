// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MonitoredPage,
  OrganizationMember,
  Project,
  WorkItem,
  WorkItemActivity,
} from "@pagepilot/contracts";
import { WorkItemsBacklog } from "../src/features/work-items/components/work-items-backlog";
import { WorkItemDetailModal } from "../src/features/work-items/components/work-item-detail-modal";
import { CreateWorkItemModal } from "../src/features/work-items/components/create-work-item-modal";
import {
  createWorkItem,
  getWorkItem,
  listWorkItems,
  updateWorkItem,
  WorkItemsApiClientError,
} from "../src/features/work-items/api.js";

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
    getWorkItem: vi.fn(),
    createWorkItem: vi.fn(),
    updateWorkItem: vi.fn(),
    deleteWorkItem: vi.fn(),
    listOrganizationMembers: vi.fn(),
    WorkItemsApiClientError,
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
  latestAuditRunId: "run-101",
  latestSuccessfulAuditRunId: "run-101",
  createdAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

const sampleMembers: OrganizationMember[] = [
  {
    id: "mem-1",
    organizationId: sampleProject.organizationId,
    userId: "user-1",
    role: "owner",
    email: "owner@acme.com",
    fullName: "Alex Owner",
    avatarUrl: null,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  },
  {
    id: "mem-2",
    organizationId: sampleProject.organizationId,
    userId: "user-2",
    role: "member",
    email: "dev@acme.com",
    fullName: "Sam Engineer",
    avatarUrl: null,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  },
];

const sampleWorkItem: WorkItem = {
  id: "w-1",
  organizationId: sampleProject.organizationId,
  projectId: sampleProject.id,
  monitoredPageId: samplePage.id,
  auditRunId: "run-101",
  auditReportId: "rep-101",
  sourceType: "finding",
  findingId: "f-101",
  recommendationId: null,
  title: "Pricing tier comparison is missing feature checklist",
  description: "Users cannot compare Pro vs Enterprise features easily.",
  category: "clarity",
  severity: "high",
  status: "open",
  assigneeId: "user-2",
  notes: "Needs design review before implementation.",
  tags: ["pricing", "clarity"],
  resolutionRationale: null,
  resolvedAt: null,
  resolvedByUserId: null,
  createdByUserId: "user-1",
  lastModifiedByUserId: "user-1",
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

const sampleActivity: WorkItemActivity = {
  id: "act-1",
  workItemId: "w-1",
  organizationId: sampleProject.organizationId,
  projectId: sampleProject.id,
  actorUserId: "user-1",
  action: "created",
  fromStatus: null,
  toStatus: "open",
  details: { title: sampleWorkItem.title },
  createdAt: "2026-08-30T10:00:00.000Z",
};

describe("Collaboration UI Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("WorkItemsBacklog", () => {
    it("renders empty state 'Nothing needs attention yet.' when project has no work items", async () => {
      vi.mocked(listWorkItems).mockResolvedValue({
        workItems: [],
        total: 0,
      });

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={sampleMembers}
          role="owner"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Nothing needs attention yet.")).toBeTruthy();
      });
    });

    it("renders work items with status badges, severities, tags, and assignee", async () => {
      vi.mocked(listWorkItems).mockResolvedValue({
        workItems: [sampleWorkItem],
        total: 1,
      });

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={sampleMembers}
          role="owner"
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText("Pricing tier comparison is missing feature checklist"),
        ).toBeTruthy();
      });

      const card = screen.getByRole("article");
      expect(card).toBeTruthy();
      expect(card.textContent).toContain("Sam Engineer");
      expect(card.textContent).toContain("#pricing");
      expect(card.textContent).toContain("#clarity");
    });

    it("handles quick status transition (Start -> In Progress)", async () => {
      vi.mocked(listWorkItems).mockResolvedValue({
        workItems: [sampleWorkItem],
        total: 1,
      });

      vi.mocked(updateWorkItem).mockResolvedValue({
        workItem: { ...sampleWorkItem, status: "in_progress" },
      });

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={sampleMembers}
          role="owner"
        />,
      );

      await waitFor(() => {
        expect(screen.getByTitle("Set In Progress")).toBeTruthy();
      });

      fireEvent.click(screen.getByTitle("Set In Progress"));

      await waitFor(() => {
        expect(updateWorkItem).toHaveBeenCalledWith(
          sampleProject.id,
          sampleWorkItem.id,
          { status: "in_progress" },
        );
      });
    });

    it("disables mutation controls for viewer role", async () => {
      vi.mocked(listWorkItems).mockResolvedValue({
        workItems: [sampleWorkItem],
        total: 1,
      });

      render(
        <WorkItemsBacklog
          projects={[sampleProject]}
          selectedProjectId={sampleProject.id}
          onSelectProject={vi.fn()}
          pages={[samplePage]}
          members={sampleMembers}
          role="viewer"
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText("Pricing tier comparison is missing feature checklist"),
        ).toBeTruthy();
      });

      // Quick status buttons and Create button should not be present
      expect(screen.queryByTitle("Set In Progress")).toBeNull();
      expect(screen.queryByText("+ Create Work Item")).toBeNull();
    });
  });

  describe("WorkItemDetailModal", () => {
    it("renders full work item details, source link, and activity history", async () => {
      vi.mocked(getWorkItem).mockResolvedValue({
        workItem: sampleWorkItem,
        activities: [sampleActivity],
      });

      const onNavigateToPage = vi.fn();
      const onNavigateToReport = vi.fn();

      render(
        <WorkItemDetailModal
          projectId={sampleProject.id}
          workItemId={sampleWorkItem.id}
          initialWorkItem={sampleWorkItem}
          role="owner"
          members={sampleMembers}
          pages={[samplePage]}
          onClose={vi.fn()}
          onUpdated={vi.fn()}
          onDeleted={vi.fn()}
          onNavigateToPage={onNavigateToPage}
          onNavigateToReport={onNavigateToReport}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByRole("heading", {
            name: "Pricing tier comparison is missing feature checklist",
          }),
        ).toBeTruthy();
      });

      expect(
        screen.getByText("Users cannot compare Pro vs Enterprise features easily."),
      ).toBeTruthy();
      expect(
        screen.getByText("Needs design review before implementation."),
      ).toBeTruthy();
      expect(screen.getByText("Activity History")).toBeTruthy();
      expect(screen.getByText("Created work item")).toBeTruthy();

      // Test navigation links
      const pageLink = screen.getByText(`Page: ${samplePage.canonicalUrl}`);
      fireEvent.click(pageLink);
      expect(onNavigateToPage).toHaveBeenCalledWith(samplePage.id);
    });

    it("shows resolution rationale when status is changed to resolved and saves update", async () => {
      vi.mocked(getWorkItem).mockResolvedValue({
        workItem: sampleWorkItem,
        activities: [sampleActivity],
      });

      vi.mocked(updateWorkItem).mockResolvedValue({
        workItem: {
          ...sampleWorkItem,
          status: "resolved",
          resolutionRationale: "Added feature comparison matrix in PR #42",
        },
      });

      const onUpdated = vi.fn();

      render(
        <WorkItemDetailModal
          projectId={sampleProject.id}
          workItemId={sampleWorkItem.id}
          initialWorkItem={sampleWorkItem}
          role="owner"
          members={sampleMembers}
          pages={[samplePage]}
          onClose={vi.fn()}
          onUpdated={onUpdated}
          onDeleted={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText("Status")).toBeTruthy();
      });

      // Change status to resolved
      fireEvent.change(screen.getByLabelText("Status"), {
        target: { value: "resolved" },
      });

      // Resolution Rationale textarea should appear
      const rationaleInput = screen.getByLabelText("Resolution Rationale");
      expect(rationaleInput).toBeTruthy();
      fireEvent.change(rationaleInput, {
        target: { value: "Added feature comparison matrix in PR #42" },
      });

      // Click Save Changes
      fireEvent.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(updateWorkItem).toHaveBeenCalledWith(
          sampleProject.id,
          sampleWorkItem.id,
          expect.objectContaining({
            status: "resolved",
            resolutionRationale: "Added feature comparison matrix in PR #42",
          }),
        );
      });

      expect(onUpdated).toHaveBeenCalled();
    });

    it("enforces read-only behavior for viewer role", async () => {
      vi.mocked(getWorkItem).mockResolvedValue({
        workItem: sampleWorkItem,
        activities: [sampleActivity],
      });

      render(
        <WorkItemDetailModal
          projectId={sampleProject.id}
          workItemId={sampleWorkItem.id}
          initialWorkItem={sampleWorkItem}
          role="viewer"
          members={sampleMembers}
          pages={[samplePage]}
          onClose={vi.fn()}
          onUpdated={vi.fn()}
          onDeleted={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Read Only")).toBeTruthy();
      });

      expect((screen.getByLabelText("Status") as HTMLSelectElement).disabled).toBe(true);
      expect((screen.getByLabelText("Assignee") as HTMLSelectElement).disabled).toBe(true);
      expect((screen.getByLabelText("Team Collaboration Notes") as HTMLTextAreaElement).disabled).toBe(true);
      expect(screen.queryByText("Save Changes")).toBeNull();
      expect(screen.queryByText("Delete Work Item")).toBeNull();
    });
  });

  describe("CreateWorkItemModal", () => {
    it("submits new work item with prefilled finding data", async () => {
      vi.mocked(createWorkItem).mockResolvedValue({
        workItem: sampleWorkItem,
      });

      const onCreated = vi.fn();
      const onClose = vi.fn();

      render(
        <CreateWorkItemModal
          projectId={sampleProject.id}
          pages={[samplePage]}
          members={sampleMembers}
          prefillSource={{
            sourceType: "finding",
            findingId: "f-101",
            pageId: samplePage.id,
            title: "Pre-filled Finding Title",
            description: "Evidence snippet",
            category: "clarity",
            severity: "high",
          }}
          onClose={onClose}
          onCreated={onCreated}
        />,
      );

      expect(screen.getByDisplayValue("Pre-filled Finding Title")).toBeTruthy();

      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(createWorkItem).toHaveBeenCalledWith(
          sampleProject.id,
          expect.objectContaining({
            monitoredPageId: samplePage.id,
            sourceType: "finding",
            findingId: "f-101",
            title: "Pre-filled Finding Title",
            severity: "high",
          }),
        );
      });

      expect(onCreated).toHaveBeenCalledWith(sampleWorkItem);
      expect(onClose).toHaveBeenCalled();
    });

    it("handles 409 conflict gracefully with user-friendly error copy", async () => {
      vi.mocked(createWorkItem).mockRejectedValue(
        new WorkItemsApiClientError(
          409,
          "CONFLICT",
          "Duplicate work item",
        ),
      );

      render(
        <CreateWorkItemModal
          projectId={sampleProject.id}
          pages={[samplePage]}
          members={sampleMembers}
          prefillSource={{
            sourceType: "finding",
            findingId: "f-101",
            pageId: samplePage.id,
            title: "Duplicate Finding",
          }}
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />,
      );

      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(
          screen.getByText("That finding/recommendation already has a work item."),
        ).toBeTruthy();
      });
    });
  });
});
