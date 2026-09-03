import { enforceUrlPolicy } from "@pagepilot/contracts";
import {
  defaultDnsResolver,
  isPubliclyRoutableAddress,
} from "@pagepilot/audit-engine";
import type { DnsResolver } from "@pagepilot/audit-engine";

export interface DestinationValidationResult {
  ok: boolean;
  url?: string;
  code?: string;
  message?: string;
}

/**
 * Enforces outbound SSRF protection on user-configured webhook / Slack targets.
 * Validates syntax, scheme, credentials, ports, and verifies that DNS returns
 * exclusively publicly routable global unicast addresses (no loopback, private RFC1918,
 * CGNAT, link-local, or cloud metadata 169.254.169.254).
 */
export async function validateOutboundWebhookUrl(
  rawUrl: string,
  resolver: DnsResolver = defaultDnsResolver,
): Promise<DestinationValidationResult> {
  const policy = enforceUrlPolicy(rawUrl);
  if (!policy.ok) {
    return {
      ok: false,
      code: policy.code,
      message: policy.message,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(policy.url);
  } catch {
    return {
      ok: false,
      code: "INVALID_URL",
      message: "Malformed URL.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 1. Check if hostname is an IP literal
  if (isPubliclyRoutableAddress(hostname)) {
    return { ok: true, url: policy.url };
  }

  // If ipaddr couldn't parse it as unicast and it looks like an IP or localhost
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
    hostname.includes(":")
  ) {
    return {
      ok: false,
      code: "BLOCKED_DESTINATION",
      message: "Destination address is not publicly routable.",
    };
  }

  // 2. DNS resolution check (mixed-record defense: all records must be safe)
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    return {
      ok: false,
      code: "CANNOT_RESOLVE",
      message: "Could not resolve webhook destination host.",
    };
  }

  if (!addresses || addresses.length === 0) {
    return {
      ok: false,
      code: "CANNOT_RESOLVE",
      message: "Destination hostname returned no address records.",
    };
  }

  for (const { address } of addresses) {
    if (!isPubliclyRoutableAddress(address)) {
      return {
        ok: false,
        code: "BLOCKED_DESTINATION",
        message: "Destination resolves to a non-publicly routable IP address.",
      };
    }
  }

  return { ok: true, url: policy.url };
}
