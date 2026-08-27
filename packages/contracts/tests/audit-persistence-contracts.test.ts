import { describe, expect, it } from "vitest";
import {
  AUDIT_ENGINE_CHECK_VERSION,
  AUDIT_ENGINE_PROMPT_VERSION,
  AUDIT_ENGINE_SCORING_VERSION,
  REPORT_SCHEMA_VERSION,
  auditHistoryItemSchema,
  auditHistoryListResponseSchema,
  auditRunResponseSchema,
  auditRunSchema,
  monitoredPageSchema,
  persistedAuditReportResponseSchema,
  triggerAuditRequestSchema,
} from "../src/database-types.js";

describe("Audit Persistence Contracts", () => {
  const auditRunId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const pageId = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22";
  const projectId = "c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33";
  const orgId = "d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44";
  const userId = "e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55";
  const reportId = "f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66";
  const snapshotId = "10eebc99-9c0b-4ef8-bb6d-6bb9bd380a77";
  const findingId = "20eebc99-9c0b-4ef8-bb6d-6bb9bd380a88";
  const recId = "30eebc99-9c0b-4ef8-bb6d-6bb9bd380a99";

  const sampleAuditRun = {
    id: auditRunId,
    monitoredPageId: pageId,
    projectId: projectId,
    organizationId: orgId,
    invocationType: "manual" as const,
    status: "completed" as const,
    targetUrl: "https://example.com",
    finalUrl: "https://example.com/",
    triggeredByUserId: userId,
    idempotencyKey: "client-req-12345",
    startedAt: "2026-08-27T12:00:00.000Z",
    completedAt: "2026-08-27T12:00:05.000Z",
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    retryable: null,
    modelVersion: "gemini-3.6-flash",
    checkVersion: AUDIT_ENGINE_CHECK_VERSION,
    promptVersion: AUDIT_ENGINE_PROMPT_VERSION,
    scoringVersion: AUDIT_ENGINE_SCORING_VERSION,
    retryCount: 0,
    maxRetries: 3,
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:05.000Z",
  };

  const sampleReport = {
    source: {
      requestedUrl: "https://example.com",
      finalUrl: "https://example.com/",
      analyzedAt: "2026-08-27T12:00:00.000Z",
      title: "Example Domain",
    },
    overallScore: 82,
    scoreConfidence: "blended" as const,
    summary: "Clear value proposition with strong CTA hierarchy.",
    categories: [
      {
        category: "clarity" as const,
        score: 80,
        confidence: "blended" as const,
        explanation: "Clear headline and subheadline.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "visualHierarchy" as const,
        score: 85,
        confidence: "blended" as const,
        explanation: "Good use of layout structure.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "ctaEffectiveness" as const,
        score: 90,
        confidence: "blended" as const,
        explanation: "Prominent primary action.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "copy" as const,
        score: 75,
        confidence: "blended" as const,
        explanation: "Concise copy.",
        severity: "medium" as const,
        findings: [],
      },
      {
        category: "accessibility" as const,
        score: 85,
        confidence: "ai-led" as const,
        explanation: "Standard contrast and structure.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "mobileUx" as const,
        score: 80,
        confidence: "blended" as const,
        explanation: "Responsive elements.",
        severity: "low" as const,
        findings: [],
      },
      {
        category: "trustCredibility" as const,
        score: 79,
        confidence: "blended" as const,
        explanation: "Legitimate domain structure.",
        severity: "low" as const,
        findings: [],
      },
    ],
    topProblems: [
      {
        title: "Missing social proof",
        severity: "medium" as const,
        evidence: "No reviews or client logos detected.",
        basis: "observed" as const,
        signalIds: [],
        recommendation: "Add 2-3 customer testimonials.",
        category: "trustCredibility" as const,
      },
      {
        title: "Secondary CTA competes with primary",
        severity: "medium" as const,
        evidence: "Two identical weight buttons in hero.",
        basis: "observed" as const,
        signalIds: [],
        recommendation: "Mute the secondary CTA styling.",
        category: "ctaEffectiveness" as const,
      },
      {
        title: "Subheadline is slightly long",
        severity: "low" as const,
        evidence: "Subheadline exceeds 30 words.",
        basis: "inferred" as const,
        signalIds: [],
        recommendation: "Shorten subheadline to under 20 words.",
        category: "clarity" as const,
      },
    ],
    quickWins: [
      {
        title: "Increase button contrast",
        detail: "Ensure 4.5:1 text contrast on primary button.",
        category: "accessibility" as const,
      },
      {
        title: "Add clear hero subhead",
        detail: "Clarify the single core promise in the hero.",
        category: "clarity" as const,
      },
      {
        title: "Add security badge",
        detail: "Display trust badge near the checkout CTA.",
        category: "trustCredibility" as const,
      },
    ],
    detailedRecommendations: [
      {
        title: "Revamp hero section",
        detail: "Structure the hero with a single CTA and social proof badge.",
        category: "ctaEffectiveness" as const,
      },
    ],
    observedSignals: [
      {
        id: "sig_h1_count",
        category: "clarity" as const,
        status: "pass" as const,
        weight: 0.5,
        evidence: "Exactly 1 H1 tag found.",
      },
    ],
  };

  it("validates version constants are frozen and distinct", () => {
    expect(REPORT_SCHEMA_VERSION).toBe("1.0.0");
    expect(AUDIT_ENGINE_CHECK_VERSION).toBe("1.0.0");
    expect(AUDIT_ENGINE_PROMPT_VERSION).toBe("1.0.0");
    expect(AUDIT_ENGINE_SCORING_VERSION).toBe("1.0.0");
  });

  it("validates monitoredPageSchema with latestSuccessfulAuditRunId", () => {
    const page = monitoredPageSchema.parse({
      id: pageId,
      projectId: projectId,
      organizationId: orgId,
      canonicalUrl: "https://example.com/landing",
      cadence: "weekly",
      status: "active",
      tags: ["pricing"],
      latestAuditRunId: auditRunId,
      latestSuccessfulAuditRunId: auditRunId,
      createdAt: "2026-08-27T12:00:00.000Z",
      updatedAt: "2026-08-27T12:00:00.000Z",
    });

    expect(page.latestSuccessfulAuditRunId).toBe(auditRunId);
  });

  it("validates auditRunSchema with idempotencyKey", () => {
    const run = auditRunSchema.parse(sampleAuditRun);
    expect(run.idempotencyKey).toBe("client-req-12345");
    expect(run.status).toBe("completed");
    expect(run.scoringVersion).toBe("1.0.0");
  });

  it("validates triggerAuditRequestSchema accepts optional idempotencyKey", () => {
    const empty = triggerAuditRequestSchema.parse({});
    expect(empty.idempotencyKey).toBeUndefined();

    const withKey = triggerAuditRequestSchema.parse({
      idempotencyKey: "test-key-123",
    });
    expect(withKey.idempotencyKey).toBe("test-key-123");

    expect(() =>
      triggerAuditRequestSchema.parse({
        idempotencyKey: "a".repeat(129),
      }),
    ).toThrow();
  });

  it("validates auditRunResponseSchema and auditHistoryListResponseSchema", () => {
    const runRes = auditRunResponseSchema.parse({
      auditRun: sampleAuditRun,
      report: sampleReport,
      auditReportId: reportId,
      isIdempotentReplay: false,
    });
    expect(runRes.auditReportId).toBe(reportId);

    const historyItem = auditHistoryItemSchema.parse({
      id: sampleAuditRun.id,
      monitoredPageId: sampleAuditRun.monitoredPageId,
      projectId: sampleAuditRun.projectId,
      organizationId: sampleAuditRun.organizationId,
      invocationType: sampleAuditRun.invocationType,
      status: sampleAuditRun.status,
      targetUrl: sampleAuditRun.targetUrl,
      finalUrl: sampleAuditRun.finalUrl,
      overallScore: 82,
      scoreConfidence: "blended",
      summary: "Clear value proposition.",
      auditReportId: reportId,
      startedAt: sampleAuditRun.startedAt,
      completedAt: sampleAuditRun.completedAt,
      modelVersion: sampleAuditRun.modelVersion,
      checkVersion: sampleAuditRun.checkVersion,
      scoringVersion: sampleAuditRun.scoringVersion,
      createdAt: sampleAuditRun.createdAt,
    });
    expect(historyItem.overallScore).toBe(82);

    const listRes = auditHistoryListResponseSchema.parse({
      audits: [historyItem],
      total: 1,
    });
    expect(listRes.total).toBe(1);
    expect(listRes.audits).toHaveLength(1);
  });

  it("validates persistedAuditReportResponseSchema", () => {
    const persistedRes = persistedAuditReportResponseSchema.parse({
      auditRun: sampleAuditRun,
      report: {
        id: reportId,
        auditRunId: sampleAuditRun.id,
        monitoredPageId: sampleAuditRun.monitoredPageId,
        projectId: sampleAuditRun.projectId,
        organizationId: sampleAuditRun.organizationId,
        schemaVersion: REPORT_SCHEMA_VERSION,
        modelIdentifier: "gemini-3.6-flash",
        checkVersion: AUDIT_ENGINE_CHECK_VERSION,
        scoringVersion: AUDIT_ENGINE_SCORING_VERSION,
        summary: sampleReport.summary,
        overallScore: sampleReport.overallScore,
        scoreConfidence: sampleReport.scoreConfidence,
        reportPayload: sampleReport,
        createdAt: "2026-08-27T12:00:05.000Z",
      },
      scoreSnapshots: [
        {
          id: snapshotId,
          auditReportId: reportId,
          auditRunId: sampleAuditRun.id,
          monitoredPageId: sampleAuditRun.monitoredPageId,
          projectId: sampleAuditRun.projectId,
          organizationId: sampleAuditRun.organizationId,
          category: "clarity",
          score: 80,
          confidence: "blended",
          explanation: "Clear headline and subheadline.",
          severity: "low",
          scoringVersion: AUDIT_ENGINE_SCORING_VERSION,
          createdAt: "2026-08-27T12:00:05.000Z",
        },
      ],
      findings: [
        {
          id: findingId,
          auditReportId: reportId,
          auditRunId: sampleAuditRun.id,
          monitoredPageId: sampleAuditRun.monitoredPageId,
          projectId: sampleAuditRun.projectId,
          organizationId: sampleAuditRun.organizationId,
          findingType: "top_problem",
          category: "trustCredibility",
          title: "Missing social proof",
          severity: "medium",
          evidence: "No reviews or client logos detected.",
          basis: "observed",
          signalIds: [],
          recommendation: "Add testimonials.",
          displayOrder: 0,
          workStatus: "open",
          createdAt: "2026-08-27T12:00:05.000Z",
        },
      ],
      recommendations: [
        {
          id: recId,
          auditReportId: reportId,
          auditRunId: sampleAuditRun.id,
          monitoredPageId: sampleAuditRun.monitoredPageId,
          projectId: sampleAuditRun.projectId,
          organizationId: sampleAuditRun.organizationId,
          recommendationType: "quick_win",
          category: "accessibility",
          title: "Increase button contrast",
          detail: "Ensure 4.5:1 text contrast.",
          displayOrder: 0,
          createdAt: "2026-08-27T12:00:05.000Z",
        },
      ],
    });

    expect(persistedRes.findings).toHaveLength(1);
    expect(persistedRes.scoreSnapshots).toHaveLength(1);
    expect(persistedRes.recommendations).toHaveLength(1);
  });
});
