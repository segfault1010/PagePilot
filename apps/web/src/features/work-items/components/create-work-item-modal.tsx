import { useEffect, useState } from "react";
import type {
  AuditCategory,
  CreateWorkItemInput,
  MonitoredPage,
  OrganizationMember,
  Severity,
  WorkItem,
  WorkItemSourceType,
} from "@pagepilot/contracts";
import { AUDIT_CATEGORIES } from "@pagepilot/contracts";
import { CATEGORY_LABELS } from "../../analysis/labels";
import { createWorkItem } from "../api.js";

export interface PrefillSourceData {
  sourceType: WorkItemSourceType;
  findingId?: string;
  recommendationId?: string;
  pageId: string;
  title: string;
  description?: string;
  category?: AuditCategory;
  severity?: Severity;
}

export interface CreateWorkItemModalProps {
  projectId: string;
  pages: MonitoredPage[];
  members: OrganizationMember[];
  prefillSource?: PrefillSourceData;
  onClose: () => void;
  onCreated: (newItem: WorkItem) => void;
}

export function CreateWorkItemModal({
  projectId,
  pages,
  members,
  prefillSource,
  onClose,
  onCreated,
}: CreateWorkItemModalProps) {
  const [sourceType, setSourceType] = useState<WorkItemSourceType>(
    prefillSource?.sourceType || "finding",
  );
  const [selectedPageId, setSelectedPageId] = useState<string>(
    prefillSource?.pageId || pages[0]?.id || "",
  );
  const [title, setTitle] = useState(prefillSource?.title || "");
  const [description, setDescription] = useState(prefillSource?.description || "");
  const [category, setCategory] = useState<AuditCategory | "">(
    prefillSource?.category || "clarity",
  );
  const [severity, setSeverity] = useState<Severity>(
    prefillSource?.severity || "medium",
  );
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = tagInput.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= 20 || trimmed.length > 50) return;
    setTags([...tags, trimmed]);
    setTagInput("");
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((tag) => tag !== t));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!selectedPageId) {
      setErrorMessage("Please select a target landing page.");
      return;
    }

    if (!title.trim()) {
      setErrorMessage("Title is required.");
      return;
    }

    const input: CreateWorkItemInput = {
      sourceType,
      monitoredPageId: selectedPageId,
      findingId:
        sourceType === "finding"
          ? prefillSource?.findingId || undefined
          : undefined,
      recommendationId:
        sourceType === "recommendation"
          ? prefillSource?.recommendationId || undefined
          : undefined,
      title: title.trim(),
      description: description.trim() || undefined,
      category: category ? (category as AuditCategory) : undefined,
      severity,
      status: "open",
      assigneeId: assigneeId || undefined,
      notes: notes.trim() || undefined,
      tags,
    };

    setIsSubmitting(true);
    try {
      const res = await createWorkItem(projectId, input);
      onCreated(res.workItem);
      onClose();
    } catch (err: any) {
      if (
        err?.status === 409 ||
        err?.code === "CONFLICT" ||
        err?.code === "DUPLICATE_WORK_ITEM" ||
        err?.message?.toLowerCase().includes("already exists")
      ) {
        setErrorMessage("That finding/recommendation already has a work item.");
      } else if (err?.message) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Failed to create work item. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-work-item-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl text-neutral-100 my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
          <div>
            <h2
              id="create-work-item-title"
              className="text-lg font-semibold tracking-tight text-neutral-50"
            >
              {prefillSource ? "Track Work Item from Audit" : "Create Work Item"}
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Turn UX findings and recommendations into actionable team work.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
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
            className="mt-4 rounded-xl border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-300"
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {/* Target Page Selector */}
          <div>
            <label
              htmlFor="target-page-select"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              Monitored Landing Page
            </label>
            <select
              id="target-page-select"
              value={selectedPageId}
              disabled={Boolean(prefillSource?.pageId)}
              onChange={(e) => setSelectedPageId(e.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
            >
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.canonicalUrl}
                </option>
              ))}
            </select>
          </div>

          {/* Source Type & Severity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="source-type-select"
                className="block text-xs font-medium text-neutral-300 mb-1"
              >
                Source Type
              </label>
              <select
                id="source-type-select"
                value={sourceType}
                disabled={Boolean(prefillSource)}
                onChange={(e) =>
                  setSourceType(e.target.value as WorkItemSourceType)
                }
                className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-60"
              >
                <option value="finding">Finding</option>
                <option value="recommendation">Recommendation</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="severity-select"
                className="block text-xs font-medium text-neutral-300 mb-1"
              >
                Severity
              </label>
              <select
                id="severity-select"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <option value="high">High Severity</option>
                <option value="medium">Medium Severity</option>
                <option value="low">Low Severity</option>
              </select>
            </div>
          </div>

          {/* Category */}
          <div>
            <label
              htmlFor="category-select"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              UX Category
            </label>
            <select
              id="category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value as AuditCategory)}
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {AUDIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label
              htmlFor="create-work-item-title-input"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              Title *
            </label>
            <input
              id="create-work-item-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Hero value proposition lacks concrete clarity"
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="create-work-item-desc"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              Description / Evidence
            </label>
            <textarea
              id="create-work-item-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Context or evidence observed on the landing page..."
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            />
          </div>

          {/* Assignee */}
          <div>
            <label
              htmlFor="create-work-item-assignee"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              Assignee
            </label>
            <select
              id="create-work-item-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className="h-10 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 text-sm text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName ? `${m.fullName} (${m.email})` : m.email} [{m.role}]
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label
              htmlFor="create-new-tag-input"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              Tags
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                >
                  #{t}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    className="text-neutral-400 hover:text-white"
                  >
                    &times;
                  </button>
                </span>
              ))}
              {tags.length < 20 && (
                <div className="inline-flex items-center gap-1">
                  <input
                    id="create-new-tag-input"
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="+ tag"
                    maxLength={50}
                    className="h-7 w-20 rounded-md border border-neutral-800 bg-neutral-900 px-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:text-white"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="create-work-item-notes"
              className="block text-xs font-medium text-neutral-300 mb-1"
            >
              Initial Notes
            </label>
            <textarea
              id="create-work-item-notes"
              rows={2}
              value={notes}
              maxLength={5000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Initial notes or assigned task instructions..."
              className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            />
          </div>

          {/* Footer Actions */}
          <div className="mt-6 flex items-center justify-end gap-3 border-t border-neutral-900 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-neutral-900 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-white px-5 py-2 text-xs font-semibold text-neutral-950 hover:bg-neutral-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create Work Item"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
