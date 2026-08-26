// Pipeline
export { analyzeTarget } from "./pipeline.js";
export type {
  AnalysisOutcome,
  AnalysisSuccess,
  AnalysisFailure,
  PipelineDeps,
} from "./pipeline.js";

// Fetch & Network Policy
export {
  createSafeFetcher,
  SafeFetchError,
  MAX_PAGE_BYTES,
  FETCH_DEADLINE_MS,
  MAX_REDIRECTS,
} from "./fetch/safe-fetch.js";
export type {
  SafeFetchErrorKind,
  FetchedPage,
  OpenStreamFn,
  SafeFetcherOptions,
} from "./fetch/safe-fetch.js";
export { isPubliclyRoutableAddress } from "./fetch/ip-policy.js";
export { defaultDnsResolver } from "./fetch/resolver.js";
export type { DnsResolver, ResolvedAddress } from "./fetch/resolver.js";

// Extract
export {
  buildPageSnapshot,
  TEXT_EXCERPT_LIMIT,
} from "./extract/page-snapshot.js";
export type {
  PageSnapshot,
  HeadingOutlineEntry,
  LinkSample,
  FormSample,
  CtaCandidate,
} from "./extract/page-snapshot.js";
export {
  runDeterministicChecks,
  SIGNAL_IDS,
} from "./extract/deterministic-checks.js";

// AI Adapter & Model Input
export {
  createGeminiAuditor,
  DEFAULT_GEMINI_MODEL,
  AiError,
} from "./ai/gemini-auditor.js";
export type {
  AiFailureKind,
  UxAuditProvider,
  GeminiAuditorOptions,
} from "./ai/gemini-auditor.js";
export {
  buildAuditModelInput,
  serializeModelInput,
  MODEL_INPUT_MAX_CHARS,
} from "./ai/audit-input.js";
export type { AuditModelInput } from "./ai/audit-input.js";

// Schemas & Validation
export {
  GEMINI_STRING_LIMITS,
  geminiAuditSchema,
  geminiAuditShapeSchema,
  geminiWireShapeSchema,
  parseGeminiAuditOutput,
  geminiResponseJsonSchema,
  checkSignalReferences,
} from "./schemas/audit.js";
export type {
  GeminiAudit,
  GeminiFinding,
  GeminiTopProblem,
  ParseOutcome,
  SignalReferenceCheck,
} from "./schemas/audit.js";

// Scoring & Report Building
export {
  CATEGORY_WEIGHTS,
  BLEND_COVERAGE_THRESHOLD,
  GEMINI_SCORE_SHARE,
  BASELINE_SCORE_SHARE,
  computeDeterministicBaseline,
  round,
  scoreCategory,
  scoreAllCategories,
  computeReportConfidence,
  computeOverallScore,
  buildReport,
} from "./scoring/score-report.js";
export type {
  DeterministicBaseline,
  ScoredCategory,
  BuildReportParams,
} from "./scoring/score-report.js";
