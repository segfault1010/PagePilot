import { useEffect, useRef } from "react";
import type { ApiError } from "../../../../shared/audit-types";
import { API_ERROR_CODES } from "../../../../shared/audit-types";
import { NETWORK_ERROR_CODE } from "../api";

interface ErrorCopy {
  title: string;
  /** What happened and the likely reason — no internal details. */
  description: string;
  /** The concrete next step the user can take. */
  hint: string;
}

const COPY: Record<string, ErrorCopy> = {
  [NETWORK_ERROR_CODE]: {
    title: "Connection problem",
    description:
      "Your browser couldn't reach the analysis service. This is usually a local network or connection issue.",
    hint: "Check your connection, then try again.",
  },
  [API_ERROR_CODES.invalidUrl]: {
    title: "That URL can't be analyzed",
    description:
      "The address doesn't look like a valid public web page. PagePilot supports standard http:// and https:// websites.",
    hint: "Check the address for typos and try again.",
  },
  [API_ERROR_CODES.blockedDestination]: {
    title: "This destination isn't reachable",
    description:
      "The website couldn't be analyzed because its destination isn't publicly accessible. Private, local, and internal addresses are blocked to keep the service safe.",
    hint: "Try analyzing a publicly accessible URL instead.",
  },
  [API_ERROR_CODES.pageTooLarge]: {
    title: "That page is too large",
    description:
      "The page exceeds the size PagePilot can read in a single pass.",
    hint: "Try a lighter landing page, or a specific page rather than the full site.",
  },
  [API_ERROR_CODES.requestTooLarge]: {
    title: "Request too large",
    description: "The analysis request exceeded its size limit.",
    hint: "Please try again.",
  },
  [API_ERROR_CODES.nonHtmlResponse]: {
    title: "That isn't an HTML page",
    description:
      "PagePilot audits HTML landing pages. PDFs, images, and other file types aren't supported.",
    hint: "Try the web address of an HTML page instead.",
  },
  [API_ERROR_CODES.rateLimited]: {
    title: "Too many requests",
    description:
      "You've hit a temporary limit to keep the service available for everyone.",
    hint: "Wait a few minutes, then try again.",
  },
  [API_ERROR_CODES.upstreamFailure]: {
    title: "Analysis engine unavailable",
    description:
      "The website or analysis service couldn't be reached this time. This is often temporary.",
    hint: "Try again in a moment.",
  },
  [API_ERROR_CODES.timeout]: {
    title: "The analysis timed out",
    description:
      "The site took too long to respond, so the audit was stopped before it could finish.",
    hint: "Give it another try — slow sites sometimes succeed on retry.",
  },
  [API_ERROR_CODES.missingConfiguration]: {
    title: "Analysis is temporarily unavailable",
    description:
      "The service isn't configured correctly right now. This isn't something you can fix.",
    hint: "Please try again later.",
  },
};

const FALLBACK_COPY: ErrorCopy = {
  title: "Something went wrong",
  description: "An unexpected problem stopped the analysis.",
  hint: "Please try again.",
};

export function ErrorState({
  error,
  url,
  onRetry,
  onEditUrl,
}: {
  error: ApiError;
  url: string;
  onRetry: () => void;
  onEditUrl: () => void;
}) {
  const copy = COPY[error.code] ?? FALLBACK_COPY;
  const retryRef = useRef<HTMLButtonElement>(null);

  // Move focus to the primary recovery action so keyboard and screen-reader
  // users can act immediately after the failure is announced.
  useEffect(() => {
    retryRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center px-6 py-20 text-center">
      <h1 className="sr-only">Analysis failed</h1>
      <div role="alert" className="fade-rise">
        <p
          aria-hidden="true"
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-neutral-700 text-xl text-neutral-300"
        >
          !
        </p>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight text-neutral-50 sm:text-3xl">
          {copy.title}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-400">
          {copy.description}
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-neutral-200">
          {copy.hint}
        </p>
      </div>
      {url && (
        <p className="mt-8 break-all rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          <span className="text-neutral-500">URL: </span>
          {url}
        </p>
      )}
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <button
          ref={retryRef}
          type="button"
          onClick={onRetry}
          className="h-11 w-full rounded-lg bg-white px-6 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 sm:w-auto"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onEditUrl}
          className="h-11 w-full rounded-lg border border-neutral-700 px-6 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 sm:w-auto"
        >
          Edit URL
        </button>
      </div>
      {/* Server envelope messages are sanitized product copy (never provider
          or network internals), so they're safe to show as a footnote. */}
      {error.message !== "" && (
        <p className="mt-6 text-xs leading-5 text-neutral-600">
          {error.message}
        </p>
      )}
    </section>
  );
}
