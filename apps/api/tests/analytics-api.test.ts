import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  CreatePageAnalyticsInput,
  MonitoredPage,
  PageAnalyticsSnapshot,
  Project,
  Role,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { AnalyticsStore } from "../src/analytics/analytics-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";

class InMemoryProjectsStore implements ProjectsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();

  async createProject(): Promise<any> {
    return null;
  }
  async listProjects(): Promise<any> {
    return [];
  }
  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const p = this.projects.get(projectId);
    if (!p || p.organizationId !== orgId) return null;
    return p;
  }
  async updateProject(): Promise<any> {
    return null;
  }
  async deleteProject(): Promise<any> {
    return true;
  }
  async checkMonitoredPageDuplicate(): Promise<any> {
    return false;
  }
  async createMonitoredPage(): Promise<any> {
    return null;
  }
  async listMonitoredPages(): Promise<any> {
    return [];
  }
  async getMonitoredPageById(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<MonitoredPage | null> {
    const page = this.pages.get(pageId);
    if (!page || page.projectId !== projectId || page.organizationId !== orgId) {
      return null;
    }
    return page;
  }
  async updateMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
    data: any,
  ): Promise<MonitoredPage | null> {
    const page = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!page) return null;
    const updated = { ...page, ...data };
    this.pages.set(pageId, updated);
    return updated;
  }
  async deleteMonitoredPage(): Promise<any> {
    return true;
  }
}

class InMemoryAnalyticsStore implements AnalyticsStore {
  snapshots: Map<string, PageAnalyticsSnapshot> = new Map();
  projectsStore: InMemoryProjectsStore;

  constructor(projectsStore: InMemoryProjectsStore) {
    this.projectsStore = projectsStore;
  }

  async getActiveSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<PageAnalyticsSnapshot | null> {
    const page = await this.projectsStore.getMonitoredPageById(orgId, projectId, pageId);
    if (!page) return null;

    if (page.latestAnalyticsSnapshotId) {
      const snap = this.snapshots.get(page.latestAnalyticsSnapshotId);
      if (snap && snap.organizationId === orgId && snap.monitoredPageId === pageId) {
        return snap;
      }
    }

    const matching = Array.from(this.snapshots.values())
      .filter(
        (s) =>
          s.organizationId === orgId &&
          s.projectId === projectId &&
          s.monitoredPageId === pageId &&
          s.isActive,
      )
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

    return matching[0] ?? null;
  }

  async listSnapshots(
    orgId: string,
    projectId: string,
    pageId: string,
    limit = 20,
  ): Promise<PageAnalyticsSnapshot[]> {
    const matching = Array.from(this.snapshots.values())
      .filter(
        (s) =>
          s.organizationId === orgId &&
          s.projectId === projectId &&
          s.monitoredPageId === pageId,
      )
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
      .slice(0, limit);

    return matching;
  }

  async createSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    input: CreatePageAnalyticsInput,
    userName?: string,
  ): Promise<PageAnalyticsSnapshot> {
    const page = await this.projectsStore.getMonitoredPageById(orgId, projectId, pageId);
    if (!page) throw new Error("Monitored page not found.");

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const snapshot: PageAnalyticsSnapshot = {
      id,
      organizationId: orgId,
      projectId,
      monitoredPageId: pageId,
      sourceType: input.sourceType ?? "manual",
      sourceProviderName: input.sourceProviderName ?? "Manual Entry",
      schemaVersion: "1.0.0",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      sessions: input.sessions ?? null,
      uniqueVisitors: input.uniqueVisitors ?? null,
      conversions: input.conversions ?? null,
      conversionRate: input.conversionRate ?? null,
      bounceRate: input.bounceRate ?? null,
      avgDurationSeconds: input.avgDurationSeconds ?? null,
      currency: input.currency ?? "USD",
      customMetrics: input.customMetrics ?? {},
      provenance: {
        label: "IMPORTED DATA",
        importedByUserId: userId,
        importedByUserName: userName ?? null,
        importedAt: now,
        notes: input.notes ?? null,
      },
      isActive: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    };

    this.snapshots.set(id, snapshot);
    await this.projectsStore.updateMonitoredPage(orgId, projectId, pageId, {
      latestAnalyticsSnapshotId: id,
    });

    return snapshot;
  }

  async deleteSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
    snapshotId: string,
  ): Promise<boolean> {
    const snap = this.snapshots.get(snapshotId);
    if (
      !snap ||
      snap.organizationId !== orgId ||
      snap.projectId !== projectId ||
      snap.monitoredPageId !== pageId
    ) {
      return false;
    }

    this.snapshots.delete(snapshotId);

    const page = await this.projectsStore.getMonitoredPageById(orgId, projectId, pageId);
    if (page?.latestAnalyticsSnapshotId === snapshotId) {
      const remaining = Array.from(this.snapshots.values())
        .filter(
          (s) =>
            s.organizationId === orgId &&
            s.projectId === projectId &&
            s.monitoredPageId === pageId &&
            s.isActive,
        )
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));

      await this.projectsStore.updateMonitoredPage(orgId, projectId, pageId, {
        latestAnalyticsSnapshotId: remaining[0]?.id ?? null,
      });
    }

    return true;
  }
}

describe("Page Analytics API Integration", () => {
  const orgAId = "11111111-1111-4111-8111-111111111111";
  const orgBId = "22222222-2222-4222-8222-222222222222";

  const userOwner = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "owner@acme.com",
    role: "owner" as Role,
    orgId: orgAId,
  };

  const userAdmin = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "admin@acme.com",
    role: "admin" as Role,
    orgId: orgAId,
  };

  const userMember = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    email: "member@acme.com",
    role: "member" as Role,
    orgId: orgAId,
  };

  const userViewer = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    email: "viewer@acme.com",
    role: "viewer" as Role,
    orgId: orgAId,
  };

  const userOrgB = {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    email: "user@othercorp.com",
    role: "owner" as Role,
    orgId: orgBId,
  };

  function createTestApp(
    analyticsStore: InMemoryAnalyticsStore,
    projectsStore: InMemoryProjectsStore,
  ) {
    return createApp({
      verifyToken: async (token: string) => {
        if (token === "token-owner") return { id: userOwner.id, email: userOwner.email };
        if (token === "token-admin") return { id: userAdmin.id, email: userAdmin.email };
        if (token === "token-member") return { id: userMember.id, email: userMember.email };
        if (token === "token-viewer") return { id: userViewer.id, email: userViewer.email };
        if (token === "token-org-b") return { id: userOrgB.id, email: userOrgB.email };
        return null;
      },
      resolveWorkspace: async (user) => {
        let role: Role = "viewer";
        let orgId = orgAId;
        if (user.id === userOwner.id) role = "owner";
        if (user.id === userAdmin.id) role = "admin";
        if (user.id === userMember.id) role = "member";
        if (user.id === userOrgB.id) {
          role = "owner";
          orgId = orgBId;
        }

        return {
          user: { id: user.id, email: user.email },
          profile: {
            id: user.id,
            email: user.email,
            fullName: user.email.split("@")[0],
            avatarUrl: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          organization: {
            id: orgId,
            name: orgId === orgAId ? "Acme Corp" : "Other Corp",
            slug: orgId === orgAId ? "acme" : "other",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          role,
          membership: {
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: user.id,
            role,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        };
      },
      getProjectsStore: () => projectsStore,
      getAnalyticsStore: () => analyticsStore,
    });
  }

  function setupFixture() {
    const projectsStore = new InMemoryProjectsStore();
    const analyticsStore = new InMemoryAnalyticsStore(projectsStore);

    const projectA: Project = {
      id: "a0000000-0000-4000-8000-000000000001",
      organizationId: orgAId,
      name: "Acme Landing Pages",
      domain: "acme.com",
      timezone: "UTC",
      goals: "Conversion optimization",
      createdBy: userOwner.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projectsStore.projects.set(projectA.id, projectA);

    const pageA: MonitoredPage = {
      id: "b0000000-0000-4000-8000-000000000001",
      projectId: projectA.id,
      organizationId: orgAId,
      canonicalUrl: "https://acme.com/pricing",
      cadence: "weekly",
      status: "active",
      tags: ["pricing"],
      latestAuditRunId: null,
      latestSuccessfulAuditRunId: null,
      latestAnalyticsSnapshotId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projectsStore.pages.set(pageA.id, pageA);

    return { projectsStore, analyticsStore, projectA, pageA };
  }

  it("GET /api/projects/:projectId/pages/:pageId/analytics returns empty state when no analytics exist", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const res = await request(app)
      .get(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-owner");

    expect(res.status).toBe(200);
    expect(res.body.current).toBeNull();
    expect(res.body.history).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("allows viewer role to read page analytics", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const res = await request(app)
      .get(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-viewer");

    expect(res.status).toBe(200);
  });

  it("POST /api/projects/:projectId/pages/:pageId/analytics creates snapshot with 'IMPORTED DATA' provenance", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const payload = {
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-08-31T23:59:59.000Z",
      sessions: 48000,
      uniqueVisitors: 41000,
      conversions: 1200,
      conversionRate: 2.5,
      bounceRate: 51.2,
      avgDurationSeconds: 135,
      notes: "Baseline 30-day performance",
    };

    const res = await request(app)
      .post(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-member")
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.analytics).toBeDefined();
    expect(res.body.analytics.sessions).toBe(48000);
    expect(res.body.analytics.conversionRate).toBe(2.5);
    expect(res.body.analytics.provenance.label).toBe("IMPORTED DATA");
    expect(res.body.analytics.provenance.importedByUserName).toBe("member");

    // Monitored page pointer updated
    const updatedPage = await projectsStore.getMonitoredPageById(orgAId, projectA.id, pageA.id);
    expect(updatedPage?.latestAnalyticsSnapshotId).toBe(res.body.analytics.id);

    // Subsequent GET returns active snapshot
    const getRes = await request(app)
      .get(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-owner");

    expect(getRes.status).toBe(200);
    expect(getRes.body.current.id).toBe(res.body.analytics.id);
    expect(getRes.body.history).toHaveLength(1);
  });

  it("blocks viewer role from importing analytics with 403 FORBIDDEN", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const res = await request(app)
      .post(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-viewer")
      .send({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T23:59:59.000Z",
        sessions: 10000,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("validates input and rejects invalid date ordering with 400 BAD_REQUEST", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const res = await request(app)
      .post(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-owner")
      .send({
        periodStart: "2026-09-01T00:00:00.000Z",
        periodEnd: "2026-08-01T00:00:00.000Z",
        sessions: 10000,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.message).toContain("Period start date must be before or equal to period end date");
  });

  it("validates input and rejects negative numbers with 400 BAD_REQUEST", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const res = await request(app)
      .post(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-admin")
      .send({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T23:59:59.000Z",
        sessions: -50,
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("enforces cross-tenant isolation and returns 404 for unowned pages", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    const res = await request(app)
      .get(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-org-b");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("DELETE /api/projects/:projectId/pages/:pageId/analytics/:snapshotId allows owner and admin to delete", async () => {
    const { analyticsStore, projectsStore, projectA, pageA } = setupFixture();
    const app = createTestApp(analyticsStore, projectsStore);

    // Create a snapshot
    const postRes = await request(app)
      .post(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics`)
      .set("Authorization", "Bearer token-owner")
      .send({
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-31T23:59:59.000Z",
        sessions: 15000,
      });

    const snapshotId = postRes.body.analytics.id;

    // Member delete is forbidden (403)
    const memberDelRes = await request(app)
      .delete(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics/${snapshotId}`)
      .set("Authorization", "Bearer token-member");
    expect(memberDelRes.status).toBe(403);

    // Admin delete succeeds (200)
    const adminDelRes = await request(app)
      .delete(`/api/projects/${projectA.id}/pages/${pageA.id}/analytics/${snapshotId}`)
      .set("Authorization", "Bearer token-admin");
    expect(adminDelRes.status).toBe(200);

    // Monitored page pointer cleared
    const updatedPage = await projectsStore.getMonitoredPageById(orgAId, projectA.id, pageA.id);
    expect(updatedPage?.latestAnalyticsSnapshotId).toBeNull();
  });
});
