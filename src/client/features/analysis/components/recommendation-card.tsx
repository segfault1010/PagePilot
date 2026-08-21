import type { Recommendation } from "../../../../shared/audit-types";
import { CATEGORY_LABELS } from "../labels";

export function RecommendationCard({
  recommendation,
  index,
}: {
  recommendation: Recommendation;
  index?: number;
}) {
  return (
    <article className="flex h-full gap-4 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      {typeof index === "number" && (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-700 text-xs font-semibold tabular-nums text-neutral-300"
          aria-hidden="true"
        >
          {index + 1}
        </span>
      )}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold leading-6 text-neutral-100">
          {recommendation.title}
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-neutral-400">
          {recommendation.detail}
        </p>
        {recommendation.category && (
          <p className="mt-2.5 text-xs uppercase tracking-wide text-neutral-600">
            {CATEGORY_LABELS[recommendation.category]}
          </p>
        )}
      </div>
    </article>
  );
}
