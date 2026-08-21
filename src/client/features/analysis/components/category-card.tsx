import type { CategoryReport } from "../../../../shared/audit-types";
import { CATEGORY_LABELS, CONFIDENCE_LABELS, SEVERITY_LABELS } from "../labels";
import { Badge, SEVERITY_TONE } from "./badge";

export function CategoryCard({ category }: { category: CategoryReport }) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-6 text-neutral-100">
          {CATEGORY_LABELS[category.category]}
        </h3>
        <span
          className="text-xl font-semibold tabular-nums text-white"
          aria-label={`Score ${category.score} out of 100`}
        >
          {category.score}
        </span>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-800"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-white"
          style={{ width: `${category.score}%` }}
        />
      </div>
      <div className="mt-3">
        <Badge tone="outline">{CONFIDENCE_LABELS[category.confidence]}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-neutral-400">
        {category.explanation}
      </p>
      {category.findings.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-neutral-800 pt-4">
          {category.findings.map((finding) => (
            <li key={finding.title}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-200">
                  {finding.title}
                </span>
                <Badge tone={SEVERITY_TONE[finding.severity]}>
                  {SEVERITY_LABELS[finding.severity]}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {finding.evidence}
              </p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
