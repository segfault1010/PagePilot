import ipaddr from "ipaddr.js";
import { enforceUrlPolicy } from "@pagepilot/contracts";
import { isPubliclyRoutableAddress } from "../fetch/ip-policy.js";
import { defaultDnsResolver } from "../fetch/resolver.js";
import type { DnsResolver } from "../fetch/resolver.js";

export interface TargetUrlValidationResult {
  valid: boolean;
  error?: string;
  normalizedUrl?: string;
  resolvedAddresses?: string[];
}

/**
 * Validates a target URL before any browser session is spawned:
 * 1. Checks syntactic and protocol validity via enforceUrlPolicy (http/https, no credentials, standard ports).
 * 2. Resolves all DNS records for the host.
 * 3. Asserts that EVERY resolved IP is publicly routable (rejecting loopback, metadata, RFC1918, etc.).
 */
export async function validateTargetUrl(
  targetUrl: string,
  dnsResolver: DnsResolver = defaultDnsResolver
): Promise<TargetUrlValidationResult> {
  const policyResult = enforceUrlPolicy(targetUrl);
  if (!policyResult.ok) {
    return { valid: false, error: policyResult.message };
  }

  const parsed = new URL(policyResult.url);
  const hostname = parsed.hostname;

  // Check if hostname is an IP literal
  if (isIpAddress(hostname)) {
    if (!isPubliclyRoutableAddress(hostname)) {
      return {
        valid: false,
        error: `Destination IP ${hostname} is blocked by SSRF policy.`,
      };
    }
    return {
      valid: true,
      normalizedUrl: policyResult.url,
      resolvedAddresses: [hostname],
    };
  }

  // Resolve all DNS records
  try {
    const records = await dnsResolver(hostname);
    if (!records || records.length === 0) {
      return {
        valid: false,
        error: `Hostname ${hostname} did not resolve to any IP address.`,
      };
    }

    const addresses = records.map((r) => r.address);
    for (const address of addresses) {
      if (!isPubliclyRoutableAddress(address)) {
        return {
          valid: false,
          error: `Destination resolved to blocked IP ${address} (mixed/private record rejection).`,
        };
      }
    }

    return {
      valid: true,
      normalizedUrl: policyResult.url,
      resolvedAddresses: addresses,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `DNS resolution failed for ${hostname}: ${msg}`,
    };
  }
}

export interface InterceptableRequest {
  url(): string;
  isNavigationRequest(): boolean;
  redirectedFrom(): unknown | null;
  resourceType?(): string;
}

export interface InterceptableRoute {
  request(): InterceptableRequest;
  abort(errorCode?: string): Promise<void>;
  continue(overrides?: unknown): Promise<void>;
}

export interface BrowserSsrfGuardOptions {
  dnsResolver?: DnsResolver;
  maxRedirects?: number;
}

/**
 * Creates a route handler for Playwright (page.route('** / *', guard)) that intercepts
 * every network request (initial document, navigation redirects, subresources, iframes).
 * 
 * Aborts any request that:
 * - Uses a non-http/https protocol (e.g. file:, ftp:, gopher:, ws:, chrome:, data: for navigation)
 * - Uses a non-standard port (anything other than 80 for http or 443 for https)
 * - Contains embedded credentials
 * - Exceeds max redirects
 * - Resolves to any private, loopback, link-local, cloud metadata (169.254.169.254), or non-public IP
 */
export function createBrowserSsrfGuard(options: BrowserSsrfGuardOptions = {}) {
  const resolver = options.dnsResolver ?? defaultDnsResolver;
  const maxRedirects = options.maxRedirects ?? 3;
  const dnsCache = new Map<string, { addresses: string[]; timestamp: number }>();
  let redirectCount = 0;

  return async (route: InterceptableRoute): Promise<void> => {
    const request = route.request();
    const urlStr = request.url();

    // Allow inline data: or blob: subresources (e.g., inline images, fonts, SVG)
    // but strictly block data: or blob: for navigation requests.
    if (urlStr.startsWith("data:") || urlStr.startsWith("blob:")) {
      if (request.isNavigationRequest()) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      await route.abort("blockedbyclient");
      return;
    }

    // Protocol check: http or https only
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      await route.abort("blockedbyclient");
      return;
    }

    // Standard port check
    const defaultPort = parsed.protocol === "https:" ? "443" : "80";
    if (parsed.port && parsed.port !== defaultPort) {
      await route.abort("blockedbyclient");
      return;
    }

    // Embedded credentials check
    if (parsed.username || parsed.password) {
      await route.abort("blockedbyclient");
      return;
    }

    // Redirect hop bounding
    if (request.isNavigationRequest() && request.redirectedFrom()) {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        await route.abort("blockedbyclient");
        return;
      }
    }

    // Hostname check
    const hostname = parsed.hostname;
    if (!hostname) {
      await route.abort("blockedbyclient");
      return;
    }

    // IP literal check
    if (isIpAddress(hostname)) {
      if (!isPubliclyRoutableAddress(hostname)) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }

    // DNS Cache check (TTL: 30s)
    const now = Date.now();
    const cached = dnsCache.get(hostname);
    if (cached && now - cached.timestamp < 30_000) {
      const allSafe =
        cached.addresses.length > 0 &&
        cached.addresses.every(isPubliclyRoutableAddress);
      if (!allSafe) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
      return;
    }

    // DNS Resolution check (all records must be publicly routable)
    try {
      const records = await resolver(hostname);
      if (!records || records.length === 0) {
        await route.abort("blockedbyclient");
        return;
      }

      const addresses = records.map((r) => r.address);
      dnsCache.set(hostname, { addresses, timestamp: now });

      const allSafe = addresses.every(isPubliclyRoutableAddress);
      if (!allSafe) {
        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  };
}

function isIpAddress(host: string): boolean {
  try {
    // Strip square brackets if IPv6 literal (e.g. [::1])
    const clean = host.replace(/^\[|\]$/g, "");
    ipaddr.parse(clean);
    return true;
  } catch {
    return false;
  }
}
