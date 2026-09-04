import { useEffect, useState } from "react";
import type {
  AuditScreenshotMetadata,
  ScreenshotDeviceType,
} from "@pagepilot/contracts";
import { VISUAL_EVIDENCE_LABEL } from "@pagepilot/contracts";
import { fetchAuditScreenshots } from "../api.js";

export interface ScreenshotPreviewCardProps {
  projectId?: string;
  pageId?: string;
  auditRunId?: string;
  screenshots?: AuditScreenshotMetadata[];
  isLoading?: boolean;
  error?: string | null;
}

export function ScreenshotPreviewCard({
  projectId,
  pageId,
  auditRunId,
  screenshots: initialScreenshots,
  isLoading: initialLoading,
  error: initialError,
}: ScreenshotPreviewCardProps) {
  const [screenshots, setScreenshots] = useState<AuditScreenshotMetadata[]>(
    initialScreenshots ?? []
  );
  const [isLoading, setIsLoading] = useState<boolean>(initialLoading ?? false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [selectedDevice, setSelectedDevice] =
    useState<ScreenshotDeviceType>("desktop");
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Sync if props change
  useEffect(() => {
    if (initialScreenshots !== undefined) {
      setScreenshots(initialScreenshots);
    }
  }, [initialScreenshots]);

  useEffect(() => {
    if (initialLoading !== undefined) {
      setIsLoading(initialLoading);
    }
  }, [initialLoading]);

  useEffect(() => {
    if (initialError !== undefined) {
      setError(initialError);
    }
  }, [initialError]);

  // Fetch screenshots if IDs are provided and screenshots not provided directly
  useEffect(() => {
    if (initialScreenshots !== undefined || !projectId || !pageId || !auditRunId) {
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetchAuditScreenshots(projectId, pageId, auditRunId)
      .then((res) => {
        if (!isMounted) return;
        setScreenshots(res.screenshots);
        // If only mobile exists, switch default to mobile
        const hasDesktop = res.screenshots.some((s) => s.deviceType === "desktop");
        if (!hasDesktop && res.screenshots.some((s) => s.deviceType === "mobile")) {
          setSelectedDevice("mobile");
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(
          err instanceof Error ? err.message : "Failed to load screenshots."
        );
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectId, pageId, auditRunId, initialScreenshots]);

  // Lightbox keyboard listener
  useEffect(() => {
    if (!isLightboxOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsLightboxOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLightboxOpen]);

  const desktopScreenshot = screenshots.find((s) => s.deviceType === "desktop");
  const mobileScreenshot = screenshots.find((s) => s.deviceType === "mobile");
  const currentScreenshot =
    selectedDevice === "desktop" ? desktopScreenshot : mobileScreenshot;

  return (
    <div
      data-testid="screenshot-preview-card"
      className="my-8 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60 p-5 shadow-xl transition-all"
    >
      {/* Header with Title & Badge */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="text-sm font-semibold tracking-wide text-neutral-100">
            Visual Page Capture
          </h3>
          <span
            data-testid="visual-evidence-badge"
            className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-950/50 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-sky-300"
            title="Evidence rendered inside sandboxed Chromium browser"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" />
            {VISUAL_EVIDENCE_LABEL}
          </span>
        </div>

        {/* Viewport Switcher Tabs */}
        {!isLoading && !error && screenshots.length > 0 && (
          <div
            role="tablist"
            aria-label="Screenshot device viewport switcher"
            className="inline-flex rounded-lg border border-neutral-800 bg-neutral-950 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedDevice === "desktop"}
              aria-controls="desktop-screenshot-panel"
              onClick={() => setSelectedDevice("desktop")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
                selectedDevice === "desktop"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80`}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8m-4-4v4" />
              </svg>
              Desktop (1280px)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedDevice === "mobile"}
              aria-controls="mobile-screenshot-panel"
              onClick={() => setSelectedDevice("mobile")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition ${
                selectedDevice === "mobile"
                  ? "bg-neutral-800 text-white shadow-sm"
                  : "text-neutral-400 hover:text-neutral-200"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80`}
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <rect x="5" y="2" width="14" height="20" rx="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
              Mobile (375px)
            </button>
          </div>
        )}
      </div>

      {/* Main Preview Container */}
      <div className="mt-4">
        {isLoading ? (
          <div
            data-testid="screenshot-loading"
            className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950/50 p-8 text-center"
          >
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <p className="mt-3 text-xs text-neutral-400">
              Loading browser visual evidence...
            </p>
          </div>
        ) : error ? (
          <div
            data-testid="screenshot-error"
            className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-red-900/40 bg-red-950/20 p-6 text-center"
          >
            <p className="text-xs font-medium text-red-300">
              Unable to load visual evidence: {error}
            </p>
          </div>
        ) : screenshots.length === 0 ? (
          <div
            data-testid="screenshot-empty"
            className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-neutral-950/30 p-6 text-center"
          >
            <p className="text-xs text-neutral-400">
              No browser visual evidence captured for this audit.
            </p>
            <p className="mt-1 text-[11px] text-neutral-500">
              Visual capture is automatically performed on scheduled and workspace runs.
            </p>
          </div>
        ) : currentScreenshot?.signedUrl ? (
          <div
            id={`${selectedDevice}-screenshot-panel`}
            role="tabpanel"
            className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950"
          >
            {/* Mock browser header frame */}
            <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-neutral-700" />
              </div>
              <span className="text-[11px] font-mono text-neutral-400">
                {currentScreenshot.width} × {currentScreenshot.height} px •{" "}
                {(currentScreenshot.fileSizeBytes / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400"
              >
                Expand View
              </button>
            </div>

            {/* Viewport Image Frame */}
            <div
              className={`flex justify-center bg-neutral-950 p-3 overflow-hidden ${
                selectedDevice === "mobile" ? "max-h-[500px]" : "max-h-[440px]"
              }`}
            >
              <img
                src={currentScreenshot.signedUrl}
                alt={`${currentScreenshot.deviceType} viewport screenshot captured at ${currentScreenshot.capturedAt}`}
                className={`cursor-zoom-in rounded border border-neutral-800/80 object-top transition duration-200 group-hover:scale-[1.01] ${
                  selectedDevice === "mobile"
                    ? "max-w-[320px] object-cover"
                    : "w-full object-cover"
                }`}
                onClick={() => setIsLightboxOpen(true)}
              />
            </div>
          </div>
        ) : (
          <div
            data-testid="screenshot-unavailable"
            className="flex min-h-[160px] flex-col items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950 p-6 text-center"
          >
            <p className="text-xs text-neutral-400">
              Screenshot for {selectedDevice} viewport is not available.
            </p>
          </div>
        )}
      </div>

      {/* Accessible Lightbox Modal */}
      {isLightboxOpen && currentScreenshot?.signedUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged screenshot preview"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-md"
          onClick={() => setIsLightboxOpen(false)}
        >
          <div
            className="relative flex max-h-[95vh] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/90 px-4 py-2.5">
              <span className="text-xs font-semibold text-neutral-200">
                {selectedDevice === "desktop" ? "Desktop Viewport" : "Mobile Viewport"} Preview
              </span>
              <button
                type="button"
                aria-label="Close screenshot preview"
                onClick={() => setIsLightboxOpen(false)}
                className="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-xs font-semibold text-neutral-200 transition hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Close (Esc)
              </button>
            </div>
            <div className="overflow-auto p-2">
              <img
                src={currentScreenshot.signedUrl}
                alt={`${currentScreenshot.deviceType} viewport full view`}
                className="max-h-[85vh] w-auto object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
