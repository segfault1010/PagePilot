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
import { DuplicateResourceError } from "../src/projects/projects-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";
import type {
  AuditPersistenceStore,
  PersistedAuditReport,
} from "../src/audits/audit-store.js";

/**
 * In-memory test store implementing both ProjectsStore and AuditPersistenceStore
 * with full relational behavior for deterministic, ultra-fast API testing.
 */
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
    return new Date(Date.now() + this.counter * 1000).toISOString();
  }

  // --- ProjectsStore implementation ---

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
    data: Partial<Project>,
  ): Promise<Project | null> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return null;
    const updated: Project = {
      ...project,
      ...data,
      updatedAt: this.nextTimestamp(),
    };
    this.projects.set(projectId, updated);
    return updated;
  }

  async deleteProject(orgId: string, projectId: string): Promise<boolean> {
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return false;
    this.projects.delete(projectId);
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
    if (!project) throw new Error("Project not found.");

    if (await this.checkMonitoredPageDuplicate(projectId, data.canonicalUrl)) {
      throw new DuplicateResourceError("URL already monitored.");
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
      latestSuccessfulAuditRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.pages.set(id, page);
    return page;
  }

  async listMonitoredPages(
    orgId: string,
    projectId: string,
  ): Promise<MonitoredPage[]> {
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
    if (
      !page ||
      page.organizationId !== orgId ||
      page.projectId !== projectId
    ) {
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

    if (
      data.canonicalUrl &&
      (await this.checkMonitoredPageDuplicate(
        projectId,
        data.canonicalUrl,
        pageId,
      ))
    ) {
      throw new DuplicateResourceError("URL already monitored.");
    }

    const updated: MonitoredPage = {
      ...page,
      ...data,
      updatedAt: this.nextTimestamp(),
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

  // --- AuditPersistenceStore implementation ---

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
    if (idempotencyKey) {
      const existing = await this.findRunByIdempotencyKey(
        orgId,
        pageId,
        idempotencyKey,
      );
      if (existing) {
        return { run: existing, isExisting: true };
      }
    }

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

    // Update monitored page latest_audit_run_id
    const page = this.pages.get(pageId);
    if (page) {
      page.latestAuditRunId = id;
      page.updatedAt = now;
    }

    return { run, isExisting: false };
  }

  async recordRunFailure(
    orgId: string,
    _projectId: string,
    pageId: string,
    runId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    const run = this.runs.get(runId);
    const now = this.nextTimestamp();
    if (run && run.organizationId === orgId) {
      run.status = "failed";
      run.failedAt = now;
      run.errorCode = error.code;
      run.errorMessage = error.message;
      run.retryable = error.retryable;
      run.updatedAt = now;
    }

    // Crucial: page.latestAuditRunId is updated to failed run, but latestSuccessfulAuditRunId is UNTOUCHED
    const page = this.pages.get(pageId);
    if (page && page.organizationId === orgId) {
      page.latestAuditRunId = runId;
      page.updatedAt = now;
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
    const run = this.runs.get(runId);
    if (!run || run.organizationId === orgId) {
      if (run) {
        run.status = "completed";
        run.finalUrl = finalUrl;
        run.completedAt = this.nextTimestamp();
        run.updatedAt = run.completedAt;
      }
    }

    const reportId = crypto.randomUUID();
    const now = this.nextTimestamp();
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

    // Score snapshots
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

    // Findings
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
        category: tp.category ?? "clarity",
        title: tp.title,
        severity: tp.severity,
        evidence: tp.evidence,
        basis: tp.basis,
        signalIds: tp.signalIds,
        recommendation: tp.recommendation,
        displayOrder: displayOrder++,
        workStatus: "open",
        createdAt: now,
      });
    }

    for (const cat of report.categories) {
      for (const f of cat.findings) {
        const fId = crypto.randomUUID();
        this.findings.set(fId, {
          id: fId,
          auditReportId: reportId,
          auditRunId: runId,
          monitoredPageId: pageId,
          projectId,
          organizationId: orgId,
          findingType: "category_finding",
          category: cat.category,
          title: f.title,
          severity: f.severity,
          evidence: f.evidence,
          basis: f.basis,
          signalIds: f.signalIds,
          recommendation: f.recommendation,
          displayOrder: displayOrder++,
          workStatus: "open",
          createdAt: now,
        });
      }
    }

    // Recommendations
    let recOrder = 0;
    for (const qw of report.quickWins) {
      const rId = crypto.randomUUID();
      this.recommendations.set(rId, {
        id: rId,
        auditReportId: reportId,
        auditRunId: runId,
        monitoredPageId: pageId,
        projectId,
        organizationId: orgId,
        recommendationType: "quick_win",
        category: qw.category ?? null,
        title: qw.title,
        detail: qw.detail,
        displayOrder: recOrder++,
        createdAt: now,
      });
    }

    for (const dr of report.detailedRecommendations) {
      const rId = crypto.randomUUID();
      this.recommendations.set(rId, {
        id: rId,
        auditReportId: reportId,
        auditRunId: runId,
        monitoredPageId: pageId,
        projectId,
        organizationId: orgId,
        recommendationType: "detailed",
        category: dr.category ?? null,
        title: dr.title,
        detail: dr.detail,
        displayOrder: recOrder++,
        createdAt: now,
      });
    }

    // Update monitored page pointers
    const page = this.pages.get(pageId);
    if (page) {
      page.latestAuditRunId = runId;
      page.latestSuccessfulAuditRunId = runId;
      page.updatedAt = now;
    }

    return { auditReportId: reportId };
  }

  async listAuditHistory(
    orgId: string,
    _projectId: string,
    pageId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ audits: AuditHistoryItem[]; total: number }> {
    const pageRuns = Array.from(this.runs.values())
      .filter((r) => r.organizationId === orgId && r.monitoredPageId === pageId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = pageRuns.length;
    const paginated = pageRuns.slice(offset, offset + limit);

    const items: AuditHistoryItem[] = paginated.map((run) => {
      const report = Array.from(this.reports.values()).find(
        (rep) => rep.auditRunId === run.id,
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

    return { audits: items, total };
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

    return this.getAuditReportByRunId(
      orgId,
      projectId,
      pageId,
      page.latestSuccessfulAuditRunId,
    );
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

// Mock sample report fixture
function createSampleAuditReport(url: string = "https://example.com"): Report {
  return {
    source: {
      requestedUrl: url,
      finalUrl: `${url}/`,
      analyzedAt: new Date().toISOString(),
      title: "Sample Landing Page",
    },
    overallScore: 84,
    scoreConfidence: "blended",
    summary: "Clear layout with high conversion potential.",
    categories: [
      {
        category: "clarity",
        score: 85,
        confidence: "blended",
        explanation: "Clear headline.",
        severity: "low",
        findings: [],
      },
      {
        category: "visualHierarchy",
        score: 85,
        confidence: "blended",
        explanation: "Strong hierarchy.",
        severity: "low",
        findings: [],
      },
      {
        category: "ctaEffectiveness",
        score: 90,
        confidence: "blended",
        explanation: "Effective CTA.",
        severity: "low",
        findings: [],
      },
      {
        category: "copy",
        score: 80,
        confidence: "blended",
        explanation: "Engaging copy.",
        severity: "low",
        findings: [],
      },
      {
        category: "accessibility",
        score: 85,
        confidence: "ai-led",
        explanation: "Good contrast.",
        severity: "low",
        findings: [],
      },
      {
        category: "mobileUx",
        score: 80,
        confidence: "blended",
        explanation: "Responsive.",
        severity: "low",
        findings: [],
      },
      {
        category: "trustCredibility",
        score: 82,
        confidence: "blended",
        explanation: "Trust signals present.",
        severity: "low",
        findings: [],
      },
    ],
    topProblems: [
      {
        title: "Test Top Problem 1",
        severity: "medium",
        evidence: "Missing testimonial quote.",
        basis: "observed",
        signalIds: [],
        recommendation: "Add testimonial quote.",
        category: "trustCredibility",
      },
      {
        title: "Test Top Problem 2",
        severity: "medium",
        evidence: "Button color low contrast.",
        basis: "observed",
        signalIds: [],
        recommendation: "Boost button contrast.",
        category: "accessibility",
      },
      {
        title: "Test Top Problem 3",
        severity: "low",
        evidence: "Header text wrap on mobile.",
        basis: "inferred",
        signalIds: [],
        recommendation: "Shorten header.",
        category: "mobileUx",
      },
    ],
    quickWins: [
      {
        title: "Fix button contrast",
        detail: "Ensure 4.5:1 ratio.",
        category: "accessibility",
      },
      {
        title: "Add guarantee badge",
        detail: "30 day money back guarantee.",
        category: "trustCredibility",
      },
      {
        title: "Clear subheader",
        detail: "Explain outcome in 1 sentence.",
        category: "clarity",
      },
    ],
    detailedRecommendations: [
      {
        title: "Redesign hero section",
        detail: "Create focused hero layout with single CTA.",
        category: "ctaEffectiveness",
      },
    ],
    observedSignals: [],
  };
}

describe("Audits Persistence & History API Integration", () => {
  const orgAId = "00000000-0000-4000-8000-000000000001";
  const orgBId = "00000000-0000-4000-8000-000000000002";
  const userAId = "11111111-1111-4111-8111-111111111111";
  const userBId = "22222222-2222-4222-8222-222222222222";

  function createTestContext(customRole: Role = "owner", orgId: string = orgAId, userId: string = userAId) {
    const db = new InMemoryDatabase();

    const app = createApp({
      getProjectsStore: () => db,
      getAuditStore: () => db,
      analyzeUrl: async (url: string) => ({
        ok: true,
        report: createSampleAuditReport(url),
      }),
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

  it("triggers manual audit: creates run, analyzes, persists report aggregate atomically, and returns 201", async () => {
    const { db, app } = createTestContext("owner");

    // Setup project and monitored page
    const project = await db.createProject(orgAId, userAId, { name: "Growth App", domain: "https://growth.app" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, { canonicalUrl: "https://growth.app/pricing" });

    const res = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer valid-token")
      .send({ idempotencyKey: "test-run-1" });

    expect(res.status).toBe(201);
    expect(res.body.auditRun).toBeDefined();
    expect(res.body.auditRun.status).toBe("completed");
    expect(res.body.auditRun.monitoredPageId).toBe(page.id);
    expect(res.body.auditRun.idempotencyKey).toBe("test-run-1");
    expect(res.body.report).toBeDefined();
    expect(res.body.report.overallScore).toBe(84);
    expect(res.body.auditReportId).toBeDefined();

    // Verify DB state
    const updatedPage = db.pages.get(page.id)!;
    expect(updatedPage.latestAuditRunId).toBe(res.body.auditRun.id);
    expect(updatedPage.latestSuccessfulAuditRunId).toBe(res.body.auditRun.id);

    // Verify report aggregate persisted
    expect(db.reports.size).toBe(1);
    expect(db.snapshots.size).toBe(7);
    expect(db.findings.size).toBeGreaterThanOrEqual(3);
    expect(db.recommendations.size).toBeGreaterThanOrEqual(4);
  });

  it("handles idempotent retries: returns 200 OK with existing completed report and does not re-run engine", async () => {
    const { db, app } = createTestContext("member");

    const project = await db.createProject(orgAId, userAId, { name: "Growth App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, { canonicalUrl: "https://growth.app/landing" });

    // 1st request -> 201 Created
    const res1 = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer valid-token")
      .send({ idempotencyKey: "idempotent-key-xyz" });

    expect(res1.status).toBe(201);
    const runId1 = res1.body.auditRun.id;

    // 2nd request with same idempotencyKey -> 200 OK with same run & report
    const res2 = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer valid-token")
      .send({ idempotencyKey: "idempotent-key-xyz" });

    expect(res2.status).toBe(200);
    expect(res2.body.auditRun.id).toBe(runId1);
    expect(res2.body.isIdempotentReplay).toBe(true);
    expect(res2.body.report.overallScore).toBe(84);

    // Verify only 1 run and 1 report exist in database
    expect(db.runs.size).toBe(1);
    expect(db.reports.size).toBe(1);
  });

  it("preserves last successful report when a subsequent audit fails", async () => {
    let shouldFail = false;
    const db = new InMemoryDatabase();

    const app = createApp({
      getProjectsStore: () => db,
      getAuditStore: () => db,
      analyzeUrl: async (url: string) => {
        if (shouldFail) {
          return {
            ok: false,
            status: 504,
            code: "TIMEOUT",
            message: "Target site timed out.",
            retryable: true,
          };
        }
        return {
          ok: true,
          report: createSampleAuditReport(url),
        };
      },
      verifyToken: async () => ({
        id: userAId,
        email: "alex@acme.com",
        app_metadata: {},
        user_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
      }),
      resolveWorkspace: async () => ({
        user: { id: userAId, email: "alex@acme.com" },
        profile: {
          id: userAId,
          email: "alex@acme.com",
          fullName: "Alex",
          avatarUrl: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        organization: {
          id: orgAId,
          name: "Acme",
          slug: "acme",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        membership: {
          id: crypto.randomUUID(),
          organizationId: orgAId,
          userId: userAId,
          role: "owner",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        role: "owner",
      }),
    });

    const project = await db.createProject(orgAId, userAId, { name: "App" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, { canonicalUrl: "https://growth.app" });

    // Run 1: Successful audit
    const res1 = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({});
    expect(res1.status).toBe(201);
    const run1Id = res1.body.auditRun.id;

    const pageAfterRun1 = db.pages.get(page.id)!;
    expect(pageAfterRun1.latestSuccessfulAuditRunId).toBe(run1Id);
    expect(pageAfterRun1.latestAuditRunId).toBe(run1Id);

    // Run 2: Failed audit
    shouldFail = true;
    const res2 = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({});
    expect(res2.status).toBe(504);
    expect(res2.body.error.code).toBe("TIMEOUT");

    const pageAfterRun2 = db.pages.get(page.id)!;
    // latestAuditRunId points to failed run 2
    expect(pageAfterRun2.latestAuditRunId).not.toBe(run1Id);
    // CRITICAL: latestSuccessfulAuditRunId remains pointing to run 1!
    expect(pageAfterRun2.latestSuccessfulAuditRunId).toBe(run1Id);

    // Fetching /latest returns Run 1's successful report
    const resLatest = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/latest`)
      .set("Authorization", "Bearer token");
    expect(resLatest.status).toBe(200);
    expect(resLatest.body.auditRun.id).toBe(run1Id);
    expect(resLatest.body.report.overallScore).toBe(84);
  });

  it("enforces role matrix: viewer receives 403 on POST audit but 200 on GET history/report", async () => {
    const { db, app } = createTestContext("viewer");

    const project = await db.createProject(orgAId, userAId, { name: "Project" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, { canonicalUrl: "https://growth.app" });

    // Viewer POST audit -> 403 FORBIDDEN
    const resPost = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({});
    expect(resPost.status).toBe(403);
    expect(resPost.body.error.code).toBe("FORBIDDEN");

    // Viewer GET history -> 200 OK
    const resGetHistory = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer token");
    expect(resGetHistory.status).toBe(200);
    expect(resGetHistory.body.audits).toEqual([]);
  });

  it("enforces tenant isolation and returns 404 for cross-tenant or mismatched page IDs", async () => {
    const { db, app } = createTestContext("owner", orgAId, userAId);

    const projectA = await db.createProject(orgAId, userAId, { name: "Org A Project" });
    const pageA = await db.createMonitoredPage(orgAId, projectA.id, userAId, { canonicalUrl: "https://a.com" });

    const projectB = await db.createProject(orgBId, userBId, { name: "Org B Project" });
    const pageB = await db.createMonitoredPage(orgBId, projectB.id, userBId, { canonicalUrl: "https://b.com" });

    // User A trying to audit Page B in Project B -> 404 NOT_FOUND
    const resCrossOrg = await request(app)
      .post(`/api/projects/${projectB.id}/pages/${pageB.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({});
    expect(resCrossOrg.status).toBe(404);

    // User A trying to audit Page A using Project B's ID (mismatched) -> 404 NOT_FOUND
    const resMismatched = await request(app)
      .post(`/api/projects/${projectB.id}/pages/${pageA.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({});
    expect(resMismatched.status).toBe(404);
  });

  it("lists audit history with pagination and gets specific audit report by run ID", async () => {
    const { db, app } = createTestContext("owner");

    const project = await db.createProject(orgAId, userAId, { name: "History Project" });
    const page = await db.createMonitoredPage(orgAId, project.id, userAId, { canonicalUrl: "https://growth.app" });

    // Trigger two audits
    const res1 = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({ idempotencyKey: "run-1" });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post(`/api/projects/${project.id}/pages/${page.id}/audits`)
      .set("Authorization", "Bearer token")
      .send({ idempotencyKey: "run-2" });
    expect(res2.status).toBe(201);

    // List history
    const resList = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits?limit=10&offset=0`)
      .set("Authorization", "Bearer token");
    expect(resList.status).toBe(200);
    expect(resList.body.total).toBe(2);
    expect(resList.body.audits).toHaveLength(2);
    expect(resList.body.audits[0].id).toBe(res2.body.auditRun.id);

    // Get specific report by run ID
    const resSpecific = await request(app)
      .get(`/api/projects/${project.id}/pages/${page.id}/audits/${res1.body.auditRun.id}`)
      .set("Authorization", "Bearer token");
    expect(resSpecific.status).toBe(200);
    expect(resSpecific.body.auditRun.id).toBe(res1.body.auditRun.id);
    expect(resSpecific.body.scoreSnapshots).toHaveLength(7);
    expect(resSpecific.body.findings.length).toBeGreaterThanOrEqual(3);
    expect(resSpecific.body.recommendations.length).toBeGreaterThanOrEqual(4);
  });

  it("preserves anonymous POST /api/analyze without authentication", async () => {
    const { app } = createTestContext("owner");

    const res = await request(app)
      .post("/api/analyze")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body.report).toBeDefined();
    expect(res.body.report.overallScore).toBe(84);
  });
});
