import { useEffect, useRef, useState } from "react";
import type { CreateProjectInput, Project, UpdateProjectInput } from "@pagepilot/contracts";
import { createProjectSchema, updateProjectSchema } from "@pagepilot/contracts";

export interface ProjectModalProps {
  isOpen: boolean;
  project?: Project | null;
  isSaving?: boolean;
  onSave: (data: CreateProjectInput | UpdateProjectInput) => Promise<void>;
  onClose: () => void;
}

export function ProjectModal({
  isOpen,
  project,
  isSaving = false,
  onSave,
  onClose,
}: ProjectModalProps) {
  const isEditing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [domain, setDomain] = useState(project?.domain ?? "");
  const [timezone, setTimezone] = useState(project?.timezone ?? "UTC");
  const [goals, setGoals] = useState(project?.goals ?? "");
  const [error, setError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(project?.name ?? "");
      setDomain(project?.domain ?? "");
      setTimezone(project?.timezone ?? "UTC");
      setGoals(project?.goals ?? "");
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isOpen, project]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const payload = {
      name: name.trim(),
      domain: domain.trim() ? domain.trim() : null,
      timezone: timezone.trim() || "UTC",
      goals: goals.trim() ? goals.trim() : null,
    };

    const schema = isEditing ? updateProjectSchema : createProjectSchema;
    const parseRes = schema.safeParse(payload);
    if (!parseRes.success) {
      setError(parseRes.error.issues[0]?.message ?? "Invalid project data.");
      return;
    }

    try {
      await onSave(parseRes.data);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save project.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm transition-opacity"
        onClick={() => {
          if (!isSaving) onClose();
        }}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl">
        <h2
          id="project-modal-title"
          className="text-lg font-semibold text-neutral-100"
        >
          {isEditing ? "Edit Project" : "Create New Project"}
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          {isEditing
            ? "Update project details and settings."
            : "Group related landing pages and audit history under a project."}
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-900/50 bg-red-950/40 p-3 text-xs text-red-300"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="project-name"
              className="block text-xs font-medium text-neutral-300"
            >
              Project Name <span className="text-red-400">*</span>
            </label>
            <input
              ref={nameInputRef}
              id="project-name"
              type="text"
              required
              maxLength={100}
              placeholder="e.g. Marketing Website"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>

          <div>
            <label
              htmlFor="project-domain"
              className="block text-xs font-medium text-neutral-300"
            >
              Primary Domain (Optional)
            </label>
            <input
              id="project-domain"
              type="text"
              placeholder="e.g. acme.com or https://acme.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>

          <div>
            <label
              htmlFor="project-timezone"
              className="block text-xs font-medium text-neutral-300"
            >
              Timezone
            </label>
            <input
              id="project-timezone"
              type="text"
              placeholder="UTC"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>

          <div>
            <label
              htmlFor="project-goals"
              className="block text-xs font-medium text-neutral-300"
            >
              Project Goals (Optional)
            </label>
            <textarea
              id="project-goals"
              rows={2}
              maxLength={500}
              placeholder="e.g. Optimize sign-up conversion and clarify pricing page CTA."
              value={goals}
              onChange={(e) => setGoals(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !name.trim()}
              className="rounded-lg bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : isEditing ? "Save Changes" : "Create Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
