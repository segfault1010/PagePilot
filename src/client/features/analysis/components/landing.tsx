import { sampleReport } from "../../../../shared/sample-report";
import { Badge } from "./badge";
import { BrandMark } from "./brand-mark";
import { ReportView } from "./report-view";
import { UrlForm } from "./url-form";

export function Landing({
  initialUrl,
  onAnalyze,
}: {
  initialUrl: string;
  onAnalyze: (url: string) => void;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <a
          href="/"
          aria-label="PagePilot home"
          className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
        >
          <BrandMark />
        </a>
        <span className="text-xs font-medium uppercase tracking-widest text-neutral-600">
          MVP preview
        </span>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-3xl px-6 pb-14 pt-10 text-center sm:pb-16 sm:pt-16">
          <p className="fade-rise mx-auto w-fit rounded-full border border-neutral-800 px-3.5 py-1 text-xs font-medium uppercase tracking-widest text-neutral-400">
            AI-powered UX audits
          </p>
          <h1
            className="fade-rise mt-5 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-neutral-50 sm:text-5xl lg:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            Find what's hurting your landing page.
          </h1>
          <p
            className="fade-rise mx-auto mt-4 max-w-xl text-pretty text-base leading-7 text-neutral-400 sm:text-lg sm:leading-8"
            style={{ animationDelay: "120ms" }}
          >
            PagePilot uses AI to audit your landing page and turn UX problems
            into actionable fixes.
          </p>
          <div
            className="fade-rise mx-auto mt-8 max-w-xl"
            style={{ animationDelay: "180ms" }}
          >
            <UrlForm initialValue={initialUrl} onSubmit={onAnalyze} />
          </div>
          <p className="mt-3 text-xs text-neutral-600">
            Paste a public URL. Nothing is stored — reports are generated on
            the fly.
          </p>
        </section>

        <section
          className="mx-auto w-full max-w-6xl px-6 pb-20"
          aria-labelledby="example-report-heading"
        >
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
              A report you can act on
            </h2>
            <p className="mt-3 text-sm leading-6 text-neutral-400 sm:text-base sm:leading-7">
              Every audit blends measurable page signals with AI
              interpretation, scored across seven UX categories. Here's an
              example:
            </p>
          </div>
          <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-4 sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-4">
              <span className="text-xs font-medium uppercase tracking-widest text-neutral-500">
                Example report
              </span>
              <Badge tone="outline">Sample data</Badge>
            </div>
            <ReportView report={sampleReport} />
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-900">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 text-center text-xs text-neutral-600 sm:text-left">
          <p>© 2026 PagePilot</p>
        </div>
      </footer>
    </div>
  );
}
