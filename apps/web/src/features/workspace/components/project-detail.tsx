import { useCallback, useEffect, useState } from "react";
import type {
  CreateMonitoredPageInput,
  MonitoredPage,
  OrganizationMember,
  Project,
  Role,
  UpdateMonitoredPageInput,
  WorkItem,
} from "@pagepilot/contracts";
import { MonitoredPageModal } from "./monitored-page-modal";
import { DeleteConfirmModal } from "./delete-confirm-modal";
import { listWorkItems } from "../../work-items/api";
import { WorkItemDetailModal } from "../../work-items/components/work-item-detail-modal";
import { IntegrationsManager } from "../../integrations/components/integrations-manager";

export interface ProjectDetailProps {
  project: Project;
  pages: MonitoredPage[];
  role: Role;
  isLoading: boolean;
  members?: OrganizationMember[];
  onBackToProjects: () => void;
  onSelectPage: (page: MonitoredPage) => void;
  onComparePage?: (page: MonitoredPage, runId: string, compareRunId?: string) => void;
  onCreatePage: (data: CreateMonitoredPageInput) => Promise<void>;
  onUpdatePage: (pageId: string, data: UpdateMonitoredPageInput) => Promise<void>;
  onDeletePage: (pageId: string) => Promise<void>;
}

const CATEGORY_NAMES: Record<string, string> = {
  clarity: "Clarity",
  visualHierarchy: "Visual Hierarchy",
  ctaEffectiveness: "CTA Effectiveness",
  copy: "Copy",
  accessibility: "Accessibility",
  mobileUx: "Mobile UX",
  trustCredibility: "Trust",
};

export function ProjectDetail({
  project,
  pages,
  role,
  isLoading,
  members = [],
  onBackToProjects,
  onSelectPage,
  onComparePage,
  onCreatePage,
  onUpdatePage,
  onDeletePage,
}: ProjectDetailProps) {
  const [activeTab, setActiveTab] = useState<"priorities" | "pages" | "integrations">("priorities");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<MonitoredPage | null>(null);
  const [deletingPage, setDeletingPage] = useState<MonitoredPage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Project Work Items State
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [isLoadingWorkItems, setIsLoadingWorkItems] = useState(false);
  const [selectedWorkItem, setSelectedWorkItem] = useState<WorkItem | null>(null);

  const canManage = role !== "viewer";

  const fetchWorkItems = useCallback(async () => {
    setIsLoadingWorkItems(true);
    try {
      const res = await listWorkItems(project.id);
      setWorkItems(res.workItems);
    } catch (err: any) {
      console.error("[project-detail] failed to load work items:", err);
    } finally {
      setIsLoadingWorkItems(false);
    }
  }, [project.id]);

  useEffect(() => {
    fetchWorkItems();
  }, [fetchWorkItems]);

  const handleOpenAdd = () => {
    setEditingPage(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (page: MonitoredPage, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPage(page);
    setModalOpen(true);
  };

  const handleOpenDelete = (page: MonitoredPage, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingPage(page);
  };

  const handleToggleStatus = async (page: MonitoredPage, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManage) return;
    const nextStatus = page.status === "active" ? "paused" : "active";
    await onUpdatePage(page.id, { status: nextStatus });
  };

  const handleSave = async (data: CreateMonitoredPageInput | UpdateMonitoredPageInput) => {
    setIsSaving(true);
    try {
      if (editingPage) {
        await onUpdatePage(editingPage.id, data);
      } else {
        await onCreatePage(data as CreateMonitoredPageInput);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPage) return;
    setIsDeleting(true);
    try {
      await onDeletePage(deletingPage.id);
      setDeletingPage(null);
    } finally {
      setIsDeleting(false);
    }
  };

  // Deterministic Prioritization Calculations
  const openWorkItems = workItems
    .filter((item) => item.status === "open" || item.status === "in_progress")
    .sort((a, b) => {
      // 1. Severity rank: high (3) > medium (2) > low (1)
      const rankA = a.severity === "high" ? 3 : a.severity === "medium" ? 2 : 1;
      const rankB = b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1;
      if (rankB !== rankA) return rankB - rankA;
      // 2. Recency: updatedAt descending
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const highSeverityOpenCount = openWorkItems.filter((i) => i.severity === "high").length;

  const resolvedWorkItems = workItems
    .filter((item) => item.status === "resolved")
    .sort((a, b) => (b.resolvedAt || b.updatedAt).localeCompare(a.resolvedAt || a.updatedAt));

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Navigation */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button
            type="button"
            onClick={onBackToProjects}
            className="inline-flex items-center gap-1.5 text-xs text-neutral-400 transition hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            &larr; Back to Projects
          </button>
          <h1 className="mt-2 text-xl font-bold tracking-tight text-neutral-100 sm:text-2xl">
            {project.name}
          </h1>
          {project.domain && (
            <p className="mt-0.5 text-xs text-neutral-400">{project.domain}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {canManage && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex items-center justify-center rounded-lg bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              + Add Page
            </button>
          )}
        </div>
      </div>

      {project.goals && (
        <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-4 text-xs text-neutral-300">
          <span className="font-semibold text-neutral-200">Goals: </span>
          {project.goals}
        </div>
      )}

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
            Monitored Pages
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-100">{pages.length}</span>
            <span className="text-[10px] text-neutral-400">
              ({pages.filter((p) => p.status === "active").length} active)
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
            Open Work Items
          </span>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-neutral-100">{openWorkItems.length}</span>
            {highSeverityOpenCount > 0 && (
              <span className="text-[10px] font-semibold text-red-400">
                ({highSeverityOpenCount} High)
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
            Audited Pages
          </span>
          <div className="mt-1 text-2xl font-bold text-neutral-100">
            {pages.filter((p) => Boolean(p.latestSuccessfulAuditRunId)).length}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4">
          <span className="text-[11px] font-medium uppercase tracking-wider text-neutral-400">
            Resolved Improvements
          </span>
          <div className="mt-1 text-2xl font-bold text-emerald-400">
            {resolvedWorkItems.length}
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-3 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab("priorities")}
          className={`rounded-lg px-3 py-1.5 font-medium transition ${
            activeTab === "priorities"
              ? "bg-neutral-800 text-neutral-100 font-semibold"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Overview & Priorities
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("pages")}
          className={`rounded-lg px-3 py-1.5 font-medium transition ${
            activeTab === "pages"
              ? "bg-neutral-800 text-neutral-100 font-semibold"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Monitored Pages ({pages.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("integrations")}
          className={`rounded-lg px-3 py-1.5 font-medium transition ${
            activeTab === "integrations"
              ? "bg-neutral-800 text-neutral-100 font-semibold"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          Integrations
        </button>
      </div>

      {/* Tab 1: Overview & Priorities */}
      {activeTab === "priorities" && (
        <div className="space-y-8">
          {/* Section 1: Highest-Impact Open Work */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-neutral-200">
                  Highest-Impact Open Work ({openWorkItems.length})
                </h2>
                <p className="text-[11px] text-neutral-400">
                  Ranked deterministically by severity (High &gt; Medium &gt; Low) and recency.
                </p>
              </div>
            </div>

            {isLoadingWorkItems ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"
                  />
                ))}
              </div>
            ) : openWorkItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-10 text-center text-xs text-neutral-400">
                <p className="font-semibold text-neutral-300">No open work items.</p>
                <p className="mt-1 text-[11px]">
                  All high-impact UX findings in this project have been addressed or none are tracked yet.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {openWorkItems.slice(0, 5).map((item) => {
                  const targetPage = pages.find((p) => p.id === item.monitoredPageId);
                  const assignee = members.find((m) => m.userId === item.assigneeId);

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedWorkItem(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedWorkItem(item);
                        }
                      }}
                      className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4 transition hover:border-neutral-700 hover:bg-neutral-900/80 sm:flex-row sm:items-center sm:justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              item.severity === "high"
                                ? "bg-red-950 text-red-400 border border-red-800/50"
                                : item.severity === "medium"
                                ? "bg-amber-950 text-amber-400 border border-amber-800/50"
                                : "bg-neutral-800 text-neutral-400"
                            }`}
                          >
                            {item.severity}
                          </span>
                          <span className="font-semibold text-neutral-100 text-xs transition group-hover:text-white truncate">
                            {item.title}
                          </span>
                          <span className="rounded bg-neutral-800/80 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 uppercase">
                            {item.status.replace(/_/g, " ")}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
                          {targetPage && (
                            <span className="truncate max-w-xs">{targetPage.canonicalUrl}</span>
                          )}
                          {item.category && (
                            <>
                              <span>&bull;</span>
                              <span>{CATEGORY_NAMES[item.category] || item.category}</span>
                            </>
                          )}
                          <span>&bull;</span>
                          <span>{assignee ? assignee.fullName || assignee.email : "Unassigned"}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <span className="text-xs text-neutral-400 group-hover:text-neutral-200">
                          View details &rarr;
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 2: Recently Regressed / Active Audited Pages */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-neutral-200">
                  Landing Page UX Trajectories ({pages.length})
                </h2>
                <p className="text-[11px] text-neutral-400">
                  Compare historical audit snapshots and track UX score deltas.
                </p>
              </div>
            </div>

            {pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-14 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                    />
                  </svg>
                </div>
                <h3 className="mt-3 text-xs font-semibold text-neutral-200">
                  No pages monitored yet
                </h3>
                <p className="mt-1 max-w-sm text-xs text-neutral-400">
                  Add a page to start monitoring its UX and tracking audit history.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={handleOpenAdd}
                    className="mt-4 rounded-lg bg-neutral-50 px-3.5 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    Add Page
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {pages.map((page) => (
                  <div
                    key={page.id}
                    onClick={() => onSelectPage(page)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectPage(page);
                      }
                    }}
                    className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4 transition hover:border-neutral-700 hover:bg-neutral-900/80 sm:flex-row sm:items-center sm:justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-100 text-xs truncate">
                          {page.canonicalUrl}
                        </span>
                        <span
                          onClick={(e) => handleToggleStatus(page, e)}
                          className={`inline-flex cursor-pointer items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ${
                            page.status === "active"
                              ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                              : "bg-neutral-800 text-neutral-400 border border-neutral-700/40"
                          }`}
                        >
                          {page.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                        <span className="capitalize">{page.cadence} cadence</span>
                        {page.tags.length > 0 && (
                          <>
                            <span>&bull;</span>
                            <div className="flex flex-wrap gap-1">
                              {page.tags.map((t) => (
                                <span
                                  key={t}
                                  className="rounded bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-300"
                                >
                                  #{t}
                                </span>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      {onComparePage && page.latestSuccessfulAuditRunId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onComparePage(page, page.latestSuccessfulAuditRunId!);
                          }}
                          className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                        >
                          Compare Changes
                        </button>
                      )}

                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        {canManage && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => handleOpenEdit(page, e)}
                              aria-label={`Edit ${page.canonicalUrl}`}
                              className="rounded p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
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
                                  strokeWidth={1.5}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleOpenDelete(page, e)}
                              aria-label={`Delete ${page.canonicalUrl}`}
                              className="rounded p-1.5 text-neutral-400 transition hover:bg-red-950/50 hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
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
                                  strokeWidth={1.5}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          </>
                        )}
                        <span className="pl-1 text-neutral-400 group-hover:text-neutral-200">
                          &rarr;
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Resolved Improvements */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold tracking-wide text-neutral-200">
                  Resolved Improvements ({resolvedWorkItems.length})
                </h2>
                <p className="text-[11px] text-neutral-400">
                  UX findings resolved with documented rationale.
                </p>
              </div>
            </div>

            {resolvedWorkItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-10 text-center text-xs text-neutral-400">
                <p className="font-semibold text-neutral-300">No resolved items yet.</p>
                <p className="mt-1 text-[11px]">
                  As your team resolves and fixes UX issues, resolved improvements will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {resolvedWorkItems.slice(0, 5).map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedWorkItem(item)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedWorkItem(item);
                      }
                    }}
                    className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-emerald-950/60 bg-emerald-950/20 p-4 transition hover:border-emerald-800/60 sm:flex-row sm:items-center sm:justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-800/40 uppercase">
                          Resolved
                        </span>
                        <span className="text-xs font-semibold text-neutral-200 line-through opacity-80">
                          {item.title}
                        </span>
                      </div>
                      {item.resolutionRationale && (
                        <p className="text-[11px] text-neutral-400">
                          Rationale: &ldquo;{item.resolutionRationale}&rdquo;
                        </p>
                      )}
                    </div>

                    <div className="text-[10px] text-neutral-400">
                      {item.resolvedAt ? new Date(item.resolvedAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Monitored Pages Full List */}
      {activeTab === "pages" && (
        <div>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"
                />
              ))}
            </div>
          ) : pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-14 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-400">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                  />
                </svg>
              </div>
              <h3 className="mt-3 text-xs font-semibold text-neutral-200">
                No pages monitored yet
              </h3>
              <p className="mt-1 max-w-sm text-xs text-neutral-400">
                Add a page to start monitoring its UX and tracking audit history.
              </p>
              {canManage && (
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="mt-4 rounded-lg bg-neutral-50 px-3.5 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  Add Page
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {pages.map((page) => (
                <div
                  key={page.id}
                  onClick={() => onSelectPage(page)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectPage(page);
                    }
                  }}
                  className="group flex cursor-pointer flex-col gap-3 rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-4 transition hover:border-neutral-700 hover:bg-neutral-900/80 sm:flex-row sm:items-center sm:justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-neutral-100 transition group-hover:text-white">
                        {page.canonicalUrl}
                      </span>
                      <span
                        onClick={(e) => handleToggleStatus(page, e)}
                        className={`inline-flex cursor-pointer items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ${
                          page.status === "active"
                            ? "bg-emerald-950/60 text-emerald-400 border border-emerald-800/40"
                            : "bg-neutral-800 text-neutral-400 border border-neutral-700/40"
                        }`}
                      >
                        {page.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                      <span className="capitalize">{page.cadence} cadence</span>
                      {page.tags.length > 0 && (
                        <>
                          <span>&bull;</span>
                          <div className="flex flex-wrap gap-1">
                            {page.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-300"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right text-xs">
                      {page.latestSuccessfulAuditRunId ? (
                        <span className="inline-flex items-center rounded-md bg-neutral-800 px-2 py-1 text-xs font-semibold text-neutral-200">
                          Audit active
                        </span>
                      ) : (
                        <span className="text-[11px] text-neutral-400">
                          No audits yet
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      {canManage && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => handleOpenEdit(page, e)}
                            aria-label={`Edit ${page.canonicalUrl}`}
                            className="rounded p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
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
                                strokeWidth={1.5}
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleOpenDelete(page, e)}
                            aria-label={`Delete ${page.canonicalUrl}`}
                            className="rounded p-1.5 text-neutral-400 transition hover:bg-red-950/50 hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
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
                                strokeWidth={1.5}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </>
                      )}
                      <span className="pl-1 text-neutral-400 group-hover:text-neutral-200">
                        &rarr;
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Integrations */}
      {activeTab === "integrations" && (
        <div className="pt-2">
          <IntegrationsManager
            project={project}
            role={role}
          />
        </div>
      )}

      {/* Add / Edit Modal */}
      <MonitoredPageModal
        isOpen={modalOpen}
        page={editingPage}
        isSaving={isSaving}
        onSave={handleSave}
        onClose={() => {
          setModalOpen(false);
          setEditingPage(null);
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={Boolean(deletingPage)}
        title="Delete Monitored Page"
        message={`Are you sure you want to delete "${deletingPage?.canonicalUrl}"? All historical audit runs and reports for this page will be permanently removed.`}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingPage(null)}
      />

      {/* Work Item Detail Modal */}
      {selectedWorkItem && (
        <WorkItemDetailModal
          projectId={project.id}
          workItemId={selectedWorkItem.id}
          initialWorkItem={selectedWorkItem}
          role={role}
          members={members}
          onClose={() => setSelectedWorkItem(null)}
          onUpdated={(updated) => {
            setSelectedWorkItem(updated);
            setWorkItems((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
          }}
          onDeleted={(deletedId) => {
            setSelectedWorkItem(null);
            setWorkItems((prev) => prev.filter((w) => w.id !== deletedId));
          }}
        />
      )}
    </div>
  );
}
