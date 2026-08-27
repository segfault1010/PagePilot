import { useEffect, useRef, useState } from "react";
import type {
  CreateMonitoredPageInput,
  MonitoredPage,
  UpdateMonitoredPageInput,
} from "@pagepilot/contracts";
import { enforceUrlPolicy } from "@pagepilot/contracts";

export interface MonitoredPageModalProps {
  isOpen: boolean;
  page?: MonitoredPage | null;
  isSaving?: boolean;
  onSave: (data: CreateMonitoredPageInput | UpdateMonitoredPageInput) => Promise<void>;
  onClose: () => void;
}

export function MonitoredPageModal({
  isOpen,
  page,
  isSaving = false,
  onSave,
  onClose,
}: MonitoredPageModalProps) {
  const isEditing = Boolean(page);
  const [url, setUrl] = useState(page?.canonicalUrl ?? "");
  const [cadence, setCadence] = useState<"weekly">("weekly");
  const [status, setStatus] = useState<"active" | "paused">(
    page?.status === "paused" ? "paused" : "active",
  );
  const [tagsInput, setTagsInput] = useState((page?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);

  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setUrl(page?.canonicalUrl ?? "");
      setCadence("weekly");
      setStatus(page?.status === "paused" ? "paused" : "active");
      setTagsInput((page?.tags ?? []).join(", "));
      setError(null);
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  }, [isOpen, page]);

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

    // Validate URL security policy
    const policyRes = enforceUrlPolicy(url.trim());
    if (!policyRes.ok) {
      setError(policyRes.message);
      return;
    }
    const canonicalUrl = policyRes.url;

    const parsedTags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      canonicalUrl,
      cadence,
      status,
      tags: parsedTags,
    };

    try {
      await onSave(payload);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save monitored page.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="page-modal-title"
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
          id="page-modal-title"
          className="text-lg font-semibold text-neutral-100"
        >
          {isEditing ? "Edit Monitored Page" : "Add Monitored Page"}
        </h2>
        <p className="mt-1 text-xs text-neutral-400">
          {isEditing
            ? "Update monitored page URL, status, and tags."
            : "Register a landing page URL to monitor its UX performance over time."}
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
              htmlFor="page-url"
              className="block text-xs font-medium text-neutral-300"
            >
              Landing Page URL <span className="text-red-400">*</span>
            </label>
            <input
              ref={urlInputRef}
              id="page-url"
              type="url"
              required
              placeholder="https://example.com/pricing"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="page-cadence"
                className="block text-xs font-medium text-neutral-300"
              >
                Cadence
              </label>
              <select
                id="page-cadence"
                value={cadence}
                onChange={(e) => setCadence(e.target.value as "weekly")}
                className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <option value="weekly">Weekly</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="page-status"
                className="block text-xs font-medium text-neutral-300"
              >
                Status
              </label>
              <select
                id="page-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "paused")}
                className="mt-1.5 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3.5 py-2 text-sm text-neutral-100 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="page-tags"
              className="block text-xs font-medium text-neutral-300"
            >
              Tags (Comma separated)
            </label>
            <input
              id="page-tags"
              type="text"
              placeholder="e.g. pricing, hero-redesign, mobile"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
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
              disabled={isSaving || !url.trim()}
              className="rounded-lg bg-neutral-50 px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : isEditing ? "Save Changes" : "Add Page"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
