import { NonRetriableError } from "inngest";
import {
  ALERT_CREATED_EVENT,
  alertCreatedPayloadSchema,
  buildAlertDeliveryKey,
} from "@pagepilot/contracts";
import { inngestClient } from "../client.js";
import type { WorkflowPersistenceStore } from "../types.js";
import type { NotificationProvider } from "../notifications/types.js";
import { createDefaultNotificationProvider } from "../notifications/email-provider.js";

export interface AlertDeliveryDeps {
  store: WorkflowPersistenceStore;
  notificationProvider?: NotificationProvider;
  client?: typeof inngestClient;
  appBaseUrl?: string;
}

/**
 * Creates the durable Inngest workflow for delivering alert notifications.
 */
export function createAlertDeliveryWorkflow(deps: AlertDeliveryDeps) {
  const client = deps.client ?? inngestClient;
  const provider =
    deps.notificationProvider ?? createDefaultNotificationProvider();
  const appBaseUrl = deps.appBaseUrl || "https://pagepilot.dev";

  return client.createFunction(
    {
      id: "deliver-alert-notification",
      name: "Deliver Alert Notification",
      retries: 3,
      triggers: [{ event: ALERT_CREATED_EVENT }],
    },
    async ({ event, step }) => {
      // 0. Validate incoming event payload
      const parseResult = alertCreatedPayloadSchema.safeParse(event.data);
      if (!parseResult.success) {
        throw new NonRetriableError(
          `Invalid alert/created event payload: ${parseResult.error.issues[0]?.message || "Validation failed"}`,
        );
      }
      const payload = parseResult.data;

      // -----------------------------------------------------------------------
      // Step 1: Load and validate alert
      // -----------------------------------------------------------------------
      const loadResult = await step.run("load-and-validate-alert", async () => {
        const alert = await deps.store.getAlert(payload.alertId);
        if (!alert) {
          throw new NonRetriableError(
            `Alert ${payload.alertId} not found in persistence store.`,
          );
        }

        // Strict tenant and resource boundary verification
        if (
          alert.organizationId !== payload.organizationId ||
          alert.projectId !== payload.projectId ||
          alert.monitoredPageId !== payload.monitoredPageId
        ) {
          throw new NonRetriableError(
            `Tenant or resource mismatch for alert ${payload.alertId}.`,
          );
        }

        if (alert.status === "delivered") {
          return {
            action: "skip" as const,
            reason: "already_delivered" as const,
            alert,
            pageUrl: "",
          };
        }

        const page = await deps.store.getMonitoredPage(
          payload.organizationId,
          payload.projectId,
          payload.monitoredPageId,
        );
        if (!page) {
          throw new NonRetriableError(
            `Monitored page ${payload.monitoredPageId} not found.`,
          );
        }

        return {
          action: "proceed" as const,
          alert,
          pageUrl: page.canonicalUrl,
        };
      });

      if (loadResult.action === "skip") {
        return {
          ok: true,
          skipped: true,
          reason: loadResult.reason,
          alertId: payload.alertId,
        };
      }

      const alert = loadResult.alert;

      // -----------------------------------------------------------------------
      // Step 2: Resolve authorized recipients
      // -----------------------------------------------------------------------
      const recipientsResult = await step.run("resolve-recipients", async () => {
        const members = await deps.store.listOrganizationRecipients(
          payload.organizationId,
        );

        const validRecipients = members.filter(
          (m) => typeof m.email === "string" && m.email.includes("@"),
        );

        if (validRecipients.length === 0) {
          return {
            action: "no_recipients" as const,
            recipients: [],
          };
        }

        return {
          action: "proceed" as const,
          recipients: validRecipients.map((r) => ({
            id: r.id,
            email: r.email,
            role: r.role,
          })),
        };
      });

      if (recipientsResult.action === "no_recipients") {
        await step.run("record-no-recipients", async () => {
          await deps.store.updateAlertStatus(alert.id, "failed", {
            reason: "no_valid_recipients",
          });
        });
        return {
          ok: true,
          delivered: false,
          reason: "no_valid_recipients",
          alertId: alert.id,
        };
      }

      // -----------------------------------------------------------------------
      // Step 3: Deliver notifications (with delivery_key idempotency barrier)
      // -----------------------------------------------------------------------
      const deliveryOutcome = await step.run("deliver-notifications", async () => {
        let successCount = 0;
        let failureCount = 0;

        for (const recipient of recipientsResult.recipients) {
          const deliveryKey = buildAlertDeliveryKey(
            alert.id,
            "email",
            recipient.email,
          );

          // Get or claim delivery record in database
          const { delivery } = await deps.store.getOrCreateDelivery({
            alertId: alert.id,
            organizationId: alert.organizationId,
            channel: "email",
            recipient: recipient.email,
            deliveryKey,
            status: "pending",
            attempts: 0,
            metadata: {},
          });

          // If already delivered to this recipient, skip sending (idempotency guard)
          if (delivery.status === "delivered") {
            successCount++;
            continue;
          }

          const sendResult = await provider.send({
            alertId: alert.id,
            organizationId: alert.organizationId,
            projectId: alert.projectId,
            monitoredPageId: alert.monitoredPageId,
            pageUrl: loadResult.pageUrl,
            ruleType: alert.ruleType,
            severity: alert.severity,
            title: alert.title,
            reasonSummary: alert.reasonSummary,
            reasonDetails: alert.reasonDetails ?? undefined,
            category: alert.category ?? undefined,
            scoreDelta: alert.scoreDelta ?? undefined,
            previousValue: alert.previousValue ?? undefined,
            currentValue: alert.currentValue ?? undefined,
            appBaseUrl,
            recipientEmail: recipient.email,
          });

          if (sendResult.success) {
            await deps.store.recordDeliverySuccess(delivery.id, {
              messageId: sendResult.messageId,
            });
            successCount++;
          } else {
            failureCount++;
            const isRetryable = sendResult.retryable ?? true;
            await deps.store.recordDeliveryFailure(
              delivery.id,
              sendResult.error || "Delivery failed",
              !isRetryable,
            );

            if (isRetryable) {
              throw new Error(
                `Failed to deliver alert email to ${recipient.email}: ${sendResult.error || "Provider error"}`,
              );
            }
          }
        }

        // Update overall alert status
        if (successCount > 0) {
          await deps.store.updateAlertStatus(alert.id, "delivered");
        } else if (failureCount > 0) {
          await deps.store.updateAlertStatus(alert.id, "failed");
        }

        return {
          successCount,
          failureCount,
        };
      });

      return {
        ok: true,
        alertId: alert.id,
        status: deliveryOutcome.successCount > 0 ? "delivered" : "failed",
        deliveredCount: deliveryOutcome.successCount,
      };
    },
  );
}
