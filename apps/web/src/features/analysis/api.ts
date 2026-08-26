import type { ApiError, Report } from "@pagepilot/contracts";
import {
  analyzeErrorResponseSchema,
  analyzeSuccessResponseSchema,
} from "@pagepilot/contracts";

export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

const GENERIC_FAILURE: ApiError = {
  code: "UPSTREAM_FAILURE",
  message: "Received an unexpected response from the analysis service.",
  retryable: true,
};

export type AnalyzeResult =
  | { ok: true; report: Report }
  | { ok: false; error: ApiError };

/**
 * Same-origin client for POST /api/analyze. Relative URL only — no
 * hardcoded hosts. Every response is schema-validated; malformed payloads
 * and network failures become predictable ApiError values.
 */
export async function analyzeUrl(url: string): Promise<AnalyzeResult> {
  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      error: {
        code: NETWORK_ERROR_CODE,
        message:
          "Couldn't reach the analysis service. Check your connection and try again.",
        retryable: true,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: GENERIC_FAILURE };
  }

  if (!response.ok) {
    const parsed = analyzeErrorResponseSchema.safeParse(payload);
    return {
      ok: false,
      error: parsed.success ? parsed.data.error : GENERIC_FAILURE,
    };
  }

  const parsed = analyzeSuccessResponseSchema.safeParse(payload);
  return parsed.success
    ? { ok: true, report: parsed.data.report }
    : { ok: false, error: GENERIC_FAILURE };
}
