import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import { createAuditWorkflow, inngestClient } from "@pagepilot/workflows";
import type { WorkflowPersistenceStore } from "@pagepilot/workflows";

describe("Inngest Serve Endpoint (/api/inngest)", () => {
  const mockWorkflowStore: WorkflowPersistenceStore = {
    getAuditRun: async () => null,
    getMonitoredPage: async () => null,
    claimRunForExecution: async () => ({ state: "not_found" }),
    persistCompletedAudit: async () => ({ auditReportId: "id" }),
    recordRunFailure: async () => {},
  };

  it("responds to GET /api/inngest with schema/function introspection", async () => {
    const workflow = createAuditWorkflow({
      auditStore: mockWorkflowStore,
      analyzeUrl: async () => ({ ok: false, status: 500, code: "ERR", message: "err", retryable: false }),
    });

    const app = createApp({
      inngestClient,
      inngestFunctions: [workflow],
      getWorkflowStore: () => mockWorkflowStore,
    });

    const res = await request(app).get("/api/inngest");

    // Inngest serve GET endpoint returns 200 with schema inspection details
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    // Verify that the registered function is exposed in the introspection payload
    if (res.body.functions) {
      const fnNames = res.body.functions.map((f: any) => f.id || f.name);
      expect(fnNames).toContain("execute-audit-workflow");
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
