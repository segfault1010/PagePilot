import { NonRetriableError } from "inngest";
import {
  AUDIT_REQUESTED_EVENT,
  auditRequestedPayloadSchema,
} from "@pagepilot/contracts";
import { analyzeTarget } from "@pagepilot/audit-engine";
import { inngestClient } from "../client.js";
import type { WorkflowDeps } from "../types.js";

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

      return {
        ok: true,
        runId: claimResult.runId,
        status: persistResult.status,
        auditReportId: persistResult.auditReportId,
        overallScore: persistResult.overallScore,
      };
    },
  );
}
