import type {
  NotificationPayload,
  NotificationResult,
} from "./types.js";

export interface SlackNotificationProviderOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export class SlackNotificationProvider {
  readonly channel = "slack" as const;
  private fetchFn: typeof fetch;
  private timeoutMs: number;

  constructor(options: SlackNotificationProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  /**
   * Formats and delivers a rich Slack Block Kit notification for an alert.
   */
  async send(
    payload: NotificationPayload,
    webhookUrl: string,
  ): Promise<NotificationResult> {
    if (!webhookUrl || typeof webhookUrl !== "string") {
      return {
        success: false,
        error: "Missing Slack webhook URL.",
        retryable: false,
      };
    }

    const emoji =
      payload.severity === "high"
        ? ":rotating_light:"
        : payload.severity === "medium"
          ? ":warning:"
          : ":information_source:";

    const ruleLabel =
      payload.ruleType === "overall_score_drop"
        ? "Overall Score Drop"
        : payload.ruleType === "category_score_drop"
          ? "Category Score Drop"
          : payload.ruleType === "new_high_severity_finding"
            ? "New High Severity Finding"
            : "Consecutive Audit Failures";

    const fields: Array<{ type: string; text: string }> = [
      {
        type: "mrkdwn",
        text: `*Rule:*\n${ruleLabel}`,
      },
      {
        type: "mrkdwn",
        text: `*Severity:*\n${payload.severity.toUpperCase()}`,
      },
    ];

    if (payload.scoreDelta !== null && payload.scoreDelta !== undefined) {
      fields.push({
        type: "mrkdwn",
        text: `*Score Change:*\n${payload.scoreDelta > 0 ? "+" : ""}${payload.scoreDelta} pts (${payload.previousValue ?? "?"} → ${payload.currentValue ?? "?"})`,
      });
    }

    if (payload.category) {
      fields.push({
        type: "mrkdwn",
        text: `*Category:*\n${payload.category}`,
      });
    }

    const blocks: any[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${emoji} PagePilot Alert: ${payload.title}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields,
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Page:* <${payload.pageUrl}|${payload.pageUrl}>\n*Summary:* ${payload.reasonSummary}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Alert ID: \`${payload.alertId}\` • Delivered by *PagePilot*`,
          },
        ],
      },
    ];

    const body = JSON.stringify({
      text: `${emoji} PagePilot Alert: ${payload.title} on ${payload.pageUrl}`,
      blocks,
    });

    try {
      const response = await this.fetchFn(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "PagePilot-SlackNotifier/1.0",
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) {
        return { success: true };
      }

      // 4xx errors from Slack indicate bad webhook URL or invalid payload (not retryable)
      const isClientError = response.status >= 400 && response.status < 500;
      return {
        success: false,
        error: `Slack webhook responded with status ${response.status}`,
        retryable: !isClientError,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || "Failed to deliver Slack notification.",
        retryable: true,
      };
    }
  }
}
