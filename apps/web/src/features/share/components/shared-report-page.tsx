import { useEffect, useState } from "react";
import type { SharedAuditReportResponse } from "@pagepilot/contracts";
import { BrandMark } from "../../analysis/components/brand-mark";
import { ReportView } from "../../analysis/components/report-view";
import { getPublicSharedReport } from "../api";

export interface SharedReportPageProps {
  token: string;
  onNavigateHome?: () => void;
}

export function SharedReportPage({ token, onNavigateHome }: SharedReportPageProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SharedAuditReportResponse | null>(null);
  const [error, setError] = useState<{ status?: number; message?: string } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    async function loadReport() {
      try {
        setLoading(true);
        setError(null);
        const res = await getPublicSharedReport(token);
        if (!cancelled) {
          setData(res);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError({
            status: err.status || 404,
            message: err.message || "This report link is no longer available.",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadReport();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleGoHome = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      window.location.href = "/";
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <SharedHeader onHome={handleGoHome} />
        <main className="mx-auto max-w-4xl px-6 py-24 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-neutral-700 border-t-white" />
          <p className="mt-4 text-sm text-neutral-400">
            Loading shared audit report...
          </p>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <SharedHeader onHome={handleGoHome} />
        <main className="mx-auto max-w-lg px-6 py-20">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center shadow-xl space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">
                This report link is no longer available.
              </h1>
              <p className="mt-2 text-xs text-neutral-400">
                The link may have expired, been revoked by the workspace owner, or is invalid.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={handleGoHome}
                className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                Run an audit on PagePilot
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const { auditRun, report, shareMetadata } = data;
  const analyzedDate = auditRun.completedAt
    ? new Date(auditRun.completedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Completed";

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <SharedHeader onHome={handleGoHome} />

      <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-4 sm:pt-6">
        {/* Banner Info */}
        <div className="mb-8 flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                Read-Only Shared Report
              </span>
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
                Audited: {analyzedDate}
              </span>
            </div>
            <p className="mt-1 text-xs text-neutral-300">
              Page:{" "}
              <a
                href={auditRun.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-white"
              >
                {auditRun.targetUrl}
              </a>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[10px] text-neutral-400">
            {shareMetadata.expiresAt && (
              <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5">
                Expires: {new Date(shareMetadata.expiresAt).toLocaleDateString()}
              </span>
            )}
            <span className="rounded border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono">
              Model: {auditRun.modelVersion}
            </span>
          </div>
        </div>

        {/* Report Content */}
        <div className="fade-rise">
          <ReportView report={report.reportPayload} />
        </div>
      </main>
    </div>
  );
}

function SharedHeader({ onHome }: { onHome: () => void }) {
  return (
    <header className="border-b border-neutral-900 bg-neutral-950/90 backdrop-blur px-6 py-4">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <button
          type="button"
          onClick={onHome}
          aria-label="PagePilot — home"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <BrandMark />
        </button>
        <span className="rounded border border-neutral-800 bg-neutral-900/80 px-2.5 py-1 text-xs font-medium text-neutral-300">
          Public Report Viewer
        </span>
      </div>
    </header>
  );
}
