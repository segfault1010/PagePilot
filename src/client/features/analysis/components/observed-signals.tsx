import type { ReactNode } from "react";
import type {
  DetectedSignal,
  SignalStatus,
} from "../../../../shared/audit-types";
import { SIGNAL_STATUS_LABELS } from "../labels";

/**
 * Signal states are distinguished by more than color: each has a distinct
 * glyph, fill treatment, and (for "not measured") a dashed border so
 * unavailable evidence never reads as failure.
 */
const SIGNAL_BADGE_STYLES: Record<SignalStatus, string> = {
  // Restrained positive: quiet muted fill, check glyph.
  pass: "border-transparent bg-neutral-800 text-neutral-200",
  // Most prominent state: highest contrast, alert glyph — actionable.
  warn: "border-transparent bg-white font-semibold text-neutral-950",
  // Unavailable evidence, not failure: hollow dashed shape.
  unknown: "border-dashed border-neutral-500 text-neutral-400",
};

const SIGNAL_ICONS: Record<SignalStatus, ReactNode> = {
  pass: (
    <path
      d="M2.5 6.5 5 9l4.5-5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  warn: (
    <>
      <path
        d="M6 2.25v4.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="6" cy="9.25" r="0.85" fill="currentColor" />
    </>
  ),
  unknown: (
    <circle
      cx="6"
      cy="6"
      r="3.75"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeDasharray="1.8 1.8"
    />
  ),
};

function SignalStatusBadge({ status }: { status: SignalStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${SIGNAL_BADGE_STYLES[status]}`}
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
        {SIGNAL_ICONS[status]}
      </svg>
      {SIGNAL_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Low-priority methodology disclosure: what was measured versus interpreted,
 * what static HTML analysis cannot measure, and the raw deterministic
 * signals. Collapsed by default to keep the report scannable.
 */
export function ObservedSignals({ signals }: { signals: DetectedSignal[] }) {
  return (
    <section className="mt-12 sm:mt-14" aria-labelledby="signals-heading">
      <h2
        id="signals-heading"
        className="text-xl font-semibold tracking-tight text-neutral-50"
      >
        Methodology &amp; observed signals
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        How this audit reaches its conclusions.
      </p>

      <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
            Observed
          </dt>
          <dd className="mt-1 text-sm leading-6 text-neutral-400">
            Directly detected from the page's HTML structure and content.
          </dd>
        </div>
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-neutral-300">
            Inferred
          </dt>
          <dd className="mt-1 text-sm leading-6 text-neutral-400">
            AI interpretation based on the supplied evidence — judgement, not
            measurement.
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded-xl border border-dashed border-neutral-800 px-4 py-3.5">
        <p className="text-xs leading-5 text-neutral-500">
          This analysis reads static HTML only. It does not measure page speed,
          Core Web Vitals, exact visual contrast, real mobile rendering,
          conversion rate, or user behavior. Signals marked{" "}
          <span className="text-neutral-300">Not measured</span> lacked enough
          page evidence and never reduce a score.
        </p>
      </div>

      {signals.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-neutral-800 px-4 py-4 text-sm leading-6 text-neutral-500">
          No deterministic signals were collected for this analysis; the score
          reflects AI assessment of the available evidence only.
        </p>
      ) : (
        <details className="group mt-4 rounded-xl border border-neutral-800 bg-neutral-900">
          <summary className="cursor-pointer select-none px-5 py-4 text-sm font-medium text-neutral-200 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80">
            View all {signals.length} observed signal
            {signals.length === 1 ? "" : "s"}
          </summary>
          <ul className="divide-y divide-neutral-800 border-t border-neutral-800 px-5">
            {signals.map((signal) => (
              <li
                key={signal.id}
                className="flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-center sm:gap-4"
              >
                <code className="shrink-0 text-xs text-neutral-500">
                  {signal.id}
                </code>
                <SignalStatusBadge status={signal.status} />
                <span className="text-sm leading-6 text-neutral-400">
                  {signal.evidence}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
