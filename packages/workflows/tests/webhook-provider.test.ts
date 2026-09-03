import { describe, expect, it, vi } from "vitest";
import { WebhookNotificationProvider } from "../src/notifications/webhook-provider.js";
import { verifyWebhookSignature } from "../src/notifications/crypto.js";
import type { NotificationPayload } from "../src/notifications/types.js";
import {
  PAGEPILOT_SIGNATURE_HEADER,
  PAGEPILOT_TIMESTAMP_HEADER,
} from "@pagepilot/contracts";

describe("WebhookNotificationProvider", () => {
  const samplePayload: NotificationPayload = {
    alertId: "123e4567-e89b-12d3-a456-426614174000",
    organizationId: "123e4567-e89b-12d3-a456-426614174001",
    projectId: "123e4567-e89b-12d3-a456-426614174002",
    monitoredPageId: "123e4567-e89b-12d3-a456-426614174003",
    pageUrl: "https://example.com/checkout",
    ruleType: "new_high_severity_finding",
    severity: "high",
    title: "New High Severity Finding Detected",
    reasonSummary: "Missing primary CTA on landing page viewport.",
    appBaseUrl: "https://pagepilot.dev",
  };

  it("delivers signed webhook payload with HMAC-SHA256 headers", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: string = "";

    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init.headers;
      capturedBody = init.body;
      return {
        ok: true,
        status: 200,
      };
    });

    const signingSecret = "whsec_test_secret_123456";
    const provider = new WebhookNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://api.example.com/webhooks/alerts",
      signingSecret,
    );

    expect(result.success).toBe(true);

    const sig = capturedHeaders[PAGEPILOT_SIGNATURE_HEADER];
    const ts = capturedHeaders[PAGEPILOT_TIMESTAMP_HEADER];

    expect(sig).toBeDefined();
    expect(ts).toBeDefined();
    expect(sig!.startsWith("sha256=")).toBe(true);

    // Verify signature using anti-replay constant-time verifier
    const isValid = verifyWebhookSignature(
      signingSecret,
      capturedBody,
      Number(ts),
      sig!,
    );
    expect(isValid).toBe(true);

    const parsed = JSON.parse(capturedBody);
    expect(parsed.event).toBe("alert.created");
    expect(parsed.data.alertId).toBe(samplePayload.alertId);
    expect(parsed.data.pageUrl).toBe(samplePayload.pageUrl);
  });

  it("delivers unsigned webhook payload when secret is omitted", async () => {
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedHeaders = init.headers;
      return { ok: true, status: 200 };
    });

    const provider = new WebhookNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://api.example.com/webhooks/alerts",
    );

    expect(result.success).toBe(true);
    expect(capturedHeaders[PAGEPILOT_SIGNATURE_HEADER]).toBeUndefined();
    expect(capturedHeaders[PAGEPILOT_TIMESTAMP_HEADER]).toBeUndefined();
  });

  it("handles remote 5xx server errors as retryable", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    const provider = new WebhookNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://api.example.com/webhooks/alerts",
    );

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
  });

  it("handles remote 4xx errors as non-retryable", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });

    const provider = new WebhookNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://api.example.com/webhooks/alerts",
    );

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });
});
