import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import request from "supertest";
import {
  PlaywrightBrowserCaptureProvider,
  createGeminiVisionAuditor,
  MockVisionAuditor,
} from "@pagepilot/audit-engine";
import {
  AUDIT_CATEGORIES,
  AUDIT_REQUESTED_EVENT,
  VISUAL_DIMENSIONS,
  VISUAL_PROVENANCE_LABEL,
  visualAnalysisReviewSchema,
  type Report,
  type Role,
  type VisualAnalysisReview,
} from "@pagepilot/contracts";
import { createAuditWorkflow } from "@pagepilot/workflows";
import { createApp } from "../src/http/app.js";
import type { VisualAnalysisStore } from "../src/visual-analysis/visual-analysis-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";

const ROOT = join(__dirname, "../../..");

// Load root .env if present
if (existsSync(join(ROOT, ".env"))) {
  const envContent = readFileSync(join(ROOT, ".env"), "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-3.6-flash";

describe("Milestone 6 — Task 6.2: Vision-Assisted Visual Hierarchy Review Runtime Smoke", () => {
  it("verifies live dedicated PagePilot Supabase visual_analysis_reviews table and RLS enforcement", async () => {
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.warn("Skipping Supabase table verification: missing Supabase credentials.");
      return;
    }

    // Must be strictly against dedicated PagePilot project
    expect(supabaseUrl).toContain("qzlffxlmrhqfjeohsnkm.supabase.co");

    const adminClient = createClient(supabaseUrl, serviceKey);
    const anonClient = createClient(supabaseUrl, anonKey);

    // 1. Service client can query visual_analysis_reviews without errors
    const { data: adminRows, error: adminErr } = await adminClient
      .from("visual_analysis_reviews")
      .select("id, audit_run_id, provenance")
      .limit(5);

    expect(adminErr).toBeNull();
    expect(Array.isArray(adminRows)).toBe(true);

    // 2. Anon client has no membership: SELECT returns 0 rows under RLS
    const { data: anonRows, error: anonErr } = await anonClient
      .from("visual_analysis_reviews")
      .select("id")
      .limit(5);

    expect(anonErr).toBeNull();
    expect(anonRows).toHaveLength(0);

    // 3. Anon client INSERT is blocked by RLS
    const { error: insertErr } = await anonClient
      .from("visual_analysis_reviews")
      .insert({
        audit_run_id: "550e8400-e29b-41d4-a716-446655440001",
        monitored_page_id: "550e8400-e29b-41d4-a716-446655440002",
        project_id: "550e8400-e29b-41d4-a716-446655440003",
        organization_id: "550e8400-e29b-41d4-a716-446655440004",
        provenance: VISUAL_PROVENANCE_LABEL,
        model_identifier: "gemini-test",
        status: "completed",
        prompt_version: "1.0.0",
        schema_version: "1.0.0",
        executive_summary: "Unauthorized test insertion",
        dimensions: {},
        findings: [],
      });

    expect(insertErr).not.toBeNull();
    expect(insertErr?.message).toMatch(/violates row-level security|new row violates row-level security/i);
  });

  it("captures real WebP viewport and evaluates with real Gemini Vision provider", async () => {
    if (!geminiKey) {
      console.warn("Skipping real Gemini vision call: missing GEMINI_API_KEY.");
      return;
    }

    // 1. Capture real desktop screenshot using Playwright
    const captureProvider = new PlaywrightBrowserCaptureProvider();
    const captureResult = await captureProvider.capture("https://example.com", {
      viewports: ["desktop", "mobile"],
      captureType: "viewport",
    });

    expect(captureResult.captures.length).toBeGreaterThanOrEqual(1);
    const desktopCapture = captureResult.captures.find((c) => c.deviceType === "desktop");
    const mobileCapture = captureResult.captures.find((c) => c.deviceType === "mobile");
    expect(desktopCapture).toBeDefined();

    // 2. Instantiate real Gemini vision auditor
    const visionAuditor = createGeminiVisionAuditor({
      apiKey: geminiKey,
      model: geminiModel,
      timeoutMs: 60_000,
    });

    const runId = "550e8400-e29b-41d4-a716-446655440010";

    // 3. Evaluate real multimodal review via runVisualReview
    const review = await visionAuditor.runVisualReview({
      auditRunId: runId,
      targetUrl: "https://example.com",
      desktopScreenshot: {
        buffer: desktopCapture!.buffer,
        mimeType: desktopCapture!.mimeType,
        width: desktopCapture!.width,
        height: desktopCapture!.height,
      },
      mobileScreenshot: mobileCapture
        ? {
            buffer: mobileCapture.buffer,
            mimeType: mobileCapture.mimeType,
            width: mobileCapture.width,
            height: mobileCapture.height,
          }
        : undefined,
    });

    // 4. Validate domain schema
    const parseResult = visualAnalysisReviewSchema.safeParse(review);
    expect(parseResult.success).toBe(true);

    // 5. Verify explicit provenance and taxonomy
    expect(review.provenance).toBe(VISUAL_PROVENANCE_LABEL);
    expect(review.auditRunId).toBe(runId);
    expect(review.modelIdentifier).toBe(geminiModel);
    expect(review.executiveSummary?.length).toBeGreaterThan(10);

    // All 7 visual dimensions present
    for (const dim of VISUAL_DIMENSIONS) {
      expect(review.dimensions[dim]).toBeDefined();
      expect(["strong", "adequate", "needs_improvement"]).toContain(
        review.dimensions[dim].rating
      );
      expect(review.dimensions[dim].explanation.length).toBeGreaterThan(5);
    }

    // Visual findings have basis visual_inference
    for (const finding of review.findings) {
      expect(finding.basis).toBe("visual_inference");
      expect(["low", "medium", "high"]).toContain(finding.severity);
      expect(["low", "medium", "high"]).toContain(finding.confidence);
      expect(["desktop", "mobile", "both"]).toContain(finding.targetViewport);
      expect(finding.observation.length).toBeGreaterThan(5);
      expect(finding.impact.length).toBeGreaterThan(5);
      expect(finding.recommendation.length).toBeGreaterThan(5);
    }
  }, 150_000);

  it("proves static HTML audit score, report payload, and snapshots remain strictly invariant", async () => {
    const runId = "550e8400-e29b-41d4-a716-446655440020";
    const pageId = "550e8400-e29b-41d4-a716-446655440021";
    const projectId = "550e8400-e29b-41d4-a716-446655440022";
    const orgId = "550e8400-e29b-41d4-a716-446655440023";
    const reportId = "550e8400-e29b-41d4-a716-446655440024";

    const staticReport: Report = {
      source: {
        requestedUrl: "https://example.com",
        finalUrl: "https://example.com/",
        analyzedAt: new Date().toISOString(),
        title: "Example Page",
      },
      overallScore: 88,
      scoreConfidence: "blended",
      summary: "Static HTML analysis summary",
      categories: AUDIT_CATEGORIES.map((category) => ({
        category,
        score: 88,
        confidence: "blended" as const,
        severity: "low" as const,
        explanation: `${category} explanation`,
        findings: [],
      })),
      topProblems: [],
      quickWins: [],
      detailedRecommendations: [],
      observedSignals: [],
    };

    let persistedOverallScore: number | null = null;
    let persistedReportPayload: Report | null = null;

    const mockStore: any = {
      getAuditRun: async () => ({
        id: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
        invocationType: "scheduled",
        status: "queued",
        targetUrl: "https://example.com",
        finalUrl: null,
        triggeredByUserId: null,
        idempotencyKey: "idem-invariance-test",
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        retryable: null,
        modelVersion: "gemini-2.0-flash",
        checkVersion: "1.0.0",
        promptVersion: "1.0.0",
        scoringVersion: "1.0.0",
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getMonitoredPage: async () => ({
        id: pageId,
        projectId,
        organizationId: orgId,
        canonicalUrl: "https://example.com",
        status: "active",
        cadence: "weekly",
        tags: [],
        latestAuditRunId: runId,
        latestSuccessfulAuditRunId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      claimRunForExecution: async () => ({
        state: "claimed",
        run: { id: runId, status: "running" },
      }),
      persistCompletedAudit: async (
        _orgId: string,
        _projectId: string,
        _pageId: string,
        _runId: string,
        _finalUrl: string | null,
        report: Report
      ) => {
        persistedOverallScore = report.overallScore;
        persistedReportPayload = report;
        return { auditReportId: reportId };
      },
      recordRunFailure: async () => {},
      getPreviousSuccessfulAuditReport: async () => null,
      findRecentAlert: async () => null,
      persistAlert: async () => ({ isExisting: false, isSuppressed: false }),
      listOrganizationRecipients: async () => [],
      listSubscribedIntegrations: async () => [],
      getOrCreateDelivery: async () => ({ delivery: { id: "del-1" }, isExisting: false }),
      recordDeliverySuccess: async () => {},
      recordDeliveryFailure: async () => {},
    };

    const mockScreenshotStore: any = {
      listScreenshots: async () => [
        {
          id: "screen-1",
          auditRunId: runId,
          monitoredPageId: pageId,
          projectId,
          organizationId: orgId,
          deviceType: "desktop",
          captureType: "viewport",
          storagePath: "orgs/test/desktop.webp",
          storageBucket: "audit-screenshots",
          fileSizeBytes: 1000,
          mimeType: "image/webp",
          width: 1280,
          height: 800,
          capturedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      uploadScreenshot: async () => ({ storagePath: "orgs/test/desktop.webp" }),
      persistScreenshotMetadata: async () => ({}),
      downloadScreenshot: async () =>
        Buffer.from(
          "UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v6n/4kAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          "base64"
        ),
    };

    let savedReview: VisualAnalysisReview | null = null;
    const mockVisualStore: any = {
      getVisualReview: async () => savedReview,
      persistVisualReview: async (review: VisualAnalysisReview) => {
        savedReview = review;
        return review;
      },
      recordVisualReviewFailure: async () => {},
    };

    const visionAuditor = new MockVisionAuditor();

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      screenshotStore: mockScreenshotStore,
      visualAnalysisStore: mockVisualStore,
      visionAuditor,
      analyzeUrl: async () => ({
        ok: true,
        report: staticReport,
      }),
    });

    const mockStep = {
      run: async (_name: string, fn: () => Promise<unknown>) => fn(),
    };
    const fn = (workflow as any)["fn"];

    const result = await fn({
      event: {
        name: AUDIT_REQUESTED_EVENT,
        data: {
          auditRunId: runId,
          monitoredPageId: pageId,
          projectId,
          organizationId: orgId,
          trigger: "scheduled",
        },
      },
      step: mockStep,
    });

    // Invariance assertions
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.overallScore).toBe(88); // 100% strictly equal to staticReport.overallScore
    expect(persistedOverallScore).toBe(88);
    expect(persistedReportPayload).toEqual(staticReport);

    // Visual review was produced separately without mutating static findings
    expect(savedReview).not.toBeNull();
    expect((savedReview as any)?.provenance).toBe(VISUAL_PROVENANCE_LABEL);
    expect((savedReview as any)?.auditRunId).toBe(runId);
  });

  it("verifies forced vision failure leaves completed static audit and alert evaluation intact", async () => {
    const runId = "550e8400-e29b-41d4-a716-446655440030";
    const pageId = "550e8400-e29b-41d4-a716-446655440031";
    const projectId = "550e8400-e29b-41d4-a716-446655440032";
    const orgId = "550e8400-e29b-41d4-a716-446655440033";
    const reportId = "550e8400-e29b-41d4-a716-446655440034";

    const failingVisionAuditor = new MockVisionAuditor({
      errorToThrow: new Error("Simulated 429 Quota Exhausted / Gemini Timeout"),
    });

    let alertEvaluated = false;

    const mockStore: any = {
      getAuditRun: async () => ({
        id: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
        invocationType: "scheduled",
        status: "queued",
        targetUrl: "https://example.com",
        finalUrl: null,
        triggeredByUserId: null,
        idempotencyKey: "idem-vision-fail-test",
        startedAt: null,
        completedAt: null,
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        retryable: null,
        modelVersion: "gemini-2.0-flash",
        checkVersion: "1.0.0",
        promptVersion: "1.0.0",
        scoringVersion: "1.0.0",
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      getMonitoredPage: async () => ({
        id: pageId,
        projectId,
        organizationId: orgId,
        canonicalUrl: "https://example.com",
        status: "active",
        cadence: "weekly",
        tags: [],
        latestAuditRunId: runId,
        latestSuccessfulAuditRunId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      claimRunForExecution: async () => ({
        state: "claimed",
        run: { id: runId, status: "running" },
      }),
      persistCompletedAudit: async () => ({ auditReportId: reportId }),
      recordRunFailure: async () => {},
      getPreviousSuccessfulAuditReport: async () => {
        alertEvaluated = true;
        return null;
      },
      findRecentAlert: async () => null,
      persistAlert: async () => ({ isExisting: false, isSuppressed: false }),
      listOrganizationRecipients: async () => [],
      listSubscribedIntegrations: async () => [],
      getOrCreateDelivery: async () => ({ delivery: { id: "del-1" }, isExisting: false }),
      recordDeliverySuccess: async () => {},
      recordDeliveryFailure: async () => {},
    };

    const mockScreenshotStore: any = {
      listScreenshots: async () => [
        {
          id: "screen-1",
          auditRunId: runId,
          monitoredPageId: pageId,
          projectId,
          organizationId: orgId,
          deviceType: "desktop",
          captureType: "viewport",
          storagePath: "orgs/test/desktop.webp",
          storageBucket: "audit-screenshots",
          fileSizeBytes: 1000,
          mimeType: "image/webp",
          width: 1280,
          height: 800,
          capturedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      uploadScreenshot: async () => ({ storagePath: "orgs/test/desktop.webp" }),
      persistScreenshotMetadata: async () => ({}),
      downloadScreenshot: async () =>
        Buffer.from(
          "UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoB+AAA/v6n/4kAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
          "base64"
        ),
    };

    let failureRecorded = false;
    const mockVisualStore: any = {
      getVisualReview: async () => null,
      persistVisualReview: async () => ({}),
      recordVisualReviewFailure: async () => {
        failureRecorded = true;
      },
    };

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      screenshotStore: mockScreenshotStore,
      visualAnalysisStore: mockVisualStore,
      visionAuditor: failingVisionAuditor,
      analyzeUrl: async () => ({
        ok: true,
        report: {
          source: {
            requestedUrl: "https://example.com",
            finalUrl: "https://example.com/",
            analyzedAt: new Date().toISOString(),
            title: "Example Page",
          },
          overallScore: 92,
          scoreConfidence: "blended",
          summary: "Static HTML audit succeeded",
          categories: AUDIT_CATEGORIES.map((category) => ({
            category,
            score: 92,
            confidence: "blended" as const,
            severity: "low" as const,
            explanation: "Clean",
            findings: [],
          })),
          topProblems: [],
          quickWins: [],
          detailedRecommendations: [],
          observedSignals: [],
        },
      }),
    });

    const mockStep = {
      run: async (_name: string, fn: () => Promise<unknown>) => fn(),
    };
    const fn = (workflow as any)["fn"];

    const result = await fn({
      event: {
        name: AUDIT_REQUESTED_EVENT,
        data: {
          auditRunId: runId,
          monitoredPageId: pageId,
          projectId,
          organizationId: orgId,
          trigger: "scheduled",
        },
      },
      step: mockStep,
    });

    // Failure isolation assertions:
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.auditReportId).toBe(reportId);
    expect(result.overallScore).toBe(92);
    expect(result.visualReviewStatus).toBe("failed");
    expect(failureRecorded).toBe(true);
    expect(alertEvaluated).toBe(true); // Step 6 alert evaluation ran cleanly
  });

  it("verifies cross-tenant visual analysis endpoint returns 404", async () => {
    const orgAId = "550e8400-e29b-41d4-a716-446655440041";
    const orgBId = "550e8400-e29b-41d4-a716-446655440042";
    const projectId = "550e8400-e29b-41d4-a716-446655440043";
    const pageId = "550e8400-e29b-41d4-a716-446655440044";
    const runId = "550e8400-e29b-41d4-a716-446655440045";

    const mockProjectsStore: ProjectsStore = {
      async createProject(): Promise<any> { return null; },
      async listProjects(): Promise<any> { return []; },
      async getProjectById(orgId: string, pId: string): Promise<any> {
        // Project belongs exclusively to Org A
        if (pId === projectId && orgId === orgAId) {
          return { id: projectId, organizationId: orgAId, name: "Org A Project" };
        }
        return null;
      },
      async updateProject(): Promise<any> { return null; },
      async deleteProject(): Promise<any> { return true; },
      async checkMonitoredPageDuplicate(): Promise<any> { return false; },
      async createMonitoredPage(): Promise<any> { return null; },
      async listMonitoredPages(): Promise<any> { return []; },
      async getMonitoredPageById(orgId: string, pId: string, pgId: string): Promise<any> {
        if (pgId === pageId && pId === projectId && orgId === orgAId) {
          return { id: pageId, projectId, organizationId: orgAId };
        }
        return null;
      },
      async updateMonitoredPage(): Promise<any> { return null; },
      async deleteMonitoredPage(): Promise<any> { return true; },
    };

    const mockVisualStore: VisualAnalysisStore = {
      async getVisualReview(aRunId: string): Promise<any> {
        if (aRunId === runId) {
          return {
            id: "550e8400-e29b-41d4-a716-446655440099",
            auditRunId: runId,
            monitoredPageId: pageId,
            projectId,
            organizationId: orgAId,
            provenance: VISUAL_PROVENANCE_LABEL,
            modelIdentifier: "gemini-1.5-pro",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
            executiveSummary: "Org A Secret Review",
            dimensions: {},
            findings: [],
            evaluatedAt: new Date().toISOString(),
          };
        }
        return null;
      },
      async getVisualReviewForAuditRun(params): Promise<any> {
        if (
          params.auditRunId === runId &&
          params.organizationId === orgAId &&
          params.projectId === projectId &&
          params.pageId === pageId
        ) {
          return {
            id: "550e8400-e29b-41d4-a716-446655440099",
            auditRunId: runId,
            monitoredPageId: pageId,
            projectId,
            organizationId: orgAId,
            provenance: VISUAL_PROVENANCE_LABEL,
            modelIdentifier: "gemini-1.5-pro",
            promptVersion: "1.0.0",
            schemaVersion: "1.0.0",
            executiveSummary: "Org A Secret Review",
            dimensions: {},
            findings: [],
            evaluatedAt: new Date().toISOString(),
          };
        }
        return null;
      },
      async persistVisualReview(): Promise<any> { return {}; },
      async recordVisualReviewFailure(): Promise<void> {},
    };

    let activeOrgId = orgBId;
    let activeRole: Role = "member";

    const app = createApp({
      getVisualAnalysisStore: () => mockVisualStore,
      getProjectsStore: () => mockProjectsStore,
      verifyToken: async () => ({
        id: "user-123",
        email: "user@example.com",
      }),
      resolveWorkspace: async () => ({
        organization: {
          id: activeOrgId,
          name: "Workspace Org",
          slug: "workspace-org",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        role: activeRole,
      } as any),
    });

    // Request as Org B user -> must safely return 404 (project not found for this tenant)
    activeOrgId = orgBId;
    activeRole = "member";
    const resOrgB = await request(app)
      .get(`/api/projects/${projectId}/pages/${pageId}/audits/${runId}/visual-analysis`)
      .set("Authorization", "Bearer token-org-b");

    expect(resOrgB.status).toBe(404);
    expect(resOrgB.body.error.message).toMatch(/not found/i);

    // Request as Org A viewer -> succeeds with 200 and visual review
    activeOrgId = orgAId;
    activeRole = "viewer";
    const resOrgAViewer = await request(app)
      .get(`/api/projects/${projectId}/pages/${pageId}/audits/${runId}/visual-analysis`)
      .set("Authorization", "Bearer token-org-a");

    expect(resOrgAViewer.status).toBe(200);
    expect(resOrgAViewer.body.visualAnalysis).toBeDefined();
    expect(resOrgAViewer.body.visualAnalysis.auditRunId).toBe(runId);
  });

  it("verifies apps/web/dist contains zero leaked server secrets", () => {
    const distDir = join(ROOT, "apps/web/dist");
    if (!existsSync(distDir)) {
      return;
    }

    const indexHtml = join(distDir, "index.html");
    if (existsSync(indexHtml)) {
      const html = readFileSync(indexHtml, "utf8");
      expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
      expect(html).not.toContain("GEMINI_API_KEY");
      if (serviceKey) {
        expect(html).not.toContain(serviceKey);
      }
      if (geminiKey) {
        expect(html).not.toContain(geminiKey);
      }
    }
  });
});
