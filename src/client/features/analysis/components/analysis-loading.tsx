import { useEffect, useRef, useState } from "react";

// Presentational phases from PLAN.md. These are honest status steps, not a
// simulation of model progress; completion is driven by the actual API
// response in App, so the display holds on the last phase if needed.
const PHASES = [
  "Checking URL",
  "Reading page structure",
  "Preparing UX audit",
] as const;

const PHASE_MS = 900;

export function AnalysisLoading({ url }: { url: string }) {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (phaseIndex >= PHASES.length - 1) return;
    const timer = setTimeout(
      () => setPhaseIndex((index) => index + 1),
      PHASE_MS,
    );
    return () => clearTimeout(timer);
  }, [phaseIndex]);

  // Predictable focus entry: keyboard and screen-reader users land on the
  // activity region instead of an undefined point in the document.
  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center focus-visible:outline-none"
      aria-busy="true"
    >
      <h1 className="sr-only">Analyzing website</h1>
      <div
        className="h-10 w-10 rounded-full border-2 border-neutral-700 border-t-white motion-safe:animate-spin"
        aria-hidden="true"
      />
      <div
        className="mt-8 flex items-center gap-1.5"
        data-testid="phase-dots"
        aria-hidden="true"
      >
        {PHASES.map((phase, index) => (
          <span
            key={phase}
            className={`h-1.5 w-6 rounded-full transition-colors ${
              index < phaseIndex
                ? "bg-neutral-600"
                : index === phaseIndex
                  ? "bg-white"
                  : "bg-neutral-800"
            }`}
          />
        ))}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-widest text-neutral-500">
        Step {Math.min(phaseIndex + 1, PHASES.length)} of {PHASES.length}
      </p>
      <p
        aria-live="polite"
        className="mt-2 text-lg font-medium text-neutral-100"
      >
        {PHASES[phaseIndex]}…
      </p>
      <p className="mt-3 max-w-md break-all text-sm leading-6 text-neutral-400">
        Analyzing <span className="text-neutral-300">{url}</span>.
      </p>
      <p className="mt-1 max-w-md text-sm leading-6 text-neutral-500">
        Analyzing the page structure and generating your UX audit. This usually
        takes a few seconds.
      </p>
    </section>
  );
}
