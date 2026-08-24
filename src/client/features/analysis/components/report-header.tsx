import type { Report } from "../../../../shared/audit-types";
import {
  CONFIDENCE_EXPLANATIONS,
  CONFIDENCE_LABELS,
  scoreVerdict,
} from "../labels";
import { Badge } from "./badge";
import { ScoreRing } from "./score-ring";

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function ReportHeader({ report }: { report: Report }) {
  const verdict = scoreVerdict(report.overallScore);
  const redirected = report.source.finalUrl !== report.source.requestedUrl;

  return (
    <header className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 sm:p-8">
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
        <ScoreRing score={report.overallScore} />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="break-all text-xs leading-5 text-neutral-500">
            {report.source.finalUrl}
          </p>
          <p className="mt-1 text-lg font-semibold tracking-tight text-neutral-50">
            {report.source.title ?? "Untitled page"}
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-white">
            {verdict.label}
          </p>
          <p className="mt-1 text-sm leading-6 text-neutral-400">
            {verdict.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 sm:justify-start">
            <Badge
              tone={report.scoreConfidence === "blended" ? "muted" : "outline"}
            >
              {CONFIDENCE_LABELS[report.scoreConfidence]}
            </Badge>
            <span className="text-xs text-neutral-600">
              Analyzed {formatDateTime(report.source.analyzedAt)}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-6 text-pretty text-sm leading-6 text-neutral-300 sm:mt-7 sm:text-base sm:leading-7">
        {report.summary}
      </p>

      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3">
        <p className="text-xs leading-5 text-neutral-400">
          <span className="font-semibold text-neutral-300">
            About this score:{" "}
          </span>
          {CONFIDENCE_EXPLANATIONS[report.scoreConfidence]}
        </p>
      </div>

      {redirected && (
        <p className="mt-3 break-all text-xs text-neutral-600">
          Redirected from {report.source.requestedUrl}
        </p>
      )}
    </header>
  );
}
