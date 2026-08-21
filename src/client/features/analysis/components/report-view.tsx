import type { Report } from "../../../../shared/audit-types";
import { CONFIDENCE_LABELS } from "../labels";
import { Badge } from "./badge";
import { CategoryCard } from "./category-card";
import { FindingCard } from "./finding-card";
import { RecommendationCard } from "./recommendation-card";
import { ScoreRing } from "./score-ring";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function ReportView({
  report,
  onAnalyzeAnother,
}: {
  report: Report;
  onAnalyzeAnother?: () => void;
}) {
  return (
    <div>
      <div className="flex flex-col items-center gap-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
        <ScoreRing score={report.overallScore} />
        <div className="min-w-0 text-center sm:text-left">
          <p className="truncate text-sm text-neutral-500">
            {report.source.finalUrl}
          </p>
          <h2 className="mt-1 truncate text-lg font-semibold text-neutral-50">
            {report.source.title ?? "Untitled page"}
          </h2>
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 sm:justify-start">
            <Badge tone="muted">{CONFIDENCE_LABELS[report.scoreConfidence]}</Badge>
            <span className="text-xs text-neutral-600">
              Analyzed {formatDateTime(report.source.analyzedAt)}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-neutral-300">
            {report.summary}
          </p>
        </div>
      </div>

      <section className="mt-12" aria-labelledby="report-categories-heading">
        <h2
          id="report-categories-heading"
          className="text-xl font-semibold tracking-tight text-neutral-50"
        >
          Category scores
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {report.categories.map((category) => (
            <CategoryCard key={category.category} category={category} />
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="report-problems-heading">
        <h2
          id="report-problems-heading"
          className="text-xl font-semibold tracking-tight text-neutral-50"
        >
          Top problems
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {report.topProblems.map((finding) => (
            <FindingCard key={finding.title} finding={finding} />
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="report-quick-wins-heading">
        <h2
          id="report-quick-wins-heading"
          className="text-xl font-semibold tracking-tight text-neutral-50"
        >
          Quick wins
        </h2>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {report.quickWins.map((recommendation, index) => (
            <RecommendationCard
              key={recommendation.title}
              recommendation={recommendation}
              index={index}
            />
          ))}
        </div>
      </section>

      <section className="mt-12" aria-labelledby="report-recommendations-heading">
        <h2
          id="report-recommendations-heading"
          className="text-xl font-semibold tracking-tight text-neutral-50"
        >
          Detailed recommendations
        </h2>
        <ol className="mt-5 space-y-4">
          {report.detailedRecommendations.map((recommendation, index) => (
            <li key={recommendation.title}>
              <RecommendationCard
                recommendation={recommendation}
                index={index}
              />
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12" aria-labelledby="report-signals-heading">
        <h2
          id="report-signals-heading"
          className="text-xl font-semibold tracking-tight text-neutral-50"
        >
          Observed signals
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          Measured directly from the page's HTML and kept separate from AI
          interpretation.
        </p>
        <details className="group mt-4 rounded-xl border border-neutral-800 bg-neutral-900">
          <summary className="cursor-pointer select-none px-5 py-4 text-sm font-medium text-neutral-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80">
            View all {report.observedSignals.length} signals
          </summary>
          <ul className="divide-y divide-neutral-800 border-t border-neutral-800 px-5">
            {report.observedSignals.map((signal) => (
              <li
                key={signal.id}
                className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-center sm:gap-4"
              >
                <code className="shrink-0 text-xs text-neutral-500">
                  {signal.id}
                </code>
                <Badge tone={signal.status === "pass" ? "muted" : "outline"}>
                  {signal.status}
                </Badge>
                <span className="text-sm leading-6 text-neutral-400">
                  {signal.evidence}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {onAnalyzeAnother && (
        <div className="mt-12 text-center">
          <button
            type="button"
            onClick={onAnalyzeAnother}
            className="h-11 rounded-lg border border-neutral-700 px-6 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          >
            Analyze another website
          </button>
        </div>
      )}
    </div>
  );
}
