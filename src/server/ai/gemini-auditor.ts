import type { GeminiAudit } from "../schemas/audit";
import { geminiResponseJsonSchema, parseGeminiAuditOutput } from "../schemas/audit";
import type { AuditModelInput } from "./audit-input";
import { serializeModelInput } from "./audit-input";

/**
 * Focused Gemini adapter (Phase 5). All provider-specific logic lives here:
 * endpoint shape, prompts, generation limits, timeouts, and response
 * parsing/validation. Nothing else in the server knows how Gemini is called,
 * and neither GEMINI_API_KEY nor any model input/output ever leaves this
 * module except as the validated GeminiAudit result.
 *
 * Raw HTML never reaches this layer — callers pass a bounded AuditModelInput
 * built from the PageSnapshot and deterministic signals.
 */

/** Current fast structured-output model default; override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

// Leaves headroom inside the 30 s function budget after an 8 s worst-case
// page fetch; thinking-enabled Flash models can run long under load.
const REQUEST_TIMEOUT_MS = 22_000;
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0.2;

const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

export type AiFailureKind =
  | "configuration"
  | "unavailable"
  | "timeout"
  | "invalid-response";

/**
 * Typed AI failure. Carries only classification data — never provider
 * payloads, stack traces, prompts, or responses — so it is always safe to
 * handle upstream.
 */
export class AiError extends Error {
  readonly kind: AiFailureKind;
  /** Optional sanitized detail (e.g. HTTP status code). Safe to log. */
  readonly detail?: string;

  constructor(kind: AiFailureKind, detail?: string) {
    super(`AI audit failed: ${kind}`);
    this.name = "AiError";
    this.kind = kind;
    this.detail = detail;
  }
}

export interface UxAuditProvider {
  runAudit(input: AuditModelInput): Promise<GeminiAudit>;
}

export interface GeminiAuditorOptions {
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const SYSTEM_INSTRUCTION = `You are a senior UX/product designer and conversion-focused reviewer auditing landing pages for PagePilot.

You receive a bounded evidence pack for exactly one page: metadata, heading outline, a visible-text excerpt, small samples of links/buttons/forms/navigation/CTA candidates, image accessibility statistics, viewport/language/canonical/Open Graph facts, and deterministic signals that PagePilot measured directly from the page's HTML.

Follow these rules without exception:
1. Analyze ONLY the evidence provided. Never invent facts about the page, its traffic, its business, or its users.
2. Set each finding's "basis" to "observed" only when it directly cites provided evidence or deterministic signal IDs; otherwise set it to "inferred" for your professional interpretation.
3. Reference deterministic signal IDs only from the provided "deterministicSignals" list, and only where they genuinely support the finding. Use [] when none apply.
4. You cannot measure page speed, Core Web Vitals, exact visual contrast ratios, actual mobile rendering, conversion rates, analytics, or user behavior. Never claim or imply such measurements. Mobile UX reasoning must rest on viewport tags, form/control evidence, and clearly labeled inference.
5. Prioritize meaningful problems over trivia; recommendations must be specific to this page's evidence, not generic best practices.
6. Severity: "high" = likely to seriously hurt clarity, trust, or conversions; "medium" = notable friction; "low" = minor polish.
7. Each category score is an integer 0-100 judging UX quality from the evidence alone.
8. Output structure and exact counts: "categories" holds EXACTLY seven entries (one per key, no duplicates) with score/explanation/severity only — findings are NOT nested there. Every finding goes in the single top-level "findings" array with "categoryKey" set to its category; at most three findings per category across the whole list (21 maximum). "topProblems" holds EXACTLY three entries; "quickWins" holds three to five.
9. Respond with a single JSON object matching the required schema exactly — no markdown fences, no commentary, no additional properties.`;

/**
 * Rules travel in the user message: sending them as a separate
 * `systemInstruction` alongside `responseJsonSchema` is rejected as
 * INVALID_ARGUMENT by the API (verified live), while the identical text in
 * the user turn is accepted.
 */
function buildUserPrompt(serializedInput: string): string {
  return [
    SYSTEM_INSTRUCTION,
    "",
    "Audit this landing-page evidence now.",
    "",
    "EVIDENCE:",
    serializedInput,
  ].join("\n");
}

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/**
 * Thinking reduction keeps structured audits inside the latency budget
 * (default thinking regularly exceeded 20 s under load). Field names differ
 * per model generation; unknown models get no thinking settings.
 */
function thinkingConfigFor(model: string): Record<string, unknown> | undefined {
  if (/^gemini-[3-9]\./.test(model)) return { thinkingLevel: "low" };
  if (/^gemini-2\.5\./.test(model)) return { thinkingBudget: 0 };
  return undefined;
}

export function createGeminiAuditor(options: GeminiAuditorOptions = {}): UxAuditProvider {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? "";
  const model = options.model?.trim() || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  // Sanitized configuration diagnostic: model name and key PRESENCE only —
  // never the key value, prompt, or response.
  console.error(
    `[ai] gemini auditor configured: model=${model} key=${apiKey.length > 0 ? "present" : "missing"}`,
  );

  return {
    async runAudit(input: AuditModelInput): Promise<GeminiAudit> {
      if (apiKey.length === 0) {
        // Fail before touching the network; the key is never echoed anywhere.
        throw new AiError("configuration", "GEMINI_API_KEY is not configured");
      }

      let serializedEvidence: string;
      try {
        serializedEvidence = serializeModelInput(input);
      } catch (error) {
        throw new AiError(
          "invalid-response",
          error instanceof Error ? error.message : undefined,
        );
      }

      const sendRequest = async (
        extraConfig?: Record<string, unknown>,
      ): Promise<Response> => {
        try {
          return await fetchFn(
            `${API_ROOT}/${encodeURIComponent(model)}:generateContent`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
              },
              body: JSON.stringify({
                contents: [
                  { role: "user", parts: [{ text: buildUserPrompt(serializedEvidence) }] },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                  responseJsonSchema: geminiResponseJsonSchema(),
                  temperature: TEMPERATURE,
                  maxOutputTokens: MAX_OUTPUT_TOKENS,
                  ...extraConfig,
                },
              }),
              signal: AbortSignal.timeout(timeoutMs),
            },
          );
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError")
          ) {
            throw new AiError("timeout", `no response within ${timeoutMs}ms`);
          }
          throw new AiError("unavailable", "request failed");
        }
      };

      // One bounded compatibility fallback: if the model generation rejects
      // the thinking settings outright, retry once without them.
      const thinking = thinkingConfigFor(model);
      let response = await sendRequest(thinking ? { thinkingConfig: thinking } : undefined);
      if (!response.ok && response.status === 400 && thinking) {
        console.error("[ai] retrying once without thinking settings");
        response = await sendRequest(undefined);
      }

      if (!response.ok) {
        const kind = response.status === 401 || response.status === 403
          ? "configuration"
          : "unavailable";
        console.error(
          `[ai] gemini request failed: kind=${kind} status=${response.status}`,
        );
        throw new AiError(kind, `http ${response.status}`);
      }

      let payload: GenerateContentResponse;
      try {
        payload = (await response.json()) as GenerateContentResponse;
      } catch {
        throw new AiError("invalid-response", "unparseable envelope");
      }

      const blockedBy = payload.promptFeedback?.blockReason;
      if (blockedBy) {
        console.error(`[ai] gemini response blocked: reason=${blockedBy}`);
        throw new AiError("unavailable", "response blocked");
      }

      const candidate = payload.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        throw new AiError("invalid-response", `finishReason=${finishReason}`);
      }
      const text = candidate?.content?.parts?.map((part) => part.text ?? "").join("");
      if (!text || text.trim().length === 0) {
        throw new AiError("invalid-response", "empty completion");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AiError("invalid-response", "model output was not valid JSON");
      }
      const outcome = parseGeminiAuditOutput(parsed);
      if (!outcome.ok) {
        // Log only the failure stage, never content.
        console.error(`[ai] gemini output rejected: ${outcome.reason}`);
        throw new AiError("invalid-response", "schema validation failed");
      }
      return outcome.audit;
    },
  };
}
