import {
  AUDIT_CATEGORIES,
  AUDIT_ENGINE_SCORING_VERSION,
  DIFF_SCHEMA_VERSION,
  MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD,
  MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD,
  auditDiffSchema,
} from "@pagepilot/contracts";
import type {
  AuditCategory,
  AuditDiff,
  AuditDiffMetadata,
  AuditDiffSummary,
  CategoryChange,
  Finding,
  FindingDiffItem,
  FindingType,
  ImprovementItem,
  RegressionItem,
  Report,
  ScoreChange,
  ScoreDirection,
  Severity,
  SeverityChangeDirection,
  SignalChangeItem,
  SignalChangeType,
} from "@pagepilot/contracts";

/**
 * Optional metadata for audit run comparison.
 */
export interface AuditDiffRunMeta {
  auditRunId?: string | null;
  analyzedAt?: string | Date | null;
  modelVersion?: string | null;
  scoringVersion?: string | null;
}

/**
 * Input parameters for pure audit diff computation.
 */
export interface ComputeAuditDiffParams {
  previousReport?: Report | null;
  currentReport: Report;
  previousRunMeta?: AuditDiffRunMeta | null;
  currentRunMeta?: AuditDiffRunMeta | null;
  options?: {
    overallRegressionThreshold?: number;
    categoryRegressionThreshold?: number;
  };
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const COMMON_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "is",
  "are",
  "was",
  "were",
  "to",
  "in",
  "on",
  "for",
  "of",
  "with",
  "at",
  "by",
  "from",
  "this",
  "that",
  "these",
  "those",
]);

/**
 * Normalizes a finding title into a stable alphanumeric slug for inferred findings.
 * Removes punctuation, normalizes whitespace, and filters trivial stop words.
 */
export function normalizeFindingTitleSlug(rawTitle: string): string {
  const words = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !COMMON_STOP_WORDS.has(word));

  if (words.length === 0) {
    const fallback = rawTitle.toLowerCase().replace(/[^a-z0-9]/g, "");
    return fallback.length > 0 ? fallback : "finding";
  }

  return words.join("-");
}

/**
 * Derives a deterministic comparison identity for a finding.
 *
 * For observed findings backed by deterministic signals, prioritizes the sorted
 * signal IDs to remain resilient against minor LLM wording variations.
 *
 * For inferred findings, derives a normalized title slug within the category.
 */
export function buildFindingIdentityKey(
  findingType: FindingType,
  category: AuditCategory,
  signalIds: readonly string[],
  title: string,
): string {
  const nonEmpties = signalIds.map((s) => s.trim()).filter((s) => s.length > 0);
  if (nonEmpties.length > 0) {
    const sorted = [...nonEmpties].sort().join("+");
    return `${findingType}:${category}:signal:${sorted}`;
  }

  const slug = normalizeFindingTitleSlug(title);
  return `${findingType}:${category}:inferred:${slug}`;
}

/**
 * Compares two severity levels and returns whether severity increased, decreased, or remained unchanged.
 */
export function compareSeverity(
  previous: Severity | null | undefined,
  current: Severity,
): SeverityChangeDirection {
  if (!previous) return "unchanged";
  const prevRank = SEVERITY_RANK[previous];
  const currRank = SEVERITY_RANK[current];
  if (currRank > prevRank) return "increased";
  if (currRank < prevRank) return "decreased";
  return "unchanged";
}

interface NormalizedFinding {
  id: string;
  findingType: FindingType;
  category: AuditCategory;
  finding: Finding;
}

function extractAndMapFindings(report: Report): Map<string, NormalizedFinding> {
  const map = new Map<string, NormalizedFinding>();
  const counts = new Map<string, number>();

  function registerFinding(
    finding: Finding,
    findingType: FindingType,
    category: AuditCategory,
  ) {
    const baseKey = buildFindingIdentityKey(
      findingType,
      category,
      finding.signalIds,
      finding.title,
    );
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}:${count}`;

    map.set(key, {
      id: key,
      findingType,
      category,
      finding,
    });
  }

  for (const topProblem of report.topProblems) {
    const cat = topProblem.category ?? "clarity";
    registerFinding(topProblem, "top_problem", cat);
  }

  for (const categoryReport of report.categories) {
    for (const categoryFinding of categoryReport.findings) {
      registerFinding(categoryFinding, "category_finding", categoryReport.category);
    }
  }

  return map;
}

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/**
 * Pure, deterministic diff engine comparing a previous successful audit report
 * against a current successful audit report.
 *
 * Immutability Guarantee: neither previousReport nor currentReport is mutated.
 */
export function computeAuditDiff(params: ComputeAuditDiffParams): AuditDiff {
  const {
    previousReport,
    currentReport,
    previousRunMeta,
    currentRunMeta,
    options,
  } = params;

  const isBaseline = !previousReport;
  const overallRegressionThreshold =
    options?.overallRegressionThreshold ?? MEANINGFUL_OVERALL_SCORE_DROP_THRESHOLD;
  const categoryRegressionThreshold =
    options?.categoryRegressionThreshold ?? MEANINGFUL_CATEGORY_SCORE_DROP_THRESHOLD;

  // ---------------------------------------------------------------------------
  // 1. Score Diff (Overall & Categories)
  // ---------------------------------------------------------------------------
  let overallScoreChange: ScoreChange;
  if (previousReport) {
    const delta = currentReport.overallScore - previousReport.overallScore;
    const direction: ScoreDirection =
      delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
    const isMeaningfulRegression = delta <= -overallRegressionThreshold;

    overallScoreChange = {
      previousScore: previousReport.overallScore,
      currentScore: currentReport.overallScore,
      delta,
      direction,
      isMeaningfulRegression,
    };
  } else {
    overallScoreChange = {
      previousScore: null,
      currentScore: currentReport.overallScore,
      delta: null,
      direction: "unchanged",
      isMeaningfulRegression: false,
    };
  }

  const categoryChanges: CategoryChange[] = AUDIT_CATEGORIES.map((category) => {
    const currCat = currentReport.categories.find((c) => c.category === category)!;
    const prevCat = previousReport?.categories.find((c) => c.category === category) ?? null;

    if (prevCat) {
      const delta = currCat.score - prevCat.score;
      const direction: ScoreDirection =
        delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
      const severityChange = compareSeverity(prevCat.severity, currCat.severity);
      const isMeaningfulRegression = delta <= -categoryRegressionThreshold;

      return {
        category,
        previousScore: prevCat.score,
        currentScore: currCat.score,
        delta,
        direction,
        previousSeverity: prevCat.severity,
        currentSeverity: currCat.severity,
        severityChange,
        previousConfidence: prevCat.confidence,
        currentConfidence: currCat.confidence,
        isMeaningfulRegression,
      };
    } else {
      return {
        category,
        previousScore: null,
        currentScore: currCat.score,
        delta: null,
        direction: "unchanged",
        previousSeverity: null,
        currentSeverity: currCat.severity,
        severityChange: "unchanged",
        previousConfidence: null,
        currentConfidence: currCat.confidence,
        isMeaningfulRegression: false,
      };
    }
  });

  // ---------------------------------------------------------------------------
  // 2. Finding Diff (New, Resolved, Changed, Unchanged)
  // ---------------------------------------------------------------------------
  const currentFindingsMap = extractAndMapFindings(currentReport);
  const previousFindingsMap = previousReport
    ? extractAndMapFindings(previousReport)
    : new Map<string, NormalizedFinding>();

  const newFindings: FindingDiffItem[] = [];
  const resolvedFindings: FindingDiffItem[] = [];
  const changedFindings: FindingDiffItem[] = [];
  const unchangedFindings: FindingDiffItem[] = [];

  for (const [key, curr] of currentFindingsMap) {
    const prev = previousFindingsMap.get(key);
    if (!prev) {
      // New finding
      const isHighSeverity = curr.finding.severity === "high";
      newFindings.push({
        id: key,
        findingType: curr.findingType,
        category: curr.category,
        status: "new",
        basis: curr.finding.basis,
        signalIds: [...curr.finding.signalIds],
        previousTitle: null,
        previousSeverity: null,
        previousEvidence: null,
        previousRecommendation: null,
        currentTitle: curr.finding.title,
        currentSeverity: curr.finding.severity,
        currentEvidence: curr.finding.evidence,
        currentRecommendation: curr.finding.recommendation,
        severityChange: "unchanged",
        isMaterialChange: true,
        isSeverityRegression: !isBaseline && isHighSeverity,
      });
    } else {
      // Matched finding in both reports
      const severityChange = compareSeverity(
        prev.finding.severity,
        curr.finding.severity,
      );
      const isSeverityIncreased = severityChange === "increased";
      const isTitleChanged = prev.finding.title.trim() !== curr.finding.title.trim();
      const isEvidenceChanged =
        prev.finding.evidence.trim() !== curr.finding.evidence.trim();
      const isRecommendationChanged =
        prev.finding.recommendation.trim() !== curr.finding.recommendation.trim();
      const isBasisChanged = prev.finding.basis !== curr.finding.basis;

      const isMaterialChange =
        severityChange !== "unchanged" ||
        isTitleChanged ||
        isEvidenceChanged ||
        isRecommendationChanged ||
        isBasisChanged;

      const diffItem: FindingDiffItem = {
        id: key,
        findingType: curr.findingType,
        category: curr.category,
        status: isMaterialChange ? "changed" : "unchanged",
        basis: curr.finding.basis,
        signalIds: [...curr.finding.signalIds],
        previousTitle: prev.finding.title,
        previousSeverity: prev.finding.severity,
        previousEvidence: prev.finding.evidence,
        previousRecommendation: prev.finding.recommendation,
        currentTitle: curr.finding.title,
        currentSeverity: curr.finding.severity,
        currentEvidence: curr.finding.evidence,
        currentRecommendation: curr.finding.recommendation,
        severityChange,
        isMaterialChange,
        isSeverityRegression: isSeverityIncreased,
      };

      if (isMaterialChange) {
        changedFindings.push(diffItem);
      } else {
        unchangedFindings.push(diffItem);
      }
    }
  }

  // Check for resolved findings (in previous but absent in current)
  for (const [key, prev] of previousFindingsMap) {
    if (!currentFindingsMap.has(key)) {
      resolvedFindings.push({
        id: key,
        findingType: prev.findingType,
        category: prev.category,
        status: "resolved",
        basis: prev.finding.basis,
        signalIds: [...prev.finding.signalIds],
        previousTitle: prev.finding.title,
        previousSeverity: prev.finding.severity,
        previousEvidence: prev.finding.evidence,
        previousRecommendation: prev.finding.recommendation,
        currentTitle: null,
        currentSeverity: null,
        currentEvidence: null,
        currentRecommendation: null,
        severityChange: "unchanged",
        isMaterialChange: true,
        isSeverityRegression: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Signal-Level Diff
  // ---------------------------------------------------------------------------
  const currentSignalsMap = new Map(
    currentReport.observedSignals.map((s) => [s.id, s]),
  );
  const previousSignalsMap = new Map(
    (previousReport?.observedSignals ?? []).map((s) => [s.id, s]),
  );

  const allSignalIds = new Set([
    ...currentSignalsMap.keys(),
    ...previousSignalsMap.keys(),
  ]);

  const signalChanges: SignalChangeItem[] = [];

  for (const signalId of allSignalIds) {
    const currSig = currentSignalsMap.get(signalId);
    const prevSig = previousSignalsMap.get(signalId);

    if (currSig && prevSig) {
      let changeType: SignalChangeType;
      let isRegression = false;
      let isImprovement = false;

      if (prevSig.status === "pass" && currSig.status === "warn") {
        changeType = "regressed";
        isRegression = true;
      } else if (prevSig.status === "warn" && currSig.status === "pass") {
        changeType = "improved";
        isImprovement = true;
      } else if (prevSig.status === "unknown" && currSig.status !== "unknown") {
        changeType = "became_measured";
      } else if (prevSig.status !== "unknown" && currSig.status === "unknown") {
        changeType = "became_unknown";
      } else {
        changeType = "unchanged";
      }

      signalChanges.push({
        signalId,
        category: currSig.category,
        weight: currSig.weight,
        previousStatus: prevSig.status,
        currentStatus: currSig.status,
        changeType,
        previousEvidence: prevSig.evidence,
        currentEvidence: currSig.evidence,
        isRegression,
        isImprovement,
      });
    } else if (currSig && !prevSig) {
      signalChanges.push({
        signalId,
        category: currSig.category,
        weight: currSig.weight,
        previousStatus: null,
        currentStatus: currSig.status,
        changeType: "new",
        previousEvidence: null,
        currentEvidence: currSig.evidence,
        isRegression: false,
        isImprovement: false,
      });
    } else if (!currSig && prevSig) {
      signalChanges.push({
        signalId,
        category: prevSig.category,
        weight: prevSig.weight,
        previousStatus: prevSig.status,
        currentStatus: "unknown",
        changeType: "became_unknown",
        previousEvidence: prevSig.evidence,
        currentEvidence: "Signal is no longer present.",
        isRegression: false,
        isImprovement: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Regressions & Improvements Aggregations
  // ---------------------------------------------------------------------------
  const regressions: RegressionItem[] = [];
  const improvements: ImprovementItem[] = [];

  if (!isBaseline && previousReport) {
    // Meaningful overall score regression (drop >= threshold)
    if (overallScoreChange.isMeaningfulRegression) {
      regressions.push({
        type: "overall_score_drop",
        category: null,
        description: `Overall score dropped by ${Math.abs(overallScoreChange.delta!)} points (${previousReport.overallScore} -> ${currentReport.overallScore}).`,
        basis: "observed",
        severity: "high",
        scoreDelta: overallScoreChange.delta,
      });
    } else if (overallScoreChange.delta !== null && overallScoreChange.delta > 0) {
      improvements.push({
        type: "overall_score_increase",
        category: null,
        description: `Overall score increased by ${overallScoreChange.delta} points (${previousReport.overallScore} -> ${currentReport.overallScore}).`,
        basis: "observed",
        scoreDelta: overallScoreChange.delta,
      });
    }

    // Meaningful category score regressions (drop >= threshold) & improvements
    for (const catChange of categoryChanges) {
      if (catChange.isMeaningfulRegression && catChange.delta !== null) {
        regressions.push({
          type: "category_score_drop",
          category: catChange.category,
          description: `${catChange.category} score dropped by ${Math.abs(catChange.delta)} points (${catChange.previousScore} -> ${catChange.currentScore}).`,
          basis: "observed",
          severity: "high",
          scoreDelta: catChange.delta,
        });
      } else if (catChange.delta !== null && catChange.delta >= 10) {
        improvements.push({
          type: "category_score_increase",
          category: catChange.category,
          description: `${catChange.category} score improved by ${catChange.delta} points (${catChange.previousScore} -> ${catChange.currentScore}).`,
          basis: "observed",
          scoreDelta: catChange.delta,
        });
      }
    }

    // New high-severity findings
    for (const newFinding of newFindings) {
      if (newFinding.currentSeverity === "high") {
        regressions.push({
          type: "new_high_severity_finding",
          category: newFinding.category,
          description: `New high-severity finding in ${newFinding.category}: "${newFinding.currentTitle}".`,
          basis: newFinding.basis,
          severity: "high",
          findingId: newFinding.id,
        });
      }
    }

    // Finding severity escalations
    for (const changed of changedFindings) {
      if (changed.severityChange === "increased") {
        regressions.push({
          type: "finding_severity_increased",
          category: changed.category,
          description: `Finding severity in ${changed.category} increased from ${changed.previousSeverity} to ${changed.currentSeverity}: "${changed.currentTitle}".`,
          basis: changed.basis,
          severity: changed.currentSeverity!,
          findingId: changed.id,
        });
      } else if (changed.severityChange === "decreased") {
        improvements.push({
          type: "finding_severity_decreased",
          category: changed.category,
          description: `Finding severity in ${changed.category} decreased from ${changed.previousSeverity} to ${changed.currentSeverity}: "${changed.currentTitle}".`,
          basis: changed.basis,
          findingId: changed.id,
        });
      }
    }

    // Resolved findings
    for (const resolved of resolvedFindings) {
      improvements.push({
        type: "finding_resolved",
        category: resolved.category,
        description: `Resolved finding in ${resolved.category}: "${resolved.previousTitle}".`,
        basis: resolved.basis,
        findingId: resolved.id,
      });
    }

    // Regressed deterministic signals (pass -> warn)
    for (const sigChange of signalChanges) {
      if (sigChange.isRegression) {
        regressions.push({
          type: "signal_regressed",
          category: sigChange.category,
          description: `Deterministic signal "${sigChange.signalId}" in ${sigChange.category} regressed from pass to warn: ${sigChange.currentEvidence}`,
          basis: "observed",
          severity: "medium",
          signalId: sigChange.signalId,
        });
      } else if (sigChange.isImprovement) {
        improvements.push({
          type: "signal_improved",
          category: sigChange.category,
          description: `Deterministic signal "${sigChange.signalId}" in ${sigChange.category} improved from warn to pass: ${sigChange.currentEvidence}`,
          basis: "observed",
          signalId: sigChange.signalId,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Summary & Metadata
  // ---------------------------------------------------------------------------
  const regressedCategoriesCount = categoryChanges.filter(
    (c) => c.direction === "regressed",
  ).length;
  const improvedCategoriesCount = categoryChanges.filter(
    (c) => c.direction === "improved",
  ).length;
  const unchangedCategoriesCount = categoryChanges.filter(
    (c) => c.direction === "unchanged",
  ).length;

  const newHighSeverityFindingsCount = newFindings.filter(
    (f) => f.currentSeverity === "high",
  ).length;

  const regressedSignalsCount = signalChanges.filter((s) => s.isRegression).length;
  const improvedSignalsCount = signalChanges.filter((s) => s.isImprovement).length;

  const observedRegressionsCount = regressions.filter(
    (r) => r.basis === "observed",
  ).length;
  const inferredRegressionsCount = regressions.filter(
    (r) => r.basis === "inferred",
  ).length;

  const hasMeaningfulRegression =
    !isBaseline &&
    (overallScoreChange.isMeaningfulRegression || newHighSeverityFindingsCount > 0);

  const summary: AuditDiffSummary = {
    schemaVersion: DIFF_SCHEMA_VERSION,
    isBaseline,
    hasPreviousReport: !isBaseline,
    hasMeaningfulRegression,
    overallScoreDelta: overallScoreChange.delta,
    overallScoreDirection: overallScoreChange.direction,
    regressedCategoriesCount,
    improvedCategoriesCount,
    unchangedCategoriesCount,
    newFindingsCount: newFindings.length,
    newHighSeverityFindingsCount,
    resolvedFindingsCount: resolvedFindings.length,
    changedFindingsCount: changedFindings.length,
    unchangedFindingsCount: unchangedFindings.length,
    regressedSignalsCount,
    improvedSignalsCount,
    totalRegressionsCount: regressions.length,
    totalImprovementsCount: improvements.length,
    observedRegressionsCount,
    inferredRegressionsCount,
  };

  const metadata: AuditDiffMetadata = {
    previousAnalyzedAt:
      normalizeTimestamp(previousRunMeta?.analyzedAt) ??
      previousReport?.source.analyzedAt ??
      null,
    currentAnalyzedAt:
      normalizeTimestamp(currentRunMeta?.analyzedAt) ??
      currentReport.source.analyzedAt,
    previousAuditRunId: previousRunMeta?.auditRunId ?? null,
    currentAuditRunId: currentRunMeta?.auditRunId ?? null,
    previousModelVersion: previousRunMeta?.modelVersion ?? null,
    currentModelVersion: currentRunMeta?.modelVersion ?? null,
    scoringVersion:
      currentRunMeta?.scoringVersion ?? AUDIT_ENGINE_SCORING_VERSION,
  };

  const rawDiff: AuditDiff = {
    summary,
    metadata,
    scoreChanges: {
      overall: overallScoreChange,
      categories: categoryChanges,
    },
    newFindings,
    resolvedFindings,
    changedFindings,
    unchangedFindings,
    signalChanges,
    regressions,
    improvements,
  };

  return auditDiffSchema.parse(rawDiff);
}
