import { useState, useEffect, useCallback } from "react";
import type {
  AuditHistoryItem,
  MonitoredPage,
  PageAnalyticsSnapshot,
  Project,
  Role,
} from "@pagepilot/contracts";
import { ScoreTrendChart } from "./score-trend-chart.js";
import { PageAnalyticsCard } from "../../analytics/components/page-analytics-card.js";
import { ImportAnalyticsModal } from "../../analytics/components/import-analytics-modal.js";
import { getPageAnalytics, deletePageAnalytics } from "../../analytics/api.js";

export interface PageDetailProps {
  project: Project;
  page: MonitoredPage;
  role: Role;
  history: AuditHistoryItem[];
  historyTotal: number;
  isLoadingHistory: boolean;
  historyPage: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onBackToProject: () => void;
  onRunAudit: (idempotencyKey: string) => Promise<void>;
  onViewLatestReport: () => void;
  onViewHistoricalReport: (runId: string) => void;
  onCompareReport?: (runId: string, compareRunId?: string) => void;
}

export function PageDetail({
  project,
  page,
  role,
  history,
  historyTotal,
  isLoadingHistory,
  historyPage,
  pageSize,
  onPageChange,
  onBackToProject,
  onRunAudit,
  onViewLatestReport,
  onViewHistoricalReport,
  onCompareReport,
}: PageDetailProps) {
  const [isAuditing, setIsAuditing] = useState(false);
  const [auditStep, setAuditStep] = useState<"starting" | "analyzing" | null>(null);
  const [currentIdempotencyKey, setCurrentIdempotencyKey] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);

  // Page Analytics state
  const [analytics, setAnalytics] = useState<PageAnalyticsSnapshot | null>(null);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const fetchAnalytics = useCallback(async () => {
    setIsLoadingAnalytics(true);
    setAnalyticsError(null);
    try {
      const res = await getPageAnalytics(project.id, page.id);
      setAnalytics(res.current);
    } catch (err: any) {
      setAnalyticsError(err?.message || "Failed to load page analytics.");
    } finally {
      setIsLoadingAnalytics(false);
    }
  }, [project.id, page.id]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const handleDeleteAnalytics = async (snapshotId: string) => {
    await deletePageAnalytics(project.id, page.id, snapshotId);
    await fetchAnalytics();
  };

  const canRunAudit = role !== "viewer";

  // Find latest run and latest successful report info from history
  const latestRun = history.length > 0 ? history[0] : null;
  const hasSuccessfulReport = Boolean(page.latestSuccessfulAuditRunId);

  const handleTriggerAudit = async () => {
    if (isAuditing || !canRunAudit) return;
    setAuditError(null);
    setIsAuditing(true);
    setAuditStep("starting");

    // Generate or reuse idempotency key for this user action
    const key = currentIdempotencyKey || `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setCurrentIdempotencyKey(key);

    try {
      setAuditStep("analyzing");
      await onRunAudit(key);
      // On success, reset idempotency key so next click generates a fresh one
      setCurrentIdempotencyKey(null);
    } catch (err: any) {
      setAuditError(err?.message || "Audit execution failed.");
    } finally {
      setIsAuditing(false);
      setAuditStep(null);
    }
  };

  const totalPages = Math.ceil(historyTotal / pageSize) || 1;

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onBackToProject}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-400 transition hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            &larr; Back to {project.name}
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-neutral-100 sm:text-xl">
              {page.canonicalUrl}
            </h1>
            <span
              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ${
                page.status === "active"
                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                  : "bg-neutral-800 text-neutral-400 border border-neutral-700/40"
              }`}
            >
              {page.status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-400">
            Cadence: <span className="capitalize">{page.cadence}</span>
            {page.tags.length > 0 && ` • Tags: ${page.tags.map((t) => `#${t}`).join(" ")}`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {hasSuccessfulReport && onCompareReport && page.latestSuccessfulAuditRunId && (
            <button
              type="button"
              disabled={isAuditing}
              onClick={() => onCompareReport(page.latestSuccessfulAuditRunId!)}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              Compare Audits
            </button>
          )}

          {hasSuccessfulReport && (
            <button
              type="button"
              disabled={isAuditing}
              onClick={onViewLatestReport}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              View Latest Audit
            </button>
          )}

          {canRunAudit && (
            <button
              type="button"
              disabled={isAuditing}
              onClick={handleTriggerAudit}
              className="inline-flex items-center justify-center rounded-lg bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              {isAuditing
                ? auditStep === "starting"
                  ? "Starting audit..."
                  : "Analyzing page..."
                : "Run Audit"}
            </button>
          )}
        </div>
      </div>

      {/* Audit In-Progress Banner */}
      {isAuditing && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/80 p-4 text-xs text-neutral-300"
        >
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-400 border-t-white" />
          <span>
            {auditStep === "starting"
              ? "Preparing audit run and checking page destination..."
              : "Running safe fetch, deterministic checks, and structured Gemini audit..."}
          </span>
        </div>
      )}

      {/* Audit Error Notification */}
      {auditError && (
        <div
          role="alert"
          className="rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-xs text-red-300"
        >
          <span className="font-semibold">Audit error: </span>
          {auditError}
        </div>
      )}

      {/* Failed Latest Run Preservation Alert */}
      {latestRun && latestRun.status === "failed" && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-amber-900/40 bg-amber-950/20 p-4 text-xs text-amber-300 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <span className="font-semibold">Latest audit attempt failed</span>
            <p className="mt-0.5 text-[11px] text-amber-400/80">
              {latestRun.errorMessage || "The target site could not be analyzed."}
              {hasSuccessfulReport &&
                " The previous successful audit report remains preserved as the source of truth."}
            </p>
          </div>
          {hasSuccessfulReport && (
            <button
              type="button"
              onClick={onViewLatestReport}
              className="self-start rounded border border-amber-800 bg-amber-950/60 px-3 py-1 text-xs font-medium text-amber-200 transition hover:bg-amber-900/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 sm:self-auto"
            >
              View Last Successful Audit
            </button>
          )}
        </div>
      )}

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Latest Overall Score
          </span>
          <div className="mt-1.5 flex items-baseline gap-2">
            {latestRun && latestRun.overallScore !== null ? (
              <>
                <span className="text-2xl font-bold text-neutral-100">
                  {latestRun.overallScore}
                </span>
                <span className="text-[10px] text-neutral-400 uppercase">
                  / 100 ({latestRun.scoreConfidence ?? "blended"})
                </span>
              </>
            ) : hasSuccessfulReport ? (
              <span className="text-sm font-semibold text-neutral-300">
                Preserved
              </span>
            ) : (
              <span className="text-sm text-neutral-400">No score yet</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Latest Audit Status
          </span>
          <div className="mt-1.5">
            {latestRun ? (
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold capitalize ${
                  latestRun.status === "completed"
                    ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                    : latestRun.status === "failed"
                    ? "bg-red-950/60 text-red-400 border border-red-800/40"
                    : "bg-amber-950/60 text-amber-400 border border-amber-800/40"
                }`}
              >
                {latestRun.status}
              </span>
            ) : (
              <span className="text-sm text-neutral-400">Never audited</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Last Audit Run
          </span>
          <div className="mt-1.5 text-xs text-neutral-200">
            {latestRun && latestRun.createdAt
              ? new Date(latestRun.createdAt).toLocaleString()
              : "No audit runs recorded"}
          </div>
        </div>
      </div>

      {/* Page Business & Analytics Context */}
      <PageAnalyticsCard
        analytics={analytics}
        isLoading={isLoadingAnalytics}
        error={analyticsError}
        role={role}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onDeleteAnalytics={handleDeleteAnalytics}
      />

      {/* UX Score Trend & Category Trajectories Dashboard */}
      {history.length > 0 && (
        <ScoreTrendChart
          history={history}
          onSelectRun={onViewHistoricalReport}
        />
      )}

      {/* Audit History Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-neutral-300">
            Audit History ({historyTotal})
          </h2>
        </div>

        {isLoadingHistory ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/50"
              />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-12 text-center">
            <h3 className="text-xs font-semibold text-neutral-200">
              No audit runs recorded
            </h3>
            <p className="mt-1 max-w-sm text-xs text-neutral-400">
              Click &quot;Run Audit&quot; above to trigger your first analysis for this landing page.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-800/80 bg-neutral-900/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-neutral-800/80 bg-neutral-950/60 text-neutral-400">
                    <th className="px-4 py-3 font-medium">Date & Time</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Invocation</th>
                    <th className="px-4 py-3 font-medium text-right">Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60">
                  {history.map((run) => (
                    <tr
                      key={run.id}
                      className="transition hover:bg-neutral-900/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-neutral-200">
                        {run.createdAt ? new Date(run.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                            run.status === "completed"
                              ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                              : run.status === "failed"
                              ? "bg-red-950/60 text-red-400 border border-red-800/40"
                              : "bg-amber-950/60 text-amber-400 border border-amber-800/40"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {run.overallScore !== null ? (
                          <span className="font-semibold text-neutral-100">
                            {run.overallScore}{" "}
                            <span className="text-[10px] font-normal text-neutral-400">
                              ({run.scoreConfidence})
                            </span>
                          </span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 capitalize text-neutral-400">
                        {run.invocationType}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {run.status === "completed" && (
                          <div className="flex items-center justify-end gap-1.5">
                            {onCompareReport && (
                              <button
                                type="button"
                                onClick={() => onCompareReport(run.id)}
                                className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
                              >
                                Compare
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onViewHistoricalReport(run.id)}
                              className="rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
                            >
                              View Report
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-neutral-800/80 px-4 py-3 text-xs text-neutral-400">
                <span>
                  Page {historyPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={historyPage <= 1}
                    onClick={() => onPageChange(historyPage - 1)}
                    className="rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={historyPage >= totalPages}
                    onClick={() => onPageChange(historyPage + 1)}
                    className="rounded border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Import Analytics Modal */}
      <ImportAnalyticsModal
        projectId={project.id}
        pageId={page.id}
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onSuccess={(newSnap) => {
          setAnalytics(newSnap);
          setIsImportModalOpen(false);
        }}
        initialData={analytics}
      />
    </div>
  );
}
