import { describe, expect, it, vi } from "vitest";
import { SlackNotificationProvider } from "../src/notifications/slack-provider.js";
import type { NotificationPayload } from "../src/notifications/types.js";

describe("SlackNotificationProvider", () => {
  const samplePayload: NotificationPayload = {
    alertId: "123e4567-e89b-12d3-a456-426614174000",
    organizationId: "123e4567-e89b-12d3-a456-426614174001",
    projectId: "123e4567-e89b-12d3-a456-426614174002",
    monitoredPageId: "123e4567-e89b-12d3-a456-426614174003",
    pageUrl: "https://example.com/checkout",
    ruleType: "overall_score_drop",
    severity: "high",
    title: "Overall UX Score Regressed",
    reasonSummary: "Overall score dropped by 15 points (85 → 70).",
    scoreDelta: -15,
    previousValue: 85,
    currentValue: 70,
    appBaseUrl: "https://pagepilot.dev",
  };

  it("formats Block Kit message and delivers successfully", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;

    const mockFetch = vi.fn().mockImplementation(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = init.body;
      return {
        ok: true,
        status: 200,
      };
    });

    const provider = new SlackNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://hooks.slack.com/services/T00/B00/SECRET",
    );

    expect(result.success).toBe(true);
    expect(capturedUrl).toBe("https://hooks.slack.com/services/T00/B00/SECRET");

    const parsedBody = JSON.parse(capturedBody!);
    expect(parsedBody.blocks).toBeDefined();
    expect(parsedBody.blocks[0].text.text).toContain("Overall UX Score Regressed");
    expect(capturedBody).toContain("https://example.com/checkout");
    expect(capturedBody).toContain("-15 pts");
  });

  it("handles Slack 4xx client errors as non-retryable failures", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const provider = new SlackNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://hooks.slack.com/services/T00/B00/INVALID",
    );

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain("status 404");
  });

  it("handles network timeouts as retryable failures", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const provider = new SlackNotificationProvider({ fetchFn: mockFetch });
    const result = await provider.send(
      samplePayload,
      "https://hooks.slack.com/services/T00/B00/TIMEOUT",
    );

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBe("Network timeout");
  });
});
