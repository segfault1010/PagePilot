import crypto from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  AuditReport,
  AuditRun,
  FindingEntity,
  MonitoredPage,
  PersistedAuditReportResponse,
  Project,
  RecommendationEntity,
  ReportShareLink,
  Role,
  ScoreSnapshot,
  SharedAuditReportResponse,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";
import type { AuditPersistenceStore } from "../src/audits/audit-store.js";
import type { SharePersistenceStore } from "../src/share/share-store.js";
import { hashShareToken } from "../src/share/routes.js";

class InMemoryProjectsStore implements ProjectsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();

  async createProject(orgId: string, userId: string, data: any): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
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
    return Array.from(this.projects.values()).filter((p) => p.organizationId === orgId);
  }

  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project || project.organizationId !== orgId) return null;
    return project;
  }

  async updateProject(): Promise<Project | null> {
    return null;
  }

  async deleteProject(): Promise<boolean> {
    return true;
  }

  async createMonitoredPage(orgId: string, projectId: string, userId: string, data: any): Promise<MonitoredPage> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const page: MonitoredPage = {
      id,
      organizationId: orgId,
      projectId,
      canonicalUrl: data.url,
      cadence: "weekly",
      status: "active",
      ownerId: userId,
      tags: [],
      latestAuditRunId: null,
      latestSuccessfulAuditRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.pages.set(id, page);
    return page;
  }

  async listMonitoredPages(orgId: string, projectId: string): Promise<MonitoredPage[]> {
    return Array.from(this.pages.values()).filter(
      (p) => p.organizationId === orgId && p.projectId === projectId,
    );
  }

  async getMonitoredPageById(orgId: string, projectId: string, pageId: string): Promise<MonitoredPage | null> {
    const page = this.pages.get(pageId);
    if (!page || page.organizationId !== orgId || page.projectId !== projectId) return null;
    return page;
  }

  async updateMonitoredPage(): Promise<MonitoredPage | null> {
    return null;
  }

  async deleteMonitoredPage(): Promise<boolean> {
    return true;
  }

  async checkMonitoredPageDuplicate(): Promise<boolean> {
    return false;
  }
}

class InMemoryAuditStore implements Partial<AuditPersistenceStore> {
  auditRuns: Map<string, AuditRun> = new Map();
  auditReports: Map<string, AuditReport> = new Map();
  scoreSnapshots: Map<string, ScoreSnapshot[]> = new Map();
  findings: Map<string, FindingEntity[]> = new Map();
  recommendations: Map<string, RecommendationEntity[]> = new Map();

  async getAuditReportByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
  ): Promise<PersistedAuditReportResponse | null> {
    const run = this.auditRuns.get(auditRunId);
    if (
      !run ||
      run.organizationId !== orgId ||
      run.projectId !== projectId ||
      run.monitoredPageId !== pageId
    ) {
      return null;
    }

    const report = Array.from(this.auditReports.values()).find(
      (r) => r.auditRunId === auditRunId,
    );
    if (!report) return null;

    return {
      auditRun: run,
      report,
      scoreSnapshots: this.scoreSnapshots.get(report.id) ?? [],
      findings: this.findings.get(report.id) ?? [],
      recommendations: this.recommendations.get(report.id) ?? [],
    };
  }
}

class InMemoryShareStore implements SharePersistenceStore {
  shares: Map<string, ReportShareLink> = new Map();
  auditStore: InMemoryAuditStore;

  constructor(auditStore: InMemoryAuditStore) {
    this.auditStore = auditStore;
  }

  async createShareLink(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
    auditReportId: string,
    userId: string,
    data: { tokenHash: string; expiresAt?: string | null },
  ): Promise<ReportShareLink> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const share: ReportShareLink = {
      id,
      organizationId: orgId,
      projectId,
      monitoredPageId: pageId,
      auditRunId,
      auditReportId,
      tokenHash: data.tokenHash,
      createdByUserId: userId,
      expiresAt: data.expiresAt ?? null,
      revokedAt: null,
      createdAt: now,
      lastAccessedAt: null,
    };
    this.shares.set(id, share);
    return share;
  }

  async getActiveShareLinkByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
  ): Promise<ReportShareLink | null> {
    const list = Array.from(this.shares.values()).filter(
      (s) =>
        s.organizationId === orgId &&
        s.projectId === projectId &&
        s.monitoredPageId === pageId &&
        s.auditRunId === auditRunId &&
        !s.revokedAt,
    );
    const now = new Date();
    const active = list.find((s) => !s.expiresAt || new Date(s.expiresAt) > now);
    return active ?? null;
  }

  async getShareLinkById(orgId: string, projectId: string, shareId: string): Promise<ReportShareLink | null> {
    const s = this.shares.get(shareId);
    if (!s || s.organizationId !== orgId || s.projectId !== projectId) return null;
    return s;
  }

  async revokeShareLink(orgId: string, projectId: string, shareId: string): Promise<boolean> {
    const s = this.shares.get(shareId);
    if (!s || s.organizationId !== orgId || s.projectId !== projectId) return false;
    s.revokedAt = new Date().toISOString();
    return true;
  }

  async resolvePublicSharedReport(tokenHash: string): Promise<SharedAuditReportResponse | null> {
    const share = Array.from(this.shares.values()).find(
      (s) => s.tokenHash === tokenHash && !s.revokedAt && (!s.expiresAt || new Date(s.expiresAt) > new Date()),
    );
    if (!share) return null;

    const report = this.auditStore.auditReports.get(share.auditReportId);
    const run = this.auditStore.auditRuns.get(share.auditRunId);
    if (!report || !run) return null;

    // Record access
    share.lastAccessedAt = new Date().toISOString();

    return {
      report,
      auditRun: run,
      scoreSnapshots: this.auditStore.scoreSnapshots.get(report.id) ?? [],
      findings: this.auditStore.findings.get(report.id) ?? [],
      recommendations: this.auditStore.recommendations.get(report.id) ?? [],
      shareMetadata: {
        id: share.id,
        createdAt: share.createdAt,
        expiresAt: share.expiresAt ?? null,
      },
    };
  }
}

describe("Share Links API & Public Resolver", () => {
  const orgA = "11111111-1111-4111-a111-111111111111";
  const userAdmin = {
    id: "aaaa1111-1111-4111-a111-111111111111",
    email: "admin@acme.com",
    role: "authenticated",
  };
  const userMember = {
    id: "bbbb2222-2222-4222-a222-222222222222",
    email: "member@acme.com",
    role: "authenticated",
  };
  const userViewer = {
    id: "cccc3333-3333-4333-a333-333333333333",
    email: "viewer@acme.com",
    role: "authenticated",
  };

  function setupTestContext() {
    const projectsStore = new InMemoryProjectsStore();
    const auditStore = new InMemoryAuditStore();
    const shareStore = new InMemoryShareStore(auditStore);

    const userRoles = new Map<string, Map<string, Role>>();
    userRoles.set(
      orgA,
      new Map([
        [userAdmin.id, "admin"],
        [userMember.id, "member"],
        [userViewer.id, "viewer"],
      ]),
    );

    const authMiddlewareOptions = {
      verifyToken: async (token: string) => {
        if (token === "token-admin") return { id: userAdmin.id, email: userAdmin.email };
        if (token === "token-member") return { id: userMember.id, email: userMember.email };
        if (token === "token-viewer") return { id: userViewer.id, email: userViewer.email };
        return null;
      },
      resolveWorkspace: async (user: { id: string; email?: string }) => {
        let role: Role = "viewer";
        let orgId = orgA;
        if (user.id === userAdmin.id) {
          role = "admin";
          orgId = orgA;
        } else if (user.id === userMember.id) {
          role = "member";
          orgId = orgA;
        } else if (user.id === userViewer.id) {
          role = "viewer";
          orgId = orgA;
        }

        return {
          user: { id: user.id, email: user.email ?? "user@acme.com" },
          profile: null,
          organization: {
            id: orgId,
            name: "Acme Corp",
            slug: "acme-corp",
            createdBy: userAdmin.id,
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
    };

    const app = createApp({
      ...authMiddlewareOptions,
      getProjectsStore: () => projectsStore,
      getAuditStore: () => auditStore as any,
      getShareStore: () => shareStore,
    });

    return { projectsStore, auditStore, shareStore, app };
  }

  async function seedProjectAndAudit(ctx: ReturnType<typeof setupTestContext>) {
    const project = await ctx.projectsStore.createProject(orgA, userAdmin.id, {
      name: "Acme Main Site",
      domain: "acme.com",
    });
    const page = await ctx.projectsStore.createMonitoredPage(
      orgA,
      project.id,
      userAdmin.id,
      { url: "https://acme.com/landing", label: "Landing" },
    );

    const runId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const now = new Date().toISOString();

    const auditRun: AuditRun = {
      id: runId,
      monitoredPageId: page.id,
      projectId: project.id,
      organizationId: orgA,
      invocationType: "manual",
      status: "completed",
      targetUrl: "https://acme.com/landing",
      finalUrl: "https://acme.com/landing",
      startedAt: now,
      completedAt: now,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      modelVersion: "gemini-2.5-flash",
      checkVersion: "1.0.0",
      promptVersion: "1.0.0",
      scoringVersion: "1.0.0",
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    };

    const auditReport: AuditReport = {
      id: reportId,
      auditRunId: runId,
      monitoredPageId: page.id,
      projectId: project.id,
      organizationId: orgA,
      schemaVersion: "1.0.0",
      modelIdentifier: "gemini-2.5-flash",
      checkVersion: "1.0.0",
      scoringVersion: "1.0.0",
      summary: "High converting SaaS hero section with strong CTA.",
      overallScore: 88,
      scoreConfidence: "blended",
      reportPayload: {
        summary: "High converting SaaS hero section with strong CTA.",
        overallScore: 88,
        scoreConfidence: "blended",
        categoryScores: {
          clarity: 90,
          visualHierarchy: 85,
          ctaEffectiveness: 92,
          copy: 84,
          accessibility: 88,
          mobileUx: 86,
          trustCredibility: 90,
        },
        findings: [
          {
            category: "clarity",
            severity: "low",
            title: "Subheadline is slightly wordy",
            evidence: "Word count 28 words in subhead",
            recommendation: "Trim to 15 words",
          },
        ],
        topRecommendations: [
          {
            category: "clarity",
            title: "Tighten subheadline",
            detail: "Make subhead punchier",
          },
        ],
      } as any,
      createdAt: now,
    };

    ctx.auditStore.auditRuns.set(runId, auditRun);
    ctx.auditStore.auditReports.set(reportId, auditReport);

    return { project, page, runId, reportId };
  }

  it("allows member/admin to create a share link with high-entropy token and SHA-256 hash", async () => {
    const ctx = setupTestContext();
    const { project, page, runId, reportId } = await seedProjectAndAudit(ctx);

    const res = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-member")
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(201);
    expect(res.body.shareLink).toBeDefined();
    expect(res.body.shareLink.id).toBeDefined();
    expect(res.body.shareLink.token).toBeDefined();
    expect(res.body.shareLink.token.length).toBeGreaterThanOrEqual(32);
    expect(res.body.shareLink.shareUrl).toBe(`/shared/reports/${res.body.shareLink.token}`);
    expect(res.body.shareLink.expiresAt).toBeDefined();

    // Verify raw token is NOT stored in DB, only token_hash is stored
    const storedShare = ctx.shareStore.shares.get(res.body.shareLink.id);
    expect(storedShare).toBeDefined();
    expect(storedShare!.tokenHash).toBe(hashShareToken(res.body.shareLink.token));
    expect(storedShare!.tokenHash).not.toBe(res.body.shareLink.token);
    expect(storedShare!.auditReportId).toBe(reportId);
  });

  it("denies viewer role from creating share links (403 FORBIDDEN)", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const res = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-viewer")
      .send({ expiresInDays: 30 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("validates expiresInDays bounds (1 to 365)", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const resInvalid0 = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 0 });
    expect(resInvalid0.status).toBe(400);

    const resInvalid366 = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 366 });
    expect(resInvalid366.status).toBe(400);
  });

  it("allows retrieval of active share metadata via GET .../audits/:auditRunId/share", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    // Initial check: no active share
    const getRes1 = await request(ctx.app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-viewer");
    expect(getRes1.status).toBe(200);
    expect(getRes1.body.shareLink).toBeNull();

    // Create share
    const createRes = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 30 });
    expect(createRes.status).toBe(201);

    // Now retrieve metadata as viewer
    const getRes2 = await request(ctx.app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-viewer");
    expect(getRes2.status).toBe(200);
    expect(getRes2.body.shareLink).toBeDefined();
    expect(getRes2.body.shareLink.id).toBe(createRes.body.shareLink.id);
    expect(getRes2.body.shareLink.isRevoked).toBe(false);
    expect(getRes2.body.shareLink.isExpired).toBe(false);
    // Raw token is NEVER returned in metadata GET
    expect(getRes2.body.shareLink.token).toBeUndefined();
  });

  it("allows member/admin to revoke share link and rejects viewer (403)", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const createRes = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 30 });
    const shareId = createRes.body.shareLink.id;

    // Viewer try revoke -> 403
    const viewerRevoke = await request(ctx.app)
      .delete(`/api/projects/${project.id}/share-links/${shareId}`)
      .set("Authorization", "Bearer token-viewer");
    expect(viewerRevoke.status).toBe(403);

    // Admin revoke -> 200
    const adminRevoke = await request(ctx.app)
      .delete(`/api/projects/${project.id}/share-links/${shareId}`)
      .set("Authorization", "Bearer token-admin");
    expect(adminRevoke.status).toBe(200);
    expect(adminRevoke.body.success).toBe(true);
    expect(adminRevoke.body.revokedShareId).toBe(shareId);

    // Verify share link is now marked revoked
    const stored = ctx.shareStore.shares.get(shareId);
    expect(stored!.revokedAt).not.toBeNull();
  });

  it("resolves public shared report via GET /api/shared/reports/:token without authentication", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const createRes = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 30 });
    const rawToken = createRes.body.shareLink.token;

    // Public lookup without any auth token
    const publicRes = await request(ctx.app)
      .get(`/api/shared/reports/${rawToken}`);

    expect(publicRes.status).toBe(200);
    expect(publicRes.headers["cache-control"]).toContain("no-store");
    expect(publicRes.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(publicRes.headers["x-content-type-options"]).toBe("nosniff");

    expect(publicRes.body.report).toBeDefined();
    expect(publicRes.body.report.overallScore).toBe(88);
    expect(publicRes.body.report.reportPayload.summary).toContain("SaaS hero section");
    expect(publicRes.body.auditRun).toBeDefined();
    expect(publicRes.body.auditRun.targetUrl).toBe("https://acme.com/landing");
    expect(publicRes.body.shareMetadata).toBeDefined();
    expect(publicRes.body.shareMetadata.id).toBe(createRes.body.shareLink.id);
  });

  it("returns 404 for invalid, unknown, or malformed tokens", async () => {
    const ctx = setupTestContext();
    await seedProjectAndAudit(ctx);

    // Random non-existent token
    const randomToken = crypto.randomBytes(32).toString("base64url");
    const res1 = await request(ctx.app).get(`/api/shared/reports/${randomToken}`);
    expect(res1.status).toBe(404);
    expect(res1.body.error.code).toBe("NOT_FOUND");
    expect(res1.body.error.message).toBe("This report link is no longer available.");

    // Malformed short token
    const res2 = await request(ctx.app).get(`/api/shared/reports/short`);
    expect(res2.status).toBe(404);
    expect(res2.body.error.message).toBe("This report link is no longer available.");
  });

  it("returns 404 immediately once a share link has been revoked", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const createRes = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-member")
      .send({ expiresInDays: 30 });
    const rawToken = createRes.body.shareLink.token;
    const shareId = createRes.body.shareLink.id;

    // Works before revocation
    const beforeRes = await request(ctx.app).get(`/api/shared/reports/${rawToken}`);
    expect(beforeRes.status).toBe(200);

    // Revoke share
    await request(ctx.app)
      .delete(`/api/projects/${project.id}/share-links/${shareId}`)
      .set("Authorization", "Bearer token-member");

    // Returns 404 after revocation
    const afterRes = await request(ctx.app).get(`/api/shared/reports/${rawToken}`);
    expect(afterRes.status).toBe(404);
    expect(afterRes.body.error.message).toBe("This report link is no longer available.");
  });

  it("returns 404 when share link has expired", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const createRes = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 1 });
    const rawToken = createRes.body.shareLink.token;
    const shareId = createRes.body.shareLink.id;

    // Manually backdate expiration
    const share = ctx.shareStore.shares.get(shareId)!;
    share.expiresAt = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago

    const res = await request(ctx.app).get(`/api/shared/reports/${rawToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe("This report link is no longer available.");
  });

  it("enforces rate limits on public shared report lookups", async () => {
    const ctx = setupTestContext();
    const { project, page, runId } = await seedProjectAndAudit(ctx);

    const createRes = await request(ctx.app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits/${runId}/share`)
      .set("Authorization", "Bearer token-admin")
      .send({ expiresInDays: 30 });
    const rawToken = createRes.body.shareLink.token;

    // Create app with rate limiter that triggers after 2 requests
    let requestCount = 0;
    const strictRateLimiter = (_ip: string) => {
      requestCount++;
      return requestCount > 2;
    };

    const rateLimitedApp = createApp({
      getShareStore: () => ctx.shareStore,
      publicShareRateLimiter: strictRateLimiter,
    });

    const res1 = await request(rateLimitedApp).get(`/api/shared/reports/${rawToken}`);
    expect(res1.status).toBe(200);

    const res2 = await request(rateLimitedApp).get(`/api/shared/reports/${rawToken}`);
    expect(res2.status).toBe(200);

    const res3 = await request(rateLimitedApp).get(`/api/shared/reports/${rawToken}`);
    expect(res3.status).toBe(429);
    expect(res3.body.error.code).toBe("RATE_LIMITED");
  });
});
