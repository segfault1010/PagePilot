import { API_ERROR_CODES } from "./audit-types.js";

export type UrlPolicyResult =
  | { ok: true; url: string }
  | { ok: false; code: string; message: string };

/**
 * Single source of truth for URL policy, enforced identically on the client
 * (inline feedback) and the server (authoritative validation). Syntactic and
 * policy checks only — destination/IP-level blocking arrives with safe
 * fetching. Requires absolute http(s) URLs, standard ports, and no
 * credentials; the returned href is the URL's own normalized form, so the
 * destination is never altered.
 */
export function enforceUrlPolicy(raw: string): UrlPolicyResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return fail("Enter a website URL to analyze.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return fail("That doesn't look like a valid URL. Check for typos.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fail("Only http:// and https:// URLs are supported.");
  }

  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return fail("URLs with embedded usernames or passwords aren't supported.");
  }

  const defaultPort = parsed.protocol === "https:" ? "443" : "80";
  if (parsed.port.length > 0 && parsed.port !== defaultPort) {
    return fail(
      "Only standard ports are supported (80 for http, 443 for https).",
    );
  }

  if (parsed.hostname.length === 0) {
    return fail("That doesn't look like a valid URL. Check for typos.");
  }

  return { ok: true, url: parsed.href };
}

function fail(message: string): UrlPolicyResult {
  return { ok: false, code: API_ERROR_CODES.invalidUrl, message };
}
