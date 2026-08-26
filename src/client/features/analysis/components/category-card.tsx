import type { CategoryReport } from "@pagepilot/contracts";
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "../labels";
import { Badge, SEVERITY_TONE } from "./badge";
import { FindingList } from "./finding-list";

export function CategoryCard({ category }: { category: CategoryReport }) {
  const findingCount = category.findings.length;

  return (
    <article className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-6 text-neutral-100">
          {CATEGORY_LABELS[category.category]}
        </h3>
        <span
          className="text-xl font-semibold tabular-nums text-white"
          aria-label={`${CATEGORY_LABELS[category.category]} score ${category.score} out of 100`}
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
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Badge tone={SEVERITY_TONE[category.severity]}>
          {SEVERITY_LABELS[category.severity]}
        </Badge>
        <span className="text-xs text-neutral-600">
          {findingCount === 0
            ? "No findings"
            : `${findingCount} ${findingCount === 1 ? "finding" : "findings"}`}
        </span>
        {category.confidence === "ai-led" && (
          <Badge tone="outline">Limited page signals</Badge>
        )}
      </div>
      {/* Visually clamped for scannability; the full text remains in the
          DOM and accessibility tree, and is shown on hover via title. */}
      <p
        className="mt-3 line-clamp-3 text-sm leading-6 text-neutral-400"
        title={category.explanation}
      >
        {category.explanation}
      </p>
      <div className="mt-auto">
        <FindingList findings={category.findings} />
      </div>
    </article>
  );
}
