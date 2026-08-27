import { describe, expect, it } from "vitest";
import {
  auditReportSchema,
  auditRunSchema,
  findingEntitySchema,
  membershipSchema,
  monitoredPageSchema,
  ORGANIZATION_ROLES,
  organizationSchema,
  profileSchema,
  projectSchema,
  recommendationEntitySchema,
  REPORT_SCHEMA_VERSION,
  roleSchema,
  scoreSnapshotSchema,
} from "../src/index.js";

describe("Database Contracts & Schemas", () => {
  const validUuid = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  const validTimestamp = "2026-08-27T12:00:00.000Z";

  it("exports the canonical REPORT_SCHEMA_VERSION", () => {
    expect(REPORT_SCHEMA_VERSION).toBe("1.0.0");
  });

  it("validates organization roles correctly", () => {
    expect(ORGANIZATION_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
    expect(roleSchema.parse("owner")).toBe("owner");
    expect(roleSchema.parse("admin")).toBe("admin");
    expect(roleSchema.parse("member")).toBe("member");
    expect(roleSchema.parse("viewer")).toBe("viewer");
    expect(() => roleSchema.parse("superadmin")).toThrow();
  });

  it("validates profile schema", () => {
    const validProfile = {
      id: validUuid,
      email: "growth@example.com",
      fullName: "Alex Growth",
      avatarUrl: "https://example.com/avatar.png",
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
    };
    expect(profileSchema.parse(validProfile)).toEqual(validProfile);
    expect(() => profileSchema.parse({ ...validProfile, email: "invalid-email" })).toThrow();
  });

  it("validates organization and membership schema", () => {
    const validOrg = {
      id: validUuid,
      name: "Acme Growth",
      slug: "acme-growth",
      createdBy: validUuid,
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
    };
    expect(organizationSchema.parse(validOrg)).toEqual(validOrg);

    const validMembership = {
      id: validUuid,
      organizationId: validUuid,
      userId: validUuid,
      role: "owner",
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
    };
    expect(membershipSchema.parse(validMembership)).toEqual(validMembership);
  });

  it("validates project and monitored page schema", () => {
    const validProject = {
      id: validUuid,
      organizationId: validUuid,
      name: "Main SaaS App",
      domain: "acme.com",
      timezone: "America/New_York",
      goals: "Increase demo signup rate",
      createdBy: validUuid,
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
    };
    expect(projectSchema.parse(validProject)).toEqual(validProject);

    const validPage = {
      id: validUuid,
      projectId: validUuid,
      organizationId: validUuid,
      canonicalUrl: "https://acme.com/pricing",
      cadence: "weekly",
      status: "active",
      ownerId: validUuid,
      tags: ["pricing", "tier-1"],
      latestAuditRunId: null,
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
    };
    expect(monitoredPageSchema.parse(validPage)).toEqual(validPage);
  });

  it("validates audit run and immutable report schema", () => {
    const validRun = {
      id: validUuid,
      monitoredPageId: validUuid,
      projectId: validUuid,
      organizationId: validUuid,
      invocationType: "manual",
      status: "completed",
      targetUrl: "https://acme.com/pricing",
      finalUrl: "https://acme.com/pricing",
      triggeredByUserId: validUuid,
      startedAt: validTimestamp,
      completedAt: validTimestamp,
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
      createdAt: validTimestamp,
      updatedAt: validTimestamp,
    };
    expect(auditRunSchema.parse(validRun)).toEqual(validRun);

    const sampleReportPayload = {
      source: {
        requestedUrl: "https://acme.com/pricing",
        finalUrl: "https://acme.com/pricing",
        analyzedAt: validTimestamp,
        title: "Acme Pricing",
      },
      overallScore: 82,
      scoreConfidence: "blended" as const,
      summary: "Clear value proposition with strong CTA hierarchy.",
      categories: [
        {
          category: "clarity" as const,
          score: 85,
          confidence: "blended" as const,
          explanation: "Clear messaging.",
          severity: "low" as const,
          findings: [],
        },
        {
          category: "visualHierarchy" as const,
          score: 80,
          confidence: "blended" as const,
          explanation: "Good structure.",
          severity: "low" as const,
          findings: [],
        },
        {
          category: "ctaEffectiveness" as const,
          score: 90,
          confidence: "blended" as const,
          explanation: "Strong buttons.",
          severity: "low" as const,
          findings: [],
        },
        {
          category: "copy" as const,
          score: 75,
          confidence: "blended" as const,
          explanation: "Good copy.",
          severity: "low" as const,
          findings: [],
        },
        {
          category: "accessibility" as const,
          score: 88,
          confidence: "blended" as const,
          explanation: "High contrast.",
          severity: "low" as const,
          findings: [],
        },
        {
          category: "mobileUx" as const,
          score: 78,
          confidence: "blended" as const,
          explanation: "Responsive.",
          severity: "low" as const,
          findings: [],
        },
        {
          category: "trustCredibility" as const,
          score: 80,
          confidence: "blended" as const,
          explanation: "Trust badges visible.",
          severity: "low" as const,
          findings: [],
        },
      ],
      topProblems: [
        {
          title: "Missing testimonial source",
          severity: "medium" as const,
          evidence: "Quotes lack attributions",
          basis: "observed" as const,
          signalIds: ["sig-1"],
          recommendation: "Add customer names and logos",
          category: "trustCredibility" as const,
        },
        {
          title: "Secondary CTA low contrast",
          severity: "low" as const,
          evidence: "Gray on white button",
          basis: "observed" as const,
          signalIds: ["sig-2"],
          recommendation: "Increase contrast ratio",
          category: "visualHierarchy" as const,
        },
        {
          title: "Lengthy feature list",
          severity: "low" as const,
          evidence: "18 bullet points",
          basis: "observed" as const,
          signalIds: ["sig-3"],
          recommendation: "Group features into collapsible tabs",
          category: "copy" as const,
        },
      ],
      quickWins: [
        {
          title: "Add sticky header CTA",
          detail: "Keep conversion path visible during scroll.",
          category: "ctaEffectiveness" as const,
        },
        {
          title: "Highlight primary plan",
          detail: "Add recommended badge to pro tier.",
          category: "visualHierarchy" as const,
        },
        {
          title: "Add security badge",
          detail: "Include SOC2 icon near checkout link.",
          category: "trustCredibility" as const,
        },
      ],
      detailedRecommendations: [
        {
          title: "Restructure pricing grid",
          detail: "Align feature comparison rows for faster scanning.",
          category: "visualHierarchy" as const,
        },
      ],
      observedSignals: [],
    };

    const validReportEntity = {
      id: validUuid,
      auditRunId: validUuid,
      monitoredPageId: validUuid,
      projectId: validUuid,
      organizationId: validUuid,
      schemaVersion: REPORT_SCHEMA_VERSION,
      modelIdentifier: "gemini-3.6-flash",
      checkVersion: "1.0.0",
      scoringVersion: "1.0.0",
      summary: "Clear value proposition with strong CTA hierarchy.",
      overallScore: 82,
      scoreConfidence: "blended",
      reportPayload: sampleReportPayload,
      createdAt: validTimestamp,
    };
    expect(auditReportSchema.parse(validReportEntity)).toEqual(validReportEntity);
  });

  it("validates score snapshot and finding entities", () => {
    const validSnapshot = {
      id: validUuid,
      auditReportId: validUuid,
      auditRunId: validUuid,
      monitoredPageId: validUuid,
      projectId: validUuid,
      organizationId: validUuid,
      category: "clarity",
      score: 85,
      confidence: "blended",
      explanation: "Clear value proposition.",
      severity: "low",
      scoringVersion: "1.0.0",
      createdAt: validTimestamp,
    };
    expect(scoreSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot);

    const validFinding = {
      id: validUuid,
      auditReportId: validUuid,
      auditRunId: validUuid,
      monitoredPageId: validUuid,
      projectId: validUuid,
      organizationId: validUuid,
      findingType: "top_problem",
      category: "trustCredibility",
      title: "Missing testimonial source",
      severity: "medium",
      evidence: "Quotes lack attributions",
      basis: "observed",
      signalIds: ["sig-1"],
      recommendation: "Add customer names and logos",
      displayOrder: 1,
      workStatus: "open",
      resolvedAt: null,
      resolvedByUserId: null,
      createdAt: validTimestamp,
    };
    expect(findingEntitySchema.parse(validFinding)).toEqual(validFinding);

    const validRecommendation = {
      id: validUuid,
      auditReportId: validUuid,
      auditRunId: validUuid,
      monitoredPageId: validUuid,
      projectId: validUuid,
      organizationId: validUuid,
      recommendationType: "quick_win",
      category: "ctaEffectiveness",
      title: "Add sticky header CTA",
      detail: "Keep conversion path visible during scroll.",
      displayOrder: 1,
      createdAt: validTimestamp,
    };
    expect(recommendationEntitySchema.parse(validRecommendation)).toEqual(validRecommendation);
  });
});
