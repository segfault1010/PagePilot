import { AUDIT_CATEGORIES } from "@pagepilot/contracts";
import type { CategoryReport, Report } from "@pagepilot/contracts";

const placeholderCategories: CategoryReport[] = AUDIT_CATEGORIES.map(
  (category) => ({
    category,
    score: 70,
    confidence: "blended",
    severity: "low",
    explanation: "Sample category explanation.",
    findings: [],
  }),
);

export const sampleReport: Report = {
  source: {
    requestedUrl: "https://example.com",
    finalUrl: "https://example.com/",
    analyzedAt: "2026-08-23T12:00:00.000Z",
    title: "Example Landing Page",
  },
  overallScore: 70,
  scoreConfidence: "blended",
  summary: "Sample report summary for API testing.",
  categories: placeholderCategories,
  topProblems: [
    {
      title: "Primary call to action could be clearer",
      severity: "medium",
      evidence: "Evidence sample.",
      basis: "observed",
      signalIds: [],
      recommendation: "Clarify the main action.",
      category: "ctaEffectiveness",
    },
    {
      title: "Value proposition appears below the fold",
      severity: "medium",
      evidence: "Evidence sample.",
      basis: "inferred",
      signalIds: [],
      recommendation: "Move key benefits higher.",
      category: "clarity",
    },
    {
      title: "Trust signals are not prominent",
      severity: "low",
      evidence: "Evidence sample.",
      basis: "observed",
      signalIds: [],
      recommendation: "Add customer proof near the CTA.",
      category: "trustCredibility",
    },
  ],
  quickWins: [
    { title: "Clarify primary button text", detail: "Short button label fix.", category: "ctaEffectiveness" },
    { title: "Add descriptive page title", detail: "Add a title tag under 60 chars.", category: "clarity" },
    { title: "Include security badges near signup", detail: "Add trust seals.", category: "trustCredibility" },
  ],
  detailedRecommendations: [
    {
      title: "Restructure hero section",
      detail: "Detail sample.",
      category: "clarity",
    },
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
