import type { ApiError } from "../../../../shared/audit-types";
import { API_ERROR_CODES } from "../../../../shared/audit-types";
import { NETWORK_ERROR_CODE } from "../api";

const COPY: Record<string, { title: string; description: string }> = {
  [NETWORK_ERROR_CODE]: {
    title: "Connection problem",
    description:
      "We couldn't reach the analysis service. Check your connection and try again.",
  },
  [API_ERROR_CODES.invalidUrl]: {
    title: "That URL can't be analyzed",
    description:
      "Check the address and try again. PagePilot analyzes public http:// and https:// pages.",
  },
  [API_ERROR_CODES.blockedDestination]: {
    title: "This destination isn't reachable",
    description:
      "PagePilot only audits public websites. Private, local, or blocked addresses can't be analyzed.",
  },
  [API_ERROR_CODES.pageTooLarge]: {
    title: "That page is too large",
    description:
      "The page exceeds the size PagePilot can process. Try a lighter landing page.",
  },
  [API_ERROR_CODES.nonHtmlResponse]: {
    title: "That isn't an HTML page",
    description:
      "PagePilot analyzes HTML landing pages. PDFs, images, and other file types aren't supported.",
  },
  [API_ERROR_CODES.requestTooLarge]: {
    title: "Request too large",
    description:
      "The analysis request exceeded its size limit. Please try again.",
  },
  [API_ERROR_CODES.rateLimited]: {
    title: "Too many requests",
    description:
      "You've hit a temporary limit. Wait a few minutes and try again.",
  },
  [API_ERROR_CODES.upstreamFailure]: {
    title: "Analysis engine unavailable",
    description:
      "We couldn't complete the audit this time. Please try again in a moment.",
  },
  [API_ERROR_CODES.timeout]: {
    title: "The analysis timed out",
    description:
      "The site took too long to respond. Give it another try — slow sites sometimes succeed on retry.",
  },
  [API_ERROR_CODES.missingConfiguration]: {
    title: "Analysis is temporarily unavailable",
    description:
      "The service is missing configuration. This isn't something you can fix — please try again later.",
  },
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
  const copy =
    COPY[error.code] ?? {
      title: "Something went wrong",
      description:
        "An unexpected problem stopped the analysis. Please try again.",
    };

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
      </div>
      {url && (
        <p className="mt-8 break-all rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          <span className="text-neutral-500">URL: </span>
          {url}
        </p>
      )}
      <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onRetry}
          className="h-11 rounded-lg bg-white px-6 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onEditUrl}
          className="h-11 rounded-lg border border-neutral-700 px-6 text-sm font-semibold text-neutral-200 transition-colors hover:border-neutral-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        >
          Edit URL
        </button>
      </div>
      <p className="mt-6 text-xs leading-5 text-neutral-600">{error.message}</p>
    </section>
  );
}
