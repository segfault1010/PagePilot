import type { AlertRuleType, AlertSeverity } from "@pagepilot/contracts";

/**
 * Normalized data payload passed to notification delivery providers.
 * Strictly excludes raw HTML, provider payloads, internal IPs, and server secrets.
 */
export interface NotificationPayload {
  alertId: string;
  organizationId: string;
  projectId: string;
  projectName?: string;
  monitoredPageId: string;
  pageUrl: string;
  ruleType: AlertRuleType;
  severity: AlertSeverity;
  title: string;
  reasonSummary: string;
  reasonDetails?: string;
  category?: string | null;
  scoreDelta?: number | null;
  previousValue?: string | number | null;
  currentValue?: string | number | null;
  appBaseUrl: string;
  recipientEmail: string;
}

/**
 * Standard delivery outcome from a notification provider.
 */
export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
}

/**
 * Pluggable notification channel delivery interface.
 */
export interface NotificationProvider {
  readonly channel: "email";
  send(payload: NotificationPayload): Promise<NotificationResult>;
}
