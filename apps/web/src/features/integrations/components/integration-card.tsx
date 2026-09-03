import { useState } from "react";
import type { IntegrationConnection, Role } from "@pagepilot/contracts";

export interface IntegrationCardProps {
  integration: IntegrationConnection;
  role: Role;
  isTesting: boolean;
  onTestPing: (integration: IntegrationConnection) => void;
  onEdit: (integration: IntegrationConnection) => void;
  onDelete: (integration: IntegrationConnection) => void;
  onToggleStatus: (integration: IntegrationConnection) => void;
}

const EVENT_LABELS: Record<string, string> = {
  overall_score_drop: "Overall Score Drop ≥ 10",
  category_score_drop: "Category Score Drop ≥ 15",
  new_high_severity_finding: "New High-Severity Finding",
  finding_severity_increased: "Severity Escalated",
  signal_regressed: "Signal Regressed",
  repeated_scan_failure: "3x Consecutive Failures",
};

export function IntegrationCard({
  integration,
  role,
  isTesting,
  onTestPing,
  onEdit,
  onDelete,
  onToggleStatus,
}: IntegrationCardProps) {
  const canManage = role === "owner" || role === "admin";
  const isOrgWide = !integration.projectId;
  const isActive = integration.status === "active";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(integration.maskedTargetUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const channel =
    typeof integration.config?.channel === "string"
      ? integration.config.channel
      : null;

  return (
    <div
      data-testid={`integration-card-${integration.id}`}
      className={`group relative flex flex-col justify-between rounded-xl border p-5 transition-all ${
        isActive
          ? "border-neutral-800 bg-neutral-900/60 hover:border-neutral-700"
          : "border-neutral-800/60 bg-neutral-950/40 opacity-75"
      }`}
    >
      <div>
        {/* Top Header: Provider Icon, Name, Scope Badge, Status Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            {/* Provider Icon */}
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
                integration.provider === "slack"
                  ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-400"
                  : "border-purple-500/30 bg-purple-950/40 text-purple-400"
              }`}
            >
              {integration.provider === "slack" ? (
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              )}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-neutral-100">
                  {integration.name}
                </h3>
                {channel && (
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] font-mono text-neutral-300">
                    {channel}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-neutral-400 capitalize">
                {integration.provider === "slack"
                  ? "Slack Incoming Webhook"
                  : "Generic HTTP Webhook"}
              </p>
            </div>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Scope Badge */}
            {isOrgWide ? (
              <span className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-950/40 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                Org-Wide
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-950/40 px-2 py-0.5 text-[10px] font-medium text-sky-300">
                Project-Scoped
              </span>
            )}

            {/* Status Badge */}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                isActive
                  ? "border border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
                  : "border border-neutral-700 bg-neutral-800 text-neutral-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isActive ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
                }`}
              />
              {isActive ? "Active" : "Disabled"}
            </span>

            {/* HMAC Badge */}
            {integration.hasSigningSecret && (
              <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                HMAC Signed
              </span>
            )}
          </div>
        </div>

        {/* Masked Destination URL */}
        <div className="mt-4 flex items-center justify-between rounded-lg border border-neutral-800/80 bg-neutral-950/70 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="text-neutral-500">Destination:</span>
            <span
              className="truncate font-mono text-[11px] text-neutral-300"
              title={integration.maskedTargetUrl}
            >
              {integration.maskedTargetUrl}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            title="Copy masked URL"
            className="ml-2 shrink-0 text-neutral-400 hover:text-neutral-200 transition"
          >
            {copied ? (
              <span className="text-[10px] text-emerald-400">Copied</span>
            ) : (
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Subscribed Events */}
        <div className="mt-4">
          <span className="text-[11px] font-medium text-neutral-400">
            Subscribed Alert Triggers ({integration.events.length})
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {integration.events.map((eventKey) => (
              <span
                key={eventKey}
                className="rounded-md border border-neutral-800 bg-neutral-900/90 px-2 py-0.5 text-[10px] text-neutral-300"
              >
                {EVENT_LABELS[eventKey] || eventKey}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Footer Controls: Test Ping & Edit / Status / Delete Actions */}
      <div className="mt-5 flex items-center justify-between border-t border-neutral-800/80 pt-3 text-xs">
        {/* Test Ping Button */}
        <button
          type="button"
          onClick={() => onTestPing(integration)}
          disabled={!canManage || isTesting}
          title={
            !canManage
              ? "Only workspace owners and admins can dispatch test pings."
              : "Send a sample ping to verify endpoint connectivity and payload delivery."
          }
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium transition ${
            !canManage
              ? "cursor-not-allowed border-neutral-800 bg-neutral-900/40 text-neutral-500"
              : isTesting
                ? "cursor-wait border-neutral-700 bg-neutral-800 text-neutral-300"
                : "border-neutral-700 bg-neutral-800/80 text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          }`}
        >
          {isTesting ? (
            <>
              <svg
                className="h-3.5 w-3.5 animate-spin text-neutral-400"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              <span>Testing...</span>
            </>
          ) : (
            <>
              <svg
                className="h-3.5 w-3.5 text-neutral-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span>Test Ping</span>
            </>
          )}
        </button>

        {/* Management Controls (Owner/Admin) */}
        {canManage && (
          <div className="flex items-center gap-2">
            {/* Quick Status Toggle */}
            <button
              type="button"
              onClick={() => onToggleStatus(integration)}
              className="rounded px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 transition"
              title={isActive ? "Disable integration" : "Enable integration"}
            >
              {isActive ? "Disable" : "Enable"}
            </button>

            {/* Edit Button */}
            <button
              type="button"
              onClick={() => onEdit(integration)}
              className="rounded px-2 py-1 text-xs font-medium text-neutral-300 hover:text-white transition"
              title="Edit integration configuration"
            >
              Edit
            </button>

            {/* Delete Button */}
            <button
              type="button"
              onClick={() => onDelete(integration)}
              className="rounded px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 transition"
              title="Delete integration"
            >
              Delete
            </button>
          </div>
        )}

        {!canManage && (
          <span className="text-[11px] text-neutral-500 italic">Read-only</span>
        )}
      </div>
    </div>
  );
}
