import { useEffect, useState } from "react";
import type {
  ScreenshotDeviceType,
  VisualAnalysisReview,
  VisualDimension,
} from "@pagepilot/contracts";
import { VISUAL_PROVENANCE_LABEL } from "@pagepilot/contracts";
import { fetchVisualAnalysis } from "../api.js";

export interface VisualReviewCardProps {
  projectId?: string;
  pageId?: string;
  auditRunId?: string;
  visualAnalysis?: VisualAnalysisReview | null;
  isLoading?: boolean;
  error?: string | null;
  onSelectViewport?: (viewport: ScreenshotDeviceType) => void;
}

const DIMENSION_TITLES: Record<VisualDimension, string> = {
  visual_hierarchy: "Visual Hierarchy",
  cta_prominence: "CTA Prominence",
  visual_clutter: "Visual Clutter",
  contrast_legibility: "Contrast & Legibility",
  typography_hierarchy: "Typography Hierarchy",
  spacing_layout: "Spacing & Layout",
  mobile_adaptation: "Mobile Adaptation",
};

export function VisualReviewCard({
  projectId,
  pageId,
  auditRunId,
  visualAnalysis: initialAnalysis,
  isLoading: initialLoading,
  error: initialError,
  onSelectViewport,
}: VisualReviewCardProps) {
  const [review, setReview] = useState<VisualAnalysisReview | null>(
    initialAnalysis ?? null
  );
  const [isLoading, setIsLoading] = useState<boolean>(initialLoading ?? false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  useEffect(() => {
    if (initialAnalysis !== undefined) {
      setReview(initialAnalysis);
    }
  }, [initialAnalysis]);

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
    if (initialAnalysis !== undefined || !projectId || !pageId || !auditRunId) {
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchVisualAnalysis(projectId, pageId, auditRunId)
      .then((res) => {
        if (!isMounted) return;
        setReview(res.visualAnalysis);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load visual hierarchy review."
        );
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectId, pageId, auditRunId, initialAnalysis]);

  return (
    <div
      data-testid="visual-review-card"
      className="my-8 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 shadow-xl transition-all"
    >
      {/* Header with Title & Provenance Badge */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-semibold tracking-wide text-neutral-100">
            Visual Hierarchy Review
          </h3>
          <span
            data-testid="visual-provenance-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-950/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-purple-300"
            title="Multimodal visual review of rendered viewport screenshots"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            {VISUAL_PROVENANCE_LABEL}
          </span>
        </div>

        {review?.modelIdentifier && (
          <span className="text-[11px] font-mono text-neutral-400">
            Model: {review.modelIdentifier} • v{review.schemaVersion}
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-neutral-400">
        Multimodal visual evaluation of rendered viewports. Analyzes focal
        hierarchy, layout clarity, and mobile adaptation without altering
        deterministic audit scores.
      </p>

      {/* Main Container */}
      <div className="mt-5">
        {isLoading ? (
          <div
            data-testid="visual-review-loading"
            className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/50 p-8 text-center"
          >
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" />
            <p className="mt-3 text-xs text-neutral-400">
              Analyzing browser visual hierarchy...
            </p>
          </div>
        ) : error ? (
          <div
            data-testid="visual-review-error"
            className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-red-900/40 bg-red-950/20 p-6 text-center"
          >
            <p className="text-xs font-medium text-red-300">
              Unable to load visual hierarchy review: {error}
            </p>
          </div>
        ) : !review ? (
          <div
            data-testid="visual-review-empty"
            className="flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-950/30 p-6 text-center"
          >
            <p className="text-xs text-neutral-400">
              No visual hierarchy review recorded for this audit.
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              Visual reviews are performed automatically during scheduled and
              workspace audit runs.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Executive Summary */}
            {review.executiveSummary && (
              <div
                data-testid="visual-executive-summary"
                className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-4"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                  Visual Impression Summary
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-neutral-200">
                  {review.executiveSummary}
                </p>
              </div>
            )}

            {/* 7 Dimensions Assessment Grid */}
            {review.dimensions && Object.keys(review.dimensions).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Visual Dimension Assessments
                </h4>
                <div
                  data-testid="visual-dimensions-grid"
                  className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {Object.entries(review.dimensions).map(([key, assessment]) => {
                    const dimKey = key as VisualDimension;
                    const rating = assessment.rating;
                    const badgeClasses =
                      rating === "strong"
                        ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
                        : rating === "adequate"
                          ? "border-amber-500/30 bg-amber-950/40 text-amber-300"
                          : "border-rose-500/30 bg-rose-950/40 text-rose-300";

                    return (
                      <div
                        key={dimKey}
                        data-testid={`dimension-${dimKey}`}
                        className="flex flex-col justify-between rounded-lg border border-neutral-800/90 bg-neutral-950/50 p-3.5 transition hover:border-neutral-700"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-neutral-200">
                              {DIMENSION_TITLES[dimKey] ?? dimKey}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${badgeClasses}`}
                            >
                              {rating.replace("_", " ")}
                            </span>
                          </div>

                          {assessment.isAboveFoldCtaVisible !== undefined && (
                            <div className="mt-2">
                              {assessment.isAboveFoldCtaVisible ? (
                                <span className="inline-flex items-center gap-1 rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-800/40">
                                  ✓ CTA visible above fold
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 rounded bg-rose-950/50 px-1.5 py-0.5 text-[10px] text-rose-400 border border-rose-800/40">
                                  ✗ CTA below fold / weak
                                </span>
                              )}
                            </div>
                          )}

                          <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                            {assessment.explanation}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Visual Findings List */}
            <div>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  Visual Findings & Recommendations (
                  {review.findings?.length ?? 0})
                </h4>
                <span className="text-[11px] text-neutral-500 font-mono">
                  Basis: visual_inference
                </span>
              </div>

              {!review.findings || review.findings.length === 0 ? (
                <div
                  data-testid="visual-findings-empty"
                  className="mt-3 rounded-lg border border-neutral-800 bg-neutral-950/40 p-4 text-center text-xs text-neutral-400"
                >
                  No visual layout or hierarchy issues detected across analyzed
                  viewports.
                </div>
              ) : (
                <div
                  data-testid="visual-findings-list"
                  className="mt-3 space-y-3"
                >
                  {review.findings.map((finding) => {
                    const severityClasses =
                      finding.severity === "high"
                        ? "border-red-500/30 bg-red-950/40 text-red-300"
                        : finding.severity === "medium"
                          ? "border-amber-500/30 bg-amber-950/40 text-amber-300"
                          : "border-blue-500/30 bg-blue-950/40 text-blue-300";

                    return (
                      <div
                        key={finding.id}
                        data-testid={`visual-finding-${finding.id}`}
                        className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 transition hover:border-neutral-700"
                      >
                        {/* Tags and Severity Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800/80 pb-2.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Viewport badge */}
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  onSelectViewport &&
                                  (finding.targetViewport === "desktop" ||
                                    finding.targetViewport === "mobile")
                                ) {
                                  onSelectViewport(finding.targetViewport);
                                }
                              }}
                              className="rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-neutral-300 hover:border-neutral-700 hover:text-white"
                              title={
                                onSelectViewport
                                  ? `Switch preview to ${finding.targetViewport}`
                                  : undefined
                              }
                            >
                              Viewport: {finding.targetViewport}
                            </button>

                            {/* Zone badge */}
                            <span className="rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-400">
                              Zone: {finding.visualZone.replace(/_/g, " ")}
                            </span>

                            {/* Dimension chip */}
                            <span className="rounded border border-purple-800/40 bg-purple-950/30 px-2 py-0.5 text-[10px] text-purple-300">
                              {DIMENSION_TITLES[finding.dimension] ??
                                finding.dimension}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span
                              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${severityClasses}`}
                            >
                              {finding.severity} Severity
                            </span>
                            <span className="text-[10px] font-mono text-neutral-500">
                              Confidence: {finding.confidence}
                            </span>
                          </div>
                        </div>

                        {/* Title */}
                        <h5 className="mt-2.5 text-xs font-semibold text-neutral-100">
                          {finding.title}
                        </h5>

                        {/* Three-Tier Breakdown */}
                        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          {/* Observation */}
                          <div className="rounded border border-neutral-800/80 bg-neutral-900/40 p-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                              Visual Observation
                            </div>
                            <p className="mt-1 text-[11px] text-neutral-300 leading-relaxed">
                              {finding.observation}
                            </p>
                          </div>

                          {/* Impact */}
                          <div className="rounded border border-neutral-800/80 bg-neutral-900/40 p-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                              Conversion Impact
                            </div>
                            <p className="mt-1 text-[11px] text-neutral-300 leading-relaxed">
                              {finding.impact}
                            </p>
                          </div>

                          {/* Recommendation */}
                          <div className="rounded border border-neutral-800/80 bg-neutral-900/40 p-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-400/90">
                              Recommended Adjustment
                            </div>
                            <p className="mt-1 text-[11px] text-neutral-300 leading-relaxed">
                              {finding.recommendation}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
