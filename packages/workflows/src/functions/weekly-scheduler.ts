import {
  AUDIT_REQUESTED_EVENT,
  AUDIT_SCHEDULE_WEEKLY_EVENT,
  getWeeklyWindow,
} from "@pagepilot/contracts";
import { inngestClient } from "../client.js";
import type { SchedulerDeps } from "../types.js";

/**
 * Creates the durable weekly scheduled audit workflow function with injectable dependencies.
 */
export function createWeeklyScheduler(deps: SchedulerDeps) {
  const client = deps.client ?? inngestClient;

  return client.createFunction(
    {
      id: "weekly-audit-scheduler",
      name: "Weekly Audit Scheduler",
      retries: 3,
      triggers: [
        { cron: "0 0 * * 1" },
        { event: AUDIT_SCHEDULE_WEEKLY_EVENT },
      ],
    },
    async ({ step }) => {
      const now = deps.now ? deps.now() : new Date();

      // -----------------------------------------------------------------------
      // Step 1: Discover all eligible active weekly monitored pages
      // -----------------------------------------------------------------------
      const pages = await step.run("discover-eligible-pages", async () => {
        return deps.schedulerStore.listEligibleWeeklyPages();
      });

      if (!pages || pages.length === 0) {
        return {
          ok: true,
          scheduledCount: 0,
          skippedCount: 0,
          totalEligible: 0,
          reason: "No active weekly monitored pages found.",
          details: [],
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Schedule audit runs with deterministic idempotency keys
      // -----------------------------------------------------------------------
      const results = await step.run("schedule-audit-runs", async () => {
        const outcomes: Array<{
          pageId: string;
          runId?: string;
          action: "scheduled" | "skipped";
          reason?: string;
          windowId?: string;
        }> = [];

        for (const page of pages) {
          // Re-verify page is active and configured for weekly cadence
          if (page.status !== "active" || page.cadence !== "weekly") {
            outcomes.push({
              pageId: page.id,
              action: "skipped",
              reason: "page_not_active_or_weekly",
            });
            continue;
          }

          const timezone = page.timezone || "UTC";
          const windowId = getWeeklyWindow(now, timezone);
          const idempotencyKey = `scheduled:${page.id}:${windowId}`;

          // Pre-persist the scheduled audit run with deterministic idempotency key
          const { run, isExisting } =
            await deps.schedulerStore.createScheduledAuditRun(
              page,
              idempotencyKey,
            );

          // If a run was already created for this window (e.g. from a prior cron run or event retry),
          // suppress event emission to guarantee zero duplicate audit/requested events
          if (isExisting) {
            outcomes.push({
              pageId: page.id,
              runId: run.id,
              action: "skipped",
              reason: "already_scheduled_for_window",
              windowId,
            });
            continue;
          }

          // Emit durable audit/requested event referencing persisted IDs
          await client.send({
            name: AUDIT_REQUESTED_EVENT,
            data: {
              auditRunId: run.id,
              organizationId: page.organizationId,
              projectId: page.projectId,
              monitoredPageId: page.id,
              requestedByUserId: null,
            },
          });

          outcomes.push({
            pageId: page.id,
            runId: run.id,
            action: "scheduled",
            windowId,
          });
        }

        return outcomes;
      });

      const scheduledCount = results.filter(
        (r) => r.action === "scheduled",
      ).length;
      const skippedCount = results.filter((r) => r.action === "skipped").length;

      return {
        ok: true,
        scheduledCount,
        skippedCount,
        totalEligible: pages.length,
        details: results,
      };
    },
  );
}
