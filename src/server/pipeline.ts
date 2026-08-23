import { createSafeFetcher, SafeFetchError } from "./fetch/safe-fetch";
import { buildPageSnapshot } from "./extract/page-snapshot";
import { runDeterministicChecks } from "./extract/deterministic-checks";
import { API_ERROR_CODES } from "../shared/audit-types";
import type { DetectedSignal } from "../shared/audit-types";

export interface AnalysisSuccess {
  finalUrl: string;
  /** Real deterministic evidence for the page, keyed by stable signal IDs. */
  signals: DetectedSignal[];
}

export interface AnalysisFailure {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}

export type AnalysisOutcome =
  | ({ ok: true } & AnalysisSuccess)
  | ({ ok: false } & AnalysisFailure);

/**
 * Phase 4 pipeline: safe fetch → snapshot → deterministic checks. No AI
 * scoring happens here; Phase 5 will merge these signals with Gemini output.
 */
export async function analyzeTarget(rawUrl: string): Promise<AnalysisOutcome> {
  const fetchPage = createSafeFetcher();

  let page;
  try {
    page = await fetchPage(rawUrl);
  } catch (error) {
    if (!(error instanceof SafeFetchError)) throw error;
    return { ok: false, ...mapFetchFailure(error) };
  }

  try {
    const snapshot = buildPageSnapshot(page.body, page.finalUrl);
    return {
      ok: true,
      finalUrl: page.finalUrl,
      signals: runDeterministicChecks(snapshot),
    };
  } catch {
    // Malformed HTML that Cheerio cannot make sense of still yields a
    // snapshot in practice; any unexpected parser failure is classified,
    // never leaked.
    return {
      ok: false,
      status: 502,
      code: API_ERROR_CODES.upstreamFailure,
      message: "The page could not be processed.",
      retryable: false,
    };
  }
}

function mapFetchFailure(error: SafeFetchError): AnalysisFailure {
  switch (error.kind) {
    case "BLOCKED_DESTINATION":
      return {
        status: 403,
        code: API_ERROR_CODES.blockedDestination,
        message:
          "This destination isn't reachable. PagePilot only analyzes public websites.",
        retryable: false,
      };
    case "INVALID_URL":
      return {
        status: 400,
        code: API_ERROR_CODES.invalidUrl,
        message: error.message,
        retryable: false,
      };
    case "REQUEST_TOO_LARGE":
      return {
        status: 413,
        code: API_ERROR_CODES.pageTooLarge,
        message: "That page exceeds the size PagePilot can process.",
        retryable: false,
      };
    case "NON_HTML_RESPONSE":
      return {
        status: 422,
        code: API_ERROR_CODES.nonHtmlResponse,
        message: "PagePilot analyzes HTML landing pages.",
        retryable: false,
      };
    case "TIMEOUT":
      return {
        status: 504,
        code: API_ERROR_CODES.timeout,
        message: "The site took too long to respond. Give it another try.",
        retryable: true,
      };
    case "UPSTREAM_FAILURE":
      return {
        status: 502,
        code: API_ERROR_CODES.upstreamFailure,
        message: "We couldn't complete the audit this time. Please try again shortly.",
        retryable: true,
      };
  }
}
