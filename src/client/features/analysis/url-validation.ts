export type UrlValidation =
  | { ok: true; url: string }
  | { ok: false; message: string };

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Client-side normalization and syntax validation only. The server remains
 * authoritative for security rules (private destinations, ports, redirects)
 * from Phase 3 onward; nothing here performs network validation.
 */
export function normalizeAndValidateUrl(raw: string): UrlValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, message: "Enter a website URL to analyze." };
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      ok: false,
      message: "That doesn't look like a valid URL. Check for typos.",
    };
  }

  if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
    return {
      ok: false,
      message: "Only http:// and https:// URLs are supported.",
    };
  }

  if (parsed.hostname.length === 0) {
    return {
      ok: false,
      message: "That doesn't look like a valid URL. Check for typos.",
    };
  }

  return { ok: true, url: parsed.href };
}
