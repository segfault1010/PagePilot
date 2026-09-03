import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CreateIntegrationInput,
  IntegrationConnection,
  Project,
  Role,
  TestIntegrationResponse,
  UpdateIntegrationInput,
} from "@pagepilot/contracts";
import {
  createIntegration,
  deleteIntegration,
  listIntegrations,
  testIntegration,
  updateIntegration,
} from "../api.js";
import { IntegrationCard } from "./integration-card";
import { IntegrationModal } from "./integration-modal";
import { DeleteIntegrationModal } from "./delete-integration-modal";

export interface IntegrationsManagerProps {
  project: Project;
  role: Role;
  availableProjects?: Project[];
  onSelectProject?: (projectId: string) => void;
  onBack?: () => void;
}

export function IntegrationsManager({
  project,
  role,
  availableProjects,
  onSelectProject,
  onBack,
}: IntegrationsManagerProps) {
  const canManage = role === "owner" || role === "admin";

  // Data State
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<"all" | "slack" | "webhook">("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "org" | "project">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">("all");

  // Modal States
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingIntegration, setEditingIntegration] = useState<IntegrationConnection | null>(null);
  const [deletingIntegration, setDeletingIntegration] = useState<IntegrationConnection | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Test Ping State
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testFeedback, setTestFeedback] = useState<{
    integrationId: string;
    integrationName: string;
    provider: string;
    result: TestIntegrationResponse;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Load Integrations
  // ---------------------------------------------------------------------------
  const fetchIntegrations = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await listIntegrations(project.id);
      setIntegrations(res.integrations);
    } catch (err: any) {
      console.error("[integrations] failed to load integrations:", err);
      setErrorMessage(err?.message || "Failed to load integrations.");
    } finally {
      setIsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  // ---------------------------------------------------------------------------
  // Create / Update Handler
  // ---------------------------------------------------------------------------
  const handleSave = async (
    data: (CreateIntegrationInput & { isOrganizationWide?: boolean }) | UpdateIntegrationInput,
  ) => {
    setIsSaving(true);
    try {
      if (editingIntegration) {
        const res = await updateIntegration(
          project.id,
          editingIntegration.id,
          data as UpdateIntegrationInput,
        );
        setIntegrations((prev) =>
          prev.map((i) => (i.id === res.integration.id ? res.integration : i)),
        );
      } else {
        const res = await createIntegration(
          project.id,
          data as CreateIntegrationInput,
        );
        setIntegrations((prev) => [res.integration, ...prev]);
      }
      setIsCreateOpen(false);
      setEditingIntegration(null);
    } finally {
      setIsSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete Handler
  // ---------------------------------------------------------------------------
  const handleConfirmDelete = async () => {
    if (!deletingIntegration) return;
    setIsDeleting(true);
    try {
      await deleteIntegration(project.id, deletingIntegration.id);
      setIntegrations((prev) =>
        prev.filter((i) => i.id !== deletingIntegration.id),
      );
      if (testFeedback?.integrationId === deletingIntegration.id) {
        setTestFeedback(null);
      }
      setDeletingIntegration(null);
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to delete integration.");
    } finally {
      setIsDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Status Toggle Handler
  // ---------------------------------------------------------------------------
  const handleToggleStatus = async (integration: IntegrationConnection) => {
    if (!canManage) return;
    const nextStatus = integration.status === "active" ? "disabled" : "active";
    try {
      const res = await updateIntegration(project.id, integration.id, {
        status: nextStatus,
      });
      setIntegrations((prev) =>
        prev.map((i) => (i.id === res.integration.id ? res.integration : i)),
      );
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to update integration status.");
    }
  };

  // ---------------------------------------------------------------------------
  // Test Ping Handler
  // ---------------------------------------------------------------------------
  const handleTestPing = async (integration: IntegrationConnection) => {
    if (!canManage) return;
    setTestingId(integration.id);
    setTestFeedback(null);
    try {
      const result = await testIntegration(project.id, integration.id);
      setTestFeedback({
        integrationId: integration.id,
        integrationName: integration.name,
        provider: integration.provider,
        result,
      });
    } catch (err: any) {
      setTestFeedback({
        integrationId: integration.id,
        integrationName: integration.name,
        provider: integration.provider,
        result: {
          success: false,
          latencyMs: 0,
          error: err?.message || "Test ping failed.",
        },
      });
    } finally {
      setTestingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtered List Computation
  // ---------------------------------------------------------------------------
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((item) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesUrl = item.maskedTargetUrl.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl) return false;
      }

      // Provider
      if (providerFilter !== "all" && item.provider !== providerFilter) {
        return false;
      }

      // Scope
      if (scopeFilter === "org" && item.projectId !== null) {
        return false;
      }
      if (scopeFilter === "project" && item.projectId === null) {
        return false;
      }

      // Status
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [integrations, searchQuery, providerFilter, scopeFilter, statusFilter]);

  const activeCount = useMemo(
    () => integrations.filter((i) => i.status === "active").length,
    [integrations],
  );

  return (
    <div className="space-y-6">
      {/* Top Banner / Breadcrumbs if back supported */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="mr-1 text-neutral-400 hover:text-neutral-200 transition"
                title="Back to project"
              >
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
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
            )}
            <h1 className="text-xl font-bold text-neutral-100">
              Integrations & Outbound Alerts
            </h1>
            <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-0.5 text-xs font-semibold text-neutral-300">
              {activeCount} Active
            </span>
          </div>
          <p className="mt-1 text-xs text-neutral-400">
            Dispatch real-time UX regression alerts to Slack channels and custom HTTP webhooks.
          </p>
        </div>

        {/* Project Selector (if multiple available) & Add Integration CTA */}
        <div className="flex items-center gap-3">
          {availableProjects && availableProjects.length > 1 && onSelectProject && (
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <span>Project:</span>
              <select
                value={project.id}
                onChange={(e) => onSelectProject(e.target.value)}
                className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
              >
                {availableProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-xs font-semibold text-neutral-950 shadow-sm transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add Integration</span>
            </button>
          )}
        </div>
      </div>

      {/* Error Notice */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-xs text-red-300"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="rounded px-2 py-1 text-red-400 hover:text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Test Ping Feedback Alert Card */}
      {testFeedback && (
        <div
          role="region"
          aria-label="Test Ping Result"
          className={`relative rounded-xl border p-4 text-xs transition-all ${
            testFeedback.result.success
              ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-200"
              : "border-red-500/40 bg-red-950/30 text-red-200"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  testFeedback.result.success
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {testFeedback.result.success ? (
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">
                    {testFeedback.result.success
                      ? "Test Ping Succeeded"
                      : "Test Ping Failed"}
                  </span>
                  <span className="rounded bg-neutral-900/80 px-2 py-0.5 text-[10px] font-mono">
                    {testFeedback.result.latencyMs} ms
                  </span>
                  {testFeedback.result.statusCode && (
                    <span className="rounded bg-neutral-900/80 px-2 py-0.5 text-[10px] font-mono">
                      HTTP {testFeedback.result.statusCode}
                    </span>
                  )}
                </div>

                <p className="mt-1 text-xs opacity-90">
                  {testFeedback.result.success ? (
                    <span>
                      Sample notification payload successfully delivered to{" "}
                      <strong>{testFeedback.integrationName}</strong>. Alert triggers are verified.
                    </span>
                  ) : (
                    <span>
                      Delivery to <strong>{testFeedback.integrationName}</strong> failed:{" "}
                      {testFeedback.result.error || "Unknown transport or connection error."}
                    </span>
                  )}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setTestFeedback(null)}
              className="text-neutral-400 hover:text-neutral-200 transition"
              aria-label="Dismiss test ping feedback"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-3">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by integration name or URL..."
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 py-1.5 pl-9 pr-3 text-xs text-neutral-200 placeholder-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
          />
        </div>

        {/* Filters Group */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Provider Filter */}
          <div className="flex rounded-lg border border-neutral-800 bg-neutral-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setProviderFilter("all")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                providerFilter === "all"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setProviderFilter("slack")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                providerFilter === "slack"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Slack
            </button>
            <button
              type="button"
              onClick={() => setProviderFilter("webhook")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                providerFilter === "webhook"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Webhook
            </button>
          </div>

          {/* Scope Filter */}
          <div className="flex rounded-lg border border-neutral-800 bg-neutral-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setScopeFilter("all")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                scopeFilter === "all"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              All Scopes
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter("org")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                scopeFilter === "org"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Org-Wide
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter("project")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                scopeFilter === "project"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              This Project
            </button>
          </div>

          {/* Status Filter */}
          <div className="flex rounded-lg border border-neutral-800 bg-neutral-950 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                statusFilter === "all"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              All Status
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                statusFilter === "active"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("disabled")}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                statusFilter === "disabled"
                  ? "bg-neutral-800 text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              Disabled
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-48 rounded-xl border border-neutral-800 bg-neutral-900/30 p-5 animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-neutral-800" />
                <div className="space-y-2">
                  <div className="h-4 w-32 rounded bg-neutral-800" />
                  <div className="h-3 w-20 rounded bg-neutral-850" />
                </div>
              </div>
              <div className="mt-4 h-8 rounded bg-neutral-850" />
              <div className="mt-4 h-6 w-48 rounded bg-neutral-850" />
            </div>
          ))}
        </div>
      ) : integrations.length === 0 ? (
        /* Empty State: Zero Integrations */
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/20 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-400">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-sm font-semibold text-neutral-200">
            No Integrations Configured
          </h3>
          <p className="mt-1.5 max-w-md text-xs text-neutral-400">
            Connect Slack or generic HTTP webhooks to receive proactive alerts when landing page UX scores drop or high-severity regressions are detected.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-neutral-950 shadow-sm transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
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
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add Your First Integration</span>
            </button>
          )}
        </div>
      ) : filteredIntegrations.length === 0 ? (
        /* Empty State: Filter yielded no matches */
        <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900/30 p-10 text-center">
          <p className="text-xs text-neutral-400">
            No integrations match your current filter criteria.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setProviderFilter("all");
              setScopeFilter("all");
              setStatusFilter("all");
            }}
            className="mt-3 text-xs font-medium text-white hover:underline"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        /* Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredIntegrations.map((item) => (
            <IntegrationCard
              key={item.id}
              integration={item}
              role={role}
              isTesting={testingId === item.id}
              onTestPing={handleTestPing}
              onEdit={(int) => setEditingIntegration(int)}
              onDelete={(int) => setDeletingIntegration(int)}
              onToggleStatus={handleToggleStatus}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {(isCreateOpen || editingIntegration) && (
        <IntegrationModal
          isOpen={isCreateOpen || Boolean(editingIntegration)}
          onClose={() => {
            setIsCreateOpen(false);
            setEditingIntegration(null);
          }}
          onSave={handleSave}
          initialIntegration={editingIntegration}
          currentProject={project}
          isSaving={isSaving}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingIntegration && (
        <DeleteIntegrationModal
          isOpen={Boolean(deletingIntegration)}
          onClose={() => setDeletingIntegration(null)}
          onConfirm={handleConfirmDelete}
          integration={deletingIntegration}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
