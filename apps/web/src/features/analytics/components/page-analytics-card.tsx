import { useState } from "react";
import type { PageAnalyticsSnapshot, Role } from "@pagepilot/contracts";
import {
  calculateBusinessExposureTier,
  isAnalyticsStale,
} from "@pagepilot/contracts";

export interface PageAnalyticsCardProps {
  analytics: PageAnalyticsSnapshot | null;
  isLoading: boolean;
  error?: string | null;
  role?: Role;
  onOpenImportModal: () => void;
  onDeleteAnalytics?: (snapshotId: string) => Promise<void>;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

export function PageAnalyticsCard({
  analytics,
  isLoading,
  error,
  role = "owner",
  onOpenImportModal,
  onDeleteAnalytics,
}: PageAnalyticsCardProps) {
  const isViewer = role === "viewer";
  const canManage = !isViewer;
  const canDelete = role === "owner" || role === "admin";
  const [isDeleting, setIsDeleting] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
        <div className="flex items-center justify-between">
          <div className="h-4 w-40 animate-pulse rounded bg-neutral-800" />
          <div className="h-5 w-24 animate-pulse rounded bg-neutral-800" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-800/40" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-800/40 bg-rose-950/20 p-5 text-xs text-rose-300">
        <p className="font-semibold text-rose-200">Failed to load analytics context</p>
        <p className="mt-1 text-rose-300/80">{error}</p>
      </div>
    );
  }

  // 1. EMPTY STATE
  if (!analytics) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-tight text-neutral-200">
                Page Business & Analytics Context
              </h3>
              <span className="inline-flex items-center rounded border border-sky-500/30 bg-sky-950/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-sky-400 uppercase">
                IMPORTED DATA
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs text-neutral-400">
              No business metrics imported yet. Import page traffic and conversion data to
              calculate business impact exposure and prioritize UX recommendations for this landing page.
            </p>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={onOpenImportModal}
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-3.5 py-2 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              + Import Analytics
            </button>
          )}
        </div>
      </div>
    );
  }

  // 2. ACTIVE ANALYTICS CONTEXT
  const isStale = isAnalyticsStale(analytics.periodEnd);
  const exposureTier = calculateBusinessExposureTier(analytics);

  const handleDelete = async () => {
    if (!onDeleteAnalytics || !analytics.id) return;
    if (!window.confirm("Are you sure you want to remove this analytics context?")) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDeleteAnalytics(analytics.id);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-5">
      {/* Header & Badges */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800/80 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-neutral-100">
            Page Business & Analytics Context
          </h3>
          <span className="inline-flex items-center rounded border border-sky-500/40 bg-sky-950/60 px-2 py-0.5 text-[10px] font-bold tracking-wider text-sky-300 uppercase">
            IMPORTED DATA
          </span>
          {exposureTier === "high_exposure" && (
            <span className="inline-flex items-center rounded border border-emerald-700/50 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
              High Business Exposure
            </span>
          )}
          {exposureTier === "medium_exposure" && (
            <span className="inline-flex items-center rounded border border-blue-700/50 bg-blue-950/60 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
              Medium Business Exposure
            </span>
          )}
          {exposureTier === "low_exposure" && (
            <span className="inline-flex items-center rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 text-[10px] font-semibold text-neutral-400">
              Low Business Exposure
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={onOpenImportModal}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              Update Context
            </button>
          )}
          {canDelete && onDeleteAnalytics && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-800 px-2.5 py-1.5 text-xs text-neutral-400 transition hover:border-rose-900/60 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
              title="Delete this analytics snapshot"
            >
              {isDeleting ? "..." : "Delete"}
            </button>
          )}
        </div>
      </div>

      {/* Stale Warning Banner */}
      {isStale && (
        <div className="mt-3 rounded-lg border border-amber-800/40 bg-amber-950/30 p-2.5 text-xs text-amber-200">
          <span className="font-semibold text-amber-300">Stale Context Warning:</span>{" "}
          This data reflects a reporting period ending over 60 days ago (
          {formatDate(analytics.periodEnd)}). Consider importing fresh metrics for accurate
          business impact prioritization.
        </div>
      )}

      {/* Metrics Grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Sessions & Visitors */}
        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/50 p-3">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            Sessions / Traffic
          </span>
          <p className="mt-1 text-lg font-bold text-neutral-100">
            {analytics.sessions != null ? analytics.sessions.toLocaleString() : "—"}
          </p>
          {analytics.uniqueVisitors != null && (
            <p className="mt-0.5 text-[11px] text-neutral-400">
              {analytics.uniqueVisitors.toLocaleString()} unique visitors
            </p>
          )}
        </div>

        {/* Conversion Rate */}
        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/50 p-3">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            Conversion Rate
          </span>
          <p className="mt-1 text-lg font-bold text-emerald-400">
            {analytics.conversionRate != null
              ? `${analytics.conversionRate.toFixed(2)}%`
              : "—"}
          </p>
          {analytics.conversions != null && (
            <p className="mt-0.5 text-[11px] text-neutral-400">
              {analytics.conversions.toLocaleString()} conversions
            </p>
          )}
        </div>

        {/* Bounce Rate */}
        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/50 p-3">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            Bounce Rate
          </span>
          <p className="mt-1 text-lg font-bold text-neutral-100">
            {analytics.bounceRate != null ? `${analytics.bounceRate.toFixed(1)}%` : "—"}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {analytics.bounceRate != null ? "Exit percentage" : "Not specified"}
          </p>
        </div>

        {/* Avg Duration */}
        <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/50 p-3">
          <span className="text-[11px] font-medium text-neutral-400 uppercase tracking-wider">
            Avg. Duration
          </span>
          <p className="mt-1 text-lg font-bold text-neutral-100">
            {formatDuration(analytics.avgDurationSeconds)}
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            {analytics.avgDurationSeconds != null ? "Time on page" : "Not specified"}
          </p>
        </div>
      </div>

      {/* Provenance & Metadata Footer */}
      <div className="mt-4 flex flex-col gap-1 border-t border-neutral-800/60 pt-3 text-[11px] text-neutral-400 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span>Reporting Period: </span>
          <span className="font-medium text-neutral-300">
            {formatDate(analytics.periodStart)} – {formatDate(analytics.periodEnd)}
          </span>
          {analytics.provenance?.importedByUserName && (
            <span> • Imported by {analytics.provenance.importedByUserName}</span>
          )}
          <span> • Source: {analytics.sourceProviderName}</span>
        </div>

        {analytics.provenance?.notes && (
          <div className="italic text-neutral-400">
            "{analytics.provenance.notes}"
          </div>
        )}
      </div>
    </div>
  );
}
