import { describe, it, expect, vi } from "vitest";
import { createAuditWorkflow } from "../src/functions/audit-workflow.js";
import type {
  AuditRun,
  MonitoredPage,
  Report,
  AuditScreenshotMetadata,
  VisualDiffResult,
} from "@pagepilot/contracts";
import type {
  WorkflowPersistenceStore,
  WorkflowScreenshotStore,
  WorkflowVisualDiffStore,
} from "../src/types.js";
import {
  generateSyntheticBlockHashes,
} from "@pagepilot/audit-engine";

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
    overallScore: 85,
    scoreConfidence: "blended",
    summary: "High quality landing page.",
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
        score: 80,
        confidence: "blended",
        explanation: "Good CTA visibility.",
        severity: "low",
        findings: [],
      },
      {
        category: "copy",
        score: 85,
        confidence: "blended",
        explanation: "Engaging copy.",
        severity: "low",
        findings: [],
      },
      {
        category: "accessibility",
        score: 90,
        confidence: "blended",
        explanation: "Good accessibility.",
        severity: "low",
        findings: [],
      },
      {
        category: "mobileUx",
        score: 85,
        confidence: "blended",
        explanation: "Responsive layout.",
        severity: "low",
        findings: [],
      },
      {
        category: "trustCredibility",
        score: 85,
        confidence: "blended",
        explanation: "Trust signals present.",
        severity: "low",
        findings: [],
      },
    ],
    topProblems: [],
    quickWins: [],
    detailedRecommendations: [],
    observedSignals: [],
  };
}

describe("Audit Workflow Step 6 — Detect Visual Regression", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440001";
  const projectId = "550e8400-e29b-41d4-a716-446655440002";
  const pageId = "550e8400-e29b-41d4-a716-446655440003";
  const runId = "550e8400-e29b-41d4-a716-446655440004";
  const baselineRunId = "550e8400-e29b-41d4-a716-446655440005";

  const mockRun: AuditRun = {
    id: runId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    targetUrl: "https://example.com",
    status: "running",
    invocationType: "manual",
    modelVersion: "test-model",
    checkVersion: "1.0.0",
    promptVersion: "1.0.0",
    scoringVersion: "1.0.0",
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockPage: MonitoredPage = {
    id: pageId,
    organizationId: orgId,
    projectId,
    canonicalUrl: "https://example.com",
    cadence: "weekly",
    status: "active",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const desktopHashes = generateSyntheticBlockHashes({ seed: "desktop-test" });
  const mobileHashes = generateSyntheticBlockHashes({ seed: "mobile-test" });

  const currentScreenshots: AuditScreenshotMetadata[] = [
    {
      id: "550e8400-e29b-41d4-a716-446655440010",
      auditRunId: runId,
      monitoredPageId: pageId,
      projectId,
      organizationId: orgId,
      deviceType: "desktop",
      captureType: "viewport",
      storagePath: "orgs/1/desktop.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 150000,
      mimeType: "image/webp",
      width: 1280,
      height: 800,
      capturedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      perceptualHash: desktopHashes.perceptualHash,
      blockHashes: desktopHashes.blockHashes,
    },
    {
      id: "550e8400-e29b-41d4-a716-446655440011",
      auditRunId: runId,
      monitoredPageId: pageId,
      projectId,
      organizationId: orgId,
      deviceType: "mobile",
      captureType: "viewport",
      storagePath: "orgs/1/mobile.webp",
      storageBucket: "audit-screenshots",
      fileSizeBytes: 95000,
      mimeType: "image/webp",
      width: 375,
      height: 812,
      capturedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      perceptualHash: mobileHashes.perceptualHash,
      blockHashes: mobileHashes.blockHashes,
    },
  ];

  it("handles initial baseline run when no previous screenshots exist", async () => {
    const persistedDiffs: VisualDiffResult[] = [];

    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(mockRun),
      getMonitoredPage: vi.fn().mockResolvedValue(mockPage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", runId }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "rep-1" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
      persistAlert: vi.fn(),
    };

    const mockScreenshotStore: Partial<WorkflowScreenshotStore> = {
      listScreenshots: vi.fn().mockResolvedValue(currentScreenshots),
    };

    const mockVisualDiffStore: WorkflowVisualDiffStore = {
      getVisualDiffsForRun: vi.fn().mockResolvedValue([]),
      persistVisualDiff: vi.fn().mockImplementation(async (diff) => {
        persistedDiffs.push(diff);
        return diff;
      }),
      getPreviousAuditScreenshots: vi.fn().mockResolvedValue([]),
    };

    const client = createMockInngest();
    const workflow: any = createAuditWorkflow({
      client: client as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore as any,
      visualDiffStore: mockVisualDiffStore,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
    });

    const result = await workflow.execute({
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.visualDiffStatus).toBe("completed");
    expect(result.visualDiffCount).toBe(2);
    expect(persistedDiffs).toHaveLength(2);
    expect(persistedDiffs[0]!.status).toBe("baseline");
    expect(persistedDiffs[0]!.isBaseline).toBe(true);
    expect(persistedDiffs[0]!.visualChangeScore).toBe(0);
    expect(persistedDiffs[0]!.isMeaningfulChange).toBe(false);
  });

  it("compares consecutive audit runs and detects visual difference", async () => {
    const persistedDiffs: VisualDiffResult[] = [];

    // Baseline screenshots with slight difference in hero
    const baselineDesktopHashes = generateSyntheticBlockHashes({
      seed: "desktop-baseline",
      heroVariation: 0.8,
    });

    const baselineScreenshots: AuditScreenshotMetadata[] = [
      {
        ...currentScreenshots[0]!,
        id: "550e8400-e29b-41d4-a716-446655440020",
        auditRunId: baselineRunId,
        perceptualHash: baselineDesktopHashes.perceptualHash,
        blockHashes: baselineDesktopHashes.blockHashes,
      },
      {
        ...currentScreenshots[1]!,
        id: "550e8400-e29b-41d4-a716-446655440021",
        auditRunId: baselineRunId,
        perceptualHash: mobileHashes.perceptualHash,
        blockHashes: mobileHashes.blockHashes,
      },
    ];

    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(mockRun),
      getMonitoredPage: vi.fn().mockResolvedValue(mockPage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", runId }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "rep-1" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
      persistAlert: vi.fn(),
    };

    const mockScreenshotStore: Partial<WorkflowScreenshotStore> = {
      listScreenshots: vi.fn().mockResolvedValue(currentScreenshots),
    };

    const mockVisualDiffStore: WorkflowVisualDiffStore = {
      getVisualDiffsForRun: vi.fn().mockResolvedValue([]),
      persistVisualDiff: vi.fn().mockImplementation(async (diff) => {
        persistedDiffs.push(diff);
        return diff;
      }),
      getPreviousAuditScreenshots: vi.fn().mockResolvedValue(baselineScreenshots),
    };

    const client = createMockInngest();
    const workflow: any = createAuditWorkflow({
      client: client as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore as any,
      visualDiffStore: mockVisualDiffStore,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
    });

    const result = await workflow.execute({
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.visualDiffStatus).toBe("completed");
    expect(result.visualDiffCount).toBe(2);

    const desktopDiff = persistedDiffs.find((d) => d.deviceType === "desktop");
    expect(desktopDiff).toBeDefined();
    expect(desktopDiff!.isBaseline).toBe(false);
    expect(desktopDiff!.baselineAuditRunId).toBe(baselineRunId);
    expect(desktopDiff!.status).toBe("completed");
    expect(desktopDiff!.heroZoneChange).toBeGreaterThan(0);

    // Mobile was identical
    const mobileDiff = persistedDiffs.find((d) => d.deviceType === "mobile");
    expect(mobileDiff).toBeDefined();
    expect(mobileDiff!.visualChangeScore).toBe(0);
    expect(mobileDiff!.isMeaningfulChange).toBe(false);
  });

  it("skips comparison idempotently when diffs already exist", async () => {
    const existingDiffs: VisualDiffResult[] = [
      {
        currentAuditRunId: runId,
        deviceType: "desktop",
        captureType: "viewport",
        status: "completed",
        isBaseline: false,
        isMeaningfulChange: false,
        visualChangeScore: 0,
        changeSeverity: "negligible",
        heroZoneChange: 0,
        bodyZoneChange: 0,
        footerZoneChange: 0,
        changedBlocksCount: 0,
        totalBlocksCount: 32,
        heightDeltaPx: 0,
        changeReasons: [],
        schemaVersion: "1.0.0",
        diffAlgorithm: "block_perceptual_hash_v1",
      },
      {
        currentAuditRunId: runId,
        deviceType: "mobile",
        captureType: "viewport",
        status: "completed",
        isBaseline: false,
        isMeaningfulChange: false,
        visualChangeScore: 0,
        changeSeverity: "negligible",
        heroZoneChange: 0,
        bodyZoneChange: 0,
        footerZoneChange: 0,
        changedBlocksCount: 0,
        totalBlocksCount: 32,
        heightDeltaPx: 0,
        changeReasons: [],
        schemaVersion: "1.0.0",
        diffAlgorithm: "block_perceptual_hash_v1",
      },
    ];

    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(mockRun),
      getMonitoredPage: vi.fn().mockResolvedValue(mockPage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", runId }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "rep-1" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
      persistAlert: vi.fn(),
    };

    const mockScreenshotStore: Partial<WorkflowScreenshotStore> = {
      listScreenshots: vi.fn().mockResolvedValue(currentScreenshots),
    };

    const mockVisualDiffStore: WorkflowVisualDiffStore = {
      getVisualDiffsForRun: vi.fn().mockResolvedValue(existingDiffs),
      persistVisualDiff: vi.fn(),
      getPreviousAuditScreenshots: vi.fn(),
    };

    const client = createMockInngest();
    const workflow: any = createAuditWorkflow({
      client: client as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore as any,
      visualDiffStore: mockVisualDiffStore,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
    });

    const result = await workflow.execute({
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.visualDiffStatus).toBe("already_completed");
    expect(mockVisualDiffStore.persistVisualDiff).not.toHaveBeenCalled();
  });

  it("isolates visual diff failure so static audit and alerts still succeed", async () => {
    const mockAuditStore: Partial<WorkflowPersistenceStore> = {
      getAuditRun: vi.fn().mockResolvedValue(mockRun),
      getMonitoredPage: vi.fn().mockResolvedValue(mockPage),
      claimRunForExecution: vi.fn().mockResolvedValue({ state: "claimed", runId }),
      persistCompletedAudit: vi.fn().mockResolvedValue({ auditReportId: "rep-1" }),
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
      persistAlert: vi.fn(),
    };

    const mockScreenshotStore: Partial<WorkflowScreenshotStore> = {
      listScreenshots: vi.fn().mockResolvedValue(currentScreenshots),
    };

    const recordFailureFn = vi.fn().mockResolvedValue(undefined);
    const mockVisualDiffStore: WorkflowVisualDiffStore = {
      getVisualDiffsForRun: vi.fn().mockResolvedValue([]),
      persistVisualDiff: vi.fn().mockRejectedValue(new Error("Database connection dropped")),
      getPreviousAuditScreenshots: vi.fn().mockResolvedValue([]),
      recordVisualDiffFailure: recordFailureFn,
    };

    const client = createMockInngest();
    const workflow: any = createAuditWorkflow({
      client: client as any,
      auditStore: mockAuditStore as any,
      screenshotStore: mockScreenshotStore as any,
      visualDiffStore: mockVisualDiffStore,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: sampleStaticReport() }),
    });

    const result = await workflow.execute({
      data: {
        auditRunId: runId,
        organizationId: orgId,
        projectId,
        monitoredPageId: pageId,
      },
    });

    // Static audit still succeeded!
    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.overallScore).toBe(85);
    // Visual diff is marked failed without disrupting static audit
    expect(result.visualDiffStatus).toBe("failed");
    expect(recordFailureFn).toHaveBeenCalledWith(
      expect.objectContaining({
        auditRunId: runId,
        errorMessage: expect.stringContaining("Database connection dropped"),
      })
    );
  });
});
