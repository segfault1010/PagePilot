import { describe, expect, it } from "vitest";
import { MockBrowserCaptureProvider } from "../src/browser/mock-provider.js";
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  MAX_CAPTURE_HEIGHT,
} from "@pagepilot/contracts";
import type { DnsResolver } from "../src/fetch/resolver.js";

describe("Browser Capture Provider", () => {
  const mockPublicResolver: DnsResolver = async () => [
    { address: "93.184.216.34", family: 4 },
  ];

  it("captures both desktop and mobile viewports by default", async () => {
    const provider = new MockBrowserCaptureProvider();
    const result = await provider.capture("https://example.com", {
      dnsResolver: mockPublicResolver,
    });

    expect(result.url).toBe("https://example.com/");
    expect(result.captures).toHaveLength(2);

    const desktop = result.captures.find((c) => c.deviceType === "desktop");
    const mobile = result.captures.find((c) => c.deviceType === "mobile");

    expect(desktop).toBeDefined();
    expect(desktop?.width).toBe(DESKTOP_VIEWPORT.width);
    expect(desktop?.height).toBe(DESKTOP_VIEWPORT.height);
    expect(desktop?.captureType).toBe("viewport");
    expect(desktop?.mimeType).toBe("image/webp");
    expect(desktop?.buffer.length).toBeGreaterThan(0);

    expect(mobile).toBeDefined();
    expect(mobile?.width).toBe(MOBILE_VIEWPORT.width);
    expect(mobile?.height).toBe(MOBILE_VIEWPORT.height);
    expect(mobile?.captureType).toBe("viewport");
  });

  it("supports single viewport capture request", async () => {
    const provider = new MockBrowserCaptureProvider();
    const result = await provider.capture("https://example.com", {
      viewports: ["mobile"],
      dnsResolver: mockPublicResolver,
    });

    expect(result.captures).toHaveLength(1);
    expect(result.captures[0].deviceType).toBe("mobile");
  });

  it("caps full page capture height at MAX_CAPTURE_HEIGHT (4000px)", async () => {
    const provider = new MockBrowserCaptureProvider();
    const result = await provider.capture("https://example.com", {
      captureType: "full_page",
      dnsResolver: mockPublicResolver,
    });

    for (const cap of result.captures) {
      expect(cap.captureType).toBe("full_page");
      expect(cap.height).toBeLessThanOrEqual(MAX_CAPTURE_HEIGHT);
    }
  });

  it("throws on security failure when destination is private", async () => {
    const provider = new MockBrowserCaptureProvider();
    await expect(
      provider.capture("http://127.0.0.1:80/admin")
    ).rejects.toThrow("Security policy rejected URL");
  });

  it("simulates capture failure when configured", async () => {
    const provider = new MockBrowserCaptureProvider({
      simulateFailure: true,
      failureMessage: "Chromium process crash simulation",
    });

    await expect(
      provider.capture("https://example.com", {
        dnsResolver: mockPublicResolver,
      })
    ).rejects.toThrow("Chromium process crash simulation");
  });
});
