import type {
  NotificationPayload,
  NotificationResult,
} from "./types.js";
import {
  PAGEPILOT_SIGNATURE_HEADER,
  PAGEPILOT_TIMESTAMP_HEADER,
} from "@pagepilot/contracts";
import { createWebhookSignature } from "./crypto.js";

export interface WebhookNotificationProviderOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class WebhookNotificationProvider {
  readonly channel = "webhook" as const;
  private fetchFn: typeof fetch;
  private timeoutMs: number;

  constructor(options: WebhookNotificationProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  /**
   * Formats and delivers a signed webhook notification for an alert.
   */
  async send(
    payload: NotificationPayload,
    webhookUrl: string,
    signingSecret?: string,
  ): Promise<NotificationResult> {
    if (!webhookUrl || typeof webhookUrl !== "string") {
      return {
        success: false,
        error: "Missing target webhook URL.",
        retryable: false,
      };
    }

    const webhookBody = JSON.stringify({
      event: "alert.created",
      timestamp: new Date().toISOString(),
      data: {
        alertId: payload.alertId,
        organizationId: payload.organizationId,
        projectId: payload.projectId,
        monitoredPageId: payload.monitoredPageId,
        pageUrl: payload.pageUrl,
        ruleType: payload.ruleType,
        severity: payload.severity,
        title: payload.title,
        reasonSummary: payload.reasonSummary,
        reasonDetails: payload.reasonDetails ?? null,
        category: payload.category ?? null,
        scoreDelta: payload.scoreDelta ?? null,
        previousValue: payload.previousValue ?? null,
        currentValue: payload.currentValue ?? null,
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "PagePilot-Webhooks/1.0",
    };

    if (signingSecret && signingSecret.trim().length > 0) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const signature = createWebhookSignature(
        signingSecret,
        webhookBody,
        nowSeconds,
      );
      headers[PAGEPILOT_SIGNATURE_HEADER] = signature;
      headers[PAGEPILOT_TIMESTAMP_HEADER] = String(nowSeconds);
    }

    try {
      const response = await this.fetchFn(webhookUrl, {
        method: "POST",
        headers,
        body: webhookBody,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) {
        return { success: true };
      }

      // 4xx client errors mean the endpoint rejected the payload or doesn't exist
      const isClientError = response.status >= 400 && response.status < 500;
      return {
        success: false,
        error: `Webhook endpoint responded with status ${response.status}`,
        retryable: !isClientError,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Failed to deliver webhook notification.",
        retryable: true,
      };
    }
  }
}
