import { useState } from "react";
import type {
  CreateMonitoredPageInput,
  MonitoredPage,
  Project,
  Role,
  UpdateMonitoredPageInput,
} from "@pagepilot/contracts";
import { MonitoredPageModal } from "./monitored-page-modal";
import { DeleteConfirmModal } from "./delete-confirm-modal";

export interface ProjectDetailProps {
  project: Project;
  pages: MonitoredPage[];
  role: Role;
  isLoading: boolean;
  onBackToProjects: () => void;
  onSelectPage: (page: MonitoredPage) => void;
  onCreatePage: (data: CreateMonitoredPageInput) => Promise<void>;
  onUpdatePage: (pageId: string, data: UpdateMonitoredPageInput) => Promise<void>;
  onDeletePage: (pageId: string) => Promise<void>;
}

export function ProjectDetail({
  project,
  pages,
  role,
  isLoading,
  onBackToProjects,
  onSelectPage,
  onCreatePage,
  onUpdatePage,
  onDeletePage,
}: ProjectDetailProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<MonitoredPage | null>(null);
  const [deletingPage, setDeletingPage] = useState<MonitoredPage | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canManage = role !== "viewer";

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

      {project.goals && (
        <div className="rounded-xl border border-neutral-800/60 bg-neutral-900/30 p-4 text-xs text-neutral-300">
          <span className="font-semibold text-neutral-200">Goals: </span>
          {project.goals}
        </div>
      )}

      {/* Monitored Pages List */}
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-neutral-300">
          Monitored Landing Pages ({pages.length})
        </h2>

        {isLoading ? (
          <div className="mt-3 space-y-2">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/50 p-4"
              />
            ))}
          </div>
        ) : pages.length === 0 ? (
          <div className="mt-3 flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-14 text-center">
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
          <div className="mt-3 space-y-2">
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
    </div>
  );
}
