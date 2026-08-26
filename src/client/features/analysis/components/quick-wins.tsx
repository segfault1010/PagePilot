import type { Recommendation } from "@pagepilot/contracts";
import { CATEGORY_LABELS } from "../labels";

/**
 * Deliberately distinct from detailed recommendations: one panel, compact
 * numbered rows, one-line rationale each. Answers "what can I fix quickly?"
 */
export function QuickWins({ quickWins }: { quickWins: Recommendation[] }) {
  return (
    <section className="mt-12 sm:mt-14" aria-labelledby="quick-wins-heading">
      <h2
        id="quick-wins-heading"
        className="text-xl font-semibold tracking-tight text-neutral-50"
      >
        Quick wins
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        Low-effort fixes that improve the experience fastest.
      </p>
      <ol className="mt-5 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900">
        {quickWins.map((win, index) => (
          <li key={win.title} className="flex gap-4 p-5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold tabular-nums text-neutral-950"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-6 text-neutral-100">
                {win.title}
              </h3>
              <p className="mt-0.5 text-sm leading-6 text-neutral-400">
                {win.detail}
              </p>
              {win.category && (
                <p className="mt-1.5 text-xs uppercase tracking-wide text-neutral-600">
                  {CATEGORY_LABELS[win.category]}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
