import type { Report } from "@pagepilot/contracts";
import { CategoryGrid } from "./category-grid";
import { DetailedRecommendations } from "./detailed-recommendations";
import { ObservedSignals } from "./observed-signals";
import { QuickWins } from "./quick-wins";
import { ReportHeader } from "./report-header";
import { TopProblems } from "./top-problems";

/**
 * Report hierarchy, most to least important:
 * verdict → top problems → category scores → quick wins →
 * detailed recommendations → methodology disclosure.
 */
export function ReportView({
  report,
  onAnalyzeAnother,
}: {
  report: Report;
  onAnalyzeAnother?: () => void;
}) {
  return (
    <div>
      <ReportHeader report={report} />

      <TopProblems problems={report.topProblems} />

      <CategoryGrid categories={report.categories} />

      <QuickWins quickWins={report.quickWins} />

      <DetailedRecommendations recommendations={report.detailedRecommendations} />

      <ObservedSignals signals={report.observedSignals} />

      {onAnalyzeAnother && (
        <div className="mt-12 text-center">
          <button
            type="button"
            onClick={onAnalyzeAnother}
            className="h-11 rounded-lg border border-neutral-700 px-6 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
          >
            Analyze another website
          </button>
        </div>
      )}
    </div>
  );
}
