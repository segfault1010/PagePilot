import { useEffect, useState } from "react";
import type {
  MonitoredPage,
  OrganizationMember,
  Role,
  WorkItem,
  WorkItemActivity,
  WorkItemStatus,
} from "@pagepilot/contracts";
import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
} from "../../analysis/labels";
import { Badge, SEVERITY_TONE } from "../../analysis/components/badge";
import {
  WORK_ITEM_ACTION_LABELS,
  WORK_ITEM_SOURCE_LABELS,
} from "../work-items-labels";
import {
  deleteWorkItem,
  getWorkItem,
  updateWorkItem,
  WorkItemsApiClientError,
} from "../api.js";

export interface WorkItemDetailModalProps {
  projectId: string;
  workItemId: string;
  initialWorkItem?: WorkItem;
  role: Role;
  members: OrganizationMember[];
  pages?: MonitoredPage[];
  onClose: () => void;
  onUpdated: (updated: WorkItem) => void;
  onDeleted: (deletedId: string) => void;
  onNavigateToPage?: (pageId: string) => void;
  onNavigateToReport?: (runId: string) => void;
}

export function WorkItemDetailModal({
  projectId,
  workItemId,
  initialWorkItem,
  role,
  members,
  pages = [],
  onClose,
  onUpdated,
  onDeleted,
  onNavigateToPage,
  onNavigateToReport,
}: WorkItemDetailModalProps) {
  const isViewer = role === "viewer";

  const [workItem, setWorkItem] = useState<WorkItem | null>(initialWorkItem ?? null);
  const [activities, setActivities] = useState<WorkItemActivity[]>([]);
  const [isLoading, setIsLoading] = useState(!initialWorkItem);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form edit state
  const [selectedStatus, setSelectedStatus] = useState<WorkItemStatus>(
    initialWorkItem?.status || "open",
  );
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | "">(
    initialWorkItem?.assigneeId || "",
  );
  const [notes, setNotes] = useState<string>(initialWorkItem?.notes || "");
  const [tags, setTags] = useState<string[]>(initialWorkItem?.tags || []);
  const [newTagInput, setNewTagInput] = useState("");
  const [resolutionRationale, setResolutionRationale] = useState<string>(
    initialWorkItem?.resolutionRationale || "",
  );

  // Fetch full details and activity trail
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const res = await getWorkItem(projectId, workItemId);
        if (cancelled) return;
        setWorkItem(res.workItem);
        setActivities(res.activities || []);
        setSelectedStatus(res.workItem.status);
        setSelectedAssigneeId(res.workItem.assigneeId || "");
        setNotes(res.workItem.notes || "");
        setTags(res.workItem.tags || []);
        setResolutionRationale(res.workItem.resolutionRationale || "");
      } catch (err: any) {
        if (cancelled) return;
        setErrorMessage(
          err instanceof WorkItemsApiClientError
            ? err.message
            : "Failed to load work item details.",
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, workItemId]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSave = async (overrideStatus?: WorkItemStatus) => {
    if (isViewer) return;
    setIsSaving(true);
    setErrorMessage(null);

    const statusToApply = overrideStatus || selectedStatus;

    try {
      const res = await updateWorkItem(projectId, workItemId, {
        status: statusToApply,
        assigneeId: selectedAssigneeId ? selectedAssigneeId : null,
        notes: notes.trim() || null,
        tags,
        resolutionRationale:
          statusToApply === "resolved" || statusToApply === "dismissed"
            ? resolutionRationale.trim() || null
            : null,
      });

      setWorkItem(res.workItem);
      setSelectedStatus(res.workItem.status);
      onUpdated(res.workItem);

      // Re-fetch activities to reflect the new change
      const refreshed = await getWorkItem(projectId, workItemId);
      setActivities(refreshed.activities || []);
    } catch (err: any) {
      setErrorMessage(
        err instanceof WorkItemsApiClientError
          ? err.message
          : "Failed to save work item.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleReopen = async () => {
    setSelectedStatus("open");
    await handleSave("open");
  };

  const handleDelete = async () => {
    if (isViewer) return;
    if (!window.confirm("Are you sure you want to delete this work item?")) return;
    setIsSaving(true);
    try {
      await deleteWorkItem(projectId, workItemId);
      onDeleted(workItemId);
      onClose();
    } catch (err: any) {
      setErrorMessage(
        err instanceof WorkItemsApiClientError
          ? err.message
          : "Failed to delete work item.",
      );
      setIsSaving(false);
    }
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagInput.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= 20 || trimmed.length > 50) return;
    setTags([...tags, trimmed]);
    setNewTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (isViewer) return;
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const monitoredPage = pages.find((p) => p.id === workItem?.monitoredPageId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="work-item-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-3xl rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl text-neutral-100 my-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-neutral-900 pb-5">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-neutral-800 px-2 py-0.5 font-medium text-neutral-300">
                {workItem ? WORK_ITEM_SOURCE_LABELS[workItem.sourceType] : "Work Item"}
              </span>
              {workItem?.category && (
                <span className="text-neutral-400 font-medium">
                  {CATEGORY_LABELS[workItem.category]}
                </span>
              )}
              {workItem?.severity && (
                <Badge tone={SEVERITY_TONE[workItem.severity]}>
                  {SEVERITY_LABELS[workItem.severity]} severity
                </Badge>
              )}
              {isViewer && (
                <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
                  Read Only
                </span>
              )}
            </div>
            <h2
              id="work-item-detail-title"
              className="text-lg font-semibold tracking-tight text-neutral-50 sm:text-xl"
            >
              {workItem?.title || "Work Item Details"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200 transition"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
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

        {/* Error Alert */}
        {errorMessage && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between rounded-xl border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-300"
          >
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-400 hover:text-red-200 ml-2"
            >
              &times;
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="py-16 text-center text-xs text-neutral-500 animate-pulse">
            Loading work item details...
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {/* Description */}
            {workItem?.description && (
              <div className="rounded-xl border border-neutral-900 bg-neutral-900/40 p-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                  Finding / Recommendation Description
                </h4>
                <p className="text-sm text-neutral-300 leading-relaxed">
                  {workItem.description}
                </p>
              </div>
            )}

            {/* Navigation Links Back to Page & Audit */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-900 bg-neutral-900/20 p-3 text-xs">
              <span className="text-neutral-500">Source:</span>
              {monitoredPage && onNavigateToPage ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateToPage(monitoredPage.id);
                  }}
                  className="text-neutral-300 hover:text-white underline decoration-neutral-700 underline-offset-2 transition"
                >
                  Page: {monitoredPage.canonicalUrl}
                </button>
              ) : (
                <span className="text-neutral-400 truncate max-w-xs">
                  {monitoredPage?.canonicalUrl || "Landing Page"}
                </span>
              )}

              {workItem?.auditRunId && onNavigateToReport && (
                <>
                  <span className="text-neutral-700">&bull;</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigateToReport(workItem.auditRunId!);
                    }}
                    className="text-blue-400 hover:text-blue-300 underline decoration-blue-500/30 underline-offset-2 transition"
                  >
                    View Source Audit Report &rarr;
                  </button>
                </>
              )}
            </div>

            {/* Controls Grid: Status & Assignee */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Status Selector */}
              <div>
                <label
                  htmlFor="work-item-status"
                  className="block text-xs font-medium text-neutral-300 mb-1.5"
                >
                  Status
                </label>
                <div className="flex items-center gap-2">
                  <select
                    id="work-item-status"
                    value={selectedStatus}
                    disabled={isViewer || isSaving}
                    onChange={(e) =>
                      setSelectedStatus(e.target.value as WorkItemStatus)
                    }
                    className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="dismissed">Dismissed</option>
                  </select>

                  {(selectedStatus === "resolved" ||
                    selectedStatus === "dismissed") && (
                    <button
                      type="button"
                      disabled={isViewer || isSaving}
                      onClick={handleReopen}
                      className="shrink-0 h-10 rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-xs font-medium text-amber-400 hover:bg-neutral-800 hover:text-amber-300 transition disabled:opacity-60"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>

              {/* Assignee Selector */}
              <div>
                <label
                  htmlFor="work-item-assignee"
                  className="block text-xs font-medium text-neutral-300 mb-1.5"
                >
                  Assignee
                </label>
                <select
                  id="work-item-assignee"
                  value={selectedAssigneeId}
                  disabled={isViewer || isSaving}
                  onChange={(e) => setSelectedAssigneeId(e.target.value)}
                  className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.fullName
                        ? `${member.fullName} (${member.email})`
                        : member.email}{" "}
                      [{member.role}]
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Resolution Rationale (Prominent when status is resolved or dismissed) */}
            {(selectedStatus === "resolved" || selectedStatus === "dismissed") && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <label
                    htmlFor="resolution-rationale"
                    className="font-semibold text-neutral-200"
                  >
                    Resolution Rationale
                  </label>
                  <span className="text-[10px] text-neutral-500">
                    {resolutionRationale.length}/2000
                  </span>
                </div>
                <textarea
                  id="resolution-rationale"
                  rows={3}
                  value={resolutionRationale}
                  disabled={isViewer || isSaving}
                  maxLength={2000}
                  placeholder={
                    selectedStatus === "resolved"
                      ? "Explain what changes or UX fixes were implemented to resolve this issue..."
                      : "Explain why this finding was dismissed..."
                  }
                  onChange={(e) => setResolutionRationale(e.target.value)}
                  className="w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
                />
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label
                  htmlFor="work-item-notes"
                  className="font-medium text-neutral-300"
                >
                  Team Collaboration Notes
                </label>
                <span className="text-[10px] text-neutral-500">
                  {notes.length}/5000
                </span>
              </div>
              <textarea
                id="work-item-notes"
                rows={4}
                value={notes}
                disabled={isViewer || isSaving}
                maxLength={5000}
                placeholder="Add contextual details, internal PR links, or discussion notes..."
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
              />
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <label
                htmlFor="new-tag-input"
                className="block text-xs font-medium text-neutral-300"
              >
                Tags (up to 20)
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md bg-neutral-800 px-2.5 py-1 text-xs text-neutral-200"
                  >
                    #{tag}
                    {!isViewer && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="text-neutral-400 hover:text-white"
                        aria-label={`Remove tag ${tag}`}
                      >
                        &times;
                      </button>
                    )}
                  </span>
                ))}
                {!isViewer && tags.length < 20 && (
                  <form onSubmit={handleAddTag} className="inline-flex items-center">
                    <input
                      id="new-tag-input"
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      placeholder="+ tag"
                      maxLength={50}
                      className="h-7 w-20 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
                    />
                  </form>
                )}
              </div>
            </div>

            {/* Activity History Trail */}
            <div className="border-t border-neutral-900 pt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
                Activity History
              </h4>
              {activities.length === 0 ? (
                <p className="text-xs text-neutral-600 italic">
                  No activity history recorded yet.
                </p>
              ) : (
                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                  {activities.map((act) => {
                    const dateStr = new Date(act.createdAt).toLocaleString();
                    return (
                      <div
                        key={act.id}
                        className="flex items-start justify-between gap-3 rounded-lg border border-neutral-900 bg-neutral-900/30 p-2.5 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-neutral-200">
                              {WORK_ITEM_ACTION_LABELS[act.action] || act.action}
                            </span>
                            {act.fromStatus && act.toStatus && (
                              <span className="text-neutral-400 font-mono text-[10px]">
                                ({act.fromStatus} &rarr; {act.toStatus})
                              </span>
                            )}
                          </div>
                          {act.details && Object.keys(act.details).length > 0 && (
                            <p className="text-[11px] text-neutral-400">
                              {act.details.assigneeEmail
                                ? `Assignee: ${act.details.assigneeEmail}`
                                : act.details.notesSummary
                                  ? `Notes: ${act.details.notesSummary}`
                                  : act.details.rationale
                                    ? `Rationale: ${act.details.rationale}`
                                    : JSON.stringify(act.details)}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-neutral-500 whitespace-nowrap">
                          {dateStr}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-900 pt-4">
          <div>
            {!isViewer && (
              <button
                type="button"
                disabled={isSaving}
                onClick={handleDelete}
                className="rounded-lg px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-950/30 hover:text-red-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/80 disabled:opacity-50"
              >
                Delete Work Item
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-900 transition"
            >
              Close
            </button>
            {!isViewer && (
              <button
                type="button"
                disabled={isSaving || isLoading}
                onClick={() => handleSave()}
                className="rounded-lg bg-white px-5 py-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
