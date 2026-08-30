import { useEffect, useState } from "react";
import type { Role, ShareLinkMetadata } from "@pagepilot/contracts";
import {
  createShareLink,
  getActiveShareLink,
  revokeShareLink,
} from "../api";

export interface ShareReportModalProps {
  projectId: string;
  pageId: string;
  auditRunId: string;
  role?: Role;
  onClose: () => void;
}

export function ShareReportModal({
  projectId,
  pageId,
  auditRunId,
  role = "member",
  onClose,
}: ShareReportModalProps) {
  const isViewer = role === "viewer";

  const [loading, setLoading] = useState(true);
  const [activeShare, setActiveShare] = useState<ShareLinkMetadata | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number>(30);
  const [newShareUrl, setNewShareUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial share status
  useEffect(() => {
    let cancelled = false;
    async function loadShare() {
      try {
        setLoading(true);
        setError(null);
        const metadata = await getActiveShareLink(projectId, pageId, auditRunId);
        if (!cancelled) {
          setActiveShare(metadata);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to load share status.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadShare();
    return () => {
      cancelled = true;
    };
  }, [projectId, pageId, auditRunId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleCreateShare = async () => {
    if (isViewer) return;
    try {
      setSubmitting(true);
      setError(null);
      const res = await createShareLink(projectId, pageId, auditRunId, {
        expiresInDays,
      });

      const fullUrl = `${window.location.origin}${res.shareLink.shareUrl}`;
      setNewShareUrl(fullUrl);
      setActiveShare({
        id: res.shareLink.id,
        auditRunId,
        auditReportId: "",
        expiresAt: res.shareLink.expiresAt ?? null,
        revokedAt: null,
        isRevoked: false,
        isExpired: false,
        createdAt: res.shareLink.createdAt,
        lastAccessedAt: null,
      });
    } catch (err: any) {
      setError(err.message || "Failed to create share link.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!activeShare || isViewer) return;
    try {
      setRevoking(true);
      setError(null);
      await revokeShareLink(projectId, activeShare.id);
      setActiveShare(null);
      setNewShareUrl(null);
      setConfirmRevoke(false);
    } catch (err: any) {
      setError(err.message || "Failed to revoke share link.");
    } finally {
      setRevoking(false);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-800 bg-neutral-950 p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 id="share-modal-title" className="text-base font-semibold text-white">
              Share Historical Audit Report
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Generate a secure, read-only link for this specific historical audit.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-xs text-neutral-400">
            Checking share status...
          </div>
        ) : (
          <div className="space-y-4">
            {isViewer && (
              <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-300">
                You have view-only permissions. Only workspace members, admins, and owners can create or revoke share links.
              </div>
            )}

            {/* Active share exists */}
            {activeShare && (
              <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-semibold text-neutral-200">
                      Active Share Link
                    </span>
                  </div>
                  {activeShare.expiresAt && (
                    <span className="text-[11px] text-neutral-400">
                      Expires: {new Date(activeShare.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {newShareUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={newShareUrl}
                        className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-mono text-neutral-200 select-all"
                      />
                      <button
                        type="button"
                        onClick={() => handleCopy(newShareUrl)}
                        className="shrink-0 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-medium text-white transition hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-white/80"
                      >
                        {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="text-[11px] text-emerald-400/90">
                      Link generated! Share this URL with anyone.
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-400">
                    A read-only link is active for this report. If you need a new share link or URL, you can revoke the current one and generate a fresh link.
                  </p>
                )}

                {/* Revoke Controls */}
                {!isViewer && (
                  <div className="pt-2 border-t border-neutral-800/80">
                    {confirmRevoke ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-red-400">
                          Revoke this link immediately?
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmRevoke(false)}
                            disabled={revoking}
                            className="rounded-lg border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleRevokeShare}
                            disabled={revoking}
                            className="rounded-lg border border-red-800 bg-red-950/80 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-red-900"
                          >
                            {revoking ? "Revoking..." : "Yes, Revoke"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(true)}
                        className="text-xs text-red-400 transition hover:text-red-300 underline"
                      >
                        Revoke share link
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No active share -> Create new */}
            {!activeShare && !isViewer && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="expiration-select"
                    className="block text-xs font-medium text-neutral-300 mb-1"
                  >
                    Link Expiration
                  </label>
                  <select
                    id="expiration-select"
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(Number(e.target.value))}
                    className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs text-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days (Recommended)</option>
                    <option value={90}>90 days</option>
                    <option value={365}>1 year</option>
                  </select>
                </div>

                <div className="rounded-lg border border-neutral-800/80 bg-neutral-900/40 p-3 text-xs text-neutral-400 space-y-1">
                  <p className="font-medium text-neutral-300">Read-Only Security Guarantee:</p>
                  <ul className="list-disc list-inside space-y-0.5 text-[11px] text-neutral-400">
                    <li>Recipients do not need a PagePilot account.</li>
                    <li>They can only view this exact historical snapshot.</li>
                    <li>Workspace, projects, pages, work items, and alerts remain private.</li>
                    <li>You can revoke this link at any time.</li>
                  </ul>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateShare}
                    disabled={submitting}
                    className="rounded-lg bg-white px-4 py-2 text-xs font-semibold text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-50"
                  >
                    {submitting ? "Generating..." : "Create Share Link"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
