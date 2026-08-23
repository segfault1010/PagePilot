import { describe, expect, it } from "vitest";
import { isPubliclyRoutableAddress } from "../../src/server/fetch/ip-policy";

describe("isPubliclyRoutableAddress", () => {
  it("accepts global unicast IPv4 addresses", () => {
    expect(isPubliclyRoutableAddress("93.184.216.34")).toBe(true);
    expect(isPubliclyRoutableAddress("8.8.8.8")).toBe(true);
    expect(isPubliclyRoutableAddress("1.1.1.1")).toBe(true);
  });

  it("rejects IPv4 loopback and localhost variants", () => {
    expect(isPubliclyRoutableAddress("127.0.0.1")).toBe(false);
    expect(isPubliclyRoutableAddress("127.8.8.8")).toBe(false);
  });

  it("rejects unspecified addresses", () => {
    expect(isPubliclyRoutableAddress("0.0.0.0")).toBe(false);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(isPubliclyRoutableAddress("10.0.0.5")).toBe(false);
    expect(isPubliclyRoutableAddress("172.16.0.9")).toBe(false);
    expect(isPubliclyRoutableAddress("192.168.1.1")).toBe(false);
  });

  it("rejects CGNAT / shared address space", () => {
    expect(isPubliclyRoutableAddress("100.64.0.1")).toBe(false);
  });

  it("rejects link-local and metadata-service addresses", () => {
    expect(isPubliclyRoutableAddress("169.254.169.254")).toBe(false);
    expect(isPubliclyRoutableAddress("169.254.0.1")).toBe(false);
  });

  it("rejects multicast, broadcast, benchmark and reserved ranges", () => {
    expect(isPubliclyRoutableAddress("224.0.0.1")).toBe(false);
    expect(isPubliclyRoutableAddress("255.255.255.255")).toBe(false);
    expect(isPubliclyRoutableAddress("198.18.0.1")).toBe(false);
    expect(isPubliclyRoutableAddress("192.0.2.1")).toBe(false);
  });

  it("accepts global unicast IPv6 addresses", () => {
    expect(isPubliclyRoutableAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(isPubliclyRoutableAddress("2001:4860:4860::8888")).toBe(true);
  });

  it("rejects IPv6 loopback and unspecified", () => {
    expect(isPubliclyRoutableAddress("::1")).toBe(false);
    expect(isPubliclyRoutableAddress("::")).toBe(false);
  });

  it("rejects IPv6 link-local and unique-local addresses", () => {
    expect(isPubliclyRoutableAddress("fe80::1")).toBe(false);
    expect(isPubliclyRoutableAddress("fc00::1")).toBe(false);
    expect(isPubliclyRoutableAddress("fd12:3456:789a::1")).toBe(false);
  });

  it("rejects IPv4-mapped and transition addresses", () => {
    expect(isPubliclyRoutableAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPubliclyRoutableAddress("::ffff:192.168.0.1")).toBe(false);
    expect(isPubliclyRoutableAddress("::ffff:7f00:1")).toBe(false); // hex-form 127.0.0.1
    expect(isPubliclyRoutableAddress("2002:c000:204::1")).toBe(false); // 6to4 wrapping 192.0.2.4
    expect(isPubliclyRoutableAddress("64:ff9b::7f00:1")).toBe(false); // NAT64 wrapping 127.0.0.1
  });

  it("rejects garbage input", () => {
    expect(isPubliclyRoutableAddress("not-an-ip")).toBe(false);
    expect(isPubliclyRoutableAddress("")).toBe(false);
  });
});
