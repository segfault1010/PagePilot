import { useState } from "react";
import type { CreateProjectInput, Project, Role, UpdateProjectInput } from "@pagepilot/contracts";
import { ProjectModal } from "./project-modal";
import { DeleteConfirmModal } from "./delete-confirm-modal";

export interface ProjectListProps {
  projects: Project[];
  role: Role;
  isLoading: boolean;
  onSelectProject: (project: Project) => void;
  onCreateProject: (data: CreateProjectInput) => Promise<void>;
  onUpdateProject: (projectId: string, data: UpdateProjectInput) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
}

export function ProjectList({
  projects,
  role,
  isLoading,
  onSelectProject,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
}: ProjectListProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const canCreate = role !== "viewer";
  const canEdit = role !== "viewer";
  const canDelete = role === "owner" || role === "admin";

  const handleOpenCreate = () => {
    setEditingProject(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(p);
    setModalOpen(true);
  };

  const handleOpenDelete = (p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingProject(p);
  };

  const handleSave = async (data: CreateProjectInput | UpdateProjectInput) => {
    setIsSaving(true);
    try {
      if (editingProject) {
        await onUpdateProject(editingProject.id, data);
      } else {
        await onCreateProject(data as CreateProjectInput);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingProject) return;
    setIsDeleting(true);
    try {
      await onDeleteProject(deletingProject.id);
      setDeletingProject(null);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="h-6 w-32 animate-pulse rounded bg-neutral-800" />
          <div className="h-9 w-28 animate-pulse rounded bg-neutral-800" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-neutral-800 bg-neutral-900/50 p-5"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-100 sm:text-2xl">
            Projects
          </h1>
          <p className="mt-1 text-xs text-neutral-400">
            Manage your monitored landing page collections.
          </p>
        </div>

        {canCreate && (
          <button
            type="button"
            onClick={handleOpenCreate}
            className="inline-flex items-center justify-center rounded-lg bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          >
            + New Project
          </button>
        )}
      </div>

      {/* Empty State */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-800 bg-neutral-950/40 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-neutral-400">
            <svg
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-sm font-semibold text-neutral-200">
            No projects found
          </h2>
          <p className="mt-1 max-w-sm text-xs text-neutral-400">
            Create your first project to organize and monitor your landing pages.
          </p>
          {canCreate && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="mt-5 rounded-lg bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              Create Project
            </button>
          )}
        </div>
      ) : (
        /* Project Cards Grid */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => onSelectProject(project)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectProject(project);
                }
              }}
              className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-neutral-800/80 bg-neutral-900/40 p-5 transition hover:border-neutral-700 hover:bg-neutral-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-neutral-100 transition group-hover:text-white">
                    {project.name}
                  </h2>
                  <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={(e) => handleOpenEdit(project, e)}
                        aria-label={`Edit ${project.name}`}
                        className="rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/80"
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
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={(e) => handleOpenDelete(project, e)}
                        aria-label={`Delete ${project.name}`}
                        className="rounded p-1 text-neutral-400 transition hover:bg-red-950/50 hover:text-red-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
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
                    )}
                  </div>
                </div>

                {project.domain && (
                  <p className="mt-1 text-xs text-neutral-400">
                    {project.domain}
                  </p>
                )}

                {project.goals && (
                  <p className="mt-3 line-clamp-2 text-xs text-neutral-400">
                    {project.goals}
                  </p>
                )}
              </div>

              <div className="mt-5 flex items-center justify-between border-t border-neutral-800/60 pt-3 text-[11px] text-neutral-400">
                <span>{project.timezone}</span>
                <span className="font-medium text-neutral-400 transition group-hover:text-neutral-200">
                  View Pages &rarr;
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <ProjectModal
        isOpen={modalOpen}
        project={editingProject}
        isSaving={isSaving}
        onSave={handleSave}
        onClose={() => {
          setModalOpen(false);
          setEditingProject(null);
        }}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={Boolean(deletingProject)}
        title="Delete Project"
        message={`Are you sure you want to delete "${deletingProject?.name}"? All associated monitored pages, historical audit runs, reports, and recommendations will be permanently deleted.`}
        isDeleting={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingProject(null)}
      />
    </div>
  );
}
