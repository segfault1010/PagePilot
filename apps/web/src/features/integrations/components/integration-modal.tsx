import { useEffect, useRef, useState } from "react";
import type {
  AlertRuleType,
  CreateIntegrationInput,
  IntegrationConnection,
  IntegrationProvider,
  IntegrationStatus,
  Project,
  UpdateIntegrationInput,
} from "@pagepilot/contracts";
import { enforceUrlPolicy } from "@pagepilot/contracts";
import { IntegrationsApiClientError } from "../api.js";

export interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    data: (CreateIntegrationInput & { isOrganizationWide?: boolean }) | UpdateIntegrationInput,
  ) => Promise<void>;
  initialIntegration?: IntegrationConnection | null;
  currentProject: Project;
  isSaving: boolean;
}

interface AlertEventOption {
  key: AlertRuleType;
  label: string;
  severity: "high" | "medium";
  description: string;
}

const ALERT_EVENT_OPTIONS: AlertEventOption[] = [
  {
    key: "overall_score_drop",
    label: "Overall Score Drop ≥ 10",
    severity: "high",
    description: "Triggers when overall landing page UX score drops by 10 points or more.",
  },
  {
    key: "new_high_severity_finding",
    label: "New High-Severity Finding",
    severity: "high",
    description: "Triggers when a new critical conversion or accessibility barrier is detected.",
  },
  {
    key: "category_score_drop",
    label: "Category Score Drop ≥ 15",
    severity: "medium",
    description: "Triggers when any UX dimension drops by 15 points (High if drop ≥ 25).",
  },
  {
    key: "finding_severity_increased",
    label: "Finding Severity Escalated",
    severity: "medium",
    description: "Triggers when an existing finding's severity escalates to medium or high.",
  },
  {
    key: "signal_regressed",
    label: "Deterministic Signal Regressed",
    severity: "medium",
    description: "Triggers when a measured signal transitions from passing to warning.",
  },
  {
    key: "repeated_scan_failure",
    label: "3x Consecutive Scan Failures",
    severity: "high",
    description: "Triggers when a monitored page fails 3 consecutive scheduled scans.",
  },
];

const RECOMMENDED_EVENTS: AlertRuleType[] = [
  "overall_score_drop",
  "new_high_severity_finding",
];

export function IntegrationModal({
  isOpen,
  onClose,
  onSave,
  initialIntegration,
  currentProject,
  isSaving,
}: IntegrationModalProps) {
  const isEdit = Boolean(initialIntegration);

  // Form State
  const [provider, setProvider] = useState<IntegrationProvider>("slack");
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [channel, setChannel] = useState("");
  const [isOrganizationWide, setIsOrganizationWide] = useState(false);
  const [status, setStatus] = useState<IntegrationStatus>("active");
  const [selectedEvents, setSelectedEvents] = useState<AlertRuleType[]>(RECOMMENDED_EVENTS);

  // Validation / Error State
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const nameInputRef = useRef<HTMLInputElement>(null);

  // Synchronize state when opening modal
  useEffect(() => {
    if (!isOpen) return;

    if (initialIntegration) {
      setName(initialIntegration.name);
      setProvider(initialIntegration.provider);
      setTargetUrl(""); // Keep blank in edit mode to preserve existing credentials
      setSigningSecret("");
      setChannel(
        typeof initialIntegration.config?.channel === "string"
          ? initialIntegration.config.channel
          : "",
      );
      setIsOrganizationWide(!initialIntegration.projectId);
      setStatus(initialIntegration.status);
      setSelectedEvents(initialIntegration.events || RECOMMENDED_EVENTS);
    } else {
      setName("");
      setProvider("slack");
      setTargetUrl("");
      setSigningSecret("");
      setChannel("");
      setIsOrganizationWide(false);
      setStatus("active");
      setSelectedEvents(RECOMMENDED_EVENTS);
    }
    setFieldErrors({});
    setServerError(null);
    setShowSecret(false);

    // Autofocus
    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 50);
  }, [isOpen, initialIntegration]);

  // Keyboard dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isSaving) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const handleToggleEvent = (key: AlertRuleType) => {
    setSelectedEvents((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const handleSelectAllEvents = () => {
    setSelectedEvents(ALERT_EVENT_OPTIONS.map((o) => o.key));
  };

  const handleSelectRecommendedEvents = () => {
    setSelectedEvents(RECOMMENDED_EVENTS);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    const trimmedName = name.trim();
    if (!trimmedName) {
      errors.name = "Integration name is required.";
    } else if (trimmedName.length > 100) {
      errors.name = "Integration name must be 100 characters or fewer.";
    }

    const trimmedUrl = targetUrl.trim();
    if (!isEdit && !trimmedUrl) {
      errors.targetUrl = "Target destination URL is required.";
    } else if (trimmedUrl) {
      const urlCheck = enforceUrlPolicy(trimmedUrl);
      if (!urlCheck.ok) {
        errors.targetUrl = urlCheck.message;
      }
    }

    if (selectedEvents.length === 0) {
      errors.events = "At least one alert event must be selected.";
    }

    if (provider === "webhook" && signingSecret.trim().length > 256) {
      errors.signingSecret = "Signing secret must be 256 characters or fewer.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    setServerError(null);

    try {
      if (isEdit) {
        const updatePayload: UpdateIntegrationInput = {
          name: trimmedName,
          status,
          events: selectedEvents,
        };
        if (trimmedUrl) {
          updatePayload.targetUrl = trimmedUrl;
        }
        if (provider === "webhook" && signingSecret.trim()) {
          updatePayload.signingSecret = signingSecret.trim();
        }
        if (provider === "slack" && channel.trim()) {
          updatePayload.config = { channel: channel.trim() };
        }
        await onSave(updatePayload);
      } else {
        const createPayload: CreateIntegrationInput & { isOrganizationWide?: boolean } = {
          name: trimmedName,
          provider,
          targetUrl: trimmedUrl,
          events: selectedEvents,
          isOrganizationWide,
        };
        if (provider === "webhook" && signingSecret.trim()) {
          createPayload.signingSecret = signingSecret.trim();
        }
        if (provider === "slack" && channel.trim()) {
          createPayload.config = { channel: channel.trim() };
        }
        await onSave(createPayload);
      }
      onClose();
    } catch (err: any) {
      if (err instanceof IntegrationsApiClientError && err.code === "BLOCKED_DESTINATION") {
        setServerError(
          "Security Policy Violation: Target URL points to a private, loopback, or non-routable address. Only publicly routable destinations are permitted.",
        );
      } else {
        setServerError(err?.message || "Failed to save integration. Please check your settings.");
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl transition-all my-8 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-800 pb-4">
          <div>
            <h2
              id="integration-modal-title"
              className="text-lg font-semibold text-neutral-100"
            >
              {isEdit ? "Edit Integration" : "Add Alert Integration"}
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              {isEdit
                ? "Update notification triggers, destination, or status."
                : "Connect Slack or a generic HTTP webhook to receive proactive regression alerts."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition"
            aria-label="Close dialog"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Server Error Banner */}
        {serverError && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-300"
          >
            <div className="flex items-start gap-2">
              <svg
                className="h-4 w-4 shrink-0 text-red-400 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span>{serverError}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-5">
          {/* Provider Selection (Only when creating) */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-2">
                Integration Provider
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Slack Option */}
                <button
                  type="button"
                  onClick={() => setProvider("slack")}
                  className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                    provider === "slack"
                      ? "border-emerald-500 bg-emerald-950/20 ring-1 ring-emerald-500/50"
                      : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-950/40 text-emerald-400">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-neutral-200">
                      Slack Webhook
                    </div>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Formatted Block Kit cards delivered to your Slack channels.
                    </p>
                  </div>
                </button>

                {/* Custom Webhook Option */}
                <button
                  type="button"
                  onClick={() => setProvider("webhook")}
                  className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                    provider === "webhook"
                      ? "border-purple-500 bg-purple-950/20 ring-1 ring-purple-500/50"
                      : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                  }`}
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-950/40 text-purple-400">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-neutral-200">
                      Custom Webhook
                    </div>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      HTTP POST payload signed with HMAC-SHA256 headers.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Integration Name */}
          <div>
            <label
              htmlFor="integration-name"
              className="block text-xs font-medium text-neutral-300"
            >
              Integration Name <span className="text-red-400">*</span>
            </label>
            <input
              id="integration-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Growth Team Slack Alerts"
              maxLength={100}
              disabled={isSaving}
              className={`mt-1.5 w-full rounded-lg border bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 transition focus-visible:outline-none focus-visible:ring-2 ${
                fieldErrors.name
                  ? "border-red-500 focus-visible:ring-red-500"
                  : "border-neutral-800 focus-visible:ring-neutral-400"
              }`}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.name}</p>
            )}
          </div>

          {/* Scope Selector (Only when creating) */}
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-2">
                Alert Dispatch Scope
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setIsOrganizationWide(false)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition ${
                    !isOrganizationWide
                      ? "border-sky-500/80 bg-sky-950/20 ring-1 ring-sky-500/40"
                      : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    checked={!isOrganizationWide}
                    onChange={() => setIsOrganizationWide(false)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-neutral-200">
                      Project-Scoped
                    </div>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Only alerts for monitored pages in <strong>{currentProject.name}</strong>.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setIsOrganizationWide(true)}
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition ${
                    isOrganizationWide
                      ? "border-purple-500/80 bg-purple-950/20 ring-1 ring-purple-500/40"
                      : "border-neutral-800 bg-neutral-950/40 hover:border-neutral-700"
                  }`}
                >
                  <input
                    type="radio"
                    name="scope"
                    checked={isOrganizationWide}
                    onChange={() => setIsOrganizationWide(true)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-xs font-medium text-neutral-200">
                      Organization-Wide
                    </div>
                    <p className="mt-0.5 text-[11px] text-neutral-400">
                      Delivers alerts for all monitored pages across all workspace projects.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Target URL */}
          <div>
            <label
              htmlFor="integration-target-url"
              className="block text-xs font-medium text-neutral-300"
            >
              Destination URL {!isEdit && <span className="text-red-400">*</span>}
            </label>
            <input
              id="integration-target-url"
              type="text"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={
                isEdit
                  ? initialIntegration?.maskedTargetUrl
                  : provider === "slack"
                    ? "https://hooks.slack.com/services/your/webhook/url"
                    : "https://api.yourdomain.com/webhooks/pagepilot"
              }
              disabled={isSaving}
              className={`mt-1.5 w-full rounded-lg border bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100 placeholder-neutral-500 transition focus-visible:outline-none focus-visible:ring-2 ${
                fieldErrors.targetUrl
                  ? "border-red-500 focus-visible:ring-red-500"
                  : "border-neutral-800 focus-visible:ring-neutral-400"
              }`}
            />
            {fieldErrors.targetUrl ? (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.targetUrl}</p>
            ) : isEdit ? (
              <p className="mt-1 text-[11px] text-neutral-500">
                Leave blank to keep existing encrypted URL ({initialIntegration?.maskedTargetUrl}).
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-neutral-500">
                Must be a publicly routable https:// destination. Encrypted at rest via AES-256-GCM.
              </p>
            )}
          </div>

          {/* Optional Slack Channel */}
          {provider === "slack" && (
            <div>
              <label
                htmlFor="integration-slack-channel"
                className="block text-xs font-medium text-neutral-300"
              >
                Slack Channel Name <span className="text-neutral-500">(Optional)</span>
              </label>
              <input
                id="integration-slack-channel"
                type="text"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="e.g. #ux-alerts or @lead-engineer"
                disabled={isSaving}
                className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                Informational label used in workspace notifications and cards.
              </p>
            </div>
          )}

          {/* Optional Webhook Signing Secret */}
          {provider === "webhook" && (
            <div>
              <label
                htmlFor="integration-signing-secret"
                className="block text-xs font-medium text-neutral-300"
              >
                HMAC-SHA256 Signing Secret <span className="text-neutral-500">(Optional)</span>
              </label>
              <div className="relative mt-1.5">
                <input
                  id="integration-signing-secret"
                  type={showSecret ? "text" : "password"}
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  placeholder={
                    isEdit && initialIntegration?.hasSigningSecret
                      ? "•••••••••••••••• (leave blank to keep)"
                      : "e.g. whsec_secret_key_123456"
                  }
                  maxLength={256}
                  disabled={isSaving}
                  className={`w-full rounded-lg border bg-neutral-950 px-3 py-2 pr-10 font-mono text-xs text-neutral-100 placeholder-neutral-500 focus-visible:outline-none focus-visible:ring-2 ${
                    fieldErrors.signingSecret
                      ? "border-red-500 focus-visible:ring-red-500"
                      : "border-neutral-800 focus-visible:ring-neutral-400"
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-200"
                  title={showSecret ? "Hide secret" : "Reveal secret"}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {showSecret ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    )}
                  </svg>
                </button>
              </div>
              {fieldErrors.signingSecret ? (
                <p className="mt-1 text-[11px] text-red-400">{fieldErrors.signingSecret}</p>
              ) : (
                <p className="mt-1 text-[11px] text-neutral-500">
                  Used to generate <code className="text-neutral-400 font-mono">X-PagePilot-Signature: sha256=...</code> for anti-tamper verification.
                </p>
              )}
            </div>
          )}

          {/* Subscribed Alert Events Checkbox Group */}
          <div>
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-neutral-300">
                Subscribed Alert Triggers <span className="text-red-400">*</span>
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={handleSelectRecommendedEvents}
                  className="text-neutral-400 hover:text-neutral-200 transition"
                >
                  Defaults
                </button>
                <span className="text-neutral-600">|</span>
                <button
                  type="button"
                  onClick={handleSelectAllEvents}
                  className="text-neutral-400 hover:text-neutral-200 transition"
                >
                  Select All
                </button>
              </div>
            </div>

            {fieldErrors.events && (
              <p className="mt-1 text-[11px] text-red-400">{fieldErrors.events}</p>
            )}

            <div className="mt-2 space-y-2 rounded-xl border border-neutral-800 bg-neutral-950/40 p-3">
              {ALERT_EVENT_OPTIONS.map((option) => {
                const isSelected = selectedEvents.includes(option.key);
                return (
                  <label
                    key={option.key}
                    className={`flex items-start gap-2.5 rounded-lg p-2 transition cursor-pointer ${
                      isSelected ? "bg-neutral-900" : "hover:bg-neutral-900/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleEvent(option.key)}
                      disabled={isSaving}
                      className="mt-0.5 rounded border-neutral-700 text-white focus:ring-white"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-neutral-200">
                          {option.label}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wider ${
                            option.severity === "high"
                              ? "bg-red-950 text-red-400 border border-red-900/60"
                              : "bg-amber-950 text-amber-400 border border-amber-900/60"
                          }`}
                        >
                          {option.severity}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-neutral-400">
                        {option.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Status Switch (Active / Disabled) */}
          <div className="flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950/40 p-3.5">
            <div>
              <span className="text-xs font-medium text-neutral-200">
                Integration Status
              </span>
              <p className="mt-0.5 text-[11px] text-neutral-400">
                When active, regression alerts will immediately dispatch to this destination.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status === "active"}
              onClick={() =>
                setStatus((s) => (s === "active" ? "disabled" : "active"))
              }
              disabled={isSaving}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                status === "active" ? "bg-emerald-600" : "bg-neutral-700"
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  status === "active" ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-neutral-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-neutral-950 shadow-sm transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <svg
                    className="h-3.5 w-3.5 animate-spin text-neutral-950"
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
                  <span>Saving...</span>
                </>
              ) : (
                <span>{isEdit ? "Save Changes" : "Create Integration"}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
