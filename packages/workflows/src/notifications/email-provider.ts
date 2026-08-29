import type { NotificationPayload, NotificationProvider, NotificationResult } from "./types.js";
import { buildAlertEmailContent } from "./email-template.js";

/**
 * Mock email notification provider for unit and integration testing.
 * Records all sent notification payloads and allows simulated errors.
 */
export class MockEmailNotificationProvider implements NotificationProvider {
  readonly channel = "email" as const;
  public sent: NotificationPayload[] = [];
  private nextError: { error: string; retryable: boolean } | null = null;

  simulateNextFailure(error: string, retryable = true): void {
    this.nextError = { error, retryable };
  }

  reset(): void {
    this.sent = [];
    this.nextError = null;
  }

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = null;
      return {
        success: false,
        error: err.error,
        retryable: err.retryable,
      };
    }

    this.sent.push({ ...payload });
    return {
      success: true,
      messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }
}

/**
 * Console/Dev email notification provider for local development or fallback.
 */
export class ConsoleEmailNotificationProvider implements NotificationProvider {
  readonly channel = "email" as const;

  async send(payload: NotificationPayload): Promise<NotificationResult> {
    const rendered = buildAlertEmailContent(payload);
    console.log(
      `[notifications/email] TO: ${payload.recipientEmail} | SUBJECT: ${rendered.subject}\n${rendered.text}`,
    );
    return {
      success: true,
      messageId: `console-msg-${Date.now()}`,
    };
  }
}

/**
 * Creates the appropriate notification provider based on environment configuration.
 */
export function createDefaultNotificationProvider(): NotificationProvider {
  return new ConsoleEmailNotificationProvider();
}
