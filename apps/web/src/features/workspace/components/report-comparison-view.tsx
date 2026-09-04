import { useCallback, useEffect, useState } from "react";
import type {
  AuditDiff,
  AuditDiffResponse,
  AuditHistoryItem,
  FindingDiffItem,
  MonitoredPage,
  OrganizationMember,
  Role,
  SignalChangeItem,
  WorkItem,
} from "@pagepilot/contracts";
import { getAuditDiff } from "../../audits/api";
import {
  CreateWorkItemModal,
  type PrefillSourceData,
} from "../../work-items/components/create-work-item-modal";
import { VisualRegressionCard } from "../../audits/components/visual-regression-card.js";

export interface ReportComparisonViewProps {
  projectId: string;
  page: MonitoredPage;
  currentRunId: string;
  initialCompareRunId?: string | null;
  history?: AuditHistoryItem[];
  role?: Role;
  members?: OrganizationMember[];
  pages?: MonitoredPage[];
  onBack: () => void;
  onWorkItemCreated?: (item: WorkItem) => void;
}

const CATEGORY_NAMES: Record<string, string> = {
  clarity: "Clarity & Value Prop",
  visualHierarchy: "Visual Hierarchy",
  ctaEffectiveness: "CTA Effectiveness",
  copy: "Copy & Messaging",
  accessibility: "Accessibility",
  mobileUx: "Mobile Experience",
  trustCredibility: "Trust & Credibility",
};

export function ReportComparisonView({
  projectId,
  page,
  currentRunId,
  initialCompareRunId = null,
  history = [],
  role = "owner",
  members = [],
  pages = [],
  onBack,
  onWorkItemCreated,
}: ReportComparisonViewProps) {
  const isViewer = role === "viewer";

  const [selectedCompareRunId, setSelectedCompareRunId] = useState<string | null>(
    initialCompareRunId,
  );
  const [data, setData] = useState<AuditDiffResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "regressions" | "new" | "resolved" | "changed" | "signals" | "improvements" | "visual"
  >("regressions");

  const [prefillData, setPrefillData] = useState<PrefillSourceData | null>(null);

  // Completed history items for comparison dropdown (excluding the current run itself)
  const completedRuns = history.filter(
    (h) => h.status === "completed" && h.id !== currentRunId,
  );

  const fetchDiff = useCallback(
    async (compareId: string | null) => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await getAuditDiff(projectId, page.id, currentRunId, {
          compareRunId: compareId || undefined,
        });
        setData(res);
      } catch (err: any) {
        setErrorMessage(err?.message || "Failed to load audit comparison.");
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, page.id, currentRunId],
  );

  useEffect(() => {
    fetchDiff(selectedCompareRunId);
  }, [fetchDiff, selectedCompareRunId]);

  const handleTrackFindingDiff = (item: FindingDiffItem) => {
    if (isViewer) return;
    setPrefillData({
      sourceType: "finding",
      pageId: page.id,
      title: item.currentTitle || item.previousTitle || "Audit Finding",
      description:
        item.currentEvidence ||
        item.previousEvidence ||
        item.currentRecommendation ||
        "Identified in audit comparison.",
      category: item.category,
      severity: item.currentSeverity || item.previousSeverity || "medium",
    });
  };

  const diff: AuditDiff | undefined = data?.diff;
  const isBaseline = diff?.summary?.isBaseline ?? false;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 self-start rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            &larr; Back to Page
          </button>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-neutral-100 sm:text-base">
              Audit Report Comparison
            </h1>
            <p className="truncate text-xs text-neutral-400 max-w-md">
              {page.canonicalUrl}
            </p>
          </div>
        </div>

        {/* Comparison Target Selector */}
        {completedRuns.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <label
              htmlFor="compare-run-select"
              className="text-neutral-400 whitespace-nowrap"
            >
              Compare with:
            </label>
            <select
              id="compare-run-select"
              value={selectedCompareRunId || ""}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedCompareRunId(val ? val : null);
              }}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <option value="">Auto (Previous Successful Audit)</option>
              {completedRuns.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.createdAt ? new Date(r.createdAt).toLocaleString() : r.id} — Score: {r.overallScore ?? "—"}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"
              />
            ))}
          </div>
        </div>
      ) : errorMessage ? (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-900/50 bg-red-950/40 p-5 text-xs text-red-300 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <span className="font-semibold">Unable to compare audit runs: </span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchDiff(selectedCompareRunId)}
            className="self-start rounded border border-red-800 bg-red-950 px-3 py-1 text-xs font-medium text-red-200 transition hover:bg-red-900 sm:self-auto"
          >
            Retry
          </button>
        </div>
      ) : diff ? (
        <>
          {/* Baseline Indicator Banner */}
          {isBaseline && (
            <div
              role="status"
              className="flex items-center gap-3 rounded-xl border border-blue-900/40 bg-blue-950/30 p-4 text-xs text-blue-300"
            >
              <svg
                className="h-5 w-5 shrink-0 text-blue-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <span className="font-semibold">Baseline Audit Established: </span>
                <span>
                  This is the first completed audit for this landing page. Future audits will automatically track score deltas, regressions, and resolved findings against this baseline.
                </span>
              </div>
            </div>
          )}

          {/* Meaningful Regression Callout */}
          {diff.summary.hasMeaningfulRegression && (
            <div
              role="alert"
              className="flex items-center gap-3 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-200"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-900 font-bold text-red-100">
                !
              </span>
              <div>
                <span className="font-semibold uppercase tracking-wider text-red-400">
                  Meaningful UX Regression Detected:{" "}
                </span>
                <span>
                  {diff.summary.overallScoreDelta !== null && diff.summary.overallScoreDelta <= -10
                    ? `Overall score dropped by ${Math.abs(diff.summary.overallScoreDelta)} points. `
                    : ""}
                  {diff.summary.newHighSeverityFindingsCount > 0
                    ? `${diff.summary.newHighSeverityFindingsCount} new high-severity finding(s) detected. `
                    : ""}
                  Review regressed dimensions below.
                </span>
              </div>
            </div>
          )}

          {/* Score Change Hero Card */}
          <div className="rounded-2xl border border-neutral-800/80 bg-neutral-900/50 p-6">
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
                  Overall Score Trajectory
                </span>
                <div className="mt-2 flex items-baseline gap-4">
                  {diff.scoreChanges.overall.previousScore !== null ? (
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-semibold text-neutral-400">
                        {diff.scoreChanges.overall.previousScore}
                      </span>
                      <span className="text-neutral-500 text-lg">&rarr;</span>
                      <span className="text-4xl font-extrabold text-neutral-100">
                        {diff.scoreChanges.overall.currentScore}
                      </span>
                    </div>
                  ) : (
                    <span className="text-4xl font-extrabold text-neutral-100">
                      {diff.scoreChanges.overall.currentScore}{" "}
                      <span className="text-xs font-normal text-neutral-400">
                        (Baseline)
                      </span>
                    </span>
                  )}

                  {diff.scoreChanges.overall.delta !== null && (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        diff.scoreChanges.overall.delta > 0
                          ? "bg-emerald-950 text-emerald-400 border border-emerald-800/50"
                          : diff.scoreChanges.overall.delta < 0
                          ? "bg-red-950 text-red-400 border border-red-800/50"
                          : "bg-neutral-800 text-neutral-300"
                      }`}
                    >
                      {diff.scoreChanges.overall.delta > 0 ? "+" : ""}
                      {diff.scoreChanges.overall.delta} pts (
                      {diff.scoreChanges.overall.direction})
                    </span>
                  )}
                </div>
              </div>

              {/* Summary Badges Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3">
                  <span className="text-[10px] text-neutral-400 uppercase">
                    Regressions
                  </span>
                  <div className="mt-0.5 text-base font-bold text-red-400">
                    {diff.summary.totalRegressionsCount}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3">
                  <span className="text-[10px] text-neutral-400 uppercase">
                    Improvements
                  </span>
                  <div className="mt-0.5 text-base font-bold text-emerald-400">
                    {diff.summary.totalImprovementsCount}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3">
                  <span className="text-[10px] text-neutral-400 uppercase">
                    New Findings
                  </span>
                  <div className="mt-0.5 text-base font-bold text-neutral-200">
                    {diff.summary.newFindingsCount}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/60 p-3">
                  <span className="text-[10px] text-neutral-400 uppercase">
                    Resolved
                  </span>
                  <div className="mt-0.5 text-base font-bold text-emerald-400">
                    {diff.summary.resolvedFindingsCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Analysis Timestamp Metadata */}
            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-neutral-800/60 pt-3 text-[11px] text-neutral-400">
              {diff.metadata.previousAnalyzedAt && (
                <span>
                  Previous:{" "}
                  <strong className="text-neutral-300">
                    {new Date(diff.metadata.previousAnalyzedAt).toLocaleString()}
                  </strong>
                </span>
              )}
              <span>
                Current:{" "}
                <strong className="text-neutral-300">
                  {new Date(diff.metadata.currentAnalyzedAt).toLocaleString()}
                </strong>
              </span>
              <span className="ml-auto font-mono text-[10px] text-neutral-500">
                Diff Engine v{diff.summary.schemaVersion}
              </span>
            </div>
          </div>

          {/* 7 Category Trajectory Cards Grid */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              UX Dimension Breakdown (7 Categories)
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {diff.scoreChanges.categories.map((cat) => (
                <div
                  key={cat.category}
                  className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                    cat.isMeaningfulRegression
                      ? "border-red-800/60 bg-red-950/20"
                      : "border-neutral-800/80 bg-neutral-900/40"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-neutral-200">
                        {CATEGORY_NAMES[cat.category] || cat.category}
                      </span>
                      {cat.isMeaningfulRegression && (
                        <span className="rounded bg-red-950 px-1.5 py-0.5 text-[9px] font-bold text-red-400 border border-red-800/40 uppercase">
                          Drop
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-baseline gap-2">
                      {cat.previousScore !== null ? (
                        <>
                          <span className="text-xs text-neutral-400">
                            {cat.previousScore}
                          </span>
                          <span className="text-neutral-600 text-xs">&rarr;</span>
                          <span className="text-lg font-bold text-neutral-100">
                            {cat.currentScore}
                          </span>
                        </>
                      ) : (
                        <span className="text-lg font-bold text-neutral-100">
                          {cat.currentScore}
                        </span>
                      )}

                      {cat.delta !== null && (
                        <span
                          className={`ml-auto text-[11px] font-bold ${
                            cat.delta > 0
                              ? "text-emerald-400"
                              : cat.delta < 0
                              ? "text-red-400"
                              : "text-neutral-400"
                          }`}
                        >
                          {cat.delta > 0 ? `+${cat.delta}` : cat.delta}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-neutral-800/50 pt-2 text-[10px] text-neutral-400">
                    <span>Severity: {cat.currentSeverity}</span>
                    <span className="capitalize">{cat.currentConfidence}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tabbed Findings & Signals Diff View */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 pb-3 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("regressions")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "regressions"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Regressions ({diff.regressions.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("new")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "new"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                New Findings ({diff.newFindings.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("resolved")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "resolved"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Resolved ({diff.resolvedFindings.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("changed")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "changed"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Changed ({diff.changedFindings.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("signals")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "signals"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Signals ({diff.signalChanges.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("improvements")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "improvements"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Improvements ({diff.improvements.length})
              </button>
              <button
                type="button"
                data-testid="tab-visual-changes"
                onClick={() => setActiveTab("visual")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition ${
                  activeTab === "visual"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Visual Changes
                {data?.visualDiffSummary?.hasVisualDiff && (
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold ${
                      data.visualDiffSummary?.isMeaningfulChange
                        ? "border border-amber-500/30 bg-amber-950/60 text-amber-300"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {Math.round(data.visualDiffSummary?.maxChangeScore ?? 0)}%
                  </span>
                )}
              </button>
            </div>

            {/* Tab Contents */}
            <div className="space-y-3">
              {activeTab === "regressions" && (
                diff.regressions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-xs text-neutral-400">
                    No regressions detected in this comparison.
                  </div>
                ) : (
                  diff.regressions.map((reg, idx) => (
                    <div
                      key={idx}
                      className="flex flex-col gap-3 rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-xs sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-red-900/60 px-1.5 py-0.5 text-[10px] font-bold text-red-300 uppercase">
                            {reg.type.replace(/_/g, " ")}
                          </span>
                          {reg.category && (
                            <span className="text-neutral-400">
                              in {CATEGORY_NAMES[reg.category] || reg.category}
                            </span>
                          )}
                          <span className="text-[10px] text-neutral-500 capitalize">
                            ({reg.basis})
                          </span>
                        </div>
                        <p className="font-medium text-neutral-200">
                          {reg.description}
                        </p>
                      </div>
                    </div>
                  ))
                )
              )}

              {activeTab === "new" && (
                diff.newFindings.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-xs text-neutral-400">
                    No new findings detected in this audit.
                  </div>
                ) : (
                  diff.newFindings.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              item.currentSeverity === "high"
                                ? "bg-red-950 text-red-400 border border-red-800/50"
                                : item.currentSeverity === "medium"
                                ? "bg-amber-950 text-amber-400 border border-amber-800/50"
                                : "bg-neutral-800 text-neutral-400"
                            }`}
                          >
                            {item.currentSeverity}
                          </span>
                          <span className="font-semibold text-neutral-200">
                            {item.currentTitle}
                          </span>
                          <span className="text-neutral-400 text-[11px]">
                            &bull; {CATEGORY_NAMES[item.category] || item.category}
                          </span>
                        </div>
                        {item.currentEvidence && (
                          <p className="text-neutral-400 text-[11px]">
                            {item.currentEvidence}
                          </p>
                        )}
                      </div>

                      {!isViewer && (
                        <button
                          type="button"
                          onClick={() => handleTrackFindingDiff(item)}
                          className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        >
                          + Track Work Item
                        </button>
                      )}
                    </div>
                  ))
                )
              )}

              {activeTab === "resolved" && (
                diff.resolvedFindings.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-xs text-neutral-400">
                    No resolved findings recorded yet.
                  </div>
                ) : (
                  diff.resolvedFindings.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4 text-xs space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-800/40 uppercase">
                          Resolved
                        </span>
                        <span className="font-medium text-neutral-200 line-through opacity-80">
                          {item.previousTitle}
                        </span>
                        <span className="text-neutral-400 text-[11px]">
                          &bull; {CATEGORY_NAMES[item.category] || item.category}
                        </span>
                      </div>
                      {item.previousEvidence && (
                        <p className="text-neutral-400 text-[11px]">
                          Previous evidence: {item.previousEvidence}
                        </p>
                      )}
                    </div>
                  ))
                )
              )}

              {activeTab === "changed" && (
                diff.changedFindings.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-xs text-neutral-400">
                    No findings had material changes.
                  </div>
                ) : (
                  diff.changedFindings.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-200">
                            {item.currentTitle || item.previousTitle}
                          </span>
                          <span className="text-neutral-400 text-[11px]">
                            &bull; {CATEGORY_NAMES[item.category] || item.category}
                          </span>
                        </div>
                        {item.severityChange !== "unchanged" && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              item.severityChange === "increased"
                                ? "bg-red-950 text-red-400"
                                : "bg-emerald-950 text-emerald-400"
                            }`}
                          >
                            Severity: {item.previousSeverity} &rarr; {item.currentSeverity} ({item.severityChange})
                          </span>
                        )}
                      </div>
                      {item.currentEvidence && (
                        <p className="text-neutral-400 text-[11px]">
                          Evidence: {item.currentEvidence}
                        </p>
                      )}
                    </div>
                  ))
                )
              )}

              {activeTab === "signals" && (
                diff.signalChanges.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-xs text-neutral-400">
                    No deterministic signal changes recorded.
                  </div>
                ) : (
                  diff.signalChanges.map((sig: SignalChangeItem) => (
                    <div
                      key={sig.signalId}
                      className={`flex flex-col gap-2 rounded-xl border p-4 text-xs sm:flex-row sm:items-center sm:justify-between ${
                        sig.isRegression
                          ? "border-red-900/40 bg-red-950/20"
                          : sig.isImprovement
                          ? "border-emerald-900/40 bg-emerald-950/20"
                          : "border-neutral-800 bg-neutral-900/40"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-neutral-200">
                            {sig.signalId}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              sig.changeType === "regressed"
                                ? "bg-red-950 text-red-400"
                                : sig.changeType === "improved"
                                ? "bg-emerald-950 text-emerald-400"
                                : "bg-neutral-800 text-neutral-400"
                            }`}
                          >
                            {sig.previousStatus ?? "none"} &rarr; {sig.currentStatus} ({sig.changeType})
                          </span>
                        </div>
                        <p className="mt-1 text-neutral-400 text-[11px]">
                          {sig.currentEvidence}
                        </p>
                      </div>
                    </div>
                  ))
                )
              )}

              {activeTab === "improvements" && (
                diff.improvements.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center text-xs text-neutral-400">
                    No improvements recorded in this comparison.
                  </div>
                ) : (
                  diff.improvements.map((imp, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-4 text-xs space-y-1"
                    >
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-800/40 uppercase">
                          {imp.type.replace(/_/g, " ")}
                        </span>
                        {imp.category && (
                          <span className="text-neutral-400">
                            in {CATEGORY_NAMES[imp.category] || imp.category}
                          </span>
                        )}
                      </div>
                      <p className="font-medium text-neutral-200">
                        {imp.description}
                      </p>
                    </div>
                  ))
                )
              )}

              {activeTab === "visual" && (
                <div data-testid="visual-changes-tab-content">
                  <VisualRegressionCard
                    projectId={projectId}
                    pageId={page.id}
                    auditRunId={currentRunId}
                    compareRunId={selectedCompareRunId ?? undefined}
                  />
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* Create Work Item Modal */}
      {prefillData && (
        <CreateWorkItemModal
          projectId={projectId}
          pages={pages}
          members={members}
          prefillSource={prefillData}
          onClose={() => setPrefillData(null)}
          onCreated={(newItem) => {
            onWorkItemCreated?.(newItem);
          }}
        />
      )}
    </div>
  );
}
