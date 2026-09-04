import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  AuditHistoryItem,
  AuditReport,
  AuditRun,
  FindingEntity,
  MonitoredPage,
  OrganizationMember,
  Project,
  RecommendationEntity,
  Report,
  Role,
  ScoreSnapshot,
  WorkItem,
  WorkItemExportRow,
  WorkItemFilters,
} from "@pagepilot/contracts";
import {
  AUDIT_REPORT_CSV_HEADERS,
  UTF8_BOM,
  WORK_ITEM_CSV_HEADERS,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";
import type { AuditPersistenceStore, PersistedAuditReport } from "../src/audits/audit-store.js";
import type { WorkItemsStore, ValidatedSourceEntity } from "../src/work-items/work-items-store.js";

/**
 * Combined in-memory test database for CSV export testing.
 */
class InMemoryDatabase implements ProjectsStore, AuditPersistenceStore, WorkItemsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();
  runs: Map<string, AuditRun> = new Map();
  reports: Map<string, AuditReport> = new Map();
  snapshots: Map<string, ScoreSnapshot> = new Map();
  findings: Map<string, FindingEntity> = new Map();
  recommendations: Map<string, RecommendationEntity> = new Map();
  workItems: Map<string, WorkItem> = new Map();
  members: Map<string, OrganizationMember[]> = new Map();

  // ProjectsStore
  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const p = this.projects.get(projectId);
    if (!p || p.organizationId !== orgId) return null;
    return p;
  }
  async createProject(): Promise<any> { return {} as any; }
  async listProjects(): Promise<any> { return []; }
  async updateProject(): Promise<any> { return null; }
  async deleteProject(): Promise<any> { return true; }
  async checkMonitoredPageDuplicate(): Promise<any> { return false; }
  async createMonitoredPage(): Promise<any> { return {} as any; }
  async listMonitoredPages(): Promise<any> { return []; }
  async getMonitoredPageById(orgId: string, projectId: string, pageId: string): Promise<MonitoredPage | null> {
    const p = this.pages.get(pageId);
    if (!p || p.organizationId !== orgId || p.projectId !== projectId) return null;
    return p;
  }
  async updateMonitoredPage(): Promise<any> { return null; }
  async deleteMonitoredPage(): Promise<any> { return true; }

  // AuditPersistenceStore
  async createAuditRun(): Promise<any> { return {} as any; }
  async getAuditRunById(): Promise<any> { return null; }
  async getAuditReportByRunId(orgId: string, projectId: string, pageId: string, auditRunId: string): Promise<PersistedAuditReport | null> {
    const run = this.runs.get(auditRunId);
    if (!run || run.organizationId !== orgId || run.projectId !== projectId || run.monitoredPageId !== pageId) {
      return null;
    }
    const report = this.reports.get(auditRunId);
    if (!report) return null;

    const snaps = Array.from(this.snapshots.values()).filter((s) => s.auditRunId === auditRunId);
    const finds = Array.from(this.findings.values()).filter((f) => f.auditRunId === auditRunId);
    const recs = Array.from(this.recommendations.values()).filter((r) => r.auditRunId === auditRunId);

    return {
      auditRun: run,
      report,
      scoreSnapshots: snaps,
      findings: finds,
      recommendations: recs,
    };
  }
  async findRunByIdempotencyKey(): Promise<any> { return null; }
  async getLatestSuccessfulAudit(): Promise<any> { return null; }
  async getPreviousSuccessfulAudit(): Promise<any> { return null; }
  async listAuditHistory(): Promise<{ audits: AuditHistoryItem[]; total: number }> { return { audits: [], total: 0 }; }
  async persistCompletedAudit(): Promise<any> { return {} as any; }
  async recordRunFailure(): Promise<void> { return; }


  // WorkItemsStore
  async createWorkItem(): Promise<any> { return {} as any; }
  async listWorkItems(orgId: string, projectId: string, filters?: WorkItemFilters): Promise<{ workItems: WorkItem[]; total: number }> {
    let items = Array.from(this.workItems.values()).filter(
      (w) => w.organizationId === orgId && w.projectId === projectId,
    );
    if (filters?.status) items = items.filter((w) => w.status === filters.status);
    if (filters?.severity) items = items.filter((w) => w.severity === filters.severity);
    if (filters?.category) items = items.filter((w) => w.category === filters.category);
    if (filters?.pageId) items = items.filter((w) => w.monitoredPageId === filters.pageId);
    if (filters?.assigneeId) items = items.filter((w) => w.assigneeId === filters.assigneeId);
    return { workItems: items, total: items.length };
  }
  async exportWorkItems(
    orgId: string,
    projectId: string,
    filters?: WorkItemFilters,
    onBatch?: (batch: WorkItemExportRow[]) => Promise<void> | void,
  ): Promise<WorkItemExportRow[]> {
    const res = await this.listWorkItems(orgId, projectId, filters);
    const rows: WorkItemExportRow[] = res.workItems.map((w) => {
      const page = this.pages.get(w.monitoredPageId);
      const members = this.members.get(orgId) || [];
      const assignee = members.find((m) => m.userId === w.assigneeId);
      return {
        ...w,
        pageUrl: page?.canonicalUrl || "https://example.com/default",
        assigneeEmail: assignee?.email || (w.assigneeId ? "member@example.com" : null),
      };
    });
    if (onBatch) {
      await onBatch(rows);
    }
    return rows;
  }
  async getWorkItemById(): Promise<any> { return null; }
  async getWorkItemWithActivities(): Promise<any> { return null; }
  async updateWorkItem(): Promise<any> { return null; }
  async deleteWorkItem(): Promise<any> { return true; }
  async validateSourceEntity(): Promise<ValidatedSourceEntity | null> { return null; }
  async validateAssigneeMembership(): Promise<boolean> { return true; }
  async listOrganizationMembers(orgId: string): Promise<OrganizationMember[]> {
    return this.members.get(orgId) || [];
  }
}

describe("CSV Export API Integration", () => {
  const orgAId = "11111111-1111-4111-8111-111111111111";
  const orgBId = "22222222-2222-4222-8222-222222222222";
  const userOwner = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "owner@acme.com", role: "owner" as Role, orgId: orgAId };
  const userMember = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "member@acme.com", role: "member" as Role, orgId: orgAId };
  const userViewer = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", email: "viewer@acme.com", role: "viewer" as Role, orgId: orgAId };
  const userOrgB = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", email: "user@other.com", role: "owner" as Role, orgId: orgBId };

  const projectAId = "44444444-4444-4444-8444-444444444444";
  const pageAId = "55555555-5555-4555-8555-555555555555";
  const runAId = "66666666-6666-4666-8666-666666666666";

  function createTestHarness() {
    const db = new InMemoryDatabase();

    // Setup project
    db.projects.set(projectAId, {
      id: projectAId,
      organizationId: orgAId,
      name: "Acme SaaS",
      domain: "acme.com",
      timezone: "UTC",
      goals: "Improve conversion",
      createdBy: userOwner.id,
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    });

    // Setup page
    db.pages.set(pageAId, {
      id: pageAId,
      projectId: projectAId,
      organizationId: orgAId,
      canonicalUrl: "https://acme.com/signup",
      cadence: "weekly",
      status: "active",
      tags: ["signup", "conversion"],
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T10:00:00.000Z",
    });

    // Setup members
    db.members.set(orgAId, [
      {
        id: "m-owner",
        organizationId: orgAId,
        userId: userOwner.id,
        role: "owner",
        email: userOwner.email,
        fullName: "Owner User",
        avatarUrl: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "m-member",
        organizationId: orgAId,
        userId: userMember.id,
        role: "member",
        email: userMember.email,
        fullName: "Member User",
        avatarUrl: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
      {
        id: "m-viewer",
        organizationId: orgAId,
        userId: userViewer.id,
        role: "viewer",
        email: userViewer.email,
        fullName: "Viewer User",
        avatarUrl: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      },
    ]);

    // Setup completed audit run & report
    const mockReportPayload: Report = {
      source: {
        requestedUrl: "https://acme.com/signup",
        finalUrl: "https://acme.com/signup",
        analyzedAt: "2026-09-02T12:00:00.000Z",
        title: "Acme Signup",
      },
      overallScore: 78,
      scoreConfidence: "blended",
      summary: "Solid landing page with clear value prop.",
      categories: [
        {
          category: "clarity",
          score: 80,
          confidence: "blended",
          explanation: "Clear headline.",
          severity: "low",
          findings: [
            {
              title: "Value prop is clear",
              severity: "low",
              evidence: "The main headline is concise.",
              basis: "observed",
              signalIds: ["heading-h1"],
              recommendation: "Keep current headline.",
            },
          ],
        },
        { category: "visualHierarchy", score: 75, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
        {
          category: "ctaEffectiveness",
          score: 65,
          confidence: "blended",
          explanation: "CTA contrast needs work.",
          severity: "medium",
          findings: [
            {
              title: "Primary button has weak contrast",
              severity: "medium",
              evidence: "Button contrast is 2.8:1.",
              basis: "observed",
              signalIds: ["cta-contrast"],
              recommendation: "Increase contrast to at least 4.5:1.",
            },
          ],
        },
        { category: "copy", score: 85, confidence: "ai-led", explanation: "Ok", severity: "low", findings: [] },
        { category: "accessibility", score: 70, confidence: "blended", explanation: "Ok", severity: "medium", findings: [] },
        { category: "mobileUx", score: 80, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
        { category: "trustCredibility", score: 90, confidence: "blended", explanation: "Ok", severity: "low", findings: [] },
      ],
      topProblems: [
        {
          title: "Primary button has weak contrast",
          severity: "medium",
          evidence: "Button contrast is 2.8:1.",
          basis: "observed",
          signalIds: ["cta-contrast"],
          recommendation: "Increase contrast to at least 4.5:1.",
          category: "ctaEffectiveness",
        },
      ],
      quickWins: [
        {
          title: "Darken button background",
          detail: "Use dark blue for primary action button.",
          category: "ctaEffectiveness",
        },
      ],
      detailedRecommendations: [
        {
          title: "Implement accessible color palette",
          detail: "Audit color tokens across all brand landing pages.",
          category: "accessibility",
        },
      ],
      observedSignals: [],
    };

    db.runs.set(runAId, {
      id: runAId,
      monitoredPageId: pageAId,
      projectId: projectAId,
      organizationId: orgAId,
      invocationType: "manual",
      status: "completed",
      targetUrl: "https://acme.com/signup",
      finalUrl: "https://acme.com/signup",
      startedAt: "2026-09-02T11:59:00.000Z",
      completedAt: "2026-09-02T12:00:00.000Z",
      modelVersion: "gemini-3.6-flash",
      checkVersion: "1.0.0",
      promptVersion: "1.0.0",
      scoringVersion: "1.0.0",
      retryCount: 0,
      maxRetries: 3,
      createdAt: "2026-09-02T11:59:00.000Z",
      updatedAt: "2026-09-02T12:00:00.000Z",
    });

    db.reports.set(runAId, {
      id: "rep-1",
      auditRunId: runAId,
      monitoredPageId: pageAId,
      projectId: projectAId,
      organizationId: orgAId,
      schemaVersion: "1.0.0",
      modelIdentifier: "gemini-3.6-flash",
      checkVersion: "1.0.0",
      scoringVersion: "1.0.0",
      summary: "Solid landing page.",
      overallScore: 78,
      scoreConfidence: "blended",
      reportPayload: mockReportPayload,
      createdAt: "2026-09-02T12:00:00.000Z",
    });

    // Create Express app with auth verification hooks
    const app = createApp({
      verifyToken: async (token: string) => {
        if (token === "token-owner") return { id: userOwner.id, email: userOwner.email };
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
      getProjectsStore: () => db,
      getAuditStore: () => db,
      getWorkItemsStore: () => db,
    });

    return { app, db };
  }

  describe("GET /api/projects/:projectId/work-items/export", () => {
    it("returns 401 when unauthenticated", async () => {
      const { app } = createTestHarness();
      const res = await request(app).get(`/api/projects/${projectAId}/work-items/export`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 404 when project does not exist", async () => {
      const { app } = createTestHarness();
      const fakeProjectId = "99999999-9999-4999-8999-999999999999";
      const res = await request(app)
        .get(`/api/projects/${fakeProjectId}/work-items/export`)
        .set("Authorization", "Bearer token-member");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 for cross-tenant request (tenant isolation)", async () => {
      // User belongs to orgBId, requesting projectAId in orgAId
      const { app } = createTestHarness();
      const res = await request(app)
        .get(`/api/projects/${projectAId}/work-items/export`)
        .set("Authorization", "Bearer token-org-b");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("allows 'viewer' role to export work items (read-only export privilege)", async () => {
      const { app, db } = createTestHarness();

      // Add a work item
      db.workItems.set("w-1", {
        id: "12345678-1234-4234-8234-123456789012",
        organizationId: orgAId,
        projectId: projectAId,
        monitoredPageId: pageAId,
        sourceType: "finding",
        title: "Improve CTA color",
        category: "ctaEffectiveness",
        severity: "medium",
        status: "open",
        tags: ["cta"],
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      });

      const res = await request(app)
        .get(`/api/projects/${projectAId}/work-items/export`)
        .set("Authorization", "Bearer token-viewer");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment; filename=");
      expect(res.headers["cache-control"]).toBe("no-store");

      // Verify UTF-8 BOM is present
      expect(res.text.startsWith(UTF8_BOM)).toBe(true);

      // Verify CSV contains headers and row
      expect(res.text).toContain(WORK_ITEM_CSV_HEADERS.join(","));
      expect(res.text).toContain("Improve CTA color");
      expect(res.text).toContain("CTA Effectiveness");
      expect(res.text).toContain("Medium");
      expect(res.text).toContain("https://acme.com/signup");
    });

    it("neutralizes spreadsheet formula injection in work item titles and notes", async () => {
      const { app, db } = createTestHarness();

      db.workItems.set("w-injection", {
        id: "12345678-1234-4234-8234-123456789013",
        organizationId: orgAId,
        projectId: projectAId,
        monitoredPageId: pageAId,
        sourceType: "finding",
        title: "=cmd|' /C calc'!A0",
        description: "+1+1 formula test",
        notes: "@SUM(A1:A10)",
        category: "copy",
        severity: "low",
        status: "open",
        tags: ["test"],
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      });

      const res = await request(app)
        .get(`/api/projects/${projectAId}/work-items/export`)
        .set("Authorization", "Bearer token-member");

      expect(res.status).toBe(200);
      // All formula triggers must be prepended with a single quote (') and enclosed in double quotes
      expect(res.text).toContain("\"'=cmd|' /C calc'!A0\"");
      expect(res.text).toContain("\"'+1+1 formula test\"");
      expect(res.text).toContain("\"'@SUM(A1:A10)\"");
    });

    it("applies query filters when exporting work items", async () => {
      const { app, db } = createTestHarness();

      db.workItems.set("w-high", {
        id: "12345678-1234-4234-8234-123456789014",
        organizationId: orgAId,
        projectId: projectAId,
        monitoredPageId: pageAId,
        sourceType: "finding",
        title: "High Severity Problem",
        category: "accessibility",
        severity: "high",
        status: "open",
        tags: [],
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      });

      db.workItems.set("w-low", {
        id: "12345678-1234-4234-8234-123456789015",
        organizationId: orgAId,
        projectId: projectAId,
        monitoredPageId: pageAId,
        sourceType: "finding",
        title: "Low Severity Item",
        category: "clarity",
        severity: "low",
        status: "resolved",
        tags: [],
        createdAt: "2026-09-02T10:00:00.000Z",
        updatedAt: "2026-09-02T10:00:00.000Z",
      });

      // Filter by severity=high
      const res = await request(app)
        .get(`/api/projects/${projectAId}/work-items/export?severity=high`)
        .set("Authorization", "Bearer token-member");

      expect(res.status).toBe(200);
      expect(res.text).toContain("High Severity Problem");
      expect(res.text).not.toContain("Low Severity Item");
    });

    it("returns valid CSV with only headers when backlog is empty", async () => {
      const { app } = createTestHarness();

      const res = await request(app)
        .get(`/api/projects/${projectAId}/work-items/export`)
        .set("Authorization", "Bearer token-member");

      expect(res.status).toBe(200);
      expect(res.text.startsWith(UTF8_BOM)).toBe(true);
      const lines = res.text.slice(UTF8_BOM.length).trimEnd().split("\r\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe(WORK_ITEM_CSV_HEADERS.join(","));
    });
  });

  describe("GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/export", () => {
    it("returns 401 when unauthenticated", async () => {
      const { app } = createTestHarness();
      const res = await request(app).get(
        `/api/projects/${projectAId}/pages/${pageAId}/audits/${runAId}/export`,
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 404 when audit run does not exist", async () => {
      const { app } = createTestHarness();
      const fakeRunId = "99999999-9999-4999-8999-999999999999";
      const res = await request(app)
        .get(`/api/projects/${projectAId}/pages/${pageAId}/audits/${fakeRunId}/export`)
        .set("Authorization", "Bearer token-member");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("allows 'viewer' role to export audit report to CSV", async () => {
      const { app } = createTestHarness();

      const res = await request(app)
        .get(`/api/projects/${projectAId}/pages/${pageAId}/audits/${runAId}/export`)
        .set("Authorization", "Bearer token-viewer");

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("attachment; filename=");
      expect(res.headers["cache-control"]).toBe("no-store");

      // Verify UTF-8 BOM
      expect(res.text.startsWith(UTF8_BOM)).toBe(true);

      // Verify 13 columns header
      expect(res.text).toContain(AUDIT_REPORT_CSV_HEADERS.join(","));

      // Verify report items are present
      expect(res.text).toContain("Top Problem");
      expect(res.text).toContain("Primary button has weak contrast");
      expect(res.text).toContain("CTA Effectiveness");
      expect(res.text).toContain("Medium");
      expect(res.text).toContain("Quick Win");
      expect(res.text).toContain("Darken button background");
      expect(res.text).toContain("Detailed Recommendation");
      expect(res.text).toContain("Implement accessible color palette");
    });

    it("returns 404 when audit run is not completed (e.g. failed or running)", async () => {
      const { app, db } = createTestHarness();

      const failedRunId = "77777777-7777-4777-8777-777777777777";
      db.runs.set(failedRunId, {
        id: failedRunId,
        monitoredPageId: pageAId,
        projectId: projectAId,
        organizationId: orgAId,
        invocationType: "scheduled",
        status: "failed",
        targetUrl: "https://acme.com/signup",
        createdAt: "2026-09-02T11:59:00.000Z",
        updatedAt: "2026-09-02T12:00:00.000Z",
        modelVersion: "gemini-3.6-flash",
        checkVersion: "1.0.0",
        promptVersion: "1.0.0",
        scoringVersion: "1.0.0",
        retryCount: 3,
        maxRetries: 3,
      });

      const res = await request(app)
        .get(`/api/projects/${projectAId}/pages/${pageAId}/audits/${failedRunId}/export`)
        .set("Authorization", "Bearer token-member");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });
});
