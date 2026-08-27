import type { PersistedAuditReportResponse } from "@pagepilot/contracts";
import { ReportView } from "../../analysis/components/report-view";

export interface HistoricalReportViewProps {
  persistedReport: PersistedAuditReportResponse;
  isLatest?: boolean;
  onBack: () => void;
}

export function HistoricalReportView({
  persistedReport,
  isLatest = false,
  onBack,
}: HistoricalReportViewProps) {
  const { auditRun, report } = persistedReport;
  const analyzedAtDate = auditRun.completedAt
    ? new Date(auditRun.completedAt).toLocaleString()
    : "Completed";

  return (
    <div className="space-y-6">
      {/* Top Banner & Navigation */}
      <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            &larr; Back to Page
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-100">
                {isLatest ? "Latest Audit Report" : "Historical Audit Snapshot"}
              </span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
                {analyzedAtDate}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-neutral-400 max-w-md">
              {auditRun.targetUrl}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-400">
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono">
            Model: {auditRun.modelVersion}
          </span>
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono">
            Score Engine: {report.scoringVersion}
          </span>
        </div>
      </div>

      {/* Render the verified ReportView */}
      <div className="fade-rise">
        <ReportView report={report.reportPayload} />
      </div>
    </div>
  );
}
