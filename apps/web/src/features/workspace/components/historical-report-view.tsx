import { useState } from "react";
import type {
  Finding,
  MonitoredPage,
  OrganizationMember,
  PersistedAuditReportResponse,
  Recommendation,
  Role,
  WorkItem,
} from "@pagepilot/contracts";
import { ReportView } from "../../analysis/components/report-view";
import { ScreenshotPreviewCard } from "../../audits/components/screenshot-preview-card";
import { VisualReviewCard } from "../../audits/components/visual-review-card";
import { VisualRegressionCard } from "../../audits/components/visual-regression-card";
import {
  CreateWorkItemModal,
  type PrefillSourceData,
} from "../../work-items/components/create-work-item-modal";
import { ShareReportModal } from "../../share/components/share-report-modal";
import { exportAuditReportCsv } from "../../audits/api.js";
import { triggerBlobDownload } from "../../work-items/api.js";


export interface HistoricalReportViewProps {
  persistedReport: PersistedAuditReportResponse;
  isLatest?: boolean;
  role?: Role;
  members?: OrganizationMember[];
  pages?: MonitoredPage[];
  onBack: () => void;
  onCompare?: (runId: string) => void;
  onWorkItemCreated?: (item: WorkItem) => void;
}

export function HistoricalReportView({
  persistedReport,
  isLatest = false,
  role = "owner",
  members = [],
  pages = [],
  onBack,
  onCompare,
  onWorkItemCreated,
}: HistoricalReportViewProps) {
  const isViewer = role === "viewer";
  const { auditRun, report, findings = [], recommendations = [] } = persistedReport;
  const analyzedAtDate = auditRun.completedAt
    ? new Date(auditRun.completedAt).toLocaleString()
    : "Completed";

  const [prefillData, setPrefillData] = useState<PrefillSourceData | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleTrackFinding = (f: Finding) => {
    if (isViewer) return;
    // Find matching FindingEntity by title or description
    const entity = findings.find(
      (fe) =>
        fe.title.trim().toLowerCase() === f.title.trim().toLowerCase() ||
        fe.title.includes(f.title) ||
        f.title.includes(fe.title),
    );

    if (entity) {
      setPrefillData({
        sourceType: "finding",
        findingId: entity.id,
        pageId: auditRun.monitoredPageId,
        title: entity.title,
        description: entity.evidence || f.evidence,
        category: entity.category || f.category,
        severity: entity.severity || f.severity,
      });
    }
  };

  const handleTrackRecommendation = (r: Recommendation) => {
    if (isViewer) return;
    // Find matching RecommendationEntity by title
    const entity = recommendations.find(
      (re) =>
        re.title.trim().toLowerCase() === r.title.trim().toLowerCase() ||
        re.title.includes(r.title) ||
        r.title.includes(re.title),
    );

    if (entity) {
      setPrefillData({
        sourceType: "recommendation",
        recommendationId: entity.id,
        pageId: auditRun.monitoredPageId,
        title: entity.title,
        description: entity.detail || r.detail,
        category: entity.category || r.category,
        severity: "medium",
      });
    }
  };

  const handleExportCsv = async () => {
    setIsExporting(true);
    setExportError(null);
    try {
      const blob = await exportAuditReportCsv(
        auditRun.projectId,
        auditRun.monitoredPageId,
        auditRun.id,
      );
      const domainSlug = (auditRun.targetUrl || "page")
        .replace(/^https?:\/\//, "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 40);
      const dateStr = new Date(auditRun.completedAt || auditRun.createdAt)
        .toISOString()
        .split("T")[0];
      triggerBlobDownload(blob, `pagepilot-audit-${domainSlug}-${dateStr}.csv`);
    } catch (err: any) {
      setExportError(err?.message || "Failed to export audit report CSV.");
    } finally {
      setIsExporting(false);
    }
  };

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
          {onCompare && (
            <button
              type="button"
              onClick={() => onCompare(auditRun.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-700 hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              Compare
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExporting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-700 hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            title="Export audit findings and recommendations to CSV"
          >
            {isExporting ? (
              <>
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-neutral-400 border-t-white" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                <span>Export CSV</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-neutral-700 hover:border-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
              />
            </svg>
            Share Report
          </button>
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono">
            Model: {auditRun.modelVersion}
          </span>
          <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono">
            Score Engine: {report.scoringVersion}
          </span>
        </div>
      </div>

      {/* Export Error Alert */}
      {exportError && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-xs text-red-300"
        >
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError(null)}
            className="text-red-400 hover:text-red-200 ml-2 font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Render the verified ReportView with optional work-item tracking */}
      <div className="fade-rise">
        <ReportView
          report={report.reportPayload}
          onCreateFindingWorkItem={!isViewer ? handleTrackFinding : undefined}
          onCreateRecommendationWorkItem={
            !isViewer ? handleTrackRecommendation : undefined
          }
          screenshotsSlot={
            <div className="space-y-6">
              <ScreenshotPreviewCard
                projectId={auditRun.projectId}
                pageId={auditRun.monitoredPageId}
                auditRunId={auditRun.id}
              />
              <VisualReviewCard
                projectId={auditRun.projectId}
                pageId={auditRun.monitoredPageId}
                auditRunId={auditRun.id}
              />
              <VisualRegressionCard
                projectId={auditRun.projectId}
                pageId={auditRun.monitoredPageId}
                auditRunId={auditRun.id}
              />
            </div>
          }
        />
      </div>

      {/* Share Report Modal */}
      {showShareModal && (
        <ShareReportModal
          projectId={auditRun.projectId}
          pageId={auditRun.monitoredPageId}
          auditRunId={auditRun.id}
          role={role}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Create Work Item Modal */}
      {prefillData && (
        <CreateWorkItemModal
          projectId={auditRun.projectId}
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
