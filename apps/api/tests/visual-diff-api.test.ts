import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  TOTAL_GRID_BLOCKS,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_REGRESSION_SCHEMA_VERSION,
  visualDiffResponseSchema,
  type MonitoredPage,
  type Project,
  type Role,
  type VisualDiffResponse,
  type VisualDiffResult,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { VisualDiffStore } from "../src/visual-diff/visual-diff-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";
import type { AuditPersistenceStore, PersistedAuditReport } from "../src/audits/audit-store.js";

class InMemoryProjectsStore implements ProjectsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();

  async createProject(): Promise<any> {
    return null;
  }
  async listProjects(): Promise<any> {
    return [];
  }
  async getProjectById(
    orgId: string,
    projectId: string
  ): Promise<Project | null> {
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

class InMemoryAuditStore implements Partial<AuditPersistenceStore> {
  runs: Map<string, any> = new Map();
  reports: Map<string, any> = new Map();

  async getAuditReportByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string
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

    const report = this.reports.get(runId);
    if (!report) return null;

    return {
      auditRun: run,
      report,
      scoreSnapshots: [],
      findings: [],
      recommendations: [],
    };
  }

  async getPreviousSuccessfulAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    beforeCreatedAt: string
  ): Promise<PersistedAuditReport | null> {
    const matching = Array.from(this.runs.values())
      .filter(
        (r) =>
          r.organizationId === orgId &&
          r.projectId === projectId &&
          r.monitoredPageId === pageId &&
          r.status === "completed" &&
          r.createdAt < beforeCreatedAt
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (matching.length === 0) return null;
    return this.getAuditReportByRunId(orgId, projectId, pageId, matching[0].id);
  }
}

class InMemoryVisualDiffStore implements VisualDiffStore {
  responses: Map<string, VisualDiffResponse> = new Map();

  async getVisualDiffsForRun(): Promise<VisualDiffResult[]> {
    return [];
  }

  async getPreviousAuditScreenshots(): Promise<any[]> {
    return [];
  }

  async persistVisualDiff(diff: VisualDiffResult): Promise<VisualDiffResult> {
    return diff;
  }

  async recordVisualDiffFailure(): Promise<void> {}

  async getVisualDiffResponse(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
    compareRunId?: string;
  }): Promise<VisualDiffResponse | null> {
    const key = `${params.auditRunId}:${params.compareRunId ?? "auto"}`;
    return this.responses.get(key) ?? null;
  }
}

describe("Visual Regression Diff API Endpoints", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440000";
  const foreignOrgId = "550e8400-e29b-41d4-a716-446655440099";
  const projectId = "550e8400-e29b-41d4-a716-446655440001";
  const pageId = "550e8400-e29b-41d4-a716-446655440002";
  const currentRunId = "550e8400-e29b-41d4-a716-446655440003";
  const baselineRunId = "550e8400-e29b-41d4-a716-446655440004";
  const explicitBaselineRunId = "550e8400-e29b-41d4-a716-446655440005";

  const sampleProject: Project = {
    id: projectId,
    organizationId: orgId,
    name: "Alpha Project",
    domain: "example.com",
    timezone: "UTC",
    goals: "Improve conversion",
    createdAt: new Date("2026-09-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
  };

  const samplePage: MonitoredPage = {
    id: pageId,
    organizationId: orgId,
    projectId,
    canonicalUrl: "https://example.com",
    status: "active",
    cadence: "weekly",
    tags: [],
    createdAt: new Date("2026-09-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-09-01T00:00:00Z").toISOString(),
  };

  const currentRun = {
    id: currentRunId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    invocationType: "manual",
    status: "completed",
    targetUrl: "https://example.com",
    createdAt: new Date("2026-09-03T00:00:00Z").toISOString(),
    completedAt: new Date("2026-09-03T00:01:00Z").toISOString(),
    modelVersion: "gemini-3.6-flash",
  };

  const baselineRun = {
    id: baselineRunId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    invocationType: "scheduled",
    status: "completed",
    targetUrl: "https://example.com",
    createdAt: new Date("2026-09-02T00:00:00Z").toISOString(),
    completedAt: new Date("2026-09-02T00:01:00Z").toISOString(),
    modelVersion: "gemini-3.6-flash",
  };

  const explicitBaselineRun = {
    id: explicitBaselineRunId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    invocationType: "manual",
    status: "completed",
    targetUrl: "https://example.com",
    createdAt: new Date("2026-09-01T12:00:00Z").toISOString(),
    completedAt: new Date("2026-09-01T12:01:00Z").toISOString(),
    modelVersion: "gemini-3.6-flash",
  };

  const sampleReportPayload = {
    url: "https://example.com",
    overallScore: 85,
    scoreConfidence: "blended" as const,
    summary: "Sample page summary",
    categories: [
      { category: "clarity", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
      { category: "visualHierarchy", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
      { category: "ctaEffectiveness", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
      { category: "copy", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
      { category: "accessibility", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
      { category: "mobileUx", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
      { category: "trustCredibility", score: 85, confidence: "blended", explanation: "Clear", severity: "low", findings: [] },
    ],
    topProblems: [],
    quickWins: [],
    detailedRecommendations: [],
    observedSignals: [],
  };

  const sampleReportCurrent = {
    id: "550e8400-e29b-41d4-a716-446655440010",
    auditRunId: currentRunId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    overallScore: 85,
    scoreConfidence: "high",
    reportPayload: sampleReportPayload,
    scoringVersion: "1.0.0",
    createdAt: currentRun.completedAt,
  };

  const sampleReportBaseline = {
    id: "550e8400-e29b-41d4-a716-446655440011",
    auditRunId: baselineRunId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    overallScore: 85,
    scoreConfidence: "high",
    reportPayload: sampleReportPayload,
    scoringVersion: "1.0.0",
    createdAt: baselineRun.completedAt,
  };

  const desktopDiffResult: VisualDiffResult = {
    id: "550e8400-e29b-41d4-a716-446655440020",
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    currentAuditRunId: currentRunId,
    baselineAuditRunId: baselineRunId,
    currentScreenshotId: "550e8400-e29b-41d4-a716-446655440030",
    baselineScreenshotId: "550e8400-e29b-41d4-a716-446655440031",
    deviceType: "desktop",
    captureType: "full_page",
    schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
    diffAlgorithm: VISUAL_DIFF_ALGORITHM,
    status: "completed",
    isBaseline: false,
    isMeaningfulChange: true,
    visualChangeScore: 24.5,
    changeSeverity: "moderate",
    heroZoneChange: 22.0,
    bodyZoneChange: 15.0,
    footerZoneChange: 5.0,
    changedBlocksCount: 6,
    totalBlocksCount: TOTAL_GRID_BLOCKS,
    heightDeltaPx: 50,
    changeReasons: [
      "Moderate overall visual difference (25% perceptual change)",
      "Hero section modified by 22% (above-the-fold shift detected)",
    ],
    currentSignedUrl: "https://storage.supabase.co/signed-desktop-current.png",
    baselineSignedUrl: "https://storage.supabase.co/signed-desktop-baseline.png",
    createdAt: new Date().toISOString(),
  };

  const mobileDiffResult: VisualDiffResult = {
    id: "550e8400-e29b-41d4-a716-446655440021",
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    currentAuditRunId: currentRunId,
    baselineAuditRunId: baselineRunId,
    currentScreenshotId: "550e8400-e29b-41d4-a716-446655440032",
    baselineScreenshotId: "550e8400-e29b-41d4-a716-446655440033",
    deviceType: "mobile",
    captureType: "full_page",
    schemaVersion: VISUAL_REGRESSION_SCHEMA_VERSION,
    diffAlgorithm: VISUAL_DIFF_ALGORITHM,
    status: "completed",
    isBaseline: false,
    isMeaningfulChange: false,
    visualChangeScore: 3.2,
    changeSeverity: "negligible",
    heroZoneChange: 1.0,
    bodyZoneChange: 4.0,
    footerZoneChange: 0.0,
    changedBlocksCount: 0,
    totalBlocksCount: TOTAL_GRID_BLOCKS,
    heightDeltaPx: 0,
    changeReasons: ["Negligible visual difference below noise threshold"],
    currentSignedUrl: "https://storage.supabase.co/signed-mobile-current.png",
    baselineSignedUrl: "https://storage.supabase.co/signed-mobile-baseline.png",
    createdAt: new Date().toISOString(),
  };

  const sampleDiffResponse: VisualDiffResponse = {
    diffs: [desktopDiffResult, mobileDiffResult],
    summary: {
      hasVisualDiff: true,
      isBaseline: false,
      isMeaningfulChange: true,
      maxChangeScore: 24.5,
      maxChangeSeverity: "moderate",
      desktopChangeScore: 24.5,
      mobileChangeScore: 3.2,
      changeReasons: [
        "Moderate overall visual difference (25% perceptual change)",
        "Hero section modified by 22% (above-the-fold shift detected)",
      ],
    },
    baselineRunId,
    currentRunId,
  };

  function setupApp(userRole: Role = "member", activeOrgId: string = orgId) {
    const projectsStore = new InMemoryProjectsStore();
    projectsStore.projects.set(projectId, sampleProject);
    projectsStore.pages.set(pageId, samplePage);

    const auditStore = new InMemoryAuditStore();
    auditStore.runs.set(currentRunId, currentRun);
    auditStore.reports.set(currentRunId, sampleReportCurrent);
    auditStore.runs.set(baselineRunId, baselineRun);
    auditStore.reports.set(baselineRunId, sampleReportBaseline);
    auditStore.runs.set(explicitBaselineRunId, explicitBaselineRun);
    auditStore.reports.set(explicitBaselineRunId, {
      ...sampleReportBaseline,
      auditRunId: explicitBaselineRunId,
    });

    const visualDiffStore = new InMemoryVisualDiffStore();
    visualDiffStore.responses.set(
      `${currentRunId}:auto`,
      sampleDiffResponse
    );
    visualDiffStore.responses.set(
      `${currentRunId}:${baselineRunId}`,
      sampleDiffResponse
    );
    visualDiffStore.responses.set(
      `${currentRunId}:${explicitBaselineRunId}`,
      {
        ...sampleDiffResponse,
        baselineRunId: explicitBaselineRunId,
      }
    );

    const app = createApp({
      getProjectsStore: () => projectsStore,
      getAuditStore: () => auditStore as any,
      getVisualDiffStore: () => visualDiffStore,
      verifyToken: async () => ({
        id: "550e8400-e29b-41d4-a716-446655440090",
        email: "tester@example.com",
      }),
      resolveWorkspace: async () =>
        ({
          organization: {
            id: activeOrgId,
            name: "Test Org",
            slug: "test-org",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          membership: {
            id: "mem-1",
            role: userRole,
            organizationId: activeOrgId,
            userId: "550e8400-e29b-41d4-a716-446655440090",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          role: userRole,
        } as any),
    });

    return { app, visualDiffStore, auditStore, projectsStore };
  }

  it("returns 200 with desktop and mobile diffs conforming to visualDiffResponseSchema", async () => {
    const { app } = setupApp("member");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${currentRunId}/visual-diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    const parsed = visualDiffResponseSchema.parse(res.body);
    expect(parsed.diffs).toHaveLength(2);
    expect(parsed.diffs[0].deviceType).toBe("desktop");
    expect(parsed.diffs[0].visualChangeScore).toBe(24.5);
    expect(parsed.diffs[0].currentSignedUrl).toContain("signed-desktop-current");
    expect(parsed.diffs[1].deviceType).toBe("mobile");
    expect(parsed.summary.hasVisualDiff).toBe(true);
    expect(parsed.summary.isMeaningfulChange).toBe(true);
    expect(parsed.summary.maxChangeScore).toBe(24.5);
    expect(parsed.baselineRunId).toBe(baselineRunId);
    expect(parsed.currentRunId).toBe(currentRunId);
  });

  it("permits viewer role (read-only member) to access visual diff", async () => {
    const { app } = setupApp("viewer");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${currentRunId}/visual-diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.summary.hasVisualDiff).toBe(true);
  });

  it("supports optional ?compareRunId=<uuid> parameter", async () => {
    const { app } = setupApp("member");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${currentRunId}/visual-diff?compareRunId=${explicitBaselineRunId}`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.baselineRunId).toBe(explicitBaselineRunId);
  });

  it("returns safe 404 for foreign tenant organization (tenant isolation)", async () => {
    const { app } = setupApp("member", foreignOrgId);

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${currentRunId}/visual-diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns safe 404 when audit run or page does not exist", async () => {
    const { app } = setupApp("member");
    const nonExistentRunId = "550e8400-e29b-41d4-a716-446655440999";

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${nonExistentRunId}/visual-diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns safe 404 for malformed UUID parameters", async () => {
    const { app } = setupApp("member");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/not-a-uuid/visual-diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("handles baseline run with empty screenshots gracefully as valid baseline response", async () => {
    const { app, auditStore } = setupApp("member");
    const newRunId = "550e8400-e29b-41d4-a716-446655440077";
    auditStore.runs.set(newRunId, {
      ...currentRun,
      id: newRunId,
    });
    auditStore.reports.set(newRunId, {
      ...sampleReportCurrent,
      auditRunId: newRunId,
    });

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${newRunId}/visual-diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.summary.isBaseline).toBe(true);
    expect(res.body.summary.hasVisualDiff).toBe(false);
    expect(res.body.diffs).toEqual([]);
    expect(res.body.baselineRunId).toBeNull();
  });

  it("integrates visualDiffSummary into static audit diff endpoint without altering static scores", async () => {
    const { app } = setupApp("member");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${currentRunId}/diff`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.diff).toBeDefined();
    expect(res.body.diff.scoreChanges.overall.currentScore).toBe(85);
    expect(res.body.visualDiffSummary).toBeDefined();
    expect(res.body.visualDiffSummary.hasVisualDiff).toBe(true);
    expect(res.body.visualDiffSummary.isMeaningfulChange).toBe(true);
    expect(res.body.visualDiffSummary.maxChangeScore).toBe(24.5);
  });
});
