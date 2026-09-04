import { useState } from "react";
import type {
  CreatePageAnalyticsInput,
  PageAnalyticsSnapshot,
} from "@pagepilot/contracts";
import { createPageAnalytics } from "../api.js";

export interface ImportAnalyticsModalProps {
  projectId: string;
  pageId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (snapshot: PageAnalyticsSnapshot) => void;
  initialData?: PageAnalyticsSnapshot | null;
}

export function ImportAnalyticsModal({
  projectId,
  pageId,
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: ImportAnalyticsModalProps) {
  // Default period: past 30 days
  const defaultEnd = new Date().toISOString().split("T")[0]!;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]!;

  const [periodStart, setPeriodStart] = useState<string>(
    initialData?.periodStart
      ? initialData.periodStart.split("T")[0]!
      : thirtyDaysAgo,
  );
  const [periodEnd, setPeriodEnd] = useState<string>(
    initialData?.periodEnd ? initialData.periodEnd.split("T")[0]! : defaultEnd,
  );
  const [sessions, setSessions] = useState<string>(
    initialData?.sessions != null ? String(initialData.sessions) : "",
  );
  const [uniqueVisitors, setUniqueVisitors] = useState<string>(
    initialData?.uniqueVisitors != null ? String(initialData.uniqueVisitors) : "",
  );
  const [conversions, setConversions] = useState<string>(
    initialData?.conversions != null ? String(initialData.conversions) : "",
  );
  const [conversionRate, setConversionRate] = useState<string>(
    initialData?.conversionRate != null ? String(initialData.conversionRate) : "",
  );
  const [bounceRate, setBounceRate] = useState<string>(
    initialData?.bounceRate != null ? String(initialData.bounceRate) : "",
  );
  const [avgDurationSeconds, setAvgDurationSeconds] = useState<string>(
    initialData?.avgDurationSeconds != null
      ? String(initialData.avgDurationSeconds)
      : "",
  );
  const [notes, setNotes] = useState<string>(
    initialData?.provenance?.notes || "",
  );

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Auto-calculate conversion rate if sessions and conversions are provided
  const handleAutoCalcRate = () => {
    const s = Number(sessions);
    const c = Number(conversions);
    if (!isNaN(s) && s > 0 && !isNaN(c) && c >= 0) {
      const rate = ((c / s) * 100).toFixed(2);
      setConversionRate(rate);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Client-side validations
    if (!periodStart || !periodEnd) {
      setError("Please specify both period start and end dates.");
      return;
    }

    if (new Date(periodStart).getTime() > new Date(periodEnd).getTime()) {
      setError("Period start date must be before or equal to period end date.");
      return;
    }

    const sessNum = sessions.trim() !== "" ? Number(sessions) : null;
    if (sessNum != null && (isNaN(sessNum) || sessNum < 0)) {
      setError("Sessions must be 0 or a positive number.");
      return;
    }

    const crNum = conversionRate.trim() !== "" ? Number(conversionRate) : null;
    if (crNum != null && (isNaN(crNum) || crNum < 0 || crNum > 100)) {
      setError("Conversion rate must be between 0% and 100%.");
      return;
    }

    const brNum = bounceRate.trim() !== "" ? Number(bounceRate) : null;
    if (brNum != null && (isNaN(brNum) || brNum < 0 || brNum > 100)) {
      setError("Bounce rate must be between 0% and 100%.");
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: CreatePageAnalyticsInput = {
        sourceType: "manual",
        sourceProviderName: "Manual Entry",
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(
          new Date(periodEnd).setUTCHours(23, 59, 59, 999),
        ).toISOString(),
        sessions: sessNum,
        uniqueVisitors:
          uniqueVisitors.trim() !== "" ? Number(uniqueVisitors) : null,
        conversions: conversions.trim() !== "" ? Number(conversions) : null,
        conversionRate: crNum,
        bounceRate: brNum,
        avgDurationSeconds:
          avgDurationSeconds.trim() !== "" ? Number(avgDurationSeconds) : null,
        notes: notes.trim() !== "" ? notes.trim() : null,
      };

      const res = await createPageAnalytics(projectId, pageId, payload);
      if (res.analytics) {
        onSuccess(res.analytics);
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || "Failed to import analytics context.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-analytics-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="relative w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
          <div className="flex items-center gap-2.5">
            <h2
              id="import-analytics-title"
              className="text-lg font-bold tracking-tight text-neutral-100"
            >
              Import Page Analytics Context
            </h2>
            <span className="inline-flex items-center rounded-full border border-sky-500/40 bg-sky-950/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-sky-300 uppercase">
              IMPORTED DATA
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {/* Invariant Disclosure Banner */}
        <div className="mt-4 rounded-lg border border-sky-800/40 bg-sky-950/30 p-3 text-xs text-sky-200">
          <p className="font-semibold text-sky-300">Data Provenance Notice</p>
          <p className="mt-0.5 text-sky-200/80">
            Metrics entered here are explicitly labeled as{" "}
            <strong>IMPORTED DATA</strong> and are used exclusively to prioritize
            UX recommendations by business exposure. They do not alter PagePilot’s
            deterministic UX audit scores.
          </p>
        </div>

        {error && (
          <div
            className="mt-4 rounded-lg border border-rose-800/60 bg-rose-950/40 p-3 text-xs font-medium text-rose-300"
            role="alert"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Period Date Range */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="periodStart"
                className="block text-xs font-semibold text-neutral-300"
              >
                Period Start Date *
              </label>
              <input
                id="periodStart"
                type="date"
                required
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
            <div>
              <label
                htmlFor="periodEnd"
                className="block text-xs font-semibold text-neutral-300"
              >
                Period End Date *
              </label>
              <input
                id="periodEnd"
                type="date"
                required
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
          </div>

          {/* Traffic Metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="sessions"
                className="block text-xs font-semibold text-neutral-300"
              >
                Total Sessions (Traffic)
              </label>
              <input
                id="sessions"
                type="number"
                min="0"
                placeholder="e.g. 45000"
                value={sessions}
                onChange={(e) => setSessions(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
            <div>
              <label
                htmlFor="uniqueVisitors"
                className="block text-xs font-semibold text-neutral-300"
              >
                Unique Visitors (Optional)
              </label>
              <input
                id="uniqueVisitors"
                type="number"
                min="0"
                placeholder="e.g. 38000"
                value={uniqueVisitors}
                onChange={(e) => setUniqueVisitors(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
          </div>

          {/* Conversion Metrics */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="conversions"
                className="block text-xs font-semibold text-neutral-300"
              >
                Total Conversions
              </label>
              <input
                id="conversions"
                type="number"
                min="0"
                placeholder="e.g. 1120"
                value={conversions}
                onChange={(e) => setConversions(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label
                  htmlFor="conversionRate"
                  className="block text-xs font-semibold text-neutral-300"
                >
                  Conversion Rate (%)
                </label>
                {sessions && conversions && (
                  <button
                    type="button"
                    onClick={handleAutoCalcRate}
                    className="text-[11px] text-sky-400 hover:text-sky-300 underline"
                  >
                    Auto-calculate
                  </button>
                )}
              </div>
              <input
                id="conversionRate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="e.g. 2.45"
                value={conversionRate}
                onChange={(e) => setConversionRate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
          </div>

          {/* Bounce Rate & Duration */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="bounceRate"
                className="block text-xs font-semibold text-neutral-300"
              >
                Bounce Rate (%)
              </label>
              <input
                id="bounceRate"
                type="number"
                step="0.01"
                min="0"
                max="100"
                placeholder="e.g. 48.5"
                value={bounceRate}
                onChange={(e) => setBounceRate(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
            <div>
              <label
                htmlFor="avgDurationSeconds"
                className="block text-xs font-semibold text-neutral-300"
              >
                Avg. Session Duration (Seconds)
              </label>
              <input
                id="avgDurationSeconds"
                type="number"
                min="0"
                placeholder="e.g. 135"
                value={avgDurationSeconds}
                onChange={(e) => setAvgDurationSeconds(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="notes"
              className="block text-xs font-semibold text-neutral-300"
            >
              Context Notes (Optional)
            </label>
            <textarea
              id="notes"
              rows={2}
              maxLength={1000}
              placeholder="e.g. Baseline metrics following summer redesign campaign..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-white focus:outline-none focus:ring-1 focus:ring-white"
            />
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-xs font-semibold text-neutral-300 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Save Analytics Context"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
