import { useCallback, useEffect, useState } from "react";
import type { ApiError, Report } from "@pagepilot/contracts";
import { AnalysisLoading } from "./features/analysis/components/analysis-loading";
import { BrandMark } from "./features/analysis/components/brand-mark";
import { ErrorState } from "./features/analysis/components/error-state";
import { Landing } from "./features/analysis/components/landing";
import { ReportView } from "./features/analysis/components/report-view";
import { analyzeUrl } from "./features/analysis/api";
import { AuthProvider } from "./features/auth/auth-context";
import { AuthNav } from "./features/auth/components/auth-nav";

/**
 * Minimum time the loading view stays up. Fast API responses would
 * otherwise flash the spinner for a few milliseconds; holding briefly is
 * calmer than animating a state that has already ended.
 */
export const MIN_ANALYSIS_MS = 600;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type View =
  | { name: "landing" }
  | { name: "analyzing"; url: string }
  | { name: "report"; url: string; report: Report }
  | { name: "failure"; url: string; error: ApiError };

export function AppContent() {
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
    // The cleanup flag makes any in-flight resolution a no-op once this
    // effect is superseded, so a stale response can never overwrite the
    // state of a newer request. Explicit user action (retry button) is the
    // only way requests are re-issued — no automatic retry loops.
    Promise.all([analyzeUrl(view.url), delay(MIN_ANALYSIS_MS)]).then(
      ([result]) => {
        if (cancelled) return;
        setView(
          result.ok
            ? { name: "report", url: view.url, report: result.report }
            : { name: "failure", url: view.url, error: result.error },
        );
      },
    );
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
          {/* Polite completion announcement; failure announces via its
              role="alert" region instead. */}
          <p className="sr-only" role="status">
            Analysis complete — your report is ready below.
          </p>
          <div className="fade-rise">
            <ReportView
              report={view.report}
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
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
      <button
        type="button"
        onClick={onHome}
        aria-label="PagePilot — back to start"
        className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        <BrandMark />
      </button>
      <AuthNav />
    </header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
