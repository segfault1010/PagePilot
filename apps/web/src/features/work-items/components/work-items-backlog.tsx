import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AuditCategory,
  MonitoredPage,
  OrganizationMember,
  Project,
  Role,
  Severity,
  WorkItem,
  WorkItemSourceType,
  WorkItemStatus,
} from "@pagepilot/contracts";
import {
  AUDIT_CATEGORIES,
} from "@pagepilot/contracts";
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "../../analysis/labels";
import { Badge, SEVERITY_TONE } from "../../analysis/components/badge";
import {
  WORK_ITEM_SOURCE_LABELS,
  WORK_ITEM_STATUS_LABELS,
  WORK_ITEM_STATUS_STYLES,
} from "../work-items-labels";
import {
  listWorkItems,
  updateWorkItem,
  WorkItemsApiClientError,
} from "../api.js";
import { WorkItemDetailModal } from "./work-item-detail-modal";
import { CreateWorkItemModal } from "./create-work-item-modal";

export interface WorkItemsBacklogProps {
  projects: Project[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  pages: MonitoredPage[];
  members: OrganizationMember[];
  role: Role;
  onNavigateToPage?: (projectId: string, pageId: string) => void;
  onNavigateToReport?: (projectId: string, pageId: string, runId: string) => void;
}

type SortOption = "priority" | "recent" | "status" | "title";

const SEVERITY_WEIGHT: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const STATUS_WEIGHT: Record<WorkItemStatus, number> = {
  open: 4,
  in_progress: 3,
  resolved: 2,
  dismissed: 1,
};

export function WorkItemsBacklog({
  projects,
  selectedProjectId,
  onSelectProject,
  pages,
  members,
  role,
  onNavigateToPage,
  onNavigateToReport,
}: WorkItemsBacklogProps) {
  const isViewer = role === "viewer";
  const activeProjectId = selectedProjectId || projects[0]?.id;

  // Data state
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [pageFilter, setPageFilter] = useState<string>("all");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("priority");

  // Modal states
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Fetch work items for active project
  const fetchWorkItems = useCallback(async () => {
    if (!activeProjectId) {
      setWorkItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await listWorkItems(activeProjectId, {
        status: statusFilter !== "all" ? (statusFilter as WorkItemStatus) : undefined,
        assigneeId:
          assigneeFilter !== "all" && assigneeFilter !== "unassigned"
            ? assigneeFilter
            : undefined,
        pageId: pageFilter !== "all" ? pageFilter : undefined,
        sourceType:
          sourceTypeFilter !== "all" ? (sourceTypeFilter as WorkItemSourceType) : undefined,
        severity:
          severityFilter !== "all" ? (severityFilter as Severity) : undefined,
        category:
          categoryFilter !== "all" ? (categoryFilter as AuditCategory) : undefined,
      });

      let items = res.workItems;
      if (assigneeFilter === "unassigned") {
        items = items.filter((item) => !item.assigneeId);
      }
      setWorkItems(items);
    } catch (err: any) {
      setErrorMessage(
        err instanceof WorkItemsApiClientError
          ? err.message
          : "Failed to load work items.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    activeProjectId,
    statusFilter,
    assigneeFilter,
    pageFilter,
    sourceTypeFilter,
    severityFilter,
    categoryFilter,
  ]);

  useEffect(() => {
    fetchWorkItems();
  }, [fetchWorkItems]);

  // Client-side deterministic sorting
  const sortedWorkItems = useMemo(() => {
    const items = [...workItems];
    switch (sortBy) {
      case "priority":
        return items.sort((a, b) => {
          const sevA = a.severity ? SEVERITY_WEIGHT[a.severity] : 0;
          const sevB = b.severity ? SEVERITY_WEIGHT[b.severity] : 0;
          if (sevA !== sevB) return sevB - sevA;

          const statA = STATUS_WEIGHT[a.status] || 0;
          const statB = STATUS_WEIGHT[b.status] || 0;
          if (statA !== statB) return statB - statA;

          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      case "recent":
        return items.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
      case "status":
        return items.sort((a, b) => {
          const statA = STATUS_WEIGHT[a.status] || 0;
          const statB = STATUS_WEIGHT[b.status] || 0;
          return statB - statA;
        });
      case "title":
        return items.sort((a, b) => a.title.localeCompare(b.title));
      default:
        return items;
    }
  }, [workItems, sortBy]);

  const handleResetFilters = () => {
    setStatusFilter("all");
    setAssigneeFilter("all");
    setPageFilter("all");
    setSourceTypeFilter("all");
    setSeverityFilter("all");
    setCategoryFilter("all");
  };

  const hasActiveFilters =
    statusFilter !== "all" ||
    assigneeFilter !== "all" ||
    pageFilter !== "all" ||
    sourceTypeFilter !== "all" ||
    severityFilter !== "all" ||
    categoryFilter !== "all";

  // Quick Status Update
  const handleQuickStatusChange = async (
    item: WorkItem,
    newStatus: WorkItemStatus,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    if (isViewer || !activeProjectId) return;

    try {
      const res = await updateWorkItem(activeProjectId, item.id, {
        status: newStatus,
      });
      setWorkItems((prev) =>
        prev.map((w) => (w.id === res.workItem.id ? res.workItem : w)),
      );
    } catch (err: any) {
      setErrorMessage(
        err instanceof WorkItemsApiClientError
          ? err.message
          : "Failed to update status.",
      );
    }
  };

  const selectedWorkItem = workItems.find((w) => w.id === selectedWorkItemId);

  return (
    <div className="space-y-6">
      {/* Top Header & Project Scope */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-50 sm:text-3xl">
            Work Items & Backlog
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            Collaborate on UX findings, assign responsibilities, and track landing page fixes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Project Selector */}
          {projects.length > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="project-filter" className="text-neutral-400 font-medium">
                Project:
              </label>
              <select
                id="project-filter"
                value={activeProjectId || ""}
                onChange={(e) => onSelectProject(e.target.value)}
                className="h-9 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-xs text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isViewer && activeProjectId && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              + Create Work Item
            </button>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-red-900/50 bg-red-950/40 p-4 text-xs text-red-300"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-red-200 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filters & Sorting Bar */}
      <section
        aria-labelledby="filters-heading"
        className="rounded-xl border border-neutral-900 bg-neutral-900/40 p-4"
      >
        <h2 id="filters-heading" className="sr-only">
          Filter and sort work items
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
          {/* Status Filter */}
          <div>
            <label htmlFor="filter-status" className="block text-neutral-400 mb-1 font-medium">
              Status
            </label>
            <select
              id="filter-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
            >
              <option value="all">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>

          {/* Severity Filter */}
          <div>
            <label htmlFor="filter-severity" className="block text-neutral-400 mb-1 font-medium">
              Severity
            </label>
            <select
              id="filter-severity"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
            >
              <option value="all">All Severities</option>
              <option value="high">High Severity</option>
              <option value="medium">Medium Severity</option>
              <option value="low">Low Severity</option>
            </select>
          </div>

          {/* Assignee Filter */}
          <div>
            <label htmlFor="filter-assignee" className="block text-neutral-400 mb-1 font-medium">
              Assignee
            </label>
            <select
              id="filter-assignee"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
            >
              <option value="all">All Assignees</option>
              <option value="unassigned">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName || m.email}
                </option>
              ))}
            </select>
          </div>

          {/* Page Filter */}
          <div>
            <label htmlFor="filter-page" className="block text-neutral-400 mb-1 font-medium">
              Landing Page
            </label>
            <select
              id="filter-page"
              value={pageFilter}
              onChange={(e) => setPageFilter(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
            >
              <option value="all">All Pages</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.canonicalUrl.replace(/^https?:\/\//, "")}
                </option>
              ))}
            </select>
          </div>

          {/* Category Filter */}
          <div>
            <label htmlFor="filter-category" className="block text-neutral-400 mb-1 font-medium">
              UX Category
            </label>
            <select
              id="filter-category"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
            >
              <option value="all">All Categories</option>
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          {/* Sort Control */}
          <div>
            <label htmlFor="sort-by-select" className="block text-neutral-400 mb-1 font-medium">
              Sort By
            </label>
            <select
              id="sort-by-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="h-8 w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
            >
              <option value="priority">Priority (Severity & Status)</option>
              <option value="recent">Recently Updated</option>
              <option value="status">Status</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-3 flex items-center justify-between border-t border-neutral-800/60 pt-3 text-xs">
            <span className="text-neutral-500">
              Showing {sortedWorkItems.length} matching work items
            </span>
            <button
              type="button"
              onClick={handleResetFilters}
              className="font-medium text-neutral-400 hover:text-white transition"
            >
              Reset all filters
            </button>
          </div>
        )}
      </section>

      {/* Work Items Cards List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/40 p-5"
            />
          ))}
        </div>
      ) : sortedWorkItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-800 p-12 text-center">
          <p className="text-sm font-semibold text-neutral-200">
            {hasActiveFilters
              ? "No work items match these filters."
              : "Nothing needs attention yet."}
          </p>
          <p className="mt-1 text-xs text-neutral-500 max-w-sm mx-auto">
            {hasActiveFilters
              ? "Try broadening your filter criteria or reset all filters to view existing items."
              : "Run landing page audits to discover high-priority findings and turn them into collaborative work items."}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white transition"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {sortedWorkItems.map((item) => {
            const statusStyle = WORK_ITEM_STATUS_STYLES[item.status];
            const assignee = members.find((m) => m.userId === item.assigneeId);
            const page = pages.find((p) => p.id === item.monitoredPageId);

            return (
              <article
                key={item.id}
                onClick={() => setSelectedWorkItemId(item.id)}
                className="group relative flex flex-col justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 transition hover:border-neutral-700 hover:bg-neutral-900 cursor-pointer sm:flex-row sm:items-center"
              >
                <div className="space-y-2 flex-1 min-w-0">
                  {/* Metadata Row */}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusStyle.border} ${statusStyle.bg} ${statusStyle.text}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`}
                        aria-hidden="true"
                      />
                      {WORK_ITEM_STATUS_LABELS[item.status]}
                    </span>

                    {/* Severity Badge */}
                    {item.severity && (
                      <Badge tone={SEVERITY_TONE[item.severity]}>
                        {SEVERITY_LABELS[item.severity]}
                      </Badge>
                    )}

                    {/* Source Type Badge */}
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-[11px] font-medium text-neutral-400">
                      {WORK_ITEM_SOURCE_LABELS[item.sourceType]}
                    </span>

                    {/* UX Category */}
                    {item.category && (
                      <span className="text-[11px] font-medium text-neutral-400">
                        {CATEGORY_LABELS[item.category]}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-semibold text-neutral-100 group-hover:text-white transition truncate">
                    {item.title}
                  </h3>

                  {/* Page & Assignee Details */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-400">
                    {page && (
                      <span className="truncate max-w-xs text-neutral-400">
                        Page: {page.canonicalUrl.replace(/^https?:\/\//, "")}
                      </span>
                    )}

                    {item.assigneeId ? (
                      <span className="inline-flex items-center gap-1 text-neutral-300 font-medium">
                        <span className="h-4 w-4 rounded-full bg-neutral-800 text-[9px] flex items-center justify-center text-neutral-200">
                          {assignee?.fullName ? assignee.fullName[0] : "@"}
                        </span>
                        {assignee?.fullName || assignee?.email || "Assignee"}
                      </span>
                    ) : (
                      <span className="text-neutral-500 italic">Unassigned</span>
                    )}

                    {item.tags.length > 0 && (
                      <div className="flex items-center gap-1">
                        {item.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400"
                          >
                            #{t}
                          </span>
                        ))}
                        {item.tags.length > 3 && (
                          <span className="text-[10px] text-neutral-500">
                            +{item.tags.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Action & Status Quick Switch */}
                <div className="flex items-center gap-3 shrink-0">
                  {!isViewer && (
                    <div
                      className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-950 p-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {item.status !== "in_progress" && (
                        <button
                          type="button"
                          title="Set In Progress"
                          onClick={(e) => handleQuickStatusChange(item, "in_progress", e)}
                          className="rounded px-2 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-blue-300 transition"
                        >
                          Start
                        </button>
                      )}
                      {item.status !== "resolved" && (
                        <button
                          type="button"
                          title="Set Resolved"
                          onClick={(e) => handleQuickStatusChange(item, "resolved", e)}
                          className="rounded px-2 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-emerald-300 transition"
                        >
                          Resolve
                        </button>
                      )}
                      {(item.status === "resolved" || item.status === "dismissed") && (
                        <button
                          type="button"
                          title="Reopen"
                          onClick={(e) => handleQuickStatusChange(item, "open", e)}
                          className="rounded px-2 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800 hover:text-amber-300 transition"
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedWorkItemId(item.id)}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 hover:text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    View Details &rarr;
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Work Item Detail Modal */}
      {selectedWorkItemId && (
        <WorkItemDetailModal
          projectId={activeProjectId!}
          workItemId={selectedWorkItemId}
          initialWorkItem={selectedWorkItem}
          role={role}
          members={members}
          pages={pages}
          onClose={() => setSelectedWorkItemId(null)}
          onUpdated={(updated) => {
            setWorkItems((prev) =>
              prev.map((w) => (w.id === updated.id ? updated : w)),
            );
          }}
          onDeleted={(deletedId) => {
            setWorkItems((prev) => prev.filter((w) => w.id !== deletedId));
          }}
          onNavigateToPage={
            onNavigateToPage && activeProjectId
              ? (pId) => onNavigateToPage(activeProjectId, pId)
              : undefined
          }
          onNavigateToReport={
            onNavigateToReport && activeProjectId && selectedWorkItem?.monitoredPageId
              ? (runId) =>
                  onNavigateToReport(
                    activeProjectId,
                    selectedWorkItem.monitoredPageId,
                    runId,
                  )
              : undefined
          }
        />
      )}

      {/* Create Work Item Modal */}
      {isCreateModalOpen && activeProjectId && (
        <CreateWorkItemModal
          projectId={activeProjectId}
          pages={pages}
          members={members}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={(newItem) => {
            setWorkItems((prev) => [newItem, ...prev]);
          }}
        />
      )}
    </div>
  );
}
