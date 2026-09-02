import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  CreateMonitoredPageInput,
  CreateProjectInput,
  MonitoredPage,
  Project,
  Role,
  UpdateMonitoredPageInput,
  UpdateProjectInput,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import {
  DuplicateResourceError,
  rowToMonitoredPage,
  rowToProject,
} from "../src/projects/projects-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";

/**
 * In-memory test store implementing the full ProjectsStore contract
 * for deterministic, ultra-fast API and authorization testing.
 */
class InMemoryProjectsStore implements ProjectsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();
  private counter = 0;

  private nextTimestamp(): string {
    this.counter += 1;
    return new Date(Date.now() + this.counter * 1000).toISOString();
  }

  async createProject(
    orgId: string,
    userId: string,
    data: CreateProjectInput,
  ): Promise<Project> {
    const id = crypto.randomUUID();
    const now = this.nextTimestamp();
    const project: Project = {
      id,
      organizationId: orgId,
      name: data.name,
      domain: data.domain ?? null,
      timezone: data.timezone ?? "UTC",
      goals: data.goals ?? null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(id, project);
    return project;
  }

  async listProjects(orgId: string): Promise<Project[]> {
    return Array.from(this.projects.values())
      .filter((p) => p.organizationId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project || project.organizationId !== orgId) return null;
    return project;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    data: UpdateProjectInput,
  ): Promise<Project | null> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return null;

    const updated: Project = {
      ...project,
      name: data.name ?? project.name,
      domain: data.domain !== undefined ? data.domain : project.domain,
      timezone: data.timezone ?? project.timezone,
      goals: data.goals !== undefined ? data.goals : project.goals,
      updatedAt: new Date().toISOString(),
    };
    this.projects.set(projectId, updated);
    return updated;
  }

  async deleteProject(orgId: string, projectId: string): Promise<boolean> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return false;

    this.projects.delete(projectId);
    // Cascade delete monitored pages
    for (const [pageId, page] of this.pages.entries()) {
      if (page.projectId === projectId) {
        this.pages.delete(pageId);
      }
    }
    return true;
  }

  async checkMonitoredPageDuplicate(
    projectId: string,
    canonicalUrl: string,
    excludePageId?: string,
  ): Promise<boolean> {
    return Array.from(this.pages.values()).some(
      (p) =>
        p.projectId === projectId &&
        p.canonicalUrl === canonicalUrl &&
        p.id !== excludePageId,
    );
  }

  async createMonitoredPage(
    orgId: string,
    projectId: string,
    userId: string,
    data: CreateMonitoredPageInput,
  ): Promise<MonitoredPage> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) {
      throw new Error("Project not found.");
    }

    if (await this.checkMonitoredPageDuplicate(projectId, data.canonicalUrl)) {
      throw new DuplicateResourceError(
        "This URL is already monitored in this project.",
      );
    }

    const id = crypto.randomUUID();
    const now = this.nextTimestamp();
    const page: MonitoredPage = {
      id,
      projectId,
      organizationId: orgId,
      canonicalUrl: data.canonicalUrl,
      cadence: data.cadence ?? "weekly",
      status: data.status ?? "active",
      ownerId: userId,
      tags: data.tags ?? [],
      latestAuditRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.pages.set(id, page);
    return page;
  }

  async listMonitoredPages(orgId: string, projectId: string): Promise<MonitoredPage[]> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return [];

    return Array.from(this.pages.values())
      .filter((p) => p.organizationId === orgId && p.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getMonitoredPageById(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<MonitoredPage | null> {
    const page = this.pages.get(pageId);
    if (!page || page.organizationId !== orgId || page.projectId !== projectId) {
      return null;
    }
    return page;
  }

  async updateMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
    data: UpdateMonitoredPageInput,
  ): Promise<MonitoredPage | null> {
    const page = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!page) return null;

    if (
      data.canonicalUrl &&
      data.canonicalUrl !== page.canonicalUrl &&
      (await this.checkMonitoredPageDuplicate(projectId, data.canonicalUrl, pageId))
    ) {
      throw new DuplicateResourceError(
        "This URL is already monitored in this project.",
      );
    }

    const updated: MonitoredPage = {
      ...page,
      canonicalUrl: data.canonicalUrl ?? page.canonicalUrl,
      cadence: data.cadence ?? page.cadence,
      status: data.status ?? page.status,
      tags: data.tags ?? page.tags,
      ownerId: data.ownerId !== undefined ? data.ownerId : page.ownerId,
      updatedAt: new Date().toISOString(),
    };
    this.pages.set(pageId, updated);
    return updated;
  }

  async deleteMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<boolean> {
    const page = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!page) return false;
    this.pages.delete(pageId);
    return true;
  }
}

describe("Projects & Monitored Pages API Integration", () => {
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

  function createTestApp(store: InMemoryProjectsStore) {
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
        if (user.id === userOwner.id) {
          role = "owner";
          orgId = orgAId;
        } else if (user.id === userAdmin.id) {
          role = "admin";
          orgId = orgAId;
        } else if (user.id === userMember.id) {
          role = "member";
          orgId = orgAId;
        } else if (user.id === userViewer.id) {
          role = "viewer";
          orgId = orgAId;
        } else if (user.id === userOrgB.id) {
          role = "owner";
          orgId = orgBId;
        }

        return {
          user: { id: user.id, email: user.email },
          profile: null,
          organization: {
            id: orgId,
            name: orgId === orgAId ? "Acme Org" : "OtherCorp",
            slug: orgId === orgAId ? "acme-org" : "other-corp",
            createdBy: user.id,
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          membership: {
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: user.id,
            role,
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          role,
        };
      },
      getProjectsStore: () => store,
    });
  }

  // -------------------------------------------------------------------------
  // 1. Projects CRUD
  // -------------------------------------------------------------------------
  describe("Project CRUD & Validation", () => {
    it("creates a new project for authorized owner and normalizes domain", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const res = await request(app)
        .post("/api/projects")
        .set("Authorization", "Bearer token-owner")
        .send({
          name: "Main Growth Site",
          domain: "https://ACME.com/landing?ref=1",
          timezone: "America/Chicago",
          goals: "Improve free trial conversions",
        });

      expect(res.status).toBe(201);
      expect(res.body.project).toBeDefined();
      expect(res.body.project.name).toBe("Main Growth Site");
      expect(res.body.project.domain).toBe("acme.com");
      expect(res.body.project.timezone).toBe("America/Chicago");
      expect(res.body.project.organizationId).toBe(orgAId);
    });

    it("rejects project creation with invalid or empty name", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const res = await request(app)
        .post("/api/projects")
        .set("Authorization", "Bearer token-owner")
        .send({
          name: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toBe("Project name is required.");
    });

    it("lists projects belonging to the verified organization", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      // Create project in Org A
      await store.createProject(orgAId, userOwner.id, { name: "Org A Project 1" });
      await store.createProject(orgAId, userOwner.id, { name: "Org A Project 2" });
      // Create project in Org B
      await store.createProject(orgBId, userOrgB.id, { name: "Org B Secret Project" });

      const res = await request(app)
        .get("/api/projects")
        .set("Authorization", "Bearer token-owner");

      expect(res.status).toBe(200);
      expect(res.body.projects).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.projects.map((p: any) => p.name)).toEqual([
        "Org A Project 2",
        "Org A Project 1",
      ]);
    });

    it("retrieves a project by ID", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, {
        name: "Retrieve Project",
        domain: "retrieve.com",
      });

      const res = await request(app)
        .get(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-owner");

      expect(res.status).toBe(200);
      expect(res.body.project.id).toBe(project.id);
      expect(res.body.project.name).toBe("Retrieve Project");
    });

    it("updates project fields and normalizes updated domain", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, {
        name: "Initial Name",
        domain: "initial.com",
      });

      const res = await request(app)
        .patch(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-owner")
        .send({
          name: "Updated Name",
          domain: "https://NEW-DOMAIN.COM/path",
        });

      expect(res.status).toBe(200);
      expect(res.body.project.name).toBe("Updated Name");
      expect(res.body.project.domain).toBe("new-domain.com");
    });

    it("allows owner and admin to delete a project", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const p1 = await store.createProject(orgAId, userOwner.id, { name: "To Delete 1" });
      const p2 = await store.createProject(orgAId, userOwner.id, { name: "To Delete 2" });

      // Owner deletes p1
      const res1 = await request(app)
        .delete(`/api/projects/${p1.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(res1.status).toBe(200);
      expect(res1.body.success).toBe(true);

      // Admin deletes p2
      const res2 = await request(app)
        .delete(`/api/projects/${p2.id}`)
        .set("Authorization", "Bearer token-admin");
      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Monitored Pages CRUD
  // -------------------------------------------------------------------------
  describe("Monitored Pages CRUD & URL Policy Validation", () => {
    it("creates a monitored page with valid URL and tags", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "App Project" });

      const res = await request(app)
        .post(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-owner")
        .send({
          canonicalUrl: "https://example.com/signup",
          cadence: "weekly",
          tags: ["core-funnel", "landing-v2"],
        });

      expect(res.status).toBe(201);
      expect(res.body.page).toBeDefined();
      expect(res.body.page.canonicalUrl).toBe("https://example.com/signup");
      expect(res.body.page.status).toBe("active");
      expect(res.body.page.tags).toEqual(["core-funnel", "landing-v2"]);
      expect(res.body.page.projectId).toBe(project.id);
      expect(res.body.page.organizationId).toBe(orgAId);
    });

    it("rejects invalid URLs according to shared URL policy", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "App Project" });

      const res = await request(app)
        .post(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-owner")
        .send({
          canonicalUrl: "ftp://example.com",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Only http:// and https:// URLs are supported.");
    });

    it("rejects duplicate monitored page registration within the same project with 409 CONFLICT", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "App Project" });

      await request(app)
        .post(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-owner")
        .send({ canonicalUrl: "https://example.com/pricing" });

      const res = await request(app)
        .post(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-owner")
        .send({ canonicalUrl: "https://example.com/pricing" });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.message).toBe("This URL is already monitored in this project.");
    });

    it("lists, gets, updates, and deletes monitored pages", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "App Project" });
      const page = await store.createMonitoredPage(orgAId, project.id, userOwner.id, {
        canonicalUrl: "https://example.com/home",
      });

      // List
      const listRes = await request(app)
        .get(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-owner");
      expect(listRes.status).toBe(200);
      expect(listRes.body.pages).toHaveLength(1);

      // Get
      const getRes = await request(app)
        .get(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(getRes.status).toBe(200);
      expect(getRes.body.page.id).toBe(page.id);

      // Update
      const patchRes = await request(app)
        .patch(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-owner")
        .send({ status: "paused" });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.page.status).toBe("paused");

      // Delete
      const delRes = await request(app)
        .delete(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);

      // Verify deletion
      const verifyRes = await request(app)
        .get(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(verifyRes.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Authentication Enforcement
  // -------------------------------------------------------------------------
  describe("Authentication Enforcement", () => {
    it("returns 401 UNAUTHENTICATED when Authorization header is missing", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const res = await request(app).get("/api/projects");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 401 UNAUTHENTICATED when token is invalid", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const res = await request(app)
        .get("/api/projects")
        .set("Authorization", "Bearer invalid-token");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("does not disrupt anonymous POST /api/analyze", async () => {
      const store = new InMemoryProjectsStore();
      const app = createApp({
        analyzeUrl: async () => ({
          ok: true,
          status: 200,
          report: {} as any,
        }),
        getProjectsStore: () => store,
      });

      const res = await request(app)
        .post("/api/analyze")
        .send({ url: "https://example.com" });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("report");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Role Authorization Matrix
  // -------------------------------------------------------------------------
  describe("Role Authorization Matrix", () => {
    it("allows viewers to read projects and pages", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "Project For Viewer" });
      const page = await store.createMonitoredPage(orgAId, project.id, userOwner.id, {
        canonicalUrl: "https://example.com/viewer-view",
      });

      const resProjList = await request(app)
        .get("/api/projects")
        .set("Authorization", "Bearer token-viewer");
      expect(resProjList.status).toBe(200);

      const resProj = await request(app)
        .get(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-viewer");
      expect(resProj.status).toBe(200);

      const resPageList = await request(app)
        .get(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-viewer");
      expect(resPageList.status).toBe(200);

      const resPage = await request(app)
        .get(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-viewer");
      expect(resPage.status).toBe(200);
    });

    it("denies all mutations for viewers with 403 FORBIDDEN", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "Test Project" });
      const page = await store.createMonitoredPage(orgAId, project.id, userOwner.id, {
        canonicalUrl: "https://example.com/page",
      });

      // POST project
      const postProj = await request(app)
        .post("/api/projects")
        .set("Authorization", "Bearer token-viewer")
        .send({ name: "Viewer Proj" });
      expect(postProj.status).toBe(403);
      expect(postProj.body.error.code).toBe("FORBIDDEN");

      // PATCH project
      const patchProj = await request(app)
        .patch(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-viewer")
        .send({ name: "Mutated" });
      expect(patchProj.status).toBe(403);

      // DELETE project
      const delProj = await request(app)
        .delete(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-viewer");
      expect(delProj.status).toBe(403);

      // POST page
      const postPage = await request(app)
        .post(`/api/projects/${project.id}/pages`)
        .set("Authorization", "Bearer token-viewer")
        .send({ canonicalUrl: "https://example.com/new" });
      expect(postPage.status).toBe(403);

      // PATCH page
      const patchPage = await request(app)
        .patch(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-viewer")
        .send({ status: "paused" });
      expect(patchPage.status).toBe(403);

      // DELETE page
      const delPage = await request(app)
        .delete(`/api/projects/${project.id}/pages/${page.id}`)
        .set("Authorization", "Bearer token-viewer");
      expect(delPage.status).toBe(403);
    });

    it("allows member to create/update projects and manage pages, but DENIES project deletion with 403", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      // Member creates project -> 201
      const createRes = await request(app)
        .post("/api/projects")
        .set("Authorization", "Bearer token-member")
        .send({ name: "Member Project" });
      expect(createRes.status).toBe(201);
      const projectId = createRes.body.project.id;

      // Member updates project -> 200
      const patchRes = await request(app)
        .patch(`/api/projects/${projectId}`)
        .set("Authorization", "Bearer token-member")
        .send({ name: "Updated Member Project" });
      expect(patchRes.status).toBe(200);

      // Member creates page -> 201
      const createPageRes = await request(app)
        .post(`/api/projects/${projectId}/pages`)
        .set("Authorization", "Bearer token-member")
        .send({ canonicalUrl: "https://example.com/member-page" });
      expect(createPageRes.status).toBe(201);
      const pageId = createPageRes.body.page.id;

      // Member deletes page -> 200
      const delPageRes = await request(app)
        .delete(`/api/projects/${projectId}/pages/${pageId}`)
        .set("Authorization", "Bearer token-member");
      expect(delPageRes.status).toBe(200);

      // Member attempts to DELETE project -> 403 FORBIDDEN
      const delProjRes = await request(app)
        .delete(`/api/projects/${projectId}`)
        .set("Authorization", "Bearer token-member");
      expect(delProjRes.status).toBe(403);
      expect(delProjRes.body.error.code).toBe("FORBIDDEN");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Tenant Isolation & Manipulated IDs
  // -------------------------------------------------------------------------
  describe("Tenant Isolation & Manipulated ID Protection", () => {
    it("returns 404 and blocks cross-organization project access", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      // Project created in Org B
      const orgBProject = await store.createProject(orgBId, userOrgB.id, {
        name: "Confidential Org B Project",
      });

      // User from Org A attempts to GET Org B project
      const getRes = await request(app)
        .get(`/api/projects/${orgBProject.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(getRes.status).toBe(404);
      expect(getRes.body.error.code).toBe("NOT_FOUND");

      // User from Org A attempts to PATCH Org B project
      const patchRes = await request(app)
        .patch(`/api/projects/${orgBProject.id}`)
        .set("Authorization", "Bearer token-owner")
        .send({ name: "Hacked Name" });
      expect(patchRes.status).toBe(404);

      // Verify Org B project was untouched
      const untouched = await store.getProjectById(orgBId, orgBProject.id);
      expect(untouched?.name).toBe("Confidential Org B Project");

      // User from Org A attempts to DELETE Org B project
      const delRes = await request(app)
        .delete(`/api/projects/${orgBProject.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(delRes.status).toBe(404);

      // Verify still exists in Org B
      const stillExists = await store.getProjectById(orgBId, orgBProject.id);
      expect(stillExists).toBeDefined();
    });

    it("returns 404 and blocks cross-organization page access", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const orgBProject = await store.createProject(orgBId, userOrgB.id, { name: "Org B Project" });
      const orgBPage = await store.createMonitoredPage(orgBId, orgBProject.id, userOrgB.id, {
        canonicalUrl: "https://orgb.com/secret",
      });

      // User from Org A attempts to GET page
      const getRes = await request(app)
        .get(`/api/projects/${orgBProject.id}/pages/${orgBPage.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(getRes.status).toBe(404);

      // User from Org A attempts to PATCH page
      const patchRes = await request(app)
        .patch(`/api/projects/${orgBProject.id}/pages/${orgBPage.id}`)
        .set("Authorization", "Bearer token-owner")
        .send({ status: "archived" });
      expect(patchRes.status).toBe(404);

      // User from Org A attempts to DELETE page
      const delRes = await request(app)
        .delete(`/api/projects/${orgBProject.id}/pages/${orgBPage.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(delRes.status).toBe(404);

      // Verify untouched
      const untouched = await store.getMonitoredPageById(orgBId, orgBProject.id, orgBPage.id);
      expect(untouched?.status).toBe("active");
    });

    it("prevents manipulated projectId routes from accessing or deleting mismatched pages", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project1 = await store.createProject(orgAId, userOwner.id, { name: "Project 1" });
      const project2 = await store.createProject(orgAId, userOwner.id, { name: "Project 2" });

      const page1 = await store.createMonitoredPage(orgAId, project1.id, userOwner.id, {
        canonicalUrl: "https://example.com/project1-landing",
      });

      // Attempt to access page1 using project2 route: /api/projects/:project2Id/pages/:page1Id
      const getRes = await request(app)
        .get(`/api/projects/${project2.id}/pages/${page1.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(getRes.status).toBe(404);

      // Attempt to patch page1 via project2 route
      const patchRes = await request(app)
        .patch(`/api/projects/${project2.id}/pages/${page1.id}`)
        .set("Authorization", "Bearer token-owner")
        .send({ status: "paused" });
      expect(patchRes.status).toBe(404);

      // Attempt to delete page1 via project2 route
      const delRes = await request(app)
        .delete(`/api/projects/${project2.id}/pages/${page1.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(delRes.status).toBe(404);

      // Verify page1 was not deleted or modified
      const page1StillActive = await store.getMonitoredPageById(orgAId, project1.id, page1.id);
      expect(page1StillActive).toBeDefined();
      expect(page1StillActive?.status).toBe("active");
    });

    it("ignores spoofed client organization_id headers or body parameters", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const res = await request(app)
        .post("/api/projects")
        .set("Authorization", "Bearer token-owner")
        .set("x-organization-id", orgBId)
        .send({
          name: "Spoofed Org Project",
          organization_id: orgBId,
          organizationId: orgBId,
        });

      expect(res.status).toBe(201);
      // Ensure organizationId is strictly Org A from verified workspace context
      expect(res.body.project.organizationId).toBe(orgAId);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Deletion Cascade Behavior
  // -------------------------------------------------------------------------
  describe("Deletion & Cascade Behavior", () => {
    it("deleting a project cascades and removes all associated monitored pages", async () => {
      const store = new InMemoryProjectsStore();
      const app = createTestApp(store);

      const project = await store.createProject(orgAId, userOwner.id, { name: "Cascade Project" });
      const page1 = await store.createMonitoredPage(orgAId, project.id, userOwner.id, {
        canonicalUrl: "https://example.com/page-1",
      });
      const page2 = await store.createMonitoredPage(orgAId, project.id, userOwner.id, {
        canonicalUrl: "https://example.com/page-2",
      });

      // Unrelated project and page in Org A
      const otherProject = await store.createProject(orgAId, userOwner.id, { name: "Other Project" });
      const otherPage = await store.createMonitoredPage(orgAId, otherProject.id, userOwner.id, {
        canonicalUrl: "https://example.com/other-page",
      });

      // Delete cascade project
      const delRes = await request(app)
        .delete(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(delRes.status).toBe(200);

      // Verify project is gone
      const checkProj = await request(app)
        .get(`/api/projects/${project.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(checkProj.status).toBe(404);

      // Verify child pages are gone
      const checkPage1 = await request(app)
        .get(`/api/projects/${project.id}/pages/${page1.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(checkPage1.status).toBe(404);

      const checkPage2 = await request(app)
        .get(`/api/projects/${project.id}/pages/${page2.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(checkPage2.status).toBe(404);

      // Verify other project and page still exist
      const checkOther = await request(app)
        .get(`/api/projects/${otherProject.id}/pages/${otherPage.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(checkOther.status).toBe(200);
    });
  });

  describe("Postgres timestamptz (+00:00) normalization regression tests", () => {
    it("rowToProject normalizes +00:00 timestamps to canonical ISO-8601 strings", () => {
      const dbRow = {
        id: "8b956a42-fd0c-4cf6-ac66-3da3b07535cb",
        organization_id: "7a845931-eb0b-3bf5-aa55-5aa8ad2719ba",
        name: "Direct Test Project",
        domain: "example.com",
        timezone: "UTC",
        goals: null,
        created_by: "6a734820-da0a-2ae4-9944-49979c1608a9",
        created_at: "2026-09-02T02:29:39.29552+00:00",
        updated_at: "2026-09-02T02:29:39.29552+00:00",
      };

      const project = rowToProject(dbRow);
      expect(project.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(project.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(project.createdAt).getTime()).toBe(new Date(dbRow.created_at).getTime());
    });

    it("rowToMonitoredPage normalizes +00:00 timestamps to canonical ISO-8601 strings", () => {
      const dbRow = {
        id: "0a6f9020-5d17-4866-a94b-c7360963d7c9",
        project_id: "8b956a42-fd0c-4cf6-ac66-3da3b07535cb",
        organization_id: "7a845931-eb0b-3bf5-aa55-5aa8ad2719ba",
        canonical_url: "https://example.com",
        cadence: "weekly",
        status: "active",
        owner_id: null,
        tags: [],
        latest_audit_run_id: null,
        created_at: "2026-09-02T02:29:39.29552+00:00",
        updated_at: "2026-09-02T02:29:39.29552+00:00",
      };

      const page = rowToMonitoredPage(dbRow);
      expect(page.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(page.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });
});
