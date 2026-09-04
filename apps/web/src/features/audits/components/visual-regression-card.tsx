import { useEffect, useState } from "react";
import type {
  ScreenshotDeviceType,
  VisualChangeSeverity,
  VisualDiffResponse,
  VisualDiffResult,
} from "@pagepilot/contracts";
import {
  HERO_SHIFT_THRESHOLD_PERCENT,
  VISUAL_DIFF_ALGORITHM,
  VISUAL_DIFF_METHOD_LABEL,
} from "@pagepilot/contracts";
import { fetchVisualDiff } from "../api.js";

export interface VisualRegressionCardProps {
  projectId?: string;
  pageId?: string;
  auditRunId?: string;
  compareRunId?: string;
  visualDiff?: VisualDiffResponse | null;
  isLoading?: boolean;
  error?: string | null;
  onSelectViewport?: (viewport: ScreenshotDeviceType) => void;
}

const SEVERITY_BADGES: Record<
  VisualChangeSeverity,
  { label: string; classes: string }
> = {
  negligible: {
    label: "Negligible",
    classes: "border-slate-500/30 bg-slate-900/50 text-slate-300",
  },
  minor: {
    label: "Minor Change",
    classes: "border-blue-500/30 bg-blue-950/50 text-blue-300",
  },
  moderate: {
    label: "Moderate Change",
    classes: "border-amber-500/30 bg-amber-950/50 text-amber-300",
  },
  significant: {
    label: "Significant Regression",
    classes: "border-orange-500/30 bg-orange-950/50 text-orange-300",
  },
  major: {
    label: "Major Visual Regression",
    classes: "border-rose-500/30 bg-rose-950/50 text-rose-300",
  },
};

export function VisualRegressionCard({
  projectId,
  pageId,
  auditRunId,
  compareRunId,
  visualDiff: initialVisualDiff,
  isLoading: initialLoading,
  error: initialError,
  onSelectViewport,
}: VisualRegressionCardProps) {
  const [data, setData] = useState<VisualDiffResponse | null>(
    initialVisualDiff ?? null
  );
  const [isLoading, setIsLoading] = useState<boolean>(initialLoading ?? false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [selectedDevice, setSelectedDevice] =
    useState<ScreenshotDeviceType>("desktop");

  useEffect(() => {
    if (initialVisualDiff !== undefined) {
      setData(initialVisualDiff);
    }
  }, [initialVisualDiff]);

  useEffect(() => {
    if (initialLoading !== undefined) {
      setIsLoading(initialLoading);
    }
  }, [initialLoading]);

  useEffect(() => {
    if (initialError !== undefined) {
      setError(initialError);
    }
  }, [initialError]);

  useEffect(() => {
    if (initialVisualDiff !== undefined || !projectId || !pageId || !auditRunId) {
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchVisualDiff(projectId, pageId, auditRunId, { compareRunId })
      .then((res) => {
        if (!isMounted) return;
        setData(res);
        // Default to mobile if only mobile diff exists
        const hasDesktop = res.diffs.some((d) => d.deviceType === "desktop");
        if (!hasDesktop && res.diffs.some((d) => d.deviceType === "mobile")) {
          setSelectedDevice("mobile");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load visual regression comparison."
        );
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectId, pageId, auditRunId, compareRunId, initialVisualDiff]);

  const activeDiff: VisualDiffResult | undefined = (data?.diffs ?? []).find(
    (d) => d.deviceType === selectedDevice
  );

  const isBaseline = Boolean(
    data?.summary?.isBaseline ||
      (activeDiff && activeDiff.isBaseline) ||
      (!activeDiff?.baselineScreenshotId && !activeDiff?.baselineSignedUrl)
  );

  const hasHeroShift = Boolean(
    activeDiff && activeDiff.heroZoneChange >= HERO_SHIFT_THRESHOLD_PERCENT
  );

  const severityMeta = activeDiff
    ? SEVERITY_BADGES[activeDiff.changeSeverity] || SEVERITY_BADGES.negligible
    : SEVERITY_BADGES.negligible;

  return (
    <div
      data-testid="visual-regression-card"
      className="my-8 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 shadow-xl transition-all"
    >
      {/* Header with Title, Method & Device Toggles */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-semibold tracking-wide text-neutral-100">
            Visual Regression & Perceptual Diff
          </h3>
          <span
            data-testid="visual-diff-method-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-950/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-sky-300"
            title="Deterministic 32-block luminance & perceptual hash comparison"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
            {VISUAL_DIFF_METHOD_LABEL}
          </span>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
            {activeDiff?.diffAlgorithm ?? VISUAL_DIFF_ALGORITHM}
          </span>
        </div>

        {/* Device Viewport Toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950/60 p-0.5">
          <button
            type="button"
            data-testid="device-toggle-desktop"
            onClick={() => {
              setSelectedDevice("desktop");
              onSelectViewport?.("desktop");
            }}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              selectedDevice === "desktop"
                ? "bg-neutral-800 text-neutral-100 shadow-sm"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
            Desktop
          </button>
          <button
            type="button"
            data-testid="device-toggle-mobile"
            onClick={() => {
              setSelectedDevice("mobile");
              onSelectViewport?.("mobile");
            }}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
              selectedDevice === "mobile"
                ? "bg-neutral-800 text-neutral-100 shadow-sm"
                : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <rect width="14" height="20" x="5" y="2" rx="2" />
              <line x1="12" x2="12.01" y1="18" y2="18" />
            </svg>
            Mobile
          </button>
        </div>
      </div>

      <p className="mt-1 text-xs text-neutral-400">
        Compares pixel layout against the previous compatible audit baseline across
        32 visual zones. Isolates true content movements from rendering noise without
        altering static audit scores.
      </p>

      {/* Main Content Area */}
      <div className="mt-5">
        {isLoading ? (
          <div
            data-testid="visual-diff-loading"
            className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/50 p-8 text-center"
          >
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <p className="mt-3 text-xs text-neutral-400">
              Computing deterministic visual difference matrix...
            </p>
          </div>
        ) : error ? (
          <div
            data-testid="visual-diff-error"
            className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-red-900/40 bg-red-950/20 p-6 text-center"
          >
            <p className="text-xs font-medium text-red-300">
              Unable to load visual regression diff: {error}
            </p>
          </div>
        ) : isBaseline || !activeDiff ? (
          <div
            data-testid="visual-diff-baseline"
            className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-sky-500/30 bg-sky-950/10 p-6 text-center"
          >
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-900/50 text-sky-400">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h4 className="mt-2 text-xs font-semibold uppercase tracking-wider text-sky-300">
              Baseline Visual Snapshot
            </h4>
            <p className="mt-1 max-w-md text-xs text-neutral-300">
              This audit run acts as the baseline reference for future scans.
              No prior compatible screenshot was available to compare against.
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              Future audits of this page will calculate Hero shifts, content diffs,
              and height changes against this baseline.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Primary Score & Severity Banner */}
            <div
              data-testid="visual-diff-score-banner"
              className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-950/80 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                    Visual Change Score
                  </span>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span
                      data-testid="visual-change-score"
                      className="text-2xl font-black text-neutral-100"
                    >
                      {activeDiff.visualChangeScore.toFixed(1)}%
                    </span>
                    <span
                      data-testid="visual-severity-badge"
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${severityMeta.classes}`}
                    >
                      {severityMeta.label}
                    </span>
                  </div>
                </div>

                <div className="h-8 w-px bg-neutral-800" />

                <div className="flex flex-wrap items-center gap-2">
                  {activeDiff.isMeaningfulChange && (
                    <span
                      data-testid="meaningful-change-badge"
                      className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 text-[11px] font-medium text-amber-300"
                    >
                      Meaningful Change
                    </span>
                  )}
                  {hasHeroShift && (
                    <span
                      data-testid="hero-shift-badge"
                      className="inline-flex items-center gap-1 rounded-md border border-purple-500/30 bg-purple-950/40 px-2 py-0.5 text-[11px] font-medium text-purple-300"
                    >
                      Hero / Fold Shift
                    </span>
                  )}
                </div>
              </div>

              {/* Baseline ID link/info */}
              {activeDiff.baselineAuditRunId && (
                <div className="text-right text-[11px] text-neutral-400">
                  Compared against baseline:{" "}
                  <span className="font-mono text-neutral-300">
                    {activeDiff.baselineAuditRunId.slice(0, 8)}
                  </span>
                </div>
              )}
            </div>

            {/* Zone Breakdown Metrics (3-Zone Grid) */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Visual Zone Breakdown (4x8 Grid Matrix)
              </h4>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {/* Hero Zone */}
                <div
                  data-testid="hero-zone-card"
                  className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-300">
                      Hero Section
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      Rows 1–3 (Fold)
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span
                      data-testid="hero-zone-change"
                      className="text-lg font-bold text-neutral-100"
                    >
                      {activeDiff.heroZoneChange.toFixed(1)}%
                    </span>
                    {activeDiff.heroZoneChange >= HERO_SHIFT_THRESHOLD_PERCENT && (
                      <span className="text-[10px] font-semibold text-purple-400">
                        Fold Shift
                      </span>
                    )}
                  </div>
                </div>

                {/* Body Zone */}
                <div
                  data-testid="body-zone-card"
                  className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-300">
                      Body Content
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      Rows 4–6
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span
                      data-testid="body-zone-change"
                      className="text-lg font-bold text-neutral-100"
                    >
                      {activeDiff.bodyZoneChange.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Footer Zone */}
                <div
                  data-testid="footer-zone-card"
                  className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-neutral-300">
                      Footer Area
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      Rows 7–8
                    </span>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between">
                    <span
                      data-testid="footer-zone-change"
                      className="text-lg font-bold text-neutral-100"
                    >
                      {activeDiff.footerZoneChange.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Secondary Block & Height Stats */}
              <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-neutral-400">
                <span data-testid="changed-blocks-metric">
                  Changed Blocks:{" "}
                  <strong className="text-neutral-200">
                    {activeDiff.changedBlocksCount}
                  </strong>{" "}
                  of {activeDiff.totalBlocksCount}
                </span>
                <span>•</span>
                <span data-testid="height-delta-metric">
                  Height Delta:{" "}
                  <strong className="text-neutral-200">
                    {activeDiff.heightDeltaPx > 0
                      ? `+${activeDiff.heightDeltaPx}px`
                      : `${activeDiff.heightDeltaPx}px`}
                  </strong>
                </span>
              </div>
            </div>

            {/* Explainable Change Reasons */}
            {activeDiff.changeReasons && activeDiff.changeReasons.length > 0 && (
              <div
                data-testid="visual-diff-reasons"
                className="rounded-lg border border-neutral-800 bg-neutral-950/70 p-4"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-sky-400">
                  Detected Observations
                </div>
                <ul className="mt-2 space-y-1.5 text-xs text-neutral-300">
                  {activeDiff.changeReasons.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Side-by-Side Visual Comparison (Before / After) */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Visual Comparison (Before vs After)
              </h4>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Before (Baseline) */}
                <div
                  data-testid="diff-baseline-view"
                  className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
                >
                  <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-3 py-2 text-xs">
                    <span className="font-medium text-neutral-300">
                      Before (Baseline)
                    </span>
                    <span className="font-mono text-[11px] text-neutral-500">
                      {activeDiff.baselineAuditRunId?.slice(0, 8) ?? "baseline"}
                    </span>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto p-2">
                    {activeDiff.baselineSignedUrl ? (
                      <img
                        src={activeDiff.baselineSignedUrl}
                        alt="Baseline viewport screenshot"
                        className="w-full rounded border border-neutral-800 object-top"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex min-h-[180px] items-center justify-center text-xs text-neutral-500">
                        Baseline image preview unavailable
                      </div>
                    )}
                  </div>
                </div>

                {/* After (Current) */}
                <div
                  data-testid="diff-current-view"
                  className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
                >
                  <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-3 py-2 text-xs">
                    <span className="font-medium text-neutral-300">
                      After (Current)
                    </span>
                    <span className="font-mono text-[11px] text-neutral-500">
                      {activeDiff.currentAuditRunId?.slice(0, 8) ?? "current"}
                    </span>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto p-2">
                    {activeDiff.currentSignedUrl ? (
                      <img
                        src={activeDiff.currentSignedUrl}
                        alt="Current viewport screenshot"
                        className="w-full rounded border border-neutral-800 object-top"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex min-h-[180px] items-center justify-center text-xs text-neutral-500">
                        Current image preview unavailable
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
