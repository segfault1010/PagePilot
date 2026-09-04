import { describe, it, expect, vi } from "vitest";
import { createAuditWorkflow } from "../src/functions/audit-workflow.js";
import { AUDIT_REQUESTED_EVENT } from "@pagepilot/contracts";
import type {
  AuditRun,
  MonitoredPage,
  Report,
  AuditScreenshotMetadata,
  VisualAnalysisReview,
} from "@pagepilot/contracts";
import type {
  WorkflowPersistenceStore,
  WorkflowScreenshotStore,
  WorkflowVisualAnalysisStore,
} from "../src/types.js";
import { MockVisionAuditor } from "@pagepilot/audit-engine";

function createMockInngest() {
  const sentEvents: any[] = [];
  return {
    sentEvents,
    createFunction: (config: any, fn: any) => ({
      config,
      fn,
      execute: async (data: any) => {
        const step = {
          run: vi.fn().mockImplementation(async (_name: string, cb: () => any) => {
            return await cb();
          }),
        };
        return await fn({ event: data, step });
      },
    }),
    send: vi.fn().mockImplementation(async (events: any) => {
      sentEvents.push(...(Array.isArray(events) ? events : [events]));
    }),
  };
}

function sampleStaticReport(): Report {
  return {
    source: {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      analyzedAt: new Date().toISOString(),
      title: "Example Domain",
    },
    overallScore: 82,
    scoreConfidence: "blended",
    summary: "Solid clean landing page with clear typography and value proposition.",
    categories: [
      {
        category: "clarity",
        score: 85,
        confidence: "blended",
        explanation: "Clear headline structure.",
        severity: "low",
        findings: [],
      },
      {
        category: "visualHierarchy",
        score: 80,
        confidence: "blended",
        explanation: "Strong hierarchy.",
        severity: "low",
        findings: [],
      },
      {
        category: "ctaEffectiveness",
        score: 78,
        confidence: "blended",
        explanation: "Good CTA visibility.",
        severity: "low",
        findings: [],
      },
      {
        category: "copy",
        score: 84,
        confidence: "blended",
        explanation: "Engaging copy.",
        severity: "low",
        findings: [],
      },
      {
        category: "accessibility",
        score: 88,
        confidence: "blended",
        explanation: "Good structure.",
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
        score: 79,
        confidence: "blended",
        explanation: "Trust signals present.",
        severity: "low",
        findings: [],
      },
    ],
    topProblems: [
      {
        title: "Top problem 1",
        severity: "low",
        evidence: "Sample evidence for problem 1",
        basis: "observed",
        signalIds: [],
        recommendation: "Sample recommendation 1",
      },
      {
        title: "Top problem 2",
        severity: "low",
        evidence: "Sample evidence for problem 2",
        basis: "observed",
        signalIds: [],
        recommendation: "Sample recommendation 2",
      },
      {
        title: "Top problem 3",
        severity: "low",
        evidence: "Sample evidence for problem 3",
        basis: "observed",
        signalIds: [],
        recommendation: "Sample recommendation 3",
      },
    ],
    quickWins: [
      { title: "Quick win 1", detail: "Detail for quick win 1" },
      { title: "Quick win 2", detail: "Detail for quick win 2" },
      { title: "Quick win 3", detail: "Detail for quick win 3" },
    ],
    detailedRecommendations: [
      { title: "Detailed recommendation 1", detail: "Detail for recommendation 1" },
    ],
    observedSignals: [],
  };
}

describe("Audit Workflow — Step 5: Visual Hierarchy Review", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440000";
  const projectId = "550e8400-e29b-41d4-a716-446655440001";
  const pageId = "550e8400-e29b-41d4-a716-446655440002";
  const runId = "550e8400-e29b-41d4-a716-446655440003";

  const sampleRun: AuditRun = {
    id: runId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    invocationType: "manual",
    status: "requested",
    targetUrl: "https://example.com",
    retryCount: 0,
    maxRetries: 3,
    modelVersion: "test-model",
    checkVersion: "1.0.0",
    promptVersion: "1.0.0",
    scoringVersion: "1.0.0",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const samplePage: MonitoredPage = {
    id: pageId,
    organizationId: orgId,
    projectId,
    canonicalUrl: "https://example.com",
    status: "active",
    cadence: "weekly",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("successfully captures screenshots, runs vision review, and persists results", async () => {
    const inngest = createMockInngest();
    let persistedReview: VisualAnalysisReview | null = null;

    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(sampleRun),
      getMonitoredPage: vi.fn().mockResolvedValue(samplePage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", run: sampleRun }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "report-123" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
      persistAlert: vi.fn().mockResolvedValue({ alert: {}, isExisting: false, isSuppressed: false }),
    };

    const mockScreenshotStore: WorkflowScreenshotStore = {
      listScreenshots: vi.fn().mockResolvedValue([
        {
          id: "550e8400-e29b-41d4-a716-446655440010",
          auditRunId: runId,
          deviceType: "desktop",
          captureType: "viewport",
          storagePath: "orgs/1/projects/1/pages/1/runs/1/desktop-viewport.webp",
          storageBucket: "audit-screenshots",
          fileSizeBytes: 102400,
          mimeType: "image/webp",
          width: 1280,
          height: 800,
          capturedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        } as AuditScreenshotMetadata,
      ]),
      uploadScreenshot: vi.fn().mockResolvedValue({ storagePath: "path" }),
      persistScreenshotMetadata: vi.fn().mockResolvedValue({} as any),
      downloadScreenshot: vi.fn().mockResolvedValue(Buffer.from("mock-webp-bytes")),
    };

    const mockVisualStore: WorkflowVisualAnalysisStore = {
      getVisualReview: vi.fn().mockResolvedValue(null),
      persistVisualReview: vi.fn().mockImplementation(async (review) => {
        persistedReview = review;
        return review;
      }),
      recordVisualReviewFailure: vi.fn(),
    };

    const mockVisionAuditor = new MockVisionAuditor();

    const workflow = createAuditWorkflow({
      client: inngest as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore,
      visualAnalysisStore: mockVisualStore,
      visionAuditor: mockVisionAuditor,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
      browserCapture: {
        capture: vi.fn().mockResolvedValue({
          targetUrl: "https://example.com",
          capturedAt: new Date().toISOString(),
          durationMs: 150,
          captures: [
            {
              deviceType: "desktop",
              captureType: "viewport",
              buffer: Buffer.from("mock-desktop-webp"),
              mimeType: "image/webp",
              width: 1280,
              height: 800,
              fileSizeBytes: 1024,
              capturedAt: new Date().toISOString(),
            },
          ],
        }),
      },
    });

    const result = await (workflow as any).execute({
      name: AUDIT_REQUESTED_EVENT,
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.overallScore).toBe(82);
    expect(result.visualStatus).toBe("completed");
    expect(result.visualReviewStatus).toBe("completed");
    expect(persistedReview).not.toBeNull();
    expect((persistedReview as any).findings[0]?.basis).toBe("visual_inference");
  });

  it("failure isolation: vision reviewer failure does not fail or rollback the static audit", async () => {
    const inngest = createMockInngest();
    let failureRecorded = false;

    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(sampleRun),
      getMonitoredPage: vi.fn().mockResolvedValue(samplePage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", run: sampleRun }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "report-123" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
    };

    const mockScreenshotStore: WorkflowScreenshotStore = {
      listScreenshots: vi.fn().mockResolvedValue([
        {
          id: "550e8400-e29b-41d4-a716-446655440010",
          auditRunId: runId,
          deviceType: "desktop",
          captureType: "viewport",
          storagePath: "test.webp",
          storageBucket: "audit-screenshots",
          fileSizeBytes: 102400,
          mimeType: "image/webp",
          width: 1280,
          height: 800,
          capturedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        } as AuditScreenshotMetadata,
      ]),
      uploadScreenshot: vi.fn().mockResolvedValue({ storagePath: "path" }),
      persistScreenshotMetadata: vi.fn().mockResolvedValue({} as any),
      downloadScreenshot: vi.fn().mockResolvedValue(Buffer.from("mock-webp-bytes")),
    };

    const mockVisualStore: WorkflowVisualAnalysisStore = {
      getVisualReview: vi.fn().mockResolvedValue(null),
      persistVisualReview: vi.fn(),
      recordVisualReviewFailure: vi.fn().mockImplementation(async () => {
        failureRecorded = true;
      }),
    };

    // Vision auditor that throws an error (e.g. rate limit or timeout)
    const failingVisionAuditor = new MockVisionAuditor({
      errorToThrow: new Error("Gemini quota limit reached (429)"),
    });

    const workflow = createAuditWorkflow({
      client: inngest as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore,
      visualAnalysisStore: mockVisualStore,
      visionAuditor: failingVisionAuditor,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
      browserCapture: {
        capture: vi.fn().mockResolvedValue({
          targetUrl: "https://example.com",
          capturedAt: new Date().toISOString(),
          durationMs: 150,
          captures: [
            {
              deviceType: "desktop",
              captureType: "viewport",
              buffer: Buffer.from("mock-desktop-webp"),
              mimeType: "image/webp",
              width: 1280,
              height: 800,
              fileSizeBytes: 1024,
              capturedAt: new Date().toISOString(),
            },
          ],
        }),
      },
    });

    const result = await (workflow as any).execute({
      name: AUDIT_REQUESTED_EVENT,
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    // Static audit still completely completed!
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.overallScore).toBe(82);
    expect(result.visualStatus).toBe("completed");
    expect(result.visualReviewStatus).toBe("failed");
    expect(failureRecorded).toBe(true);
  });

  it("idempotency: skips vision review if already completed", async () => {
    const inngest = createMockInngest();

    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(sampleRun),
      getMonitoredPage: vi.fn().mockResolvedValue(samplePage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", run: sampleRun }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "report-123" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
    };

    const mockScreenshotStore: WorkflowScreenshotStore = {
      listScreenshots: vi.fn().mockResolvedValue([
        {
          id: "550e8400-e29b-41d4-a716-446655440010",
          auditRunId: runId,
          deviceType: "desktop",
          captureType: "viewport",
          storagePath: "test.webp",
          storageBucket: "audit-screenshots",
          fileSizeBytes: 102400,
          mimeType: "image/webp",
          width: 1280,
          height: 800,
          capturedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        } as AuditScreenshotMetadata,
      ]),
      uploadScreenshot: vi.fn().mockResolvedValue({ storagePath: "path" }),
      persistScreenshotMetadata: vi.fn().mockResolvedValue({} as any),
      downloadScreenshot: vi.fn().mockResolvedValue(Buffer.from("mock-webp-bytes")),
    };

    const runVisionSpy = vi.fn();
    const mockVisionAuditor: any = { runVisualReview: runVisionSpy };

    const mockVisualStore: WorkflowVisualAnalysisStore = {
      getVisualReview: vi.fn().mockResolvedValue({
        status: "completed",
        findings: [{ id: "vis-1" }],
      } as any),
      persistVisualReview: vi.fn(),
    };

    const workflow = createAuditWorkflow({
      client: inngest as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore,
      visualAnalysisStore: mockVisualStore,
      visionAuditor: mockVisionAuditor,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
      browserCapture: {
        capture: vi.fn().mockResolvedValue({
          targetUrl: "https://example.com",
          capturedAt: new Date().toISOString(),
          durationMs: 150,
          captures: [],
        }),
      },
    });

    const result = await (workflow as any).execute({
      name: AUDIT_REQUESTED_EVENT,
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.visualReviewStatus).toBe("already_completed");
    expect(runVisionSpy).not.toHaveBeenCalled();
  });
});
