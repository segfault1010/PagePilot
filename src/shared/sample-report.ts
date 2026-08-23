import type {
  AuditCategory,
  CategoryReport,
  Finding,
  Recommendation,
  Report,
} from "./audit-types";

const ALL_CATEGORIES: AuditCategory[] = [
  "clarity",
  "visualHierarchy",
  "ctaEffectiveness",
  "copy",
  "accessibility",
  "mobileUx",
  "trustCredibility",
];

function makeCategory(category: AuditCategory): CategoryReport {
  return {
    category,
    score: 70,
    confidence: "blended",
    explanation: `${category} looks acceptable in the sample.`,
    severity: "low",
    findings: [
      {
        title: `Sample ${category} finding`,
        severity: "low",
        evidence: "Fixture evidence text.",
        basis: "observed",
        signalIds: [],
        recommendation: "Sample recommendation.",
      },
    ],
  };
}

function makeFinding(title: string): Finding {
  return {
    title,
    severity: "medium",
    evidence: "Fixture evidence text.",
    basis: "inferred",
    signalIds: ["title.present"],
    recommendation: "Sample recommendation.",
  };
}

function makeRecommendation(title: string): Recommendation {
  return {
    title,
    detail: "Fixture recommendation detail.",
    category: "clarity",
  };
}

/**
 * Contract-valid sample report rendered by the landing page's labeled
 * "Example report" preview and reused by contract/UI tests. The API no
 * longer serves this — Phase 5 replaced it with real server-scored reports.
 */
export const sampleReport: Report = {
  source: {
    requestedUrl: "https://example.com/",
    finalUrl: "https://example.com/",
    analyzedAt: "2026-08-21T12:00:00.000Z",
    title: "Example Domain",
  },
  overallScore: 70,
  scoreConfidence: "blended",
  summary: "Sample fixture report used by contract tests.",
  categories: ALL_CATEGORIES.map(makeCategory),
  topProblems: [
    makeFinding("Weak call to action"),
    makeFinding("Thin page copy"),
    makeFinding("Missing image alt text"),
  ],
  quickWins: [
    makeRecommendation("Sharpen the primary CTA"),
    makeRecommendation("Add a meta description"),
    makeRecommendation("Label form fields"),
  ],
  detailedRecommendations: [
    makeRecommendation("Restructure the heading outline"),
  ],
  observedSignals: [
    {
      id: "title.present",
      category: "clarity",
      status: "pass",
      weight: 0.5,
      evidence: "Title present.",
    },
  ],
};
