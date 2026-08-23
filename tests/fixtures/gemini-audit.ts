import { AUDIT_CATEGORIES } from "../../src/shared/audit-types";
import type { AuditCategory } from "../../src/shared/audit-types";
import type { GeminiAudit } from "../../src/server/schemas/audit";
import type { AuditModelInput } from "../../src/server/ai/audit-input";

/**
 * Contract-valid Gemini audit fixture in its DOMAIN form (findings grouped
 * under categories) and its WIRE form (flat tagged findings list) — the two
 * shapes parseGeminiAuditOutput maps between.
 */
export function validGeminiAudit(): GeminiAudit {
  return {
    summary:
      "The page communicates its offer clearly but buries the primary call to action below the fold.",
    categories: AUDIT_CATEGORIES.map((category) => ({
      key: category,
      score: 70,
      explanation: `Evidence supports an adequate ${category} baseline.`,
      severity: "low",
      findings: [
        {
          title: `${category} finding title`,
          severity: "medium",
          evidence: "Deterministic signals show partial coverage here.",
          basis: "observed",
          signalIds: [],
          recommendation: "Tighten the weakest element identified above.",
        },
      ],
    })),
    topProblems: [
      {
        category: "ctaEffectiveness",
        title: "Primary CTA lacks prominence",
        severity: "high",
        evidence: "Buttons read 'Submit' with no action-oriented wording.",
        basis: "observed",
        signalIds: ["cta.candidates"],
        recommendation: "Rewrite the main button around the user's outcome.",
      },
      {
        category: "clarity",
        title: "Meta description missing",
        severity: "medium",
        evidence: "No meta description tag was found in the head.",
        basis: "observed",
        signalIds: ["meta.description.present"],
        recommendation: "Add a 50-160 character meta description.",
      },
      {
        category: "trustCredibility",
        title: "Trust links are not discoverable",
        severity: "low",
        evidence: "Sampled links contain no contact or legal destinations.",
        basis: "inferred",
        signalIds: [],
        recommendation: "Surface privacy and contact links in the footer.",
      },
    ],
    quickWins: [
      {
        title: "Add a meta description",
        rationale: "One tag improves search snippets and clarity immediately.",
        category: "clarity",
      },
      {
        title: "Label every form field",
        rationale: "Programmatic labels fix accessibility gaps quickly.",
        category: "accessibility",
      },
      {
        title: "Rewrite generic link text",
        rationale: "Descriptive anchors help users and screen readers scan.",
        category: "copy",
      },
    ],
    detailedRecommendations: [
      {
        title: "Restructure the heading outline",
        rationale: "A single H1 with ordered H2s clarifies page hierarchy.",
        category: "visualHierarchy",
        priority: 1,
      },
      {
        title: "Publish trust pages",
        rationale: "Contact and privacy pages support credibility judgments.",
        category: "trustCredibility",
        priority: 2,
      },
    ],
  };
}

/** Wire form of the same audit: flat findings list tagged by categoryKey. */
export function validWireAudit(): Record<string, unknown> {
  const domain = validGeminiAudit();
  const findings = domain.categories.flatMap((category) =>
    category.findings.map((finding) => ({
      categoryKey: category.key,
      ...finding,
    })),
  );
  return {
    summary: domain.summary,
    categories: domain.categories.map(({ key, score, explanation, severity }) => ({
      key,
      score,
      explanation,
      severity,
    })),
    findings,
    topProblems: domain.topProblems,
    quickWins: domain.quickWins,
    detailedRecommendations: domain.detailedRecommendations,
  };
}

type Mutation = (audit: GeminiAudit) => void;

/** Deep-clones the valid fixture, applies mutations, returns the result. */
export function auditWith(...mutations: Mutation[]): GeminiAudit {
  const audit = structuredClone(validGeminiAudit()) as GeminiAudit;
  for (const mutate of mutations) mutate(audit);
  return audit;
}

export function setCategory(
  key: AuditCategory,
  patch: Partial<GeminiAudit["categories"][number]>,
): Mutation {
  return (audit) => {
    const index = audit.categories.findIndex((c) => c.key === key);
    audit.categories[index] = { ...audit.categories[index]!, ...patch };
  };
}

/** Deterministic model input matching the fixture's referenced signals. */
export function minimalModelInput(): AuditModelInput {
  return {
    page: {
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      title: "Example landing page",
      metaDescription: null,
      lang: "en",
      viewport: "width=device-width, initial-scale=1",
      canonical: null,
      openGraph: {},
      counts: {
        h1: 1,
        h2: 2,
        h3: 0,
        anchors: 4,
        buttons: 2,
        forms: 1,
        paragraphs: 5,
        navigationRegions: 1,
        images: 3,
        imagesWithAlt: 2,
        visibleTextCharacters: 900,
      },
      headingWarnings: [],
    },
    content: {
      textExcerpt: "Example landing page copy.",
      headingOutline: [{ level: 1, text: "Example landing page" }],
    },
    samples: {
      links: [],
      buttons: ["Submit"],
      forms: [{ fieldCount: 2, labeledFieldCount: 0 }],
      navigationFirstItems: [],
      ctaCandidates: [{ kind: "button", text: "Submit" }],
    },
    deterministicSignals: [
      {
        id: "cta.candidates",
        category: "ctaEffectiveness",
        status: "warn",
        weight: 0.35,
        evidence: "1 CTA candidate detected.",
      },
      {
        id: "meta.description.present",
        category: "clarity",
        status: "warn",
        weight: 0.4,
        evidence: "No meta description found.",
      },
    ],
  };
}
