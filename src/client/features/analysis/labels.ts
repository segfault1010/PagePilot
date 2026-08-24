import type {
  AuditCategory,
  Finding,
  ScoreConfidence,
  Severity,
  SignalStatus,
} from "../../../shared/audit-types";

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  clarity: "Clarity",
  visualHierarchy: "Visual hierarchy",
  ctaEffectiveness: "CTA effectiveness",
  copy: "Copy",
  accessibility: "Accessibility",
  mobileUx: "Mobile UX",
  trustCredibility: "Trust & credibility",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const CONFIDENCE_LABELS: Record<ScoreConfidence, string> = {
  blended: "Blended scoring",
  "ai-led": "AI-led",
};

/**
 * Plain-language explanation of where the score comes from. Deliberately
 * understated — the report must not overstate certainty.
 */
export const CONFIDENCE_EXPLANATIONS: Record<ScoreConfidence, string> = {
  blended: "This score combines AI assessment with deterministic page signals.",
  "ai-led":
    "Limited measurable page signals were available for this page, so its score relies more heavily on AI assessment.",
};

/** Whether a claim was directly detected on the page or interpreted by AI. */
export const BASIS_LABELS: Record<Finding["basis"], string> = {
  observed: "Observed on the page",
  inferred: "AI-inferred from evidence",
};

export const SIGNAL_STATUS_LABELS: Record<SignalStatus, string> = {
  pass: "Pass",
  warn: "Warning",
  unknown: "Not measured",
};

export interface ScoreVerdict {
  label: string;
  description: string;
}

/**
 * Maps an overall score to a short interpretation. Tiers are intentionally
 * coarse: a single number cannot carry more precision than this honestly.
 */
export function scoreVerdict(score: number): ScoreVerdict {
  if (score >= 80) {
    return {
      label: "Strong",
      description: "Fundamentals are in place; the fixes below are refinements.",
    };
  }
  if (score >= 60) {
    return {
      label: "Mixed",
      description: "Some things work, but clear friction points remain.",
    };
  }
  if (score >= 40) {
    return {
      label: "Needs work",
      description: "Meaningful UX problems are likely hurting this page.",
    };
  }
  return {
    label: "At risk",
    description:
      "Serious usability problems need attention before sending traffic here.",
  };
}
