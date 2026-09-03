import { useEffect } from "react";
import type { IntegrationConnection } from "@pagepilot/contracts";

export interface DeleteIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  integration: IntegrationConnection | null;
  isDeleting: boolean;
}

export function DeleteIntegrationModal({
  isOpen,
  onClose,
  onConfirm,
  integration,
  isDeleting,
}: DeleteIntegrationModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isDeleting, onClose]);

  if (!isOpen || !integration) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-integration-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Icon & Title */}
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-red-900/60 bg-red-950/40 text-red-400">
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
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <div>
            <h2
              id="delete-integration-title"
              className="text-base font-semibold text-neutral-100"
            >
              Delete Integration
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Are you sure you want to delete{" "}
              <strong className="text-neutral-200">{integration.name}</strong>?
            </p>
          </div>
        </div>

        {/* Impact Warning Notice */}
        <div className="mt-4 rounded-xl border border-neutral-800 bg-neutral-950/70 p-3.5 text-xs text-neutral-400 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-neutral-500">Destination:</span>
            <span className="font-mono text-[11px] text-neutral-300 truncate">
              {integration.maskedTargetUrl}
            </span>
          </div>
          <p className="text-[11px] text-amber-400/90">
            Outbound notifications for subscribed regressions will permanently cease delivery to this endpoint. This action cannot be undone.
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-lg border border-neutral-800 px-4 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <svg
                  className="h-3.5 w-3.5 animate-spin text-white"
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
                <span>Deleting...</span>
              </>
            ) : (
              <span>Delete Integration</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
