import { enforceUrlPolicy } from "@pagepilot/contracts";

export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; message: string };

const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * Client-side normalization and validation for fast inline feedback. The
 * policy rules come from the shared module so client and server agree
 * exactly; the server remains authoritative. No network validation here.
 */
export function normalizeAndValidateUrl(raw: string): UrlValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Enter a website URL to analyze." };
  }

  const hasScheme = SCHEME_PATTERN.test(trimmed);
  const result = enforceUrlPolicy(hasScheme ? trimmed : `https://${trimmed}`);

  return result.ok
    ? { ok: true, url: result.url }
    : { ok: false, message: result.message };
}
