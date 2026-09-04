import { describe, expect, it } from "vitest";
import {
  createBrowserSsrfGuard,
  validateTargetUrl,
} from "../src/browser/browser-security.js";
import type {
  InterceptableRoute,
  InterceptableRequest,
} from "../src/browser/browser-security.js";
import type { DnsResolver } from "../src/fetch/resolver.js";

describe("Browser Security & SSRF Interception", () => {
  describe("validateTargetUrl", () => {
    it("accepts valid publicly routable domain", async () => {
      const mockResolver: DnsResolver = async () => [
        { address: "93.184.216.34", family: 4 },
      ];
      const result = await validateTargetUrl("https://example.com", mockResolver);
      expect(result.valid).toBe(true);
      expect(result.normalizedUrl).toBe("https://example.com/");
    });

    it("rejects loopback IP (127.0.0.1)", async () => {
      const result = await validateTargetUrl("http://127.0.0.1");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("blocked by SSRF policy");
    });

    it("rejects cloud metadata IP (169.254.169.254)", async () => {
      const result = await validateTargetUrl("http://169.254.169.254");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("blocked by SSRF policy");
    });

    it("rejects private RFC1918 IPs (10.0.0.1, 192.168.1.1, 172.16.0.1)", async () => {
      for (const ip of ["10.0.0.1", "192.168.1.1", "172.16.0.1"]) {
        const result = await validateTargetUrl(`http://${ip}`);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("blocked by SSRF policy");
      }
    });

    it("rejects IPv6 loopback and unique-local ([::1], [fc00::1])", async () => {
      for (const ip of ["[::1]", "[fc00::1]"]) {
        const result = await validateTargetUrl(`http://${ip}`);
        expect(result.valid).toBe(false);
      }
    });

    it("rejects non-standard ports (8080, 8443, 22)", async () => {
      const res1 = await validateTargetUrl("http://example.com:8080");
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain("standard ports");

      const res2 = await validateTargetUrl("https://example.com:8443");
      expect(res2.valid).toBe(false);
      expect(res2.error).toContain("standard ports");
    });

    it("rejects unsafe protocols (file://, ftp://, ws://)", async () => {
      const res1 = await validateTargetUrl("file:///etc/passwd");
      expect(res1.valid).toBe(false);
      expect(res1.error).toContain("Only http:// and https://");

      const res2 = await validateTargetUrl("ftp://example.com");
      expect(res2.valid).toBe(false);
    });

    it("rejects domain with mixed DNS records containing a private IP", async () => {
      const mockResolver: DnsResolver = async () => [
        { address: "93.184.216.34", family: 4 }, // public
        { address: "127.0.0.1", family: 4 }, // private/loopback
      ];
      const result = await validateTargetUrl("https://rebind.example.com", mockResolver);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("blocked IP 127.0.0.1");
    });
  });

  describe("createBrowserSsrfGuard (Route Interceptor)", () => {
    function createMockRoute(
      url: string,
      options: {
        isNavigation?: boolean;
        redirectedFrom?: unknown;
        resourceType?: string;
      } = {}
    ): {
      route: InterceptableRoute;
      abortedWith: string | null;
      continued: boolean;
    } {
      let abortedWith: string | null = null;
      let continued = false;

      const request: InterceptableRequest = {
        url: () => url,
        isNavigationRequest: () => options.isNavigation ?? false,
        redirectedFrom: () => options.redirectedFrom ?? null,
        resourceType: () => options.resourceType ?? "document",
      };

      const route: InterceptableRoute = {
        request: () => request,
        abort: async (code = "blockedbyclient") => {
          abortedWith = code;
        },
        continue: async () => {
          continued = true;
        },
      };

      return {
        route,
        get abortedWith() {
          return abortedWith;
        },
        get continued() {
          return continued;
        },
      };
    }

    it("allows valid public HTTPS requests", async () => {
      const mockResolver: DnsResolver = async () => [
        { address: "93.184.216.34", family: 4 },
      ];
      const guard = createBrowserSsrfGuard({ dnsResolver: mockResolver });
      const mock = createMockRoute("https://example.com/styles.css");

      await guard(mock.route);
      expect(mock.continued).toBe(true);
      expect(mock.abortedWith).toBeNull();
    });

    it("aborts requests to loopback IP (127.0.0.1)", async () => {
      const guard = createBrowserSsrfGuard();
      const mock = createMockRoute("http://127.0.0.1:80/api");

      await guard(mock.route);
      expect(mock.abortedWith).toBe("blockedbyclient");
      expect(mock.continued).toBe(false);
    });

    it("aborts requests to cloud metadata endpoint (169.254.169.254)", async () => {
      const guard = createBrowserSsrfGuard();
      const mock = createMockRoute("http://169.254.169.254/latest/meta-data/");

      await guard(mock.route);
      expect(mock.abortedWith).toBe("blockedbyclient");
      expect(mock.continued).toBe(false);
    });

    it("aborts non-standard ports (http://example.com:8080)", async () => {
      const guard = createBrowserSsrfGuard();
      const mock = createMockRoute("http://example.com:8080/exploit");

      await guard(mock.route);
      expect(mock.abortedWith).toBe("blockedbyclient");
      expect(mock.continued).toBe(false);
    });

    it("aborts non-http protocols like file:// or gopher://", async () => {
      const guard = createBrowserSsrfGuard();
      const mock1 = createMockRoute("file:///etc/passwd");
      await guard(mock1.route);
      expect(mock1.abortedWith).toBe("blockedbyclient");

      const mock2 = createMockRoute("gopher://example.com");
      await guard(mock2.route);
      expect(mock2.abortedWith).toBe("blockedbyclient");
    });

    it("aborts navigation requests with data: URL", async () => {
      const guard = createBrowserSsrfGuard();
      const mock = createMockRoute("data:text/html,<h1>XSS</h1>", {
        isNavigation: true,
      });

      await guard(mock.route);
      expect(mock.abortedWith).toBe("blockedbyclient");
    });

    it("allows inline image data: subresources", async () => {
      const guard = createBrowserSsrfGuard();
      const mock = createMockRoute("data:image/png;base64,iVBORw0KGgo...", {
        isNavigation: false,
        resourceType: "image",
      });

      await guard(mock.route);
      expect(mock.continued).toBe(true);
      expect(mock.abortedWith).toBeNull();
    });

    it("aborts hostnames resolving to private IP space", async () => {
      const mockResolver: DnsResolver = async () => [
        { address: "10.0.0.5", family: 4 },
      ];
      const guard = createBrowserSsrfGuard({ dnsResolver: mockResolver });
      const mock = createMockRoute("https://internal.corp.local/dashboard");

      await guard(mock.route);
      expect(mock.abortedWith).toBe("blockedbyclient");
      expect(mock.continued).toBe(false);
    });

    it("aborts if DNS resolution fails completely", async () => {
      const mockResolver: DnsResolver = async () => {
        throw new Error("ENOTFOUND");
      };
      const guard = createBrowserSsrfGuard({ dnsResolver: mockResolver });
      const mock = createMockRoute("https://nonexistent-fake-domain-123.com");

      await guard(mock.route);
      expect(mock.abortedWith).toBe("blockedbyclient");
    });
  });
});
