// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type {
  AuditDiffResponse,
  MonitoredPage,
  OrganizationMember,
} from "@pagepilot/contracts";
import { ReportComparisonView } from "../src/features/workspace/components/report-comparison-view";
import * as auditsApi from "../src/features/audits/api";

vi.mock("../src/features/audits/api");

const mockPage: MonitoredPage = {
  id: "page-1",
  projectId: "proj-1",
  organizationId: "org-1",
  canonicalUrl: "https://example.com",
  cadence: "weekly",
  status: "active",
  tags: ["landing"],
  latestAuditRunId: "run-curr",
  latestSuccessfulAuditRunId: "run-curr",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const mockMembers: OrganizationMember[] = [
  {
    id: "mem-1",
    organizationId: "org-1",
    userId: "user-1",
    role: "owner",
    email: "lead@example.com",
    fullName: "Lead Designer",
    avatarUrl: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
];

const mockBaselineDiffResponse: AuditDiffResponse = {
  diff: {
    summary: {
      schemaVersion: "1.0.0",
      isBaseline: true,
      hasPreviousReport: false,
      hasMeaningfulRegression: false,
      overallScoreDelta: null,
      overallScoreDirection: "unchanged",
      regressedCategoriesCount: 0,
      improvedCategoriesCount: 0,
      unchangedCategoriesCount: 7,
      newFindingsCount: 2,
      newHighSeverityFindingsCount: 0,
      resolvedFindingsCount: 0,
      changedFindingsCount: 0,
      unchangedFindingsCount: 0,
      regressedSignalsCount: 0,
      improvedSignalsCount: 0,
      totalRegressionsCount: 0,
      totalImprovementsCount: 0,
      observedRegressionsCount: 0,
      inferredRegressionsCount: 0,
    },
    metadata: {
      previousAnalyzedAt: null,
      currentAnalyzedAt: "2026-08-10T12:00:00.000Z",
      previousAuditRunId: null,
      currentAuditRunId: "run-curr",
      previousModelVersion: null,
      currentModelVersion: "gemini-3.6-flash",
      scoringVersion: "1.0.0",
    },
    scoreChanges: {
      overall: {
        previousScore: null,
        currentScore: 82,
        delta: null,
        direction: "unchanged",
        isMeaningfulRegression: false,
      },
      categories: [
        {
          category: "clarity",
          previousScore: null,
          currentScore: 85,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "visualHierarchy",
          previousScore: null,
          currentScore: 80,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "ctaEffectiveness",
          previousScore: null,
          currentScore: 78,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "copy",
          previousScore: null,
          currentScore: 84,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "accessibility",
          previousScore: null,
          currentScore: 90,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "mobileUx",
          previousScore: null,
          currentScore: 80,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "trustCredibility",
          previousScore: null,
          currentScore: 77,
          delta: null,
          direction: "unchanged",
          previousSeverity: null,
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: null,
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
      ],
    },
    newFindings: [
      {
        id: "f-1",
        findingType: "top_problem",
        category: "clarity",
        status: "new",
        basis: "observed",
        signalIds: ["has-title"],
        previousTitle: null,
        previousSeverity: null,
        previousEvidence: null,
        previousRecommendation: null,
        currentTitle: "Hero headline lacks direct benefit statement",
        currentSeverity: "medium",
        currentEvidence: "Value proposition is vague.",
        currentRecommendation: "Clarify user value immediately above fold.",
        severityChange: "unchanged",
        isMaterialChange: true,
        isSeverityRegression: false,
      },
    ],
    resolvedFindings: [],
    changedFindings: [],
    unchangedFindings: [],
    signalChanges: [],
    regressions: [],
    improvements: [],
  },
};

const mockRegressionDiffResponse: AuditDiffResponse = {
  diff: {
    summary: {
      schemaVersion: "1.0.0",
      isBaseline: false,
      hasPreviousReport: true,
      hasMeaningfulRegression: true,
      overallScoreDelta: -14,
      overallScoreDirection: "regressed",
      regressedCategoriesCount: 2,
      improvedCategoriesCount: 1,
      unchangedCategoriesCount: 4,
      newFindingsCount: 1,
      newHighSeverityFindingsCount: 1,
      resolvedFindingsCount: 1,
      changedFindingsCount: 1,
      unchangedFindingsCount: 2,
      regressedSignalsCount: 1,
      improvedSignalsCount: 1,
      totalRegressionsCount: 3,
      totalImprovementsCount: 2,
      observedRegressionsCount: 2,
      inferredRegressionsCount: 1,
    },
    metadata: {
      previousAnalyzedAt: "2026-08-01T10:00:00.000Z",
      currentAnalyzedAt: "2026-08-15T10:00:00.000Z",
      previousAuditRunId: "run-prev",
      currentAuditRunId: "run-curr",
      previousModelVersion: "gemini-3.6-flash",
      currentModelVersion: "gemini-3.6-flash",
      scoringVersion: "1.0.0",
    },
    scoreChanges: {
      overall: {
        previousScore: 84,
        currentScore: 70,
        delta: -14,
        direction: "regressed",
        isMeaningfulRegression: true,
      },
      categories: [
        {
          category: "clarity",
          previousScore: 85,
          currentScore: 68,
          delta: -17,
          direction: "regressed",
          previousSeverity: "low",
          currentSeverity: "medium",
          severityChange: "increased",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: true,
        },
        {
          category: "visualHierarchy",
          previousScore: 80,
          currentScore: 80,
          delta: 0,
          direction: "unchanged",
          previousSeverity: "low",
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "ctaEffectiveness",
          previousScore: 75,
          currentScore: 60,
          delta: -15,
          direction: "regressed",
          previousSeverity: "medium",
          currentSeverity: "high",
          severityChange: "increased",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: true,
        },
        {
          category: "copy",
          previousScore: 80,
          currentScore: 80,
          delta: 0,
          direction: "unchanged",
          previousSeverity: "low",
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "accessibility",
          previousScore: 85,
          currentScore: 92,
          delta: 7,
          direction: "improved",
          previousSeverity: "medium",
          currentSeverity: "low",
          severityChange: "decreased",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "mobileUx",
          previousScore: 75,
          currentScore: 75,
          delta: 0,
          direction: "unchanged",
          previousSeverity: "low",
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
        {
          category: "trustCredibility",
          previousScore: 70,
          currentScore: 70,
          delta: 0,
          direction: "unchanged",
          previousSeverity: "low",
          currentSeverity: "low",
          severityChange: "unchanged",
          previousConfidence: "blended",
          currentConfidence: "blended",
          isMeaningfulRegression: false,
        },
      ],
    },
    newFindings: [
      {
        id: "f-new-high",
        findingType: "top_problem",
        category: "ctaEffectiveness",
        status: "new",
        basis: "observed",
        signalIds: ["cta-visible"],
        previousTitle: null,
        previousSeverity: null,
        previousEvidence: null,
        previousRecommendation: null,
        currentTitle: "Primary call to action is missing from viewport",
        currentSeverity: "high",
        currentEvidence: "No primary conversion CTA detected above fold.",
        currentRecommendation: "Place primary button prominently.",
        severityChange: "unchanged",
        isMaterialChange: true,
        isSeverityRegression: true,
      },
    ],
    resolvedFindings: [
      {
        id: "f-resolved",
        findingType: "top_problem",
        category: "accessibility",
        status: "resolved",
        basis: "observed",
        signalIds: ["alt-tags"],
        previousTitle: "Images lacked descriptive alternative text",
        previousSeverity: "medium",
        previousEvidence: "3 images had missing alt attributes.",
        previousRecommendation: "Add alt tags.",
        currentTitle: null,
        currentSeverity: null,
        currentEvidence: null,
        currentRecommendation: null,
        severityChange: "unchanged",
        isMaterialChange: true,
        isSeverityRegression: false,
      },
    ],
    changedFindings: [
      {
        id: "f-changed",
        findingType: "category_finding",
        category: "clarity",
        status: "changed",
        basis: "inferred",
        signalIds: [],
        previousTitle: "Value proposition clarity",
        previousSeverity: "low",
        previousEvidence: "Some jargon present.",
        previousRecommendation: "Simplify terminology.",
        currentTitle: "Value proposition clarity",
        currentSeverity: "medium",
        currentEvidence: "Dense technical jargon across hero section.",
        currentRecommendation: "Rewrite in clear benefit-oriented copy.",
        severityChange: "increased",
        isMaterialChange: true,
        isSeverityRegression: true,
      },
    ],
    unchangedFindings: [],
    signalChanges: [
      {
        signalId: "has-cta",
        category: "ctaEffectiveness",
        weight: 0.2,
        previousStatus: "pass",
        currentStatus: "warn",
        changeType: "regressed",
        previousEvidence: "CTA was present",
        currentEvidence: "CTA is absent",
        isRegression: true,
        isImprovement: false,
      },
    ],
    regressions: [
      {
        type: "overall_score_drop",
        category: null,
        description: "Overall score dropped by 14 points (84 -> 70).",
        basis: "observed",
        severity: "high",
        scoreDelta: -14,
      },
      {
        type: "category_score_drop",
        category: "clarity",
        description: "clarity score dropped by 17 points (85 -> 68).",
        basis: "observed",
        severity: "high",
        scoreDelta: -17,
      },
      {
        type: "new_high_severity_finding",
        category: "ctaEffectiveness",
        description: 'New high-severity finding in ctaEffectiveness: "Primary call to action is missing from viewport".',
        basis: "observed",
        severity: "high",
        findingId: "f-new-high",
      },
    ],
    improvements: [
      {
        type: "finding_resolved",
        category: "accessibility",
        description: 'Resolved finding in accessibility: "Images lacked descriptive alternative text".',
        basis: "observed",
        findingId: "f-resolved",
      },
    ],
  },
};

describe("<ReportComparisonView />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders baseline diff indicator cleanly when comparing initial audit", async () => {
    vi.mocked(auditsApi.getAuditDiff).mockResolvedValue(mockBaselineDiffResponse);

    render(
      <ReportComparisonView
        projectId="proj-1"
        page={mockPage}
        currentRunId="run-curr"
        role="owner"
        members={mockMembers}
        pages={[mockPage]}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(/Audit Report Comparison/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/Baseline Audit Established/i)).toBeDefined();
    });
    expect(screen.getByText(/82/i)).toBeDefined();
    expect(screen.getByText(/\(Baseline\)/i)).toBeDefined();
  });

  it("renders meaningful regression alerts and score changes", async () => {
    vi.mocked(auditsApi.getAuditDiff).mockResolvedValue(mockRegressionDiffResponse);

    render(
      <ReportComparisonView
        projectId="proj-1"
        page={mockPage}
        currentRunId="run-curr"
        role="owner"
        members={mockMembers}
        pages={[mockPage]}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Meaningful UX Regression Detected/i)).toBeDefined();
    });

    expect(screen.getAllByText(/84/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/70/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/-14 pts \(regressed\)/i)).toBeDefined();

    // Verify Regressions Tab is default and shows regression items
    expect(screen.getAllByText(/Overall score dropped by 14 points/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/clarity score dropped by 17 points/i)).toBeDefined();
  });

  it("navigates between diff tabs: New, Resolved, Changed, Signals, Improvements", async () => {
    vi.mocked(auditsApi.getAuditDiff).mockResolvedValue(mockRegressionDiffResponse);

    render(
      <ReportComparisonView
        projectId="proj-1"
        page={mockPage}
        currentRunId="run-curr"
        role="owner"
        members={mockMembers}
        pages={[mockPage]}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/New Findings \(1\)/i)).toBeDefined();
    });

    // 1. New Findings Tab
    fireEvent.click(screen.getByText(/New Findings \(1\)/i));
    expect(screen.getByText(/Primary call to action is missing from viewport/i)).toBeDefined();
    expect(screen.getByText(/\+ Track Work Item/i)).toBeDefined();

    // 2. Resolved Findings Tab
    fireEvent.click(screen.getByText(/Resolved \(1\)/i));
    expect(screen.getByText(/Images lacked descriptive alternative text/i)).toBeDefined();

    // 3. Changed Findings Tab
    fireEvent.click(screen.getByText(/Changed \(1\)/i));
    expect(screen.getByText(/Value proposition clarity/i)).toBeDefined();
    expect(screen.getByText(/Severity: low → medium \(increased\)/i)).toBeDefined();

    // 4. Signals Tab
    fireEvent.click(screen.getByText(/Signals \(1\)/i));
    expect(screen.getByText(/has-cta/i)).toBeDefined();
    expect(screen.getByText(/pass → warn \(regressed\)/i)).toBeDefined();

    // 5. Improvements Tab
    fireEvent.click(screen.getByText(/Improvements \(1\)/i));
    expect(screen.getByText(/Resolved finding in accessibility/i)).toBeDefined();
  });

  it("hides '+ Track Work Item' buttons for viewer role", async () => {
    vi.mocked(auditsApi.getAuditDiff).mockResolvedValue(mockRegressionDiffResponse);

    render(
      <ReportComparisonView
        projectId="proj-1"
        page={mockPage}
        currentRunId="run-curr"
        role="viewer"
        members={mockMembers}
        pages={[mockPage]}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/New Findings \(1\)/i)).toBeDefined();
    });

    fireEvent.click(screen.getByText(/New Findings \(1\)/i));
    expect(screen.queryByText(/\+ Track Work Item/i)).toBeNull();
  });

  it("handles fetch errors with an actionable retry button", async () => {
    vi.mocked(auditsApi.getAuditDiff).mockRejectedValueOnce(new Error("Network timeout"));

    render(
      <ReportComparisonView
        projectId="proj-1"
        page={mockPage}
        currentRunId="run-curr"
        role="owner"
        members={mockMembers}
        pages={[mockPage]}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Unable to compare audit runs/i)).toBeDefined();
      expect(screen.getByText(/Network timeout/i)).toBeDefined();
    });

    // Mock success on retry
    vi.mocked(auditsApi.getAuditDiff).mockResolvedValue(mockBaselineDiffResponse);
    fireEvent.click(screen.getByText(/Retry/i));

    await waitFor(() => {
      expect(screen.getByText(/Baseline Audit Established/i)).toBeDefined();
    });
  });
});
