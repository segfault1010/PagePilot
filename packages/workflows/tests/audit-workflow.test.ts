import { describe, expect, it, vi } from "vitest";
import { NonRetriableError } from "inngest";
import {
  AUDIT_CATEGORIES,
  AUDIT_REQUESTED_EVENT,
  auditRequestedPayloadSchema,
} from "@pagepilot/contracts";
import type {
  AuditRun,
  CategoryReport,
  MonitoredPage,
  Report,
} from "@pagepilot/contracts";
import { createAuditWorkflow } from "../src/functions/audit-workflow.js";
import { inngestClient } from "../src/client.js";
import type {
  ClaimRunResult,
  WorkflowPersistenceStore,
} from "../src/types.js";

const placeholderCategories: CategoryReport[] = AUDIT_CATEGORIES.map(
  (category) => ({
    category,
    score: 75,
    confidence: "blended",
    severity: "low",
    explanation: "Sample explanation.",
    findings: [],
  }),
);

const sampleReport: Report = {
  source: {
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    analyzedAt: "2026-08-28T12:00:00.000Z",
    title: "Example Landing Page",
  },
  overallScore: 75,
  scoreConfidence: "blended",
  summary: "Sample report summary.",
  categories: placeholderCategories,
  topProblems: [
    {
      title: "Hero CTA needs stronger contrast",
      severity: "medium",
      evidence: "Evidence sample.",
      basis: "observed",
      signalIds: [],
      recommendation: "Improve CTA color contrast.",
      category: "ctaEffectiveness",
    },
  ],
  quickWins: [
    {
      title: "Clarify hero heading",
      detail: "Use concise benefit-oriented text.",
      category: "clarity",
    },
  ],
  detailedRecommendations: [
    {
      title: "Add customer testimonials",
      detail: "Include social proof near the conversion section.",
      category: "trustCredibility",
    },
  ],
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

function createMockStep() {
  return {
    run: vi.fn(async (_name: string, fn: () => Promise<any>) => fn()),
  };
}

describe("Durable Audit Workflow (execute-audit-workflow)", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440001";
  const projectId = "550e8400-e29b-41d4-a716-446655440002";
  const pageId = "550e8400-e29b-41d4-a716-446655440003";
  const runId = "550e8400-e29b-41d4-a716-446655440000";
  const userId = "550e8400-e29b-41d4-a716-446655440004";

  const validEvent = {
    name: AUDIT_REQUESTED_EVENT,
    data: {
      auditRunId: runId,
      organizationId: orgId,
      projectId: projectId,
      monitoredPageId: pageId,
      requestedByUserId: userId,
    },
  };

  const sampleRun: AuditRun = {
    id: runId,
    organizationId: orgId,
    projectId: projectId,
    monitoredPageId: pageId,
    invocationType: "manual",
    status: "requested",
    targetUrl: "https://example.com",
    finalUrl: null,
    triggeredByUserId: userId,
    idempotencyKey: "test-key-123",
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    retryable: null,
    modelVersion: "gemini-3.6-flash",
    checkVersion: "1.0.0",
    promptVersion: "1.0.0",
    scoringVersion: "1.0.0",
    retryCount: 0,
    maxRetries: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const samplePage: MonitoredPage = {
    id: pageId,
    projectId: projectId,
    organizationId: orgId,
    canonicalUrl: "https://example.com",
    cadence: "weekly",
    status: "active",
    ownerId: userId,
    tags: ["landing"],
    latestAuditRunId: runId,
    latestSuccessfulAuditRunId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function createMockStore(overrides?: Partial<WorkflowPersistenceStore>): WorkflowPersistenceStore {
    return {
      getAuditRun: vi.fn(async () => sampleRun),
      getMonitoredPage: vi.fn(async () => samplePage),
      listEligibleWeeklyPages: vi.fn(async () => []),
      createScheduledAuditRun: vi.fn(async () => ({ run: sampleRun, isExisting: false })),
      claimRunForExecution: vi.fn(async (): Promise<ClaimRunResult> => ({
        state: "claimed",
        run: { ...sampleRun, status: "running" },
      })),
      persistCompletedAudit: vi.fn(async () => ({
        auditReportId: "550e8400-e29b-41d4-a716-446655440005",
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
      getOrCreateDelivery: vi.fn(async () => ({
        delivery: { id: "del-1" } as any,
        isExisting: false,
      })),
      recordDeliverySuccess: vi.fn(async () => {}),
      recordDeliveryFailure: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it("successfully executes audit workflow and persists completed report", async () => {
    const mockStore = createMockStore();
    const mockAnalyze = vi.fn(async () => ({
      ok: true as const,
      report: sampleReport,
    }));

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: mockAnalyze,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    const result = await fn({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.auditReportId).toBe("550e8400-e29b-41d4-a716-446655440005");
    expect(result.overallScore).toBe(75);

    expect(mockStore.getAuditRun).toHaveBeenCalledWith(runId);
    expect(mockStore.claimRunForExecution).toHaveBeenCalledWith(orgId, runId);
    expect(mockAnalyze).toHaveBeenCalledWith("https://example.com");
    expect(mockStore.persistCompletedAudit).toHaveBeenCalledWith(
      orgId,
      projectId,
      pageId,
      runId,
      "https://example.com/",
      sampleReport,
    );
  });

  it("handles idempotent replay: completed run is skipped without re-running engine or persistence", async () => {
    const completedRun: AuditRun = {
      ...sampleRun,
      status: "completed",
      completedAt: new Date().toISOString(),
    };

    const mockStore = createMockStore({
      getAuditRun: vi.fn(async () => completedRun),
      claimRunForExecution: vi.fn(async (): Promise<ClaimRunResult> => ({
        state: "already_completed",
        run: completedRun,
      })),
    });

    const mockAnalyze = vi.fn();
    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: mockAnalyze,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    const result = await fn({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already_completed");

    // Must NOT call analyzer or persist
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockStore.persistCompletedAudit).not.toHaveBeenCalled();
  });

  it("handles concurrency lock: actively running run is skipped to prevent duplicate worker execution", async () => {
    const mockStore = createMockStore({
      claimRunForExecution: vi.fn(async (): Promise<ClaimRunResult> => ({
        state: "already_running",
        run: { ...sampleRun, status: "running" },
      })),
    });

    const mockAnalyze = vi.fn();
    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: mockAnalyze,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    const result = await fn({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already_running");

    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockStore.persistCompletedAudit).not.toHaveBeenCalled();
  });

  it("rejects malformed event payload with NonRetriableError", async () => {
    const mockStore = createMockStore();
    const workflow = createAuditWorkflow({
      auditStore: mockStore,
    });

    const invalidEvent = {
      name: AUDIT_REQUESTED_EVENT,
      data: {
        auditRunId: "not-a-uuid",
      },
    };

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    await expect(fn({ event: invalidEvent, step: mockStep })).rejects.toThrow(
      NonRetriableError,
    );
  });

  it("rejects non-existent audit run with NonRetriableError", async () => {
    const mockStore = createMockStore({
      getAuditRun: vi.fn(async () => null),
    });

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    await expect(fn({ event: validEvent, step: mockStep })).rejects.toThrow(
      NonRetriableError,
    );
  });

  it("rejects tenant/project/page mismatch with NonRetriableError", async () => {
    const crossTenantRun: AuditRun = {
      ...sampleRun,
      organizationId: "550e8400-e29b-41d4-a716-446655440999", // Different org
    };

    const mockStore = createMockStore({
      getAuditRun: vi.fn(async () => crossTenantRun),
    });

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    await expect(fn({ event: validEvent, step: mockStep })).rejects.toThrow(
      NonRetriableError,
    );
  });

  it("records safe failure and throws NonRetriableError for non-retryable failures", async () => {
    const mockStore = createMockStore();
    const mockAnalyze = vi.fn(async () => ({
      ok: false as const,
      status: 403,
      code: "BLOCKED_DESTINATION",
      message: "Destination IP resolves to a private or restricted address.",
      retryable: false,
    }));

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: mockAnalyze,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    await expect(fn({ event: validEvent, step: mockStep })).rejects.toThrow(
      NonRetriableError,
    );

    expect(mockStore.recordRunFailure).toHaveBeenCalledWith(
      orgId,
      projectId,
      pageId,
      runId,
      {
        code: "BLOCKED_DESTINATION",
        message: "Destination IP resolves to a private or restricted address.",
        retryable: false,
      },
    );
    expect(mockStore.persistCompletedAudit).not.toHaveBeenCalled();
  });

  it("records safe failure and throws standard Error for retryable failures", async () => {
    const mockStore = createMockStore();
    const mockAnalyze = vi.fn(async () => ({
      ok: false as const,
      status: 502,
      code: "UPSTREAM_FAILURE",
      message: "Target server returned 504 Gateway Timeout.",
      retryable: true,
    }));

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: mockAnalyze,
    });

    const mockStep = createMockStep();
    const fn = (workflow as any)["fn"];

    await expect(fn({ event: validEvent, step: mockStep })).rejects.toThrow(
      "Audit failed with retryable error [UPSTREAM_FAILURE]",
    );

    expect(mockStore.recordRunFailure).toHaveBeenCalledWith(
      orgId,
      projectId,
      pageId,
      runId,
      {
        code: "UPSTREAM_FAILURE",
        message: "Target server returned 504 Gateway Timeout.",
        retryable: true,
      },
    );
  });

  it("payload verification: event payload strictly contains IDs and no secrets or raw HTML", () => {
    const parse = auditRequestedPayloadSchema.safeParse(validEvent.data);
    expect(parse.success).toBe(true);
    if (parse.success) {
      const keys = Object.keys(parse.data);
      expect(keys).toEqual([
        "auditRunId",
        "organizationId",
        "projectId",
        "monitoredPageId",
        "requestedByUserId",
      ]);
      expect((parse.data as any).html).toBeUndefined();
      expect((parse.data as any).rawHtml).toBeUndefined();
      expect((parse.data as any).secret).toBeUndefined();
    }
  });

  it("evaluates regression vs previous report and dispatches alert/created event", async () => {
    const previousSuccessfulReport: Report = {
      ...sampleReport,
      overallScore: 85,
    };
    const regressedReport: Report = {
      ...sampleReport,
      overallScore: 65, // -20 pts drop (>= 10 pts meaningful drop)
    };

    const persistedAlert = {
      id: "alert-123",
      organizationId: orgId,
      projectId: projectId,
      monitoredPageId: pageId,
      auditRunId: runId,
      ruleType: "overall_score_drop" as const,
      severity: "high" as const,
      title: "Overall UX Score Regressed",
      reasonCode: "SCORE_DROP_EXCEEDED" as const,
      reasonSummary: "Overall score dropped by 20 points.",
      deduplicationKey: `alert:${pageId}:overall_score_drop`,
      schemaVersion: "1.0.0",
      status: "created" as const,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mockClientSend = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      createFunction: inngestClient.createFunction.bind(inngestClient),
      send: mockClientSend,
    };
    const mockStore = createMockStore({
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(previousSuccessfulReport),
      persistAlert: vi.fn().mockResolvedValue({
        alert: persistedAlert,
        isExisting: false,
        isSuppressed: false,
      }),
    });

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: regressedReport }),
      client: mockClient as any,
    });

    const mockStep = createMockStep();
    const result = await (workflow as any)["fn"]({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(result.dispatchedAlertsCount).toBeGreaterThan(0);
    expect(mockStore.persistAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleType: "overall_score_drop",
        severity: "high",
      }),
    );
    expect(mockClientSend).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: "alert/created",
          data: expect.objectContaining({
            alertId: "alert-123",
            organizationId: orgId,
            monitoredPageId: pageId,
          }),
        }),
      ]),
    );
  });

  it("suppresses alert/created dispatch when alert is suppressed within 24-hour window", async () => {
    const previousSuccessfulReport: Report = {
      ...sampleReport,
      overallScore: 85,
    };
    const regressedReport: Report = {
      ...sampleReport,
      overallScore: 65,
    };

    const mockClientSend = vi.fn().mockResolvedValue(undefined);
    const mockClient = {
      createFunction: inngestClient.createFunction.bind(inngestClient),
      send: mockClientSend,
    };
    const mockStore = createMockStore({
      getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(previousSuccessfulReport),
      persistAlert: vi.fn().mockResolvedValue({
        alert: { id: "alert-123" } as any,
        isExisting: false,
        isSuppressed: true, // Suppressed!
      }),
    });

    const workflow = createAuditWorkflow({
      auditStore: mockStore,
      analyzeUrl: vi.fn().mockResolvedValue({ ok: true, report: regressedReport }),
      client: mockClient as any,
    });

    const mockStep = createMockStep();
    const result = await (workflow as any)["fn"]({ event: validEvent, step: mockStep });

    expect(result.ok).toBe(true);
    expect(result.dispatchedAlertsCount).toBe(0);
    expect(mockClientSend).not.toHaveBeenCalled();
  });
});
