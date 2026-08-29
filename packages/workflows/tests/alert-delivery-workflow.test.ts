import { describe, expect, it, vi } from "vitest";
import {
  ALERT_CREATED_EVENT,
  ALERT_SCHEMA_VERSION,
} from "@pagepilot/contracts";
import type {
  AlertDeliveryEntity,
  AlertEntity,
  MonitoredPage,
} from "@pagepilot/contracts";
import { createAlertDeliveryWorkflow } from "../src/functions/alert-delivery-workflow.js";
import { MockEmailNotificationProvider } from "../src/notifications/email-provider.js";
import type { WorkflowPersistenceStore } from "../src/types.js";

function createMockStep() {
  return {
    run: vi.fn().mockImplementation(async (_name: string, fn: () => any) => {
      return await fn();
    }),
  };
}

describe("Alert Delivery Inngest Workflow", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const pageId = "33333333-3333-4333-8333-333333333333";
  const alertId = "44444444-4444-4444-8444-444444444444";
  const runId = "55555555-5555-4555-8555-555555555555";

  const mockPage: MonitoredPage = {
    id: pageId,
    projectId,
    organizationId: orgId,
    canonicalUrl: "https://example.com/landing",
    cadence: "weekly",
    status: "active",
    ownerId: null,
    tags: [],
    latestAuditRunId: runId,
    latestSuccessfulAuditRunId: runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockAlert: AlertEntity = {
    id: alertId,
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    auditRunId: runId,
    ruleType: "overall_score_drop",
    severity: "high",
    title: "Overall UX Score Regressed",
    reasonCode: "SCORE_DROP_EXCEEDED",
    reasonSummary: "Overall score dropped by 12 points.",
    reasonDetails: "Score dropped from 80 to 68.",
    category: null,
    targetId: null,
    scoreDelta: -12,
    previousValue: 80,
    currentValue: 68,
    deduplicationKey: `alert:${pageId}:overall_score_drop`,
    schemaVersion: ALERT_SCHEMA_VERSION,
    status: "created",
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockRecipients = [
    { id: "user-1", email: "owner@example.com", role: "owner" as const },
    { id: "user-2", email: "admin@example.com", role: "admin" as const },
  ];

  function createStoreStub(overrides?: Partial<WorkflowPersistenceStore>): WorkflowPersistenceStore {
    const deliveries = new Map<string, AlertDeliveryEntity>();

    return {
      getAuditRun: vi.fn(),
      getMonitoredPage: vi.fn().mockResolvedValue(mockPage),
      listEligibleWeeklyPages: vi.fn().mockResolvedValue([]),
      createScheduledAuditRun: vi.fn(),
      claimRunForExecution: vi.fn(),
      persistCompletedAudit: vi.fn(),
      recordRunFailure: vi.fn(),
      getPreviousSuccessfulAuditReport: vi.fn(),
      findRecentAlert: vi.fn(),
      persistAlert: vi.fn(),
      getAlert: vi.fn().mockResolvedValue(mockAlert),
      updateAlertStatus: vi.fn().mockResolvedValue(undefined),
      listOrganizationRecipients: vi.fn().mockResolvedValue(mockRecipients),
      getOrCreateDelivery: vi.fn().mockImplementation(async (d) => {
        const existing = deliveries.get(d.deliveryKey);
        if (existing) {
          return { delivery: existing, isExisting: true };
        }
        const created: AlertDeliveryEntity = {
          id: `del-${deliveries.size + 1}`,
          alertId: d.alertId,
          organizationId: d.organizationId,
          channel: d.channel,
          recipient: d.recipient,
          deliveryKey: d.deliveryKey,
          status: "pending",
          attempts: 0,
          lastAttemptedAt: null,
          deliveredAt: null,
          errorMessage: null,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        deliveries.set(d.deliveryKey, created);
        return { delivery: created, isExisting: false };
      }),
      recordDeliverySuccess: vi.fn().mockImplementation(async (id) => {
        for (const d of deliveries.values()) {
          if (d.id === id) {
            d.status = "delivered";
            d.deliveredAt = new Date().toISOString();
          }
        }
      }),
      recordDeliveryFailure: vi.fn().mockImplementation(async (id, err) => {
        for (const d of deliveries.values()) {
          if (d.id === id) {
            d.status = "failed";
            d.errorMessage = err;
          }
        }
      }),
      ...overrides,
    };
  }

  it("delivers alert notifications to all organization owners and admins", async () => {
    const store = createStoreStub();
    const provider = new MockEmailNotificationProvider();
    const workflow = createAlertDeliveryWorkflow({
      store,
      notificationProvider: provider,
      appBaseUrl: "https://app.pagepilot.dev",
    });

    const step = createMockStep();
    const result = await (workflow as any)["fn"]({
      event: {
        name: ALERT_CREATED_EVENT,
        data: {
          alertId,
          organizationId: orgId,
          projectId,
          monitoredPageId: pageId,
          auditRunId: runId,
        },
      },
      step,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("delivered");
    expect(result.deliveredCount).toBe(2);

    expect(provider.sent).toHaveLength(2);
    expect(provider.sent[0]?.recipientEmail).toBe("owner@example.com");
    expect(provider.sent[1]?.recipientEmail).toBe("admin@example.com");
    expect(provider.sent[0]?.appBaseUrl).toBe("https://app.pagepilot.dev");

    expect(store.recordDeliverySuccess).toHaveBeenCalledTimes(2);
    expect(store.updateAlertStatus).toHaveBeenCalledWith(alertId, "delivered");
  });

  it("enforces delivery idempotency on repeated workflow execution", async () => {
    const store = createStoreStub();
    const provider = new MockEmailNotificationProvider();
    const workflow = createAlertDeliveryWorkflow({
      store,
      notificationProvider: provider,
    });
    const step = createMockStep();

    // First execution delivers to both recipients
    await (workflow as any)["fn"]({
      event: {
        name: ALERT_CREATED_EVENT,
        data: { alertId, organizationId: orgId, projectId, monitoredPageId: pageId },
      },
      step,
    });
    expect(provider.sent).toHaveLength(2);

    // Second execution with same alert
    const secondResult = await (workflow as any)["fn"]({
      event: {
        name: ALERT_CREATED_EVENT,
        data: { alertId, organizationId: orgId, projectId, monitoredPageId: pageId },
      },
      step,
    });

    // Provider should not receive additional send calls
    expect(provider.sent).toHaveLength(2);
    expect(secondResult.deliveredCount).toBe(2);
  });

  it("skips execution if alert is already marked delivered", async () => {
    const store = createStoreStub({
      getAlert: vi.fn().mockResolvedValue({
        ...mockAlert,
        status: "delivered",
      }),
    });
    const provider = new MockEmailNotificationProvider();
    const workflow = createAlertDeliveryWorkflow({
      store,
      notificationProvider: provider,
    });
    const step = createMockStep();

    const result = await (workflow as any)["fn"]({
      event: {
        name: ALERT_CREATED_EVENT,
        data: { alertId, organizationId: orgId, projectId, monitoredPageId: pageId },
      },
      step,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("already_delivered");
    expect(provider.sent).toHaveLength(0);
  });

  it("fails fast with NonRetriableError on cross-tenant resource mismatch", async () => {
    const store = createStoreStub({
      getAlert: vi.fn().mockResolvedValue({
        ...mockAlert,
        organizationId: "other-org-id",
      }),
    });
    const workflow = createAlertDeliveryWorkflow({ store });
    const step = createMockStep();

    await expect(
      (workflow as any)["fn"]({
        event: {
          name: ALERT_CREATED_EVENT,
          data: { alertId, organizationId: orgId, projectId, monitoredPageId: pageId },
        },
        step,
      }),
    ).rejects.toThrow("Tenant or resource mismatch");
  });

  it("records failure when no valid organization recipients exist", async () => {
    const store = createStoreStub({
      listOrganizationRecipients: vi.fn().mockResolvedValue([]),
    });
    const provider = new MockEmailNotificationProvider();
    const workflow = createAlertDeliveryWorkflow({
      store,
      notificationProvider: provider,
    });
    const step = createMockStep();

    const result = await (workflow as any)["fn"]({
      event: {
        name: ALERT_CREATED_EVENT,
        data: { alertId, organizationId: orgId, projectId, monitoredPageId: pageId },
      },
      step,
    });

    expect(result.delivered).toBe(false);
    expect(result.reason).toBe("no_valid_recipients");
    expect(provider.sent).toHaveLength(0);
    expect(store.updateAlertStatus).toHaveBeenCalledWith(
      alertId,
      "failed",
      expect.objectContaining({ reason: "no_valid_recipients" }),
    );
  });

  it("throws retryable error when provider encounters transient failure", async () => {
    const store = createStoreStub();
    const provider = new MockEmailNotificationProvider();
    provider.simulateNextFailure("SMTP Timeout", true);

    const workflow = createAlertDeliveryWorkflow({
      store,
      notificationProvider: provider,
    });
    const step = createMockStep();

    await expect(
      (workflow as any)["fn"]({
        event: {
          name: ALERT_CREATED_EVENT,
          data: { alertId, organizationId: orgId, projectId, monitoredPageId: pageId },
        },
        step,
      }),
    ).rejects.toThrow("Failed to deliver alert email");

    expect(store.recordDeliveryFailure).toHaveBeenCalledWith(
      expect.any(String),
      "SMTP Timeout",
      false, // retryable
    );
  });
});
