import { useEffect, useState } from "react";

// Presentational phases from PLAN.md. These are honest status steps, not a
// simulation of model progress.
const PHASES = [
  "Checking URL",
  "Reading page structure",
  "Preparing UX audit",
] as const;

const PHASE_MS = 900;
const FINISH_MS = 1100;

export function AnalysisLoading({
  url,
  onComplete,
}: {
  url: string;
  onComplete: () => void;
}) {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (phaseIndex < PHASES.length - 1) {
      const timer = setTimeout(
        () => setPhaseIndex((index) => index + 1),
        PHASE_MS,
      );
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(onComplete, FINISH_MS);
    return () => clearTimeout(timer);
  }, [phaseIndex, onComplete]);

  return (
    <section
      className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center"
      aria-busy="true"
    >
      <h1 className="sr-only">Analyzing website</h1>
      <div
        className="h-10 w-10 rounded-full border-2 border-neutral-700 border-t-white motion-safe:animate-spin"
        aria-hidden="true"
      />
      <p className="mt-8 text-xs font-medium uppercase tracking-widest text-neutral-500">
        Step {phaseIndex + 1} of {PHASES.length}
      </p>
      <p
        aria-live="polite"
        className="mt-2 text-lg font-medium text-neutral-100"
      >
        {PHASES[phaseIndex]}…
      </p>
      <p className="mt-3 max-w-md text-sm leading-6 text-neutral-500">
        Analyzing{" "}
        <span className="break-all text-neutral-400">{url}</span>. This usually
        takes a few seconds.
      </p>
    </section>
  );
}
