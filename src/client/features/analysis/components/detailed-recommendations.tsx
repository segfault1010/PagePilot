import type { Recommendation } from "../../../../shared/audit-types";
import { CATEGORY_LABELS } from "../labels";

/**
 * The full action plan: ordered, prioritized fixes with rationale. Rows use
 * outlined markers so they read as a sequence rather than quick wins.
 */
export function DetailedRecommendations({
  recommendations,
}: {
  recommendations: Recommendation[];
}) {
  return (
    <section
      className="mt-12 sm:mt-14"
      aria-labelledby="recommendations-heading"
    >
      <h2
        id="recommendations-heading"
        className="text-xl font-semibold tracking-tight text-neutral-50"
      >
        Detailed recommendations
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        The complete fix list for this page, ordered by priority.
      </p>
      <ol className="mt-5 space-y-4">
        {recommendations.map((recommendation, index) => (
          <li key={recommendation.title}>
            <article className="flex gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-xs font-semibold tabular-nums text-neutral-300"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold leading-6 text-neutral-100">
                    {recommendation.title}
                  </h3>
                  {recommendation.category && (
                    <span className="text-xs uppercase tracking-wide text-neutral-600">
                      {CATEGORY_LABELS[recommendation.category]}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm leading-6 text-neutral-400">
                  {recommendation.detail}
                </p>
              </div>
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}
