import { describe, expect, it, vi } from "vitest";
import { Inngest } from "inngest";
import {
  AUDIT_REQUESTED_EVENT,
  type AuditRun,
} from "@pagepilot/contracts";
import { createWeeklyScheduler } from "../src/functions/weekly-scheduler.js";
import type {
  MonitoredPageWithProject,
  WorkflowPersistenceStore,
} from "../src/types.js";

function createMockStore(
  overrides?: Partial<WorkflowPersistenceStore>,
): WorkflowPersistenceStore {
  return {
    getAuditRun: vi.fn().mockResolvedValue(null),
    getMonitoredPage: vi.fn().mockResolvedValue(null),
    listEligibleWeeklyPages: vi.fn().mockResolvedValue([]),
    createScheduledAuditRun: vi.fn().mockImplementation(async (page, idempotencyKey) => {
      const run: AuditRun = {
        id: "770e8400-e29b-41d4-a716-446655440001",
        monitoredPageId: page.id,
        projectId: page.projectId,
        organizationId: page.organizationId,
        invocationType: "scheduled",
        status: "requested",
        targetUrl: page.canonicalUrl,
        finalUrl: null,
        triggeredByUserId: null,
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
        idempotencyKey,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { run, isExisting: false };
    }),
    claimRunForExecution: vi.fn(),
    persistCompletedAudit: vi.fn(),
    recordRunFailure: vi.fn(),
    getPreviousSuccessfulAuditReport: vi.fn().mockResolvedValue(null),
    findRecentAlert: vi.fn().mockResolvedValue(null),
    persistAlert: vi.fn().mockResolvedValue({
      alert: { id: "mock-alert" } as any,
      isExisting: false,
      isSuppressed: false,
    }),
    getAlert: vi.fn().mockResolvedValue(null),
    updateAlertStatus: vi.fn().mockResolvedValue(undefined),
    listOrganizationRecipients: vi.fn().mockResolvedValue([]),
    getOrCreateDelivery: vi.fn().mockResolvedValue({
      delivery: { id: "mock-del" } as any,
      isExisting: false,
    }),
    recordDeliverySuccess: vi.fn().mockResolvedValue(undefined),
    recordDeliveryFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("Weekly Audit Scheduler Workflow", () => {
  it("discovers eligible active weekly pages and schedules audit runs with deterministic idempotency keys", async () => {
    const mockPages: MonitoredPageWithProject[] = [
      {
        id: "page-1",
        projectId: "proj-1",
        organizationId: "org-1",
        canonicalUrl: "https://example.com/landing",
        cadence: "weekly",
        status: "active",
        ownerId: null,
        tags: ["core"],
        latestAuditRunId: null,
        latestSuccessfulAuditRunId: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
        timezone: "UTC",
      },
      {
        id: "page-2",
        projectId: "proj-2",
        organizationId: "org-1",
        canonicalUrl: "https://example.org/pricing",
        cadence: "weekly",
        status: "active",
        ownerId: null,
        tags: [],
        latestAuditRunId: null,
        latestSuccessfulAuditRunId: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
        timezone: "America/New_York",
      },
    ];

    const store = createMockStore({
      listEligibleWeeklyPages: vi.fn().mockResolvedValue(mockPages),
      createScheduledAuditRun: vi.fn().mockImplementation(async (page, idempotencyKey) => {
        return {
          run: {
            id: `run-${page.id}`,
            monitoredPageId: page.id,
            projectId: page.projectId,
            organizationId: page.organizationId,
            invocationType: "scheduled",
            status: "requested",
            targetUrl: page.canonicalUrl,
            finalUrl: null,
            triggeredByUserId: null,
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
            idempotencyKey,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          isExisting: false,
        };
      }),
    });

    const mockClient = new Inngest({ id: "test-scheduler" });
    const sendSpy = vi.spyOn(mockClient, "send").mockResolvedValue({ ids: ["evt-1"] });

    // Anchor time to Saturday in Week 35
    const fixedNow = new Date("2026-08-29T12:00:00Z");
    const fn = createWeeklyScheduler({
      schedulerStore: store,
      client: mockClient,
      now: () => fixedNow,
    });

    const runner = (fn as any).fn;
    const step = {
      run: vi.fn().mockImplementation(async (_name: string, cb: () => Promise<any>) => cb()),
    };

    const result = await runner({
      event: { name: "inngest/cron", data: {} },
      step,
    });

    expect(result.ok).toBe(true);
    expect(result.scheduledCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.totalEligible).toBe(2);

    // Verify store calls with deterministic keys
    expect(store.createScheduledAuditRun).toHaveBeenCalledWith(
      mockPages[0],
      "scheduled:page-1:2026-W35",
    );
    expect(store.createScheduledAuditRun).toHaveBeenCalledWith(
      mockPages[1],
      "scheduled:page-2:2026-W35",
    );

    // Verify Inngest event emission
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy).toHaveBeenCalledWith({
      name: AUDIT_REQUESTED_EVENT,
      data: {
        auditRunId: "run-page-1",
        organizationId: "org-1",
        projectId: "proj-1",
        monitoredPageId: "page-1",
        requestedByUserId: null,
      },
    });
  });

  it("skips paused and non-weekly pages safely", async () => {
    const mockPages: MonitoredPageWithProject[] = [
      {
        id: "page-paused",
        projectId: "proj-1",
        organizationId: "org-1",
        canonicalUrl: "https://example.com/paused",
        cadence: "weekly",
        status: "paused",
        ownerId: null,
        tags: [],
        latestAuditRunId: null,
        latestSuccessfulAuditRunId: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
      {
        id: "page-manual",
        projectId: "proj-1",
        organizationId: "org-1",
        canonicalUrl: "https://example.com/manual",
        cadence: "manual",
        status: "active",
        ownerId: null,
        tags: [],
        latestAuditRunId: null,
        latestSuccessfulAuditRunId: null,
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
      },
    ];

    const store = createMockStore({
      listEligibleWeeklyPages: vi.fn().mockResolvedValue(mockPages),
    });

    const mockClient = new Inngest({ id: "test-scheduler" });
    const sendSpy = vi.spyOn(mockClient, "send");

    const fn = createWeeklyScheduler({
      schedulerStore: store,
      client: mockClient,
    });

    const runner = (fn as any).fn;
    const step = {
      run: vi.fn().mockImplementation(async (_name: string, cb: () => Promise<any>) => cb()),
    };

    const result = await runner({
      event: { name: "inngest/cron", data: {} },
      step,
    });

    expect(result.ok).toBe(true);
    expect(result.scheduledCount).toBe(0);
    expect(result.skippedCount).toBe(2);
    expect(store.createScheduledAuditRun).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("suppresses event emission when run already exists for the weekly window (idempotency)", async () => {
    const mockPages: MonitoredPageWithProject[] = [
      {
        id: "page-already-run",
        projectId: "proj-1",
        organizationId: "org-1",
        canonicalUrl: "https://example.com/existing",
        cadence: "weekly",
        status: "active",
        ownerId: null,
        tags: [],
        latestAuditRunId: "run-existing",
        latestSuccessfulAuditRunId: "run-existing",
        createdAt: "2026-08-20T00:00:00Z",
        updatedAt: "2026-08-20T00:00:00Z",
        timezone: "UTC",
      },
    ];

    const store = createMockStore({
      listEligibleWeeklyPages: vi.fn().mockResolvedValue(mockPages),
      createScheduledAuditRun: vi.fn().mockResolvedValue({
        run: {
          id: "run-existing",
          monitoredPageId: "page-already-run",
          projectId: "proj-1",
          organizationId: "org-1",
          invocationType: "scheduled",
          status: "completed",
          targetUrl: "https://example.com/existing",
          idempotencyKey: "scheduled:page-already-run:2026-W35",
        } as AuditRun,
        isExisting: true, // Already created
      }),
    });

    const mockClient = new Inngest({ id: "test-scheduler" });
    const sendSpy = vi.spyOn(mockClient, "send");

    const fixedNow = new Date("2026-08-29T12:00:00Z");
    const fn = createWeeklyScheduler({
      schedulerStore: store,
      client: mockClient,
      now: () => fixedNow,
    });

    const runner = (fn as any).fn;
    const step = {
      run: vi.fn().mockImplementation(async (_name: string, cb: () => Promise<any>) => cb()),
    };

    const result = await runner({
      event: { name: "inngest/cron", data: {} },
      step,
    });

    expect(result.ok).toBe(true);
    expect(result.scheduledCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.details[0]).toEqual({
      pageId: "page-already-run",
      runId: "run-existing",
      action: "skipped",
      reason: "already_scheduled_for_window",
      windowId: "2026-W35",
    });

    // CRITICAL: send must NOT be called when isExisting is true!
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("handles empty eligible page list gracefully", async () => {
    const store = createMockStore({
      listEligibleWeeklyPages: vi.fn().mockResolvedValue([]),
    });

    const mockClient = new Inngest({ id: "test-scheduler" });
    const fn = createWeeklyScheduler({
      schedulerStore: store,
      client: mockClient,
    });

    const runner = (fn as any).fn;
    const step = {
      run: vi.fn().mockImplementation(async (_name: string, cb: () => Promise<any>) => cb()),
    };

    const result = await runner({
      event: { name: "inngest/cron", data: {} },
      step,
    });

    expect(result.ok).toBe(true);
    expect(result.scheduledCount).toBe(0);
    expect(result.totalEligible).toBe(0);
    expect(result.reason).toContain("No active weekly");
  });
});
