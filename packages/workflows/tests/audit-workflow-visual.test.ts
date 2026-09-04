import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_CATEGORIES,
  AUDIT_REQUESTED_EVENT,
  SCREENSHOT_STORAGE_BUCKET,
} from "@pagepilot/contracts";
import type {
  AuditRun,
  CategoryReport,
  MonitoredPage,
  Report,
  AuditScreenshotMetadata,
} from "@pagepilot/contracts";
import { MockBrowserCaptureProvider } from "@pagepilot/audit-engine";
import { createAuditWorkflow } from "../src/functions/audit-workflow.js";
import type {
  ClaimRunResult,
  WorkflowPersistenceStore,
  WorkflowScreenshotStore,
} from "../src/types.js";

const placeholderCategories: CategoryReport[] = AUDIT_CATEGORIES.map(
  (category) => ({
    category,
    score: 80,
    confidence: "blended",
    severity: "low",
    explanation: "Sample explanation.",
    findings: [],
  })
);

const sampleReport: Report = {
  source: {
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    analyzedAt: "2026-09-06T12:00:00.000Z",
    title: "Example Landing Page",
  },
  overallScore: 80,
  scoreConfidence: "blended",
  summary: "Visual test summary.",
  categories: placeholderCategories,
  topProblems: [],
  quickWins: [],
  detailedRecommendations: [],
  observedSignals: [
    {
      id: "title.present",
      category: "clarity",
      status: "pass",
      weight: 0.5,
      evidence: "Title is present.",
    },
  ],
};

const sampleRun: AuditRun = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  organizationId: "550e8400-e29b-41d4-a716-446655440001",
  projectId: "550e8400-e29b-41d4-a716-446655440002",
  monitoredPageId: "550e8400-e29b-41d4-a716-446655440003",
  invocationType: "scheduled",
  status: "queued",
  targetUrl: "https://example.com",
  finalUrl: null,
  triggeredByUserId: null,
  idempotencyKey: "test-idempotency-key",
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
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};

const samplePage: MonitoredPage = {
  id: "550e8400-e29b-41d4-a716-446655440003",
  projectId: "550e8400-e29b-41d4-a716-446655440002",
  organizationId: "550e8400-e29b-41d4-a716-446655440001",
  canonicalUrl: "https://example.com",
  status: "active",
  cadence: "weekly",
  tags: ["landing"],
  latestAuditRunId: "550e8400-e29b-41d4-a716-446655440000",
  latestSuccessfulAuditRunId: null,
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};

const validEvent = {
  name: AUDIT_REQUESTED_EVENT,
  data: {
    auditRunId: sampleRun.id,
    monitoredPageId: samplePage.id,
    projectId: sampleRun.projectId,
    organizationId: sampleRun.organizationId,
    trigger: "scheduled" as const,
  },
};

function createMockStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
  };
}

function createMockStore(
  overrides: Partial<WorkflowPersistenceStore> = {}
): WorkflowPersistenceStore {
  return {
    getAuditRun: vi.fn(async () => sampleRun),
    getMonitoredPage: vi.fn(async () => samplePage),
    listEligibleWeeklyPages: vi.fn(async () => []),
    createScheduledAuditRun: vi.fn(async () => ({
      run: sampleRun,
      isExisting: false,
    })),
    claimRunForExecution: vi.fn(async (): Promise<ClaimRunResult> => ({
      state: "claimed",
      run: { ...sampleRun, status: "running" },
    })),
    persistCompletedAudit: vi.fn(async () => ({
      auditReportId: "550e8400-e29b-41d4-a716-446655440099",
    })),
    recordRunFailure: vi.fn(async () => {}),
    getPreviousSuccessfulAuditReport: vi.fn(async () => null),
    findRecentAlert: vi.fn(async () => null),
    persistAlert: vi.fn(async () => ({
      alert: { id: "alert-123" } as any,
      isExisting: false,
      isSuppressed: false,
    })),
    getAlert: vi.fn(async () => null),
    updateAlertStatus: vi.fn(async () => {}),
    listOrganizationRecipients: vi.fn(async () => []),
    listSubscribedIntegrations: vi.fn(async () => []),
    getOrCreateDelivery: vi.fn(async () => ({
      delivery: { id: "del-1" } as any,
      isExisting: false,
    })),
    recordDeliverySuccess: vi.fn(async () => {}),
    recordDeliveryFailure: vi.fn(async () => {}),
    ...overrides,
  };
}

function createMockScreenshotStore(
  overrides: Partial<WorkflowScreenshotStore> = {}
): WorkflowScreenshotStore {
  const persisted: AuditScreenshotMetadata[] = [];
  const uploaded: Array<{ storagePath: string; buffer: Buffer }> = [];

  return {
    listScreenshots: vi.fn(async (runId: string) =>
      persisted.filter((p) => p.auditRunId === runId)
    ),
    uploadScreenshot: vi.fn(async (params) => {
      uploaded.push(params);
      return { storagePath: params.storagePath };
    }),
    persistScreenshotMetadata: vi.fn(async (meta) => {
      const entry: AuditScreenshotMetadata = {
        ...meta,
        id: `screenshot-${persisted.length + 1}`,
        createdAt: new Date().toISOString(),
      };
      persisted.push(entry);
      return entry;
    }),
    ...overrides,
  };
}

describe("Audit Workflow — Visual Screenshot Step Integration", () => {
  it("captures and persists desktop and mobile screenshots after static audit persistence", async () => {
    const mockStore = createMockStore();
    const mockScreenshotStore = createMockScreenshotStore();
    const mockCapture = new MockBrowserCaptureProvider();

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      screenshotStore: mockScreenshotStore,
      browserCapture: mockCapture,
      analyzeUrl: vi.fn(async () => ({
        ok: true as const,
        report: sampleReport,
      })),
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    const result = await fn({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.auditReportId).toBe("550e8400-e29b-41d4-a716-446655440099");
    expect(result.visualCapturesCount).toBe(2);
    expect(result.visualStatus).toBe("completed");

    expect(mockScreenshotStore.uploadScreenshot).toHaveBeenCalledTimes(2);
    expect(mockScreenshotStore.persistScreenshotMetadata).toHaveBeenCalledTimes(2);

    // Verify storage bucket and device viewports
    expect(mockScreenshotStore.persistScreenshotMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceType: "desktop",
        storageBucket: SCREENSHOT_STORAGE_BUCKET,
        width: 1280,
        height: 800,
      })
    );
    expect(mockScreenshotStore.persistScreenshotMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceType: "mobile",
        storageBucket: SCREENSHOT_STORAGE_BUCKET,
        width: 375,
        height: 812,
      })
    );
  });

  it("failure isolation: screenshot error does not fail or invalidate static audit", async () => {
    const mockStore = createMockStore();
    const mockScreenshotStore = createMockScreenshotStore();
    // Simulate browser capture crash or timeout
    const failingCapture = new MockBrowserCaptureProvider({
      simulateFailure: true,
      failureMessage: "Chromium navigation timed out after 15000ms",
    });

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      screenshotStore: mockScreenshotStore,
      browserCapture: failingCapture,
      analyzeUrl: vi.fn(async () => ({
        ok: true as const,
        report: sampleReport,
      })),
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    // Workflow must NOT throw!
    const result = await fn({ event: validEvent, step: mockStep });

    // Static report remains safely persisted
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.auditReportId).toBe("550e8400-e29b-41d4-a716-446655440099");
    expect(result.overallScore).toBe(80);

    // Visual capture is safely recorded as failed
    expect(result.visualCapturesCount).toBe(0);
    expect(result.visualStatus).toBe("failed");
    expect(mockStore.persistCompletedAudit).toHaveBeenCalledTimes(1);
    expect(mockStore.recordRunFailure).not.toHaveBeenCalled();
  });

  it("idempotency: skips capture if screenshots already exist for the audit run", async () => {
    const existingScreenshots: AuditScreenshotMetadata[] = [
      {
        id: "s1",
        auditRunId: sampleRun.id,
        monitoredPageId: samplePage.id,
        projectId: sampleRun.projectId,
        organizationId: sampleRun.organizationId,
        deviceType: "desktop",
        captureType: "viewport",
        storagePath: "test/desktop.webp",
        storageBucket: SCREENSHOT_STORAGE_BUCKET,
        fileSizeBytes: 1000,
        mimeType: "image/webp",
        width: 1280,
        height: 800,
        capturedAt: "2026-09-06T12:00:00Z",
        createdAt: "2026-09-06T12:00:00Z",
      },
      {
        id: "s2",
        auditRunId: sampleRun.id,
        monitoredPageId: samplePage.id,
        projectId: sampleRun.projectId,
        organizationId: sampleRun.organizationId,
        deviceType: "mobile",
        captureType: "viewport",
        storagePath: "test/mobile.webp",
        storageBucket: SCREENSHOT_STORAGE_BUCKET,
        fileSizeBytes: 800,
        mimeType: "image/webp",
        width: 375,
        height: 812,
        capturedAt: "2026-09-06T12:00:00Z",
        createdAt: "2026-09-06T12:00:00Z",
      },
    ];

    const mockStore = createMockStore();
    const mockScreenshotStore = createMockScreenshotStore({
      listScreenshots: vi.fn(async () => existingScreenshots),
    });
    const mockCapture = new MockBrowserCaptureProvider();
    const captureSpy = vi.spyOn(mockCapture, "capture");

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      screenshotStore: mockScreenshotStore,
      browserCapture: mockCapture,
      analyzeUrl: vi.fn(async () => ({
        ok: true as const,
        report: sampleReport,
      })),
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    const result = await fn({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(mockScreenshotStore.uploadScreenshot).not.toHaveBeenCalled();
    expect(result.visualStatus).toBe("already_completed");
  });
});
