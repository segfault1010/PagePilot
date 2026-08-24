import {
  AUDIT_CATEGORIES,
  reportSchema,
} from "../../shared/audit-types";
import type {
  AuditCategory,
  CategoryReport,
  DetectedSignal,
  Finding,
  Recommendation,
  Report,
  ScoreConfidence,
} from "../../shared/audit-types";
import type { GeminiAudit } from "../schemas/audit";

/**
 * Server-side scoring (Phase 5).
 *
 * Per category: a deterministic baseline is computed from that category's
 * applicable weighted signals (`unknown` signals are excluded from both the
 * numerator and denominator — they never penalize). When the non-unknown
 * weight covers at least 40% of the emitted signal weight for the category,
 * the final score blends 0.60 × Gemini + 0.40 × deterministic baseline and
 * is labeled "blended"; otherwise the Gemini score stands alone ("ai-led").
 *
 * overallScore is computed here — never by the model — as the weighted sum
 * of the FINAL (post-blend) category scores.
 */

export const CATEGORY_WEIGHTS: Record<AuditCategory, number> = {
  clarity: 0.18,
  visualHierarchy: 0.15,
  ctaEffectiveness: 0.15,
  copy: 0.12,
  accessibility: 0.15,
  mobileUx: 0.1,
  trustCredibility: 0.15,
};

export const BLEND_COVERAGE_THRESHOLD = 0.4;
export const GEMINI_SCORE_SHARE = 0.6;
export const BASELINE_SCORE_SHARE = 0.4;

/**
 * Partial credit for `warn`: a warn means the criterion is partially met.
 * Unknowns never contribute points or weight.
 */
const WARN_CREDIT = 0.5;

export interface DeterministicBaseline {
  /** 0–100 baseline over applicable signals only; null when none apply. */
  baseline: number | null;
  /** Share of this category's emitted signal weight that is determinable. */
  coverage: number;
}

export function computeDeterministicBaseline(
  signals: readonly DetectedSignal[],
  category: AuditCategory,
): DeterministicBaseline {
  let totalWeight = 0;
  let applicableWeight = 0;
  let weightedPoints = 0;

  for (const signal of signals) {
    if (signal.category !== category) continue;
    totalWeight += signal.weight;
    if (signal.status === "unknown") continue;
    const credit = signal.status === "pass" ? 1 : WARN_CREDIT;
    applicableWeight += signal.weight;
    weightedPoints += credit * signal.weight;
  }

  if (totalWeight === 0 || applicableWeight === 0) {
    return { baseline: null, coverage: 0 };
  }
  return {
    baseline: round((weightedPoints / applicableWeight) * 100),
    coverage: applicableWeight / totalWeight,
  };
}

export function round(value: number): number {
  return Math.round(value);
}

export interface ScoredCategory {
  key: AuditCategory;
  geminiScore: number;
  finalScore: number;
  confidence: ScoreConfidence;
  baseline: number | null;
  coverage: number;
}

/** Blends one category per the coverage rule. */
export function scoreCategory(
  geminiScore: number,
  baselineInfo: DeterministicBaseline,
): Pick<ScoredCategory, "finalScore" | "confidence"> {
  if (
    baselineInfo.baseline !== null &&
    baselineInfo.coverage >= BLEND_COVERAGE_THRESHOLD
  ) {
    return {
      finalScore: clampScore(
        round(
          GEMINI_SCORE_SHARE * geminiScore +
            BASELINE_SCORE_SHARE * baselineInfo.baseline,
        ),
      ),
      confidence: "blended",
    };
  }
  return { finalScore: clampScore(geminiScore), confidence: "ai-led" };
}

export function scoreAllCategories(
  audit: GeminiAudit,
  signals: readonly DetectedSignal[],
): Map<AuditCategory, ScoredCategory> {
  const scored = new Map<AuditCategory, ScoredCategory>();
  for (const assessment of audit.categories) {
    const baselineInfo = computeDeterministicBaseline(signals, assessment.key);
    const blend = scoreCategory(assessment.score, baselineInfo);
    scored.set(assessment.key, {
      key: assessment.key,
      geminiScore: assessment.score,
      finalScore: blend.finalScore,
      confidence: blend.confidence,
      baseline: baselineInfo.baseline,
      coverage: Number(baselineInfo.coverage.toFixed(4)),
    });
  }
  return scored;
}

/**
 * Overall confidence mirrors the per-category rule conservatively: the whole
 * report is "blended" only when every category had sufficient deterministic
 * coverage; any ai-led category downgrades the report label.
 */
export function computeReportConfidence(scored: Iterable<ScoredCategory>): ScoreConfidence {
  for (const category of scored) {
    if (category.confidence !== "blended") return "ai-led";
  }
  return "blended";
}

export function computeOverallScore(scored: Iterable<ScoredCategory>): number {
  let weighted = 0;
  for (const category of scored) {
    weighted += CATEGORY_WEIGHTS[category.key] * category.finalScore;
  }
  // Defensive invariant: keep the aggregate within contract bounds even if
  // weights drift in future phases.
  return clampScore(round(weighted));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Report transformation
// ---------------------------------------------------------------------------

export interface BuildReportParams {
  requestedUrl: string;
  finalUrl: string;
  title: string | null;
  analyzedAt: Date;
  signals: readonly DetectedSignal[];
  audit: GeminiAudit;
}

/**
 * Merges the validated Gemini audit with deterministic evidence into the
 * stable API report contract. Model fields are copied field-by-field through
 * contract shapes — never spread wholesale — so nothing unvalidated can leak
 * through, and the finished report is re-validated against reportSchema as a
 * defensive invariant before returning.
 */
export function buildReport(params: BuildReportParams): Report {
  const scored = scoreAllCategories(params.audit, params.signals);

  const categories: CategoryReport[] = AUDIT_CATEGORIES.map((key) => {
    const assessment = params.audit.categories.find((c) => c.key === key)!;
    const categoryScored = scored.get(key)!;
    return {
      category: key,
      score: categoryScored.finalScore,
      confidence: categoryScored.confidence,
      explanation: assessment.explanation,
      severity: assessment.severity,
      findings: assessment.findings.map(toFinding),
    };
  });

  const topProblems: Finding[] = params.audit.topProblems.map((problem) => ({
    title: problem.title,
    severity: problem.severity,
    evidence: problem.evidence,
    basis: problem.basis,
    signalIds: problem.signalIds,
    recommendation: problem.recommendation,
    category: problem.category,
  }));

  const quickWins: Recommendation[] = params.audit.quickWins.map((win) => ({
    title: win.title,
    detail: win.rationale,
    category: win.category,
  }));

  const detailedRecommendations: Recommendation[] = [...params.audit.detailedRecommendations]
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
    .map((rec) => ({
      title: rec.title,
      detail: rec.rationale,
      category: rec.category,
    }));

  const candidate: Report = {
    source: {
      requestedUrl: params.requestedUrl,
      finalUrl: params.finalUrl,
      analyzedAt: params.analyzedAt.toISOString(),
      title: params.title,
    },
    overallScore: computeOverallScore(scored.values()),
    scoreConfidence: computeReportConfidence(scored.values()),
    summary: params.audit.summary,
    categories,
    topProblems,
    quickWins,
    detailedRecommendations,
    observedSignals: [...params.signals],
  };

  return reportSchema.parse(candidate);
}

function toFinding(finding: GeminiAudit["categories"][number]["findings"][number]): Finding {
  return {
    title: finding.title,
    severity: finding.severity,
    evidence: finding.evidence,
    basis: finding.basis,
    signalIds: finding.signalIds,
    recommendation: finding.recommendation,
  };
}
