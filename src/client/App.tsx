import { useCallback, useEffect, useState } from "react";
import type { ApiError } from "../shared/audit-types";
import { AnalysisLoading } from "./features/analysis/components/analysis-loading";
import { BrandMark } from "./features/analysis/components/brand-mark";
import { ErrorState } from "./features/analysis/components/error-state";
import { Landing } from "./features/analysis/components/landing";
import { ReportView } from "./features/analysis/components/report-view";
import { analyzeUrl } from "./features/analysis/api";
import { sampleReport } from "../shared/sample-report";

type View =
  | { name: "landing" }
  | { name: "analyzing"; url: string }
  | { name: "report"; url: string }
  | { name: "failure"; url: string; error: ApiError };

export default function App() {
  const [view, setView] = useState<View>({ name: "landing" });
  const [draftUrl, setDraftUrl] = useState("");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  const handleAnalyze = useCallback((url: string) => {
    setDraftUrl(url);
    setView({ name: "analyzing", url });
  }, []);

  const handleBackToLanding = useCallback(() => {
    setView({ name: "landing" });
  }, []);

  const handleRetry = useCallback(() => {
    setView((current) =>
      current.name === "failure"
        ? { name: "analyzing", url: current.url }
        : current,
    );
  }, []);

  useEffect(() => {
    if (view.name !== "analyzing") return;
    let cancelled = false;
    analyzeUrl(view.url).then((result) => {
      if (cancelled) return;
      setView(
        result.ok
          ? { name: "report", url: view.url }
          : { name: "failure", url: view.url, error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [view]);

  if (view.name === "analyzing") {
    return (
      <div className="min-h-screen">
        <MiniHeader onHome={handleBackToLanding} />
        <AnalysisLoading url={view.url} />
      </div>
    );
  }

  if (view.name === "report") {
    return (
      <div className="min-h-screen">
        <MiniHeader onHome={handleBackToLanding} />
        <main className="mx-auto w-full max-w-5xl px-6 pb-20 pt-4 sm:pt-8">
          <h1 className="sr-only">Analysis report</h1>
          <p className="mb-8 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-center text-xs leading-5 text-neutral-400">
            Preview report with sample data — live analysis arrives in an
            upcoming update.
          </p>
          <div className="fade-rise">
            <ReportView
              report={sampleReport}
              onAnalyzeAnother={handleBackToLanding}
            />
          </div>
        </main>
      </div>
    );
  }

  if (view.name === "failure") {
    return (
      <div className="min-h-screen">
        <MiniHeader onHome={handleBackToLanding} />
        <ErrorState
          error={view.error}
          url={view.url}
          onRetry={handleRetry}
          onEditUrl={handleBackToLanding}
        />
      </div>
    );
  }

  return <Landing initialUrl={draftUrl} onAnalyze={handleAnalyze} />;
}

function MiniHeader({ onHome }: { onHome: () => void }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center px-6 py-6">
      <button
        type="button"
        onClick={onHome}
        aria-label="PagePilot — back to start"
        className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        <BrandMark />
      </button>
    </header>
  );
}
