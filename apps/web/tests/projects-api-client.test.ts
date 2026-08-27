import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMonitoredPage,
  createProject,
  deleteMonitoredPage,
  deleteProject,
  getMonitoredPage,
  getProject,
  listMonitoredPages,
  listProjects,
  ProjectApiClientError,
  updateMonitoredPage,
  updateProject,
} from "../src/features/projects/api.js";

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

describe("Web Projects API Client", () => {
  const sampleProject = {
    id: "a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    organizationId: "b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22",
    name: "Growth Pilot",
    domain: "growthpilot.io",
    timezone: "UTC",
    goals: "Improve funnel conversion",
    createdBy: "c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  const samplePage = {
    id: "d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
    projectId: sampleProject.id,
    organizationId: sampleProject.organizationId,
    canonicalUrl: "https://growthpilot.io/landing",
    cadence: "weekly",
    status: "active",
    ownerId: "c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33",
    tags: ["core"],
    latestAuditRunId: null,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("automatically attaches active session token and lists projects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ projects: [sampleProject], total: 1 }),
    });
    global.fetch = fetchMock;

    const res = await listProjects();
    expect(res.projects).toHaveLength(1);
    expect(res.projects[0].name).toBe("Growth Pilot");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );
    const sentHeaders: Headers = fetchMock.mock.calls[0][1].headers;
    expect(sentHeaders.get("Authorization")).toBe("Bearer auto-session-token");
  });

  it("creates a project and validates returned schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ project: sampleProject }),
    });
    global.fetch = fetchMock;

    const res = await createProject({
      name: "Growth Pilot",
      domain: "https://growthpilot.io",
    });

    expect(res.project.id).toBe(sampleProject.id);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Growth Pilot",
          domain: "https://growthpilot.io",
        }),
      }),
    );
  });

  it("gets and updates project", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ project: sampleProject }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          project: { ...sampleProject, name: "Updated Name" },
        }),
      });
    global.fetch = fetchMock;

    const getRes = await getProject(sampleProject.id);
    expect(getRes.project.name).toBe("Growth Pilot");

    const updateRes = await updateProject(sampleProject.id, { name: "Updated Name" });
    expect(updateRes.project.name).toBe("Updated Name");
  });

  it("deletes a project", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, deletedProjectId: sampleProject.id }),
    });
    global.fetch = fetchMock;

    const res = await deleteProject(sampleProject.id);
    expect(res.success).toBe(true);
    expect(res.deletedProjectId).toBe(sampleProject.id);
  });

  it("creates, gets, lists, updates, and deletes monitored pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ page: samplePage }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pages: [samplePage], total: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ page: samplePage }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          page: { ...samplePage, status: "paused" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, deletedPageId: samplePage.id }),
      });
    global.fetch = fetchMock;

    const created = await createMonitoredPage(sampleProject.id, {
      canonicalUrl: "https://growthpilot.io/landing",
    });
    expect(created.page.canonicalUrl).toBe("https://growthpilot.io/landing");

    const list = await listMonitoredPages(sampleProject.id);
    expect(list.pages).toHaveLength(1);

    const getPage = await getMonitoredPage(sampleProject.id, samplePage.id);
    expect(getPage.page.id).toBe(samplePage.id);

    const updated = await updateMonitoredPage(sampleProject.id, samplePage.id, {
      status: "paused",
    });
    expect(updated.page.status).toBe("paused");

    const deleted = await deleteMonitoredPage(sampleProject.id, samplePage.id);
    expect(deleted.success).toBe(true);
  });

  it("throws ProjectApiClientError with status and code on error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: "FORBIDDEN",
          message: "Insufficient permissions.",
          retryable: false,
        },
      }),
    });
    global.fetch = fetchMock;

    await expect(deleteProject(sampleProject.id)).rejects.toThrow(
      ProjectApiClientError,
    );
  });
});
