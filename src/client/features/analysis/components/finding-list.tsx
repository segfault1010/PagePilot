import type { Finding } from "../../../../shared/audit-types";
import { BASIS_LABELS, SEVERITY_LABELS } from "../labels";
import { Badge, SEVERITY_TONE } from "./badge";

/**
 * Compact, scannable findings for a category card. An empty list is an
 * intentional state — never padded with invented findings.
 */
export function FindingList({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-neutral-800 px-3.5 py-3 text-sm leading-6 text-neutral-500">
        No significant issues detected from the available evidence.
      </p>
    );
  }

  return (
    <ul className="mt-4 space-y-4 border-t border-neutral-800 pt-4">
      {findings.map((finding) => (
        <li key={finding.title}>
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-medium leading-6 text-neutral-200">
              {finding.title}
            </h4>
            <Badge tone={SEVERITY_TONE[finding.severity]}>
              {SEVERITY_LABELS[finding.severity]}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            {finding.evidence}
          </p>
          <p className="mt-1.5 text-xs text-neutral-600">
            {BASIS_LABELS[finding.basis]}
          </p>
          <p className="mt-2 border-l-2 border-neutral-800 pl-3 text-xs leading-5 text-neutral-300">
            <span className="sr-only">Recommended fix: </span>
            {finding.recommendation}
          </p>
        </li>
      ))}
    </ul>
  );
}
