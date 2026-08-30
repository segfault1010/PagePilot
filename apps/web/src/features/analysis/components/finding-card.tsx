import type { Finding } from "@pagepilot/contracts";
import { BASIS_LABELS, CATEGORY_LABELS, SEVERITY_LABELS } from "../labels";
import { Badge, SEVERITY_TONE } from "./badge";

/**
 * The strongest card in the report: used for the three prioritized top
 * problems. Rank 1 gets a filled marker so priority reads at a glance
 * without relying on color alone.
 */
export function FindingCard({
  finding,
  rank,
  onCreateWorkItem,
}: {
  finding: Finding;
  rank?: number;
  onCreateWorkItem?: (finding: Finding) => void;
}) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {typeof rank === "number" && (
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
              rank === 1
                ? "bg-white text-neutral-950"
                : "border border-neutral-700 text-neutral-300"
            }`}
            aria-hidden="true"
          >
            {rank}
          </span>
        )}
        <Badge tone={SEVERITY_TONE[finding.severity]}>
          {SEVERITY_LABELS[finding.severity]} severity
        </Badge>
        {finding.category && (
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            {CATEGORY_LABELS[finding.category]}
          </span>
        )}
      </div>
      <h3 className="mt-4 text-base font-semibold leading-6 tracking-tight text-neutral-50">
        {finding.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-neutral-400">
        {finding.evidence}
      </p>
      <p className="mb-4 mt-2.5 text-xs uppercase tracking-wide text-neutral-600">
        {BASIS_LABELS[finding.basis]}
      </p>
      <div className="mt-auto border-t border-neutral-800 pt-4">
        <p className="text-sm leading-6 text-neutral-100">
          <span className="mb-1 block text-xs uppercase tracking-wide text-neutral-500">
            Fix
          </span>
          {finding.recommendation}
        </p>
        {onCreateWorkItem && (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => onCreateWorkItem(finding)}
              className="inline-flex items-center gap-1 text-xs font-medium text-neutral-400 hover:text-white transition"
            >
              + Track Work Item
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
