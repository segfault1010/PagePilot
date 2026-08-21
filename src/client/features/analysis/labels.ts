import type {
  AuditCategory,
  ScoreConfidence,
  Severity,
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
