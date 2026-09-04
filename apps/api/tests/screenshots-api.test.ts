import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  AuditScreenshotMetadata,
  MonitoredPage,
  Project,
  Role,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { ScreenshotsStore } from "../src/screenshots/screenshots-store.js";
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
    pageId: string
  ): Promise<MonitoredPage | null> {
    const page = this.pages.get(pageId);
    if (!page || page.projectId !== projectId || page.organizationId !== orgId) {
      return null;
    }
    return page;
  }
  async updateMonitoredPage(): Promise<any> {
    return null;
  }
  async deleteMonitoredPage(): Promise<any> {
    return true;
  }
}

class InMemoryScreenshotsStore implements ScreenshotsStore {
  screenshots: Map<string, AuditScreenshotMetadata> = new Map();

  async listScreenshots(auditRunId: string): Promise<AuditScreenshotMetadata[]> {
    return Array.from(this.screenshots.values()).filter(
      (s) => s.auditRunId === auditRunId
    );
  }

  async uploadScreenshot(params: {
    storagePath: string;
    buffer: Buffer;
    mimeType: any;
  }): Promise<{ storagePath: string }> {
    return { storagePath: params.storagePath };
  }

  async persistScreenshotMetadata(
    metadata: Omit<AuditScreenshotMetadata, "id" | "createdAt" | "signedUrl">
  ): Promise<AuditScreenshotMetadata> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entry: AuditScreenshotMetadata = {
      ...metadata,
      id,
      createdAt: now,
    };
    this.screenshots.set(id, entry);
    return entry;
  }

  async createSignedUrl(
    storagePath: string,
    _expiresInSeconds = 900
  ): Promise<string> {
    return `https://example.supabase.co/storage/v1/object/sign/audit-screenshots/${storagePath}?token=mock-signed-token`;
  }

  async getScreenshotsForAuditRun(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
    generateSignedUrls?: boolean;
  }): Promise<AuditScreenshotMetadata[]> {
    const matching = Array.from(this.screenshots.values()).filter(
      (s) =>
        s.organizationId === params.organizationId &&
        s.projectId === params.projectId &&
        s.monitoredPageId === params.pageId &&
        s.auditRunId === params.auditRunId
    );

    if (params.generateSignedUrls === false) {
      return matching;
    }

    return matching.map((s) => ({
      ...s,
      signedUrl: `https://example.supabase.co/storage/v1/object/sign/audit-screenshots/${s.storagePath}?token=mock-signed-token`,
    }));
  }
}

describe("Screenshots API Integration", () => {
  const orgAId = "11111111-1111-4111-8111-111111111111";
  const orgBId = "22222222-2222-4222-8222-222222222222";

  const userOwner = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "owner@acme.com",
    role: "owner" as Role,
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
    email: "user@competitor.com",
    role: "owner" as Role,
    orgId: orgBId,
  };

  const projectAId = "33333333-3333-4333-8333-333333333333";
  const pageAId = "44444444-4444-4444-8444-444444444444";
  const runAId = "55555555-5555-4555-8555-555555555555";

  function setupHarness() {
    const projectsStore = new InMemoryProjectsStore();
    const screenshotsStore = new InMemoryScreenshotsStore();

    projectsStore.projects.set(projectAId, {
      id: projectAId,
      organizationId: orgAId,
      name: "Acme Main App",
      domain: "example.com",
      timezone: "UTC",
      createdAt: "2026-09-06T00:00:00Z",
      updatedAt: "2026-09-06T00:00:00Z",
    });

    projectsStore.pages.set(pageAId, {
      id: pageAId,
      projectId: projectAId,
      organizationId: orgAId,
      canonicalUrl: "https://example.com",
      cadence: "weekly",
      status: "active",
      tags: ["landing"],
      createdAt: "2026-09-06T00:00:00Z",
      updatedAt: "2026-09-06T00:00:00Z",
    });

    const verifyToken = async (token: string) => {
      if (token === "token-owner") return { id: userOwner.id, email: userOwner.email };
      if (token === "token-viewer") return { id: userViewer.id, email: userViewer.email };
      if (token === "token-org-b") return { id: userOrgB.id, email: userOrgB.email };
      return null;
    };

    const resolveWorkspace = async (user: any) => {
      let role: Role = "viewer";
      let orgId = orgAId;
      if (user.id === userOwner.id) role = "owner";
      if (user.id === userViewer.id) role = "viewer";
      if (user.id === userOrgB.id) {
        role = "owner";
        orgId = orgBId;
      }

      const now = new Date().toISOString();
      return {
        user: { id: user.id, email: user.email },
        profile: {
          id: user.id,
          email: user.email,
          fullName: user.email.split("@")[0],
          avatarUrl: null,
          createdAt: now,
          updatedAt: now,
        },
        organization: {
          id: orgId,
          name: orgId === orgAId ? "Acme Corp" : "Beta Corp",
          slug: orgId === orgAId ? "acme" : "beta",
          createdAt: now,
          updatedAt: now,
        },
        role,
        membership: {
          id: "mem-1",
          organizationId: orgId,
          userId: user.id,
          role,
          createdAt: now,
          updatedAt: now,
        },
      };
    };

    const app = createApp({
      verifyToken,
      resolveWorkspace,
      getProjectsStore: () => projectsStore,
      getScreenshotsStore: () => screenshotsStore,
    });

    return { app, projectsStore, screenshotsStore };
  }

  it("returns 401 UNAUTHENTICATED when authorization header is missing", async () => {
    const { app } = setupHarness();
    const res = await request(app).get(
      `/api/projects/${projectAId}/pages/${pageAId}/audits/${runAId}/screenshots`
    );

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 404 NOT_FOUND for cross-tenant request from Org B", async () => {
    const { app } = setupHarness();
    const res = await request(app)
      .get(`/api/projects/${projectAId}/pages/${pageAId}/audits/${runAId}/screenshots`)
      .set("Authorization", "Bearer token-org-b");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns 200 with empty screenshots array when none exist", async () => {
    const { app } = setupHarness();
    const res = await request(app)
      .get(`/api/projects/${projectAId}/pages/${pageAId}/audits/${runAId}/screenshots`)
      .set("Authorization", "Bearer token-owner");

    expect(res.status).toBe(200);
    expect(res.body.screenshots).toEqual([]);
  });

  it("returns 200 with signed URLs for authorized member (including viewer role)", async () => {
    const { app, screenshotsStore } = setupHarness();

    await screenshotsStore.persistScreenshotMetadata({
      organizationId: orgAId,
      projectId: projectAId,
      monitoredPageId: pageAId,
      auditRunId: runAId,
      deviceType: "desktop",
      captureType: "viewport",
      storagePath: "orgs/111/desktop.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 125000,
      mimeType: "image/webp",
      width: 1280,
      height: 800,
      capturedAt: "2026-09-06T12:00:00Z",
    });

    await screenshotsStore.persistScreenshotMetadata({
      organizationId: orgAId,
      projectId: projectAId,
      monitoredPageId: pageAId,
      auditRunId: runAId,
      deviceType: "mobile",
      captureType: "viewport",
      storagePath: "orgs/111/mobile.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 75000,
      mimeType: "image/webp",
      width: 375,
      height: 812,
      capturedAt: "2026-09-06T12:00:00Z",
    });

    // Request as viewer
    const res = await request(app)
      .get(`/api/projects/${projectAId}/pages/${pageAId}/audits/${runAId}/screenshots`)
      .set("Authorization", "Bearer token-viewer");

    expect(res.status).toBe(200);
    expect(res.body.screenshots).toHaveLength(2);

    const desktop = res.body.screenshots.find(
      (s: any) => s.deviceType === "desktop"
    );
    const mobile = res.body.screenshots.find(
      (s: any) => s.deviceType === "mobile"
    );

    expect(desktop).toBeDefined();
    expect(desktop.width).toBe(1280);
    expect(desktop.height).toBe(800);
    expect(desktop.signedUrl).toContain("https://example.supabase.co");
    expect(desktop.signedUrl).toContain("token=mock-signed-token");

    expect(mobile).toBeDefined();
    expect(mobile.width).toBe(375);
    expect(mobile.height).toBe(812);
    expect(mobile.signedUrl).toContain("token=mock-signed-token");
  });
});
