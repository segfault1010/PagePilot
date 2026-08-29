import { NonRetriableError } from "inngest";
import {
  ALERT_CREATED_EVENT,
  AUDIT_REQUESTED_EVENT,
  auditRequestedPayloadSchema,
} from "@pagepilot/contracts";
import type { AlertCreatedEvent } from "@pagepilot/contracts";
import { analyzeTarget, computeAuditDiff } from "@pagepilot/audit-engine";
import { inngestClient } from "../client.js";
import type { WorkflowDeps } from "../types.js";
import { evaluateAuditAlerts } from "../alerts/alert-evaluation.js";

/**
 * Creates the durable background audit execution workflow with injectable dependencies.
 */
export function createAuditWorkflow(deps: WorkflowDeps) {
  const client = deps.client ?? inngestClient;

  return client.createFunction(
    {
      id: "execute-audit-workflow",
      name: "Execute Audit Workflow",
      retries: 3,
      triggers: [{ event: AUDIT_REQUESTED_EVENT }],
    },
    async ({ event, step }) => {
      // 0. Validate incoming event payload against strict Zod schema
      const parseResult = auditRequestedPayloadSchema.safeParse(event.data);
      if (!parseResult.success) {
        throw new NonRetriableError(
          `Invalid audit/requested event payload: ${parseResult.error.issues[0]?.message || "Validation failed"}`,
        );
      }
      const payload = parseResult.data;

      // -----------------------------------------------------------------------
      // Step 1: Claim and validate audit run
      // -----------------------------------------------------------------------
      const claimResult = await step.run("claim-and-validate-run", async () => {
        // 1a. Load audit run from persistence store
        const run = await deps.auditStore.getAuditRun(payload.auditRunId);
        if (!run) {
          throw new NonRetriableError(`Audit run ${payload.auditRunId} not found.`);
        }

        // 1b. Strict Tenant & Resource Boundary Verification
        if (
          run.organizationId !== payload.organizationId ||
          run.projectId !== payload.projectId ||
          run.monitoredPageId !== payload.monitoredPageId
        ) {
          throw new NonRetriableError(
            `Tenant or resource mismatch for audit run ${payload.auditRunId}.`,
          );
        }

        // 1c. Check if already completed (Idempotent replay protection)
        if (run.status === "completed") {
          return {
            action: "skip" as const,
            reason: "already_completed" as const,
            runId: run.id,
          };
        }

        // 1d. Load monitored page to ensure target exists and belongs to tenant
        const page = await deps.auditStore.getMonitoredPage(
          payload.organizationId,
          payload.projectId,
          payload.monitoredPageId,
        );
        if (!page) {
          throw new NonRetriableError(
            `Monitored page ${payload.monitoredPageId} not found in organization.`,
          );
        }

        // 1e. Atomically claim execution in database (DB-backed concurrency lock)
        const claim = await deps.auditStore.claimRunForExecution(
          payload.organizationId,
          payload.auditRunId,
        );

        if (claim.state === "already_completed") {
          return {
            action: "skip" as const,
            reason: "already_completed" as const,
            runId: run.id,
          };
        }

        if (claim.state === "already_running") {
          // Another worker is actively executing this run
          return {
            action: "skip" as const,
            reason: "already_running" as const,
            runId: run.id,
          };
        }

        if (claim.state === "not_found") {
          throw new NonRetriableError(`Audit run ${payload.auditRunId} not found.`);
        }

        return {
          action: "proceed" as const,
          runId: run.id,
          targetUrl: page.canonicalUrl,
          orgId: payload.organizationId,
          projectId: payload.projectId,
          pageId: payload.monitoredPageId,
        };
      });

      if (claimResult.action === "skip") {
        return {
          ok: true,
          skipped: true,
          reason: claimResult.reason,
          runId: claimResult.runId,
        };
      }

      // -----------------------------------------------------------------------
      // Step 2: Execute Audit Engine
      // -----------------------------------------------------------------------
      const analysisResult = await step.run("execute-audit-engine", async () => {
        const analyzeFn = deps.analyzeUrl ?? analyzeTarget;
        try {
          const outcome = await analyzeFn(claimResult.targetUrl);
          if (!outcome.ok) {
            return {
              ok: false as const,
              status: outcome.status,
              code: outcome.code,
              message: outcome.message,
              retryable: outcome.retryable,
            };
          }
          return {
            ok: true as const,
            report: outcome.report,
          };
        } catch (err: unknown) {
          console.error("[workflows/audit-workflow] unexpected engine failure:", err);
          return {
            ok: false as const,
            status: 502,
            code: "UPSTREAM_FAILURE",
            message: "Failed to analyze landing page.",
            retryable: true,
          };
        }
      });

      // -----------------------------------------------------------------------
      // Step 3: Persist Audit Result
      // -----------------------------------------------------------------------
      const persistResult = await step.run("persist-audit-result", async () => {
        if (analysisResult.ok) {
          const { auditReportId } = await deps.auditStore.persistCompletedAudit(
            claimResult.orgId,
            claimResult.projectId,
            claimResult.pageId,
            claimResult.runId,
            analysisResult.report.source.finalUrl,
            analysisResult.report,
          );
          return {
            status: "completed" as const,
            auditReportId,
            overallScore: analysisResult.report.overallScore,
          };
        } else {
          // Record failure while preserving latest_successful_audit_run_id
          await deps.auditStore.recordRunFailure(
            claimResult.orgId,
            claimResult.projectId,
            claimResult.pageId,
            claimResult.runId,
            {
              code: analysisResult.code,
              message: analysisResult.message,
              retryable: analysisResult.retryable,
            },
          );

          if (!analysisResult.retryable) {
            throw new NonRetriableError(
              `Audit failed with non-retryable error [${analysisResult.code}]: ${analysisResult.message}`,
            );
          } else {
            throw new Error(
              `Audit failed with retryable error [${analysisResult.code}]: ${analysisResult.message}`,
            );
          }
        }
      });

      // -----------------------------------------------------------------------
      // Step 4: Evaluate regressions and dispatch alert notifications
      // -----------------------------------------------------------------------
      const alertOutcome = await step.run("evaluate-and-dispatch-alerts", async () => {
        if (!analysisResult.ok) {
          return { dispatchedAlertsCount: 0 };
        }

        // 1. Fetch previous successful audit report (excluding current run)
        const previousReport =
          await deps.auditStore.getPreviousSuccessfulAuditReport(
            claimResult.orgId,
            claimResult.projectId,
            claimResult.pageId,
            claimResult.runId,
          );

        // 2. Compute pure deterministic regression diff
        const diff = computeAuditDiff({
          previousReport,
          currentReport: analysisResult.report,
        });

        // 3. Pure alert evaluation
        const evaluation = evaluateAuditAlerts(diff, {
          organizationId: claimResult.orgId,
          projectId: claimResult.projectId,
          monitoredPageId: claimResult.pageId,
          auditRunId: claimResult.runId,
          consecutiveFailureCount: 0,
          evaluatedAt: new Date().toISOString(),
        });

        if (!evaluation.hasAlerts || evaluation.decisions.length === 0) {
          return { dispatchedAlertsCount: 0 };
        }

        let dispatchedCount = 0;
        const eventsToEmit: AlertCreatedEvent[] = [];

        // 4. Persist alerts with state-aware 24-hour suppression & deduplication
        for (const decision of evaluation.decisions) {
          const { alert, isExisting, isSuppressed } =
            await deps.auditStore.persistAlert({
              organizationId: claimResult.orgId,
              projectId: claimResult.projectId,
              monitoredPageId: claimResult.pageId,
              auditRunId: claimResult.runId,
              ruleType: decision.ruleType,
              severity: decision.severity,
              title: decision.title,
              reasonCode: decision.reason.code,
              reasonSummary: decision.reason.summary,
              reasonDetails: decision.reason.details ?? null,
              category: decision.category ?? null,
              targetId: decision.targetId ?? null,
              scoreDelta: decision.scoreDelta ?? null,
              previousValue:
                decision.previousValue !== undefined
                  ? String(decision.previousValue)
                  : null,
              currentValue:
                decision.currentValue !== undefined
                  ? String(decision.currentValue)
                  : null,
              deduplicationKey: decision.deduplicationKey,
              schemaVersion: decision.schemaVersion,
              status: "created",
              metadata: decision.metadata ?? {},
            });

          // If freshly created (not duplicate and not suppressed by 24h window), queue event
          if (!isExisting && !isSuppressed) {
            eventsToEmit.push({
              name: ALERT_CREATED_EVENT,
              data: {
                alertId: alert.id,
                organizationId: alert.organizationId,
                projectId: alert.projectId,
                monitoredPageId: alert.monitoredPageId,
                auditRunId: alert.auditRunId ?? null,
              },
            });
            dispatchedCount++;
          }
        }

        // 5. Emit Inngest delivery events
        if (eventsToEmit.length > 0 && client.send) {
          await client.send(eventsToEmit);
        }

        return { dispatchedAlertsCount: dispatchedCount };
      });

      return {
        ok: true,
        runId: claimResult.runId,
        status: persistResult.status,
        auditReportId: persistResult.auditReportId,
        overallScore: persistResult.overallScore,
        dispatchedAlertsCount: alertOutcome.dispatchedAlertsCount,
      };
    },
  );
}

