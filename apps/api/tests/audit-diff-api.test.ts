import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  AuditHistoryItem,
  AuditReport,
  AuditRun,
  CreateMonitoredPageInput,
  CreateProjectInput,
  FindingEntity,
  MonitoredPage,
  Project,
  RecommendationEntity,
  Report,
  Role,
  ScoreSnapshot,
} from "@pagepilot/contracts";
import {
  AUDIT_ENGINE_CHECK_VERSION,
  AUDIT_ENGINE_PROMPT_VERSION,
  AUDIT_ENGINE_SCORING_VERSION,
  REPORT_SCHEMA_VERSION,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";
import type {
  AuditPersistenceStore,
  PersistedAuditReport,
} from "../src/audits/audit-store.js";

class InMemoryDatabase implements ProjectsStore, AuditPersistenceStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();
  runs: Map<string, AuditRun> = new Map();
  reports: Map<string, AuditReport> = new Map();
  snapshots: Map<string, ScoreSnapshot> = new Map();
  findings: Map<string, FindingEntity> = new Map();
  recommendations: Map<string, RecommendationEntity> = new Map();

  private counter = 0;

  private nextTimestamp(): string {
    this.counter += 1;
    return new Date(1700000000000 + this.counter * 10000).toISOString();
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
    return Array.from(this.projects.values()).filter(
      (p) => p.organizationId === orgId,
    );
  }

  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project || project.organizationId !== orgId) return null;
    return project;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    data: Partial<Project>,
  ): Promise<Project | null> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return null;
    const updated: Project = { ...project, ...data, updatedAt: this.nextTimestamp() };
    this.projects.set(projectId, updated);
    return updated;
  }

  async deleteProject(orgId: string, projectId: string): Promise<boolean> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return false;
    this.projects.delete(projectId);
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
    _userId: string,
    data: CreateMonitoredPageInput,
  ): Promise<MonitoredPage> {
    const id = crypto.randomUUID();
    const now = this.nextTimestamp();
    const page: MonitoredPage = {
      id,
      projectId,
      organizationId: orgId,
      canonicalUrl: data.canonicalUrl,
      cadence: data.cadence ?? "weekly",
      status: "active",
      tags: data.tags ?? [],
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
    data: Partial<MonitoredPage>,
  ): Promise<MonitoredPage | null> {
    const page = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!page) return null;
    const updated: MonitoredPage = { ...page, ...data, updatedAt: this.nextTimestamp() };
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

  async findRunByIdempotencyKey(
    orgId: string,
    pageId: string,
    key: string,
  ): Promise<AuditRun | null> {
    for (const run of this.runs.values()) {
      if (
        run.organizationId === orgId &&
        run.monitoredPageId === pageId &&
        run.idempotencyKey === key
      ) {
        return run;
      }
    }
    return null;
  }

  async createAuditRun(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    targetUrl: string,
    idempotencyKey?: string,
  ): Promise<{ run: AuditRun; isExisting: boolean }> {
    const id = crypto.randomUUID();
    const now = this.nextTimestamp();
    const run: AuditRun = {
      id,
      monitoredPageId: pageId,
      projectId,
      organizationId: orgId,
      invocationType: "manual",
      status: "running",
      targetUrl,
      finalUrl: null,
      triggeredByUserId: userId,
      idempotencyKey: idempotencyKey ?? null,
      startedAt: now,
      completedAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      retryable: null,
      modelVersion: "gemini-3.6-flash",
      checkVersion: AUDIT_ENGINE_CHECK_VERSION,
      promptVersion: AUDIT_ENGINE_PROMPT_VERSION,
      scoringVersion: AUDIT_ENGINE_SCORING_VERSION,
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    };
    this.runs.set(id, run);
    return { run, isExisting: false };
  }

  async recordRunFailure(
    _orgId: string,
    _projectId: string,
    pageId: string,
    runId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (run) {
      run.status = "failed";
      run.failedAt = this.nextTimestamp();
      run.errorCode = error.code;
      run.errorMessage = error.message;
      run.retryable = error.retryable;
    }
    const page = this.pages.get(pageId);
    if (page) {
      page.latestAuditRunId = runId;
    }
  }

  async persistCompletedAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    finalUrl: string,
    report: Report,
  ): Promise<{ auditReportId: string }> {
    const now = this.nextTimestamp();
    const run = this.runs.get(runId);
    if (run) {
      run.status = "completed";
      run.completedAt = now;
      run.finalUrl = finalUrl;
    }

    const reportId = crypto.randomUUID();
    const auditReport: AuditReport = {
      id: reportId,
      auditRunId: runId,
      monitoredPageId: pageId,
      projectId,
      organizationId: orgId,
      schemaVersion: REPORT_SCHEMA_VERSION,
      modelIdentifier: "gemini-3.6-flash",
      checkVersion: AUDIT_ENGINE_CHECK_VERSION,
      scoringVersion: AUDIT_ENGINE_SCORING_VERSION,
      summary: report.summary,
      overallScore: report.overallScore,
      scoreConfidence: report.scoreConfidence,
      reportPayload: report,
      createdAt: now,
    };
    this.reports.set(reportId, auditReport);

    for (const cat of report.categories) {
      const snapId = crypto.randomUUID();
      this.snapshots.set(snapId, {
        id: snapId,
        auditReportId: reportId,
        auditRunId: runId,
        monitoredPageId: pageId,
        projectId,
        organizationId: orgId,
        category: cat.category,
        score: cat.score,
        confidence: cat.confidence,
        explanation: cat.explanation,
        severity: cat.severity,
        scoringVersion: AUDIT_ENGINE_SCORING_VERSION,
        createdAt: now,
      });
    }

    let displayOrder = 0;
    for (const tp of report.topProblems) {
      const fId = crypto.randomUUID();
      this.findings.set(fId, {
        id: fId,
        auditReportId: reportId,
        auditRunId: runId,
        monitoredPageId: pageId,
        projectId,
        organizationId: orgId,
        findingType: "top_problem",
        category: tp.category || "clarity",
        title: tp.title,
        severity: tp.severity,
        evidence: tp.evidence,
        basis: tp.basis,
        signalIds: tp.signalIds,
        recommendation: tp.recommendation,
        displayOrder: displayOrder++,
        workStatus: "open",
        resolvedAt: null,
        resolvedByUserId: null,
        createdAt: now,
      });
    }

    const page = this.pages.get(pageId);
    if (page) {
      page.latestAuditRunId = runId;
      page.latestSuccessfulAuditRunId = runId;
    }

    return { auditReportId: reportId };
  }

  async listAuditHistory(
    orgId: string,
    _projectId: string,
    pageId: string,
    _limit?: number,
    _offset?: number,
  ): Promise<{ audits: AuditHistoryItem[]; total: number }> {
    const matching = Array.from(this.runs.values())
      .filter((r) => r.organizationId === orgId && r.monitoredPageId === pageId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const items: AuditHistoryItem[] = matching.map((run) => {
      const report = Array.from(this.reports.values()).find(
        (r) => r.auditRunId === run.id,
      );
      return {
        id: run.id,
        monitoredPageId: run.monitoredPageId,
        projectId: run.projectId,
        organizationId: run.organizationId,
        invocationType: run.invocationType,
        status: run.status,
        targetUrl: run.targetUrl,
        finalUrl: run.finalUrl,
        overallScore: report?.overallScore ?? null,
        scoreConfidence: report?.scoreConfidence ?? null,
        summary: report?.summary ?? null,
        auditReportId: report?.id ?? null,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        failedAt: run.failedAt,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
        retryable: run.retryable,
        modelVersion: run.modelVersion,
        checkVersion: run.checkVersion,
        scoringVersion: run.scoringVersion,
        createdAt: run.createdAt,
      };
    });

    return { audits: items, total: items.length };
  }

  async getAuditReportByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
  ): Promise<PersistedAuditReport | null> {
    const run = this.runs.get(runId);
    if (
      !run ||
      run.organizationId !== orgId ||
      run.projectId !== projectId ||
      run.monitoredPageId !== pageId
    ) {
      return null;
    }

    const report = Array.from(this.reports.values()).find(
      (rep) => rep.auditRunId === runId,
    );
    if (!report) return null;

    const snaps = Array.from(this.snapshots.values()).filter(
      (s) => s.auditReportId === report.id,
    );
    const finds = Array.from(this.findings.values())
      .filter((f) => f.auditReportId === report.id)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const recs = Array.from(this.recommendations.values())
      .filter((r) => r.auditReportId === report.id)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    return {
      auditRun: run,
      report,
      scoreSnapshots: snaps,
      findings: finds,
      recommendations: recs,
    };
  }

  async getLatestSuccessfulAudit(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<PersistedAuditReport | null> {
    const page = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!page || !page.latestSuccessfulAuditRunId) return null;
    return this.getAuditReportByRunId(orgId, projectId, pageId, page.latestSuccessfulAuditRunId);
  }

  async getPreviousSuccessfulAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    beforeTimestamp: string,
  ): Promise<PersistedAuditReport | null> {
    const matchingRuns = Array.from(this.runs.values())
      .filter(
        (r) =>
          r.organizationId === orgId &&
          r.projectId === projectId &&
          r.monitoredPageId === pageId &&
          r.status === "completed" &&
          r.createdAt < beforeTimestamp,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (matchingRuns.length === 0) return null;
    return this.getAuditReportByRunId(orgId, projectId, pageId, matchingRuns[0].id);
  }
}

function makeMockReport(overallScore: number, options: { topProblemTitle?: string } = {}): Report {
  return {
    source: {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      analyzedAt: new Date().toISOString(),
      title: "Example Landing Page",
    },
    overallScore,
    scoreConfidence: "blended",
    summary: `Audit summary with overall score ${overallScore}`,
    categories: [
      {
        category: "clarity",
        score: overallScore,
        confidence: "blended",
        explanation: "Clarity explanation",
        severity: overallScore >= 70 ? "low" : "medium",
        findings: [],
      },
      {
        category: "visualHierarchy",
        score: overallScore,
        confidence: "blended",
        explanation: "Visual hierarchy explanation",
        severity: "low",
        findings: [],
      },
      {
        category: "ctaEffectiveness",
        score: overallScore,
        confidence: "blended",
        explanation: "CTA explanation",
        severity: "low",
        findings: [],
      },
      {
        category: "copy",
        score: overallScore,
        confidence: "blended",
        explanation: "Copy explanation",
        severity: "low",
        findings: [],
      },
      {
        category: "accessibility",
        score: overallScore,
        confidence: "blended",
        explanation: "Accessibility explanation",
        severity: "low",
        findings: [],
      },
      {
        category: "mobileUx",
        score: overallScore,
        confidence: "blended",
        explanation: "Mobile UX explanation",
        severity: "low",
        findings: [],
      },
      {
        category: "trustCredibility",
        score: overallScore,
        confidence: "blended",
        explanation: "Trust explanation",
        severity: "low",
        findings: [],
      },
    ],
    topProblems: options.topProblemTitle
      ? [
          {
            title: options.topProblemTitle,
            severity: "high",
            category: "clarity",
            evidence: "Problem evidence",
            recommendation: "Problem recommendation",
            signalIds: [],
            basis: "inferred",
          },
        ]
      : [],
    quickWins: [],
    detailedRecommendations: [],
    observedSignals: [
      {
        id: "has-title",
        category: "clarity",
        status: "pass",
        evidence: "Title tag found",
        weight: 0.15,
      },
    ],
  };
}

describe("GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/diff", () => {
  const orgAId = "00000000-0000-4000-8000-000000000001";
  const orgBId = "00000000-0000-4000-8000-000000000002";
  const userAId = "11111111-1111-4111-8111-111111111111";

  function createTestContext(customRole: Role = "owner", orgId: string = orgAId, userId: string = userAId) {
    const db = new InMemoryDatabase();

    const app = createApp({
      getProjectsStore: () => db,
      getAuditStore: () => db,
      verifyToken: async (token: string) => {
        if (token === "invalid-token") return null;
        return {
          id: userId,
          email: `${userId}@example.com`,
          app_metadata: {},
          user_metadata: {},
          aud: "authenticated",
          created_at: new Date().toISOString(),
        };
      },
      resolveWorkspace: async (_user) => ({
        user: { id: userId, email: `${userId}@example.com` },
        profile: {
          id: userId,
          email: `${userId}@example.com`,
          fullName: "Test User",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        organization: {
          id: orgId,
          name: orgId === orgAId ? "Acme Org A" : "Beta Org B",
          slug: orgId === orgAId ? "acme-a" : "beta-b",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        membership: {
          id: crypto.randomUUID(),
          organizationId: orgId,
          userId: userId,
          role: customRole,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        role: customRole,
      }),
    });

    return { db, app };
  }

  it("returns baseline diff when page has only one completed audit", async () => {
    const { db, app } = createTestContext("owner", orgAId, userAId);
    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, {
      canonicalUrl: "https://example.com",
    });

    const { run } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run.id, page.canonicalUrl, makeMockReport(80));

    const res = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${run.id}/diff`)
      .set("Authorization", "Bearer valid-token")
      .expect(200);

    expect(res.body).toHaveProperty("diff");
    expect(res.body.diff.summary.isBaseline).toBe(true);
    expect(res.body.diff.summary.hasPreviousReport).toBe(false);
    expect(res.body.diff.summary.hasMeaningfulRegression).toBe(false);
    expect(res.body.diff.scoreChanges.overall.currentScore).toBe(80);
    expect(res.body.diff.scoreChanges.overall.previousScore).toBeNull();
    expect(res.body.previousReport).toBeNull();
    expect(res.body.currentReport.auditRun.id).toBe(run.id);
  });

  it("computes diff automatically against most recent completed audit", async () => {
    const { db, app } = createTestContext("owner", orgAId, userAId);
    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, {
      canonicalUrl: "https://example.com",
    });

    // Run 1: Score 85
    const { run: run1 } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run1.id, page.canonicalUrl, makeMockReport(85));

    // Run 2 (Failed scan): Should be ignored as comparison baseline
    const { run: run2 } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.recordRunFailure(orgAId, project.id, page.id, run2.id, {
      code: "FETCH_FAILED",
      message: "Timeout",
      retryable: true,
    });

    // Run 3: Score 70 with new high severity finding (meaningful regression)
    const { run: run3 } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(
      orgAId,
      project.id,
      page.id,
      run3.id,
      page.canonicalUrl,
      makeMockReport(70, { topProblemTitle: "Missing primary value proposition" }),
    );

    const res = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${run3.id}/diff`)
      .set("Authorization", "Bearer valid-token")
      .expect(200);

    expect(res.body.diff.summary.isBaseline).toBe(false);
    expect(res.body.diff.summary.hasPreviousReport).toBe(true);
    expect(res.body.diff.summary.hasMeaningfulRegression).toBe(true);
    expect(res.body.diff.summary.overallScoreDelta).toBe(-15);
    expect(res.body.diff.scoreChanges.overall.previousScore).toBe(85);
    expect(res.body.diff.scoreChanges.overall.currentScore).toBe(70);
    expect(res.body.previousReport.auditRun.id).toBe(run1.id);
    expect(res.body.diff.regressions.length).toBeGreaterThan(0);
  });

  it("supports explicit compareRunId parameter", async () => {
    const { db, app } = createTestContext("owner", orgAId, userAId);
    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, {
      canonicalUrl: "https://example.com",
    });

    // Run 1: 60
    const { run: run1 } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run1.id, page.canonicalUrl, makeMockReport(60));

    // Run 2: 75
    const { run: run2 } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run2.id, page.canonicalUrl, makeMockReport(75));

    // Run 3: 90
    const { run: run3 } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run3.id, page.canonicalUrl, makeMockReport(90));

    // Explicitly compare Run 3 vs Run 1 (skipping Run 2)
    const res = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${run3.id}/diff?compareRunId=${run1.id}`)
      .set("Authorization", "Bearer valid-token")
      .expect(200);

    expect(res.body.diff.scoreChanges.overall.previousScore).toBe(60);
    expect(res.body.diff.scoreChanges.overall.currentScore).toBe(90);
    expect(res.body.diff.scoreChanges.overall.delta).toBe(30);
    expect(res.body.previousReport.auditRun.id).toBe(run1.id);
  });

  it("allows viewer role to access diff comparison endpoint", async () => {
    const { db, app } = createTestContext("viewer", orgAId, userAId);
    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, {
      canonicalUrl: "https://example.com",
    });

    const { run } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run.id, page.canonicalUrl, makeMockReport(80));

    await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${run.id}/diff`)
      .set("Authorization", "Bearer valid-token")
      .expect(200);
  });

  it("returns 404 for cross-tenant access attempts", async () => {
    const { db } = createTestContext("owner", orgAId, userAId);
    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, {
      canonicalUrl: "https://example.com",
    });

    const { run } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.persistCompletedAudit(orgAId, project.id, page.id, run.id, page.canonicalUrl, makeMockReport(80));

    // Request made from Organization B trying to access Org A resource
    const { app: orgBApp } = createTestContext("owner", orgBId, "99999999-9999-4999-8999-999999999999");
    await request(orgBApp)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${run.id}/diff`)
      .set("Authorization", "Bearer valid-token")
      .expect(404);
  });

  it("returns 404 if the requested current audit run is not found or failed", async () => {
    const { db, app } = createTestContext("owner", orgAId, userAId);
    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, {
      canonicalUrl: "https://example.com",
    });

    const { run } = await db.createAuditRun(orgAId, project.id, page.id, userAId, page.canonicalUrl);
    await db.recordRunFailure(orgAId, project.id, page.id, run.id, {
      code: "FETCH_FAILED",
      message: "Timeout",
      retryable: false,
    });

    await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${run.id}/diff`)
      .set("Authorization", "Bearer valid-token")
      .expect(404);
  });
});
