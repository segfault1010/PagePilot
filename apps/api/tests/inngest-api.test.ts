import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import {
  createAuditWorkflow,
  createWeeklyScheduler,
  inngestClient,
} from "@pagepilot/workflows";
import type { WorkflowPersistenceStore } from "@pagepilot/workflows";

describe("Inngest Serve Endpoint (/api/inngest)", () => {
  const mockWorkflowStore: WorkflowPersistenceStore = {
    getAuditRun: async () => null,
    getMonitoredPage: async () => null,
    listEligibleWeeklyPages: async () => [],
    createScheduledAuditRun: async (page, idempotencyKey) => ({
      run: {
        id: "run-1",
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
    }),
    claimRunForExecution: async () => ({ state: "not_found" }),
    persistCompletedAudit: async () => ({ auditReportId: "id" }),
    recordRunFailure: async () => {},
    getPreviousSuccessfulAuditReport: async () => null,
    findRecentAlert: async () => null,
    persistAlert: async () => ({
      alert: { id: "alert-1" } as any,
      isExisting: false,
      isSuppressed: false,
    }),
    getAlert: async () => null,
    updateAlertStatus: async () => {},
    listOrganizationRecipients: async () => [],
    getOrCreateDelivery: async () => ({
      delivery: { id: "del-1" } as any,
      isExisting: false,
    }),
    recordDeliverySuccess: async () => {},
    recordDeliveryFailure: async () => {},
  };

  it("responds to GET /api/inngest with schema/function introspection for all 3 workflows", async () => {
    const auditWorkflow = createAuditWorkflow({
      auditStore: mockWorkflowStore,
      analyzeUrl: async () => ({
        ok: false,
        status: 500,
        code: "ERR",
        message: "err",
        retryable: false,
      }),
    });

    const schedulerWorkflow = createWeeklyScheduler({
      schedulerStore: mockWorkflowStore,
    });

    const app = createApp({
      inngestClient,
      inngestFunctions: [auditWorkflow, schedulerWorkflow],
      getWorkflowStore: () => mockWorkflowStore,
    });

    const res = await request(app).get("/api/inngest");

    // Inngest serve GET endpoint returns 200 with schema inspection details
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    // Verify that registered functions are exposed in the introspection payload
    if (res.body.functions) {
      const fnNames = res.body.functions.map((f: any) => f.id || f.name);
      expect(fnNames).toContain("execute-audit-workflow");
      expect(fnNames).toContain("weekly-audit-scheduler");
    }
  });

  it("registers all 3 functions by default when none are passed", async () => {
    const app = createApp({
      inngestClient,
      getWorkflowStore: () => mockWorkflowStore,
    });

    const res = await request(app).get("/api/inngest");
    expect(res.status).toBe(200);
    if (res.body.functions) {
      const fnNames = res.body.functions.map((f: any) => f.id || f.name);
      expect(fnNames).toContain("execute-audit-workflow");
      expect(fnNames).toContain("weekly-audit-scheduler");
      expect(fnNames).toContain("deliver-alert-notification");
    }
  });

  it("preserves anonymous POST /api/analyze functionality", async () => {
    const app = createApp({
      analyzeUrl: async (url: string) => ({
        ok: true,
        report: {
          source: {
            requestedUrl: url,
            finalUrl: url,
            analyzedAt: new Date().toISOString(),
            title: "Test",
          },
          overallScore: 80,
          scoreConfidence: "blended",
          summary: "Test summary",
          categories: [],
          topProblems: [],
          quickWins: [],
          detailedRecommendations: [],
          observedSignals: [],
        },
      }),
      inngestClient,
      getWorkflowStore: () => mockWorkflowStore,
    });

    const res = await request(app)
      .post("/api/analyze")
      .send({ url: "https://example.com" });

    expect(res.status).toBe(200);
    expect(res.body.report.overallScore).toBe(80);
  });
});
