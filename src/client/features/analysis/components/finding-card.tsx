import type { Finding } from "../../../../shared/audit-types";
import { SEVERITY_LABELS } from "../labels";
import { Badge, SEVERITY_TONE } from "./badge";

export function FindingCard({ finding }: { finding: Finding }) {
  return (
    <article className="flex h-full flex-col rounded-xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-6 text-neutral-100">
          {finding.title}
        </h3>
        <Badge tone={SEVERITY_TONE[finding.severity]}>
          {SEVERITY_LABELS[finding.severity]}
        </Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-neutral-400">
        {finding.evidence}
      </p>
      <p className="mt-3 text-sm leading-6 text-neutral-300">
        <span className="text-neutral-500">Recommended fix — </span>
        {finding.recommendation}
      </p>
      <p className="mt-auto pt-3 text-xs uppercase tracking-wide text-neutral-600">
        {finding.basis === "observed"
          ? "Observed on page"
          : "AI-inferred"}
      </p>
    </article>
  );
}
