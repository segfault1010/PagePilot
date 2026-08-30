import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkItem,
  deleteWorkItem,
  getWorkItem,
  listOrganizationMembers,
  listWorkItems,
  updateWorkItem,
  WorkItemsApiClientError,
} from "../src/features/work-items/api.js";

// Mock Supabase client
vi.mock("../src/features/auth/supabase-client.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: "auto-session-token",
          },
        },
      }),
    },
  })),
}));

describe("Web Work Items API Client", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const workItemId = "22222222-2222-4222-8222-222222222222";
  const orgId = "33333333-3333-4333-8333-333333333333";
  const pageId = "44444444-4444-4444-8444-444444444444";

  const sampleWorkItem = {
    id: workItemId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    auditRunId: null,
    auditReportId: null,
    sourceType: "finding",
    findingId: "55555555-5555-4555-8555-555555555555",
    recommendationId: null,
    title: "Hero value proposition is unclear",
    description: "No subheadline explaining the core SaaS benefit.",
    category: "clarity",
    severity: "high",
    status: "open",
    assigneeId: null,
    notes: "Assigned to marketing sprint",
    tags: ["hero", "copy"],
    resolutionRationale: null,
    resolvedAt: null,
    resolvedByUserId: null,
    createdByUserId: "66666666-6666-4666-8666-666666666666",
    lastModifiedByUserId: "66666666-6666-4666-8666-666666666666",
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
  };

  const sampleActivity = {
    id: "77777777-7777-4777-8777-777777777777",
    workItemId,
    organizationId: orgId,
    projectId,
    actorUserId: "66666666-6666-4666-8666-666666666666",
    action: "created",
    fromStatus: null,
    toStatus: "open",
    details: { title: sampleWorkItem.title },
    createdAt: "2026-08-30T10:00:00.000Z",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists work items with query parameters and parses schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workItems: [sampleWorkItem],
        total: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await listWorkItems(projectId, {
      status: "open",
      severity: "high",
      limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain(`/api/projects/${projectId}/work-items?`);
    expect(calledUrl).toContain("status=open");
    expect(calledUrl).toContain("severity=high");
    expect(calledUrl).toContain("limit=10");

    const authHeader = fetchMock.mock.calls[0][1].headers.get("Authorization");
    expect(authHeader).toBe("Bearer auto-session-token");

    expect(res.workItems).toHaveLength(1);
    expect(res.workItems[0].title).toBe("Hero value proposition is unclear");
    expect(res.total).toBe(1);
  });

  it("fetches single work item with activity trail", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workItem: sampleWorkItem,
        activities: [sampleActivity],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getWorkItem(projectId, workItemId);
    expect(res.workItem.id).toBe(workItemId);
    expect(res.activities).toHaveLength(1);
    expect(res.activities![0].action).toBe("created");
  });

  it("creates a work item successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workItem: sampleWorkItem,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createWorkItem(projectId, {
      monitoredPageId: pageId,
      sourceType: "finding",
      title: "Hero value proposition is unclear",
      severity: "high",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/work-items`,
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(res.workItem.title).toBe(sampleWorkItem.title);
  });

  it("updates a work item successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workItem: { ...sampleWorkItem, status: "in_progress" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await updateWorkItem(projectId, workItemId, {
      status: "in_progress",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/work-items/${workItemId}`,
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(res.workItem.status).toBe("in_progress");
  });

  it("deletes a work item successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        deletedWorkItemId: workItemId,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteWorkItem(projectId, workItemId);
    expect(res.success).toBe(true);
    expect(res.deletedWorkItemId).toBe(workItemId);
  });

  it("lists workspace organization members", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        members: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            organizationId: orgId,
            userId: "99999999-9999-4999-8999-999999999999",
            role: "owner",
            email: "alice@growthpilot.io",
            fullName: "Alice Founder",
            avatarUrl: null,
            createdAt: "2026-08-25T00:00:00.000Z",
            updatedAt: "2026-08-25T00:00:00.000Z",
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await listOrganizationMembers();
    expect(res.members).toHaveLength(1);
    expect(res.members[0].email).toBe("alice@growthpilot.io");
    expect(res.members[0].role).toBe("owner");
  });

  it("throws typed WorkItemsApiClientError on 409 conflict and 403 forbidden", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: {
          code: "DUPLICATE_WORK_ITEM",
          message: "A work item already exists for this finding.",
          retryable: false,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWorkItem(projectId, {
        monitoredPageId: pageId,
        sourceType: "finding",
        title: "Duplicate finding",
      }),
    ).rejects.toThrow(WorkItemsApiClientError);
  });
});
