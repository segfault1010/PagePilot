import { createSafeFetcher, SafeFetchError } from "./fetch/safe-fetch.js";
import { buildPageSnapshot } from "./extract/page-snapshot.js";
import { runDeterministicChecks } from "./extract/deterministic-checks.js";
import { createGeminiAuditor, AiError, DEFAULT_GEMINI_MODEL } from "./ai/gemini-auditor.js";
import type { UxAuditProvider } from "./ai/gemini-auditor.js";
import { buildAuditModelInput } from "./ai/audit-input.js";
import { checkSignalReferences, geminiAuditSchema } from "./schemas/audit.js";
import { buildReport } from "./scoring/score-report.js";
import { API_ERROR_CODES } from "@pagepilot/contracts";
import type { Report } from "@pagepilot/contracts";

export interface AnalysisSuccess {
  report: Report;
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

export interface PipelineDeps {
  /** Injectable for tests; production builds the real Gemini adapter. */
  auditor?: UxAuditProvider;
}

const GENERIC_AI_FAILURE = {
  status: 502,
  code: API_ERROR_CODES.upstreamFailure,
  message:
    "We couldn't complete the audit this time. Please try again shortly.",
  retryable: true,
} as const;

/**
 * Full Phase 5 pipeline: safe fetch → snapshot → deterministic signals →
 * Gemini structured audit (validated) → signal-reference check → server-side
 * scoring → contract-valid report.
 *
 * Fetch failures keep their Phase 4 mappings; every AI failure collapses to
 * one of four safe envelopes (503 missing config, 502 provider/schema
 * failure, 504 timeout). Raw prompts, model output, and provider details
 * never cross this boundary.
 */
export async function analyzeTarget(
  rawUrl: string,
  deps: PipelineDeps = {},
): Promise<AnalysisOutcome> {
  const fetchPage = createSafeFetcher();

  let page;
  try {
    page = await fetchPage(rawUrl);
  } catch (error) {
    if (!(error instanceof SafeFetchError)) throw error;
    return { ok: false, ...mapFetchFailure(error) };
  }

  let snapshot;
  let signals;
  try {
    snapshot = buildPageSnapshot(page.body, page.finalUrl);
    signals = runDeterministicChecks(snapshot);
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

  const auditor = deps.auditor ?? defaultAuditor();
  let audit;
  try {
    audit = await auditor.runAudit(buildAuditModelInput(snapshot, rawUrl, signals));
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, ...mapAiFailure(error) };
  }

  // Defense-in-depth: re-validate at the pipeline boundary so no provider
  // (including test doubles) can smuggle malformed data into scoring.
  const validated = geminiAuditSchema.safeParse(audit);
  if (!validated.success) {
    console.error("[ai] audit failed schema validation before scoring");
    return { ok: false, ...GENERIC_AI_FAILURE };
  }
  audit = validated.data;

  // The model may only reference deterministic signals that exist for THIS
  // page; anything else is an invented evidence reference.
  const references = checkSignalReferences(audit, new Set(signals.map((s) => s.id)));
  if (!references.ok) {
    console.error(
      `[ai] audit referenced unknown signal ids (${references.invalidIds.length})`,
    );
    return { ok: false, ...GENERIC_AI_FAILURE };
  }

  return {
    ok: true,
    report: buildReport({
      requestedUrl: rawUrl,
      finalUrl: page.finalUrl,
      title: snapshot.title,
      analyzedAt: new Date(),
      signals,
      audit,
    }),
  };
}

function defaultAuditor(): UxAuditProvider {
  return createGeminiAuditor({ model: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL });
}

function mapAiFailure(error: AiError): AnalysisFailure {
  switch (error.kind) {
    case "configuration":
      return {
        status: 503,
        code: API_ERROR_CODES.missingConfiguration,
        message:
          "The service is missing configuration. This isn't something you can fix — please try again later.",
        retryable: false,
      };
    case "timeout":
      return {
        status: 504,
        code: API_ERROR_CODES.timeout,
        message:
          "The analysis took too long to complete. Give it another try.",
        retryable: true,
      };
    case "unavailable":
    case "invalid-response":
      return { ...GENERIC_AI_FAILURE };
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
