import { useId, useState } from "react";
import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditHistoryItem,
} from "@pagepilot/contracts";

export interface ScoreTrendChartProps {
  history: AuditHistoryItem[];
  onSelectRun?: (runId: string) => void;
}

const CATEGORY_DISPLAY_NAMES: Record<AuditCategory, string> = {
  clarity: "Clarity & Value",
  visualHierarchy: "Visual Hierarchy",
  ctaEffectiveness: "Call to Action",
  copy: "Copywriting",
  accessibility: "Accessibility",
  mobileUx: "Mobile UX",
  trustCredibility: "Trust & Proof",
};

export function ScoreTrendChart({ history, onSelectRun }: ScoreTrendChartProps) {
  const gradientId = useId();
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

  // Extract completed audits with scores in chronological order (oldest -> newest)
  const scoreRuns = history
    .filter((h) => h.status === "completed" && typeof h.overallScore === "number")
    .slice()
    .reverse();

  if (scoreRuns.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-6 text-center">
        <h3 className="text-xs font-semibold text-neutral-300">
          No Score History Available
        </h3>
        <p className="mt-1 text-xs text-neutral-500">
          Run your first landing page audit to establish a baseline score and begin tracking UX trends over time.
        </p>
      </div>
    );
  }

  const latestRun = scoreRuns[scoreRuns.length - 1]!;
  const firstRun = scoreRuns[0]!;
  const previousRun =
    scoreRuns.length > 1 ? scoreRuns[scoreRuns.length - 2] : null;

  const totalDelta =
    scoreRuns.length > 1
      ? (latestRun.overallScore ?? 0) - (firstRun.overallScore ?? 0)
      : 0;

  const recentDelta =
    typeof previousRun?.overallScore === "number" &&
    typeof latestRun.overallScore === "number"
      ? latestRun.overallScore - previousRun.overallScore
      : 0;

  // Chart dimensions
  const svgWidth = 640;
  const svgHeight = 220;
  const padLeft = 45;
  const padRight = 35;
  const padTop = 25;
  const padBottom = 35;

  const innerWidth = svgWidth - padLeft - padRight;
  const innerHeight = svgHeight - padTop - padBottom;

  // Coordinate calculations
  const points = scoreRuns.map((run, idx) => {
    const score = run.overallScore ?? 0;
    const x =
      scoreRuns.length === 1
        ? padLeft + innerWidth / 2
        : padLeft + (idx / (scoreRuns.length - 1)) * innerWidth;
    const y = padTop + ((100 - score) / 100) * innerHeight;

    const prevScore =
      idx > 0 && scoreRuns[idx - 1]?.overallScore !== null
        ? scoreRuns[idx - 1]!.overallScore!
        : null;
    const deltaFromPrev = prevScore !== null ? score - prevScore : null;

    return {
      run,
      score,
      x,
      y,
      index: idx,
      deltaFromPrev,
    };
  });

  // SVG Path definitions
  const linePathD =
    points.length === 1
      ? ""
      : points.reduce(
          (acc, p, i) =>
            i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`,
          "",
        );

  const areaPathD =
    points.length === 1
      ? ""
      : `${linePathD} L ${points[points.length - 1]!.x} ${padTop + innerHeight} L ${points[0]!.x} ${padTop + innerHeight} Z`;

  const activePoint =
    activePointIndex !== null ? points[activePointIndex] : null;

  // Latest category scores & deltas
  const latestCategoryScores: Partial<Record<AuditCategory, number>> =
    latestRun.categoryScores || {};
  const previousCategoryScores: Partial<Record<AuditCategory, number>> =
    previousRun?.categoryScores || {};

  return (
    <div
      role="region"
      aria-label="UX Score Trend and Historical Trajectory"
      className="space-y-4 rounded-2xl border border-neutral-800/80 bg-neutral-900/40 p-5 backdrop-blur-sm"
    >
      {/* Header & Trend Summary */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-neutral-200">
              UX Score Trajectory
            </h2>
            <span className="text-[11px] text-neutral-400">
              ({scoreRuns.length} {scoreRuns.length === 1 ? "audit" : "audits"} tracked)
            </span>
          </div>
          <p className="mt-0.5 text-xs text-neutral-400">
            {scoreRuns.length === 1
              ? "Baseline score established. Future weekly scans will plot progress."
              : totalDelta > 0
              ? `Overall UX score improved by +${totalDelta} pts since baseline.`
              : totalDelta < 0
              ? `Overall UX score declined by ${totalDelta} pts since baseline.`
              : "Overall UX score is stable across monitored audits."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {scoreRuns.length > 1 ? (
            <div
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold ${
                recentDelta > 0
                  ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/50"
                  : recentDelta < 0
                  ? "bg-red-950/60 text-red-400 border border-red-800/50"
                  : "bg-neutral-800/80 text-neutral-300 border border-neutral-700/50"
              }`}
            >
              <span>
                {recentDelta > 0
                  ? `+${recentDelta} pts`
                  : recentDelta < 0
                  ? `${recentDelta} pts`
                  : "0 pts (Stable)"}
              </span>
              <span className="text-[10px] font-normal text-neutral-400">
                vs previous
              </span>
            </div>
          ) : (
            <span className="inline-flex items-center rounded-lg border border-neutral-800 bg-neutral-950/60 px-2.5 py-1 text-xs font-medium text-neutral-300">
              Baseline Established
            </span>
          )}
        </div>
      </div>

      {/* Interactive SVG Trend Chart */}
      <div className="relative overflow-hidden rounded-xl border border-neutral-800/60 bg-neutral-950/50 p-2">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="h-44 w-full select-none overflow-visible sm:h-52"
          role="img"
          aria-label={`Score trend line chart starting at ${firstRun.overallScore} and ending at ${latestRun.overallScore}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Horizontal Score Grid Lines (0, 25, 50, 75, 100) */}
          {[0, 25, 50, 75, 100].map((gridScore) => {
            const y = padTop + ((100 - gridScore) / 100) * innerHeight;
            return (
              <g key={gridScore}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + innerWidth}
                  y2={y}
                  stroke="#262626"
                  strokeDasharray={gridScore === 50 ? "4 4" : undefined}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fill="#737373"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {gridScore}
                </text>
              </g>
            );
          })}

          {/* Area Fill */}
          {areaPathD && (
            <path
              d={areaPathD}
              fill={`url(#${gradientId})`}
              className="transition-all duration-300"
            />
          )}

          {/* Trend Line */}
          {linePathD && (
            <path
              d={linePathD}
              fill="none"
              stroke="#34d399"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-all duration-300"
            />
          )}

          {/* Baseline Indicator for Single Audit */}
          {points.length === 1 && (
            <g>
              <circle
                cx={points[0]!.x}
                cy={points[0]!.y}
                r="18"
                fill="none"
                stroke="#10b981"
                strokeOpacity="0.25"
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
              <text
                x={points[0]!.x}
                y={points[0]!.y - 18}
                textAnchor="middle"
                fill="#34d399"
                fontSize="10"
                fontWeight="600"
              >
                Baseline: {points[0]!.score} pts
              </text>
            </g>
          )}

          {/* Data Points */}
          {points.map((p) => {
            const isHovered = activePointIndex === p.index;
            const isLatest = p.index === points.length - 1;

            return (
              <g key={p.run.id} className="cursor-pointer">
                {/* Focus/Hover Halo */}
                {isHovered && (
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r="12"
                    fill="#34d399"
                    fillOpacity="0.2"
                  />
                )}

                {/* Score Dot */}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={isLatest ? "5" : "4"}
                  fill={isLatest ? "#34d399" : "#10b981"}
                  stroke="#09090b"
                  strokeWidth="2"
                  tabIndex={0}
                  role="button"
                  aria-label={`Audit on ${new Date(p.run.createdAt).toLocaleDateString()}: Score ${p.score}`}
                  onMouseEnter={() => setActivePointIndex(p.index)}
                  onMouseLeave={() => setActivePointIndex(null)}
                  onFocus={() => setActivePointIndex(p.index)}
                  onBlur={() => setActivePointIndex(null)}
                  onClick={() => onSelectRun?.(p.run.id)}
                  className="transition-transform duration-150 hover:scale-125 focus:scale-125 focus:outline-none"
                />

                {/* Date Label on X Axis */}
                <text
                  x={p.x}
                  y={svgHeight - 12}
                  textAnchor="middle"
                  fill={isHovered ? "#f5f5f5" : "#737373"}
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {new Date(p.run.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {activePoint && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 text-xs shadow-2xl backdrop-blur-md transition-all"
            style={{
              left: `${(activePoint.x / svgWidth) * 100}%`,
              top: `${Math.max(8, (activePoint.y / svgHeight) * 100 - 35)}%`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] text-neutral-400">
                {new Date(activePoint.run.createdAt).toLocaleString()}
              </span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-neutral-300">
                {activePoint.run.invocationType}
              </span>
            </div>

            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-bold text-neutral-100">
                {activePoint.score}
              </span>
              <span className="text-[10px] text-neutral-400">/ 100</span>
              {activePoint.deltaFromPrev !== null && (
                <span
                  className={`text-[11px] font-semibold ${
                    activePoint.deltaFromPrev > 0
                      ? "text-emerald-400"
                      : activePoint.deltaFromPrev < 0
                      ? "text-red-400"
                      : "text-neutral-400"
                  }`}
                >
                  {activePoint.deltaFromPrev > 0
                    ? `+${activePoint.deltaFromPrev}`
                    : activePoint.deltaFromPrev}{" "}
                  pts
                </span>
              )}
            </div>

            {activePoint.run.summary && (
              <p className="mt-1 max-w-[200px] truncate text-[10px] text-neutral-400">
                {activePoint.run.summary}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Per-Category Score Trajectories */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold tracking-wide text-neutral-300">
            Category Trajectories
          </h3>
          <span className="text-[11px] text-neutral-400">
            Latest audit vs previous
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {AUDIT_CATEGORIES.map((category) => {
            const currentScore = latestCategoryScores[category];
            const prevScore = previousCategoryScores[category];
            const hasScores = typeof currentScore === "number";
            const delta =
              hasScores && typeof prevScore === "number"
                ? currentScore - prevScore
                : null;

            return (
              <div
                key={category}
                className="flex flex-col justify-between rounded-xl border border-neutral-800/70 bg-neutral-950/40 p-3 transition hover:border-neutral-700/70"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-300">
                    {CATEGORY_DISPLAY_NAMES[category]}
                  </span>
                  {delta !== null && delta !== 0 && (
                    <span
                      className={`text-[10px] font-semibold ${
                        delta > 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-lg font-bold text-neutral-100">
                    {hasScores ? currentScore : "—"}
                    <span className="text-[10px] font-normal text-neutral-400">
                      {" "}
                      / 100
                    </span>
                  </span>

                  {hasScores && (
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className={`h-full rounded-full ${
                          currentScore >= 80
                            ? "bg-emerald-400"
                            : currentScore >= 50
                            ? "bg-amber-400"
                            : "bg-red-400"
                        }`}
                        style={{ width: `${currentScore}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
