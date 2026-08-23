import ipaddr from "ipaddr.js";

/**
 * Destination IP policy: an address is connectable only when it is global
 * unicast space. Everything else (loopback, unspecified, RFC1918, CGNAT,
 * link-local/metadata service, multicast, reserved/benchmark blocks, IPv6
 * loopback/link-local/unique-local, IPv4-mapped and tunnel addresses) is
 * rejected. Parsing/validation is delegated to ipaddr.js rather than
 * hand-written range logic.
 */
export function isPubliclyRoutableAddress(addressText: string): boolean {
  const trimmed = addressText.trim();
  if (trimmed.length === 0) return false;

  let addr;
  try {
    addr = ipaddr.parse(trimmed);
  } catch {
    return false;
  }

  const range = addr.range();
  switch (addr.kind()) {
    case "ipv4":
      return range === "unicast";
    case "ipv6":
      // Global unicast only. IPv4-mapped, 6to4, Teredo and other transition
      // ranges are rejected because they can smuggle private IPv4 targets.
      return range === "unicast";
    default:
      return false;
  }
}
