import {
  AUDIT_CATEGORIES,
  reportSchema,
} from "@pagepilot/contracts";
import type {
  AuditCategory,
  CategoryReport,
  Finding,
  Recommendation,
  Report,
} from "@pagepilot/contracts";

/**
 * Deterministic contract-valid reports for UI tests:
 * - richReport: blended confidence, findings in every category, all sections
 *   populated.
 * - sparseReport: ai-led confidence, empty category findings, unknown
 *   signals — exercises intentional empty/unknown states.
 */

function makeFinding(overrides: Partial<Finding> & { title: string }): Finding {
  return {
    severity: "medium",
    evidence: "Deterministic fixture evidence.",
    basis: "observed",
    signalIds: [],
    recommendation: "Apply the fixture fix.",
    ...overrides,
  };
}

function makeRecommendation(
  overrides: Partial<Recommendation> & { title: string },
): Recommendation {
  return {
    detail: "Fixture rationale.",
    ...overrides,
  };
}

const RICH_CATEGORIES: Record<AuditCategory, Pick<CategoryReport, "score" | "confidence" | "severity"> & { explanation: string }> = {
  clarity: { score: 78, confidence: "blended", severity: "medium", explanation: "Title and meta description are present but generic." },
  visualHierarchy: { score: 64, confidence: "blended", severity: "medium", explanation: "Heading outline jumps levels in two places." },
  ctaEffectiveness: { score: 55, confidence: "blended", severity: "high", explanation: "One primary CTA competes with four secondary actions." },
  copy: { score: 72, confidence: "ai-led", severity: "low", explanation: "Copy is concise; value proposition arrives late." },
  accessibility: { score: 49, confidence: "blended", severity: "high", explanation: "Several images lack alt text." },
  mobileUx: { score: 81, confidence: "blended", severity: "low", explanation: "Viewport is configured; controls are adequately sized." },
  trustCredibility: { score: 68, confidence: "ai-led", severity: "medium", explanation: "Trust links exist but are hard to find." },
};

export const richReport: Report = reportSchema.parse({
  source: {
    requestedUrl: "https://example.com",
    finalUrl: "https://www.example.com/",
    analyzedAt: "2026-08-24T10:00:00.000Z",
    title: "Example Landing Page",
  },
  overallScore: 66,
  scoreConfidence: "blended",
  summary:
    "The page communicates its offer clearly, but weak calls to action and missing image alt text undermine conversion and accessibility.",
  categories: AUDIT_CATEGORIES.map((category) => ({
    category,
    ...RICH_CATEGORIES[category],
    findings:
      category === "mobileUx"
        ? []
        : [
            makeFinding({
              title: `${category} issue one`,
              severity: category === "accessibility" ? "high" : "medium",
              basis: category === "copy" ? "inferred" : "observed",
              signalIds: ["h1.present"],
            }),
          ],
  })),
  topProblems: [
    makeFinding({
      title: "Primary CTA is buried below the fold",
      severity: "high",
      evidence: "The strongest action link appears after several competing buttons.",
      basis: "observed",
      signalIds: ["cta.candidates"],
      recommendation: "Move the primary call to action above the fold.",
      category: "ctaEffectiveness",
    }),
    makeFinding({
      title: "Images are missing alt text",
      severity: "high",
      evidence: "6 of 10 images have no alt attribute.",
      basis: "observed",
      signalIds: ["img.altCoverage"],
      recommendation: "Describe each meaningful image with alt text.",
      category: "accessibility",
    }),
    makeFinding({
      title: "Headline promises differ from body copy",
      severity: "medium",
      evidence: "The headline emphasizes speed while the body never mentions it.",
      basis: "inferred",
      signalIds: [],
      recommendation: "Align the headline with the proof in the body copy.",
      category: "copy",
    }),
  ],
  quickWins: [
    makeRecommendation({ title: "Add alt text to key images", category: "accessibility" }),
    makeRecommendation({ title: "Write a specific meta description", category: "clarity" }),
    makeRecommendation({ title: "Label every form field", category: "ctaEffectiveness" }),
    makeRecommendation({ title: "Link the logo to the homepage", category: "trustCredibility" }),
  ],
  detailedRecommendations: [
    makeRecommendation({
      title: "Rebuild the hero around a single action",
      detail: "Reduce competing buttons and give the primary CTA visual priority.",
      category: "ctaEffectiveness",
    }),
    makeRecommendation({
      title: "Fix the heading hierarchy",
      detail: "Use one H1 and step through H2/H3 without skipping levels.",
      category: "visualHierarchy",
    }),
  ],
  observedSignals: [
    { id: "title.present", category: "clarity", status: "pass", weight: 0.5, evidence: "Title tag present (34 characters)." },
    { id: "meta.description", category: "clarity", status: "warn", weight: 0.3, evidence: "Meta description is 210 characters; aim for under 160." },
    { id: "h1.present", category: "visualHierarchy", status: "pass", weight: 0.4, evidence: "Exactly one H1 found." },
    { id: "img.altCoverage", category: "accessibility", status: "warn", weight: 0.4, evidence: "6 of 10 images have no alt attribute." },
    { id: "viewport.present", category: "mobileUx", status: "pass", weight: 1, evidence: "Viewport meta tag present." },
    { id: "forms.present", category: "ctaEffectiveness", status: "unknown", weight: 0.2, evidence: "No forms found; conversion paths other than forms may still exist." },
  ],
});

export const sparseReport: Report = reportSchema.parse({
  source: {
    requestedUrl: "https://sparse.example.org/page",
    finalUrl: "https://sparse.example.org/page",
    analyzedAt: "2026-08-24T11:30:00.000Z",
    title: null,
  },
  overallScore: 38,
  scoreConfidence: "ai-led",
  summary:
    "Very little structure could be measured on this page, so the audit leans on AI interpretation of the limited content available.",
  categories: AUDIT_CATEGORIES.map((category) => ({
    category,
    score: 40,
    confidence: "ai-led",
    severity: "medium" as const,
    explanation: "Not enough measurable evidence for a confident assessment.",
    findings: [],
  })),
  topProblems: [
    makeFinding({
      title: "Page purpose is unclear",
      severity: "high",
      evidence: "No H1 or meta description was detected.",
      basis: "observed",
      signalIds: ["h1.present"],
      recommendation: "State what the page offers in a single clear headline.",
      category: "clarity",
    }),
    makeFinding({
      title: "No obvious next step for visitors",
      severity: "medium",
      evidence: "No buttons or action-oriented links were detected.",
      basis: "observed",
      signalIds: [],
      recommendation: "Add one prominent call to action.",
      category: "ctaEffectiveness",
    }),
    makeFinding({
      title: "Content is too thin to evaluate",
      severity: "low",
      evidence: "Visible text is under 100 characters.",
      basis: "observed",
      signalIds: ["content.length"],
      recommendation: "Explain the offer, who it is for, and why it is credible.",
      category: "copy",
    }),
  ],
  quickWins: [
    makeRecommendation({ title: "Add an H1 that states the offer", category: "clarity" }),
    makeRecommendation({ title: "Add a primary call to action", category: "ctaEffectiveness" }),
    makeRecommendation({ title: "Set a descriptive page title", category: "clarity" }),
  ],
  detailedRecommendations: [
    makeRecommendation({
      title: "Build out the page content",
      detail: "Add headings, proof, and a clear action path so the page can be evaluated and convert.",
    }),
  ],
  observedSignals: [
    { id: "forms.present", category: "ctaEffectiveness", status: "unknown", weight: 0.2, evidence: "No forms found; conversion paths other than forms may still exist." },
  ],
});
