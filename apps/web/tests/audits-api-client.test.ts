import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditApiClientError,
  getAuditReportByRunId,
  getLatestAuditReport,
  listAuditHistory,
  triggerManualAudit,
} from "../src/features/audits/api.js";

// Mock Supabase client
vi.mock("../src/features/auth/supabase-client.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: "auto-session-token",
          },
        },
      }),
    },
  })),
}));

describe("Audits Web API Client", () => {
  const projectId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
  const pageId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
  const runId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const reportId = "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66";

  const sampleRun = {
    id: runId,
    monitoredPageId: pageId,
    projectId: projectId,
    organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
    invocationType: "manual" as const,
    status: "completed" as const,
    targetUrl: "https://example.com",
    finalUrl: "https://example.com/",
    triggeredByUserId: "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55",
    idempotencyKey: "test-idem-key",
    startedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:05.000Z",
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
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:05.000Z",
  };

  const sampleReportPayload = {
    source: {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      analyzedAt: "2026-08-27T12:00:00.000Z",
      title: "Example Domain",
    },
    overallScore: 85,
    scoreConfidence: "blended" as const,
    summary: "High quality page.",
    categories: [
      {
        category: "clarity" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Clear.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "visualHierarchy" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Good.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "ctaEffectiveness" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Strong.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "copy" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Clear.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "accessibility" as const,
        score: 85,
        confidence: "ai-led" as const,
        explanation: "Accessible.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "mobileUx" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Responsive.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "trustCredibility" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Trustworthy.",
        severity: "low" as const,
        findings: [],
      },
    ],
    topProblems: [
      {
        title: "Test problem 1",
        severity: "medium" as const,
        evidence: "Evidence 1",
        basis: "observed" as const,
        signalIds: [],
        recommendation: "Fix 1",
        category: "clarity" as const,
      },
      {
        title: "Test problem 2",
        severity: "medium" as const,
        evidence: "Evidence 2",
        basis: "observed" as const,
        signalIds: [],
        recommendation: "Fix 2",
        category: "copy" as const,
      },
      {
        title: "Test problem 3",
        severity: "low" as const,
        evidence: "Evidence 3",
        basis: "inferred" as const,
        signalIds: [],
        recommendation: "Fix 3",
        category: "mobileUx" as const,
      },
    ],
    quickWins: [
      {
        title: "Win 1",
        detail: "Detail 1",
        category: "clarity" as const,
      },
      {
        title: "Win 2",
        detail: "Detail 2",
        category: "copy" as const,
      },
      {
        title: "Win 3",
        detail: "Detail 3",
        category: "accessibility" as const,
      },
    ],
    detailedRecommendations: [
      {
        title: "Detailed 1",
        detail: "Detailed detail 1",
        category: "ctaEffectiveness" as const,
      },
    ],
    observedSignals: [],
  };

  const samplePersistedReport = {
    auditRun: sampleRun,
    report: {
      id: reportId,
      auditRunId: runId,
      monitoredPageId: pageId,
      projectId: projectId,
      organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
      schemaVersion: "1.0.0",
      modelIdentifier: "gemini-3.6-flash",
      checkVersion: "1.0.0",
      scoringVersion: "1.0.0",
      summary: "High quality page.",
      overallScore: 85,
      scoreConfidence: "blended" as const,
      reportPayload: sampleReportPayload,
      createdAt: "2026-08-27T12:00:05.000Z",
    },
    scoreSnapshots: [],
    findings: [],
    recommendations: [],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers manual audit and attaches session token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        auditRun: sampleRun,
        report: sampleReportPayload,
        auditReportId: reportId,
      }),
    });
    global.fetch = fetchMock;

    const res = await triggerManualAudit(projectId, pageId, {
      idempotencyKey: "test-idem-key",
    });

    expect(res.auditRun.id).toBe(runId);
    expect(res.auditReportId).toBe(reportId);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/pages/${pageId}/audits`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "test-idem-key" }),
      }),
    );
    const sentHeaders: Headers = fetchMock.mock.calls[0][1].headers;
    expect(sentHeaders.get("Authorization")).toBe("Bearer auto-session-token");
  });

  it("lists audit history with pagination params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        audits: [
          {
            id: runId,
            monitoredPageId: pageId,
            projectId: projectId,
            organizationId: "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44",
            invocationType: "manual",
            status: "completed",
            targetUrl: "https://example.com",
            finalUrl: "https://example.com/",
            overallScore: 85,
            scoreConfidence: "blended",
            summary: "High quality page.",
            auditReportId: reportId,
            startedAt: "2026-08-27T12:00:00.000Z",
            completedAt: "2026-08-27T12:00:05.000Z",
            modelVersion: "gemini-3.6-flash",
            checkVersion: "1.0.0",
            scoringVersion: "1.0.0",
            createdAt: "2026-08-27T12:00:00.000Z",
          },
        ],
        total: 1,
      }),
    });
    global.fetch = fetchMock;

    const res = await listAuditHistory(projectId, pageId, {
      limit: 10,
      offset: 0,
    });

    expect(res.total).toBe(1);
    expect(res.audits).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/pages/${pageId}/audits?limit=10&offset=0`,
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("gets latest audit report", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => samplePersistedReport,
    });
    global.fetch = fetchMock;

    const res = await getLatestAuditReport(projectId, pageId);
    expect(res.auditRun.id).toBe(runId);
    expect(res.report.overallScore).toBe(85);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/pages/${pageId}/audits/latest`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("gets audit report by run ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => samplePersistedReport,
    });
    global.fetch = fetchMock;

    const res = await getAuditReportByRunId(projectId, pageId, runId);
    expect(res.auditRun.id).toBe(runId);
    expect(res.report.id).toBe(reportId);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${projectId}/pages/${pageId}/audits/${runId}`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws AuditApiClientError on API error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: "FORBIDDEN",
          message: "Viewer cannot trigger audits.",
          retryable: false,
        },
      }),
    });
    global.fetch = fetchMock;

    await expect(triggerManualAudit(projectId, pageId)).rejects.toThrow(
      AuditApiClientError,
    );
  });
});
