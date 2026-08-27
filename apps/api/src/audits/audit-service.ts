import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import { analyzeTarget } from "@pagepilot/audit-engine";
import type {
  AuditRun,
  Report,
} from "@pagepilot/contracts";
import type { ProjectsStore } from "../projects/projects-store.js";
import type {
  AuditPersistenceStore,
} from "./audit-store.js";

export interface AuditServiceDeps {
  projectsStore: ProjectsStore;
  auditStore: AuditPersistenceStore;
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
}

export type ExecuteAuditResult =
  | {
      status: 200 | 201;
      auditRun: AuditRun;
      report?: Report;
      auditReportId?: string;
      isIdempotentReplay?: boolean;
    }
  | {
      status: number;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };

export class AuditService {
  private deps: AuditServiceDeps;

  constructor(deps: AuditServiceDeps) {
    this.deps = deps;
  }

  async executeManualAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    idempotencyKey?: string,
  ): Promise<ExecuteAuditResult> {
    // 1. Verify project and page exist and belong to the verified organization
    const page = await this.deps.projectsStore.getMonitoredPageById(
      orgId,
      projectId,
      pageId,
    );
    if (!page) {
      return {
        status: 404,
        error: {
          code: "NOT_FOUND",
          message: "Monitored page not found.",
          retryable: false,
        },
      };
    }

    // 2. Create or find audit run (atomic idempotency check + race condition conflict handling)
    const { run, isExisting } = await this.deps.auditStore.createAuditRun(
      orgId,
      projectId,
      pageId,
      userId,
      page.canonicalUrl,
      idempotencyKey,
    );

    // 3. If an existing run was found for this idempotency key, return existing state without re-running engine
    if (isExisting) {
      if (run.status === "completed") {
        const persisted = await this.deps.auditStore.getAuditReportByRunId(
          orgId,
          projectId,
          pageId,
          run.id,
        );
        if (persisted) {
          return {
            status: 200,
            auditRun: persisted.auditRun,
            report: persisted.report.reportPayload,
            auditReportId: persisted.report.id,
            isIdempotentReplay: true,
          };
        }
      }
      return {
        status: 200,
        auditRun: run,
        isIdempotentReplay: true,
      };
    }

    // 4. Run the safe audit engine pipeline
    const analyzeFn = this.deps.analyzeUrl ?? analyzeTarget;
    let outcome: AnalysisOutcome;
    try {
      outcome = await analyzeFn(page.canonicalUrl);
    } catch (err: any) {
      console.error("[audits] unexpected engine failure:", err);
      const safeError = {
        code: "UPSTREAM_FAILURE",
        message: "Failed to analyze landing page.",
        retryable: true,
      };
      await this.deps.auditStore.recordRunFailure(
        orgId,
        projectId,
        pageId,
        run.id,
        safeError,
      );
      return {
        status: 502,
        error: safeError,
      };
    }

    // 5. If analysis failed, persist failure and return safe error envelope
    if (!outcome.ok) {
      await this.deps.auditStore.recordRunFailure(
        orgId,
        projectId,
        pageId,
        run.id,
        {
          code: outcome.code,
          message: outcome.message,
          retryable: outcome.retryable,
        },
      );
      return {
        status: outcome.status,
        error: {
          code: outcome.code,
          message: outcome.message,
          retryable: outcome.retryable,
        },
      };
    }

    // 6. If analysis succeeded, persist atomic report aggregate
    try {
      const { auditReportId } = await this.deps.auditStore.persistCompletedAudit(
        orgId,
        projectId,
        pageId,
        run.id,
        outcome.report.source.finalUrl,
        outcome.report,
      );

      const completedRun: AuditRun = {
        ...run,
        status: "completed",
        finalUrl: outcome.report.source.finalUrl,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        status: 201,
        auditRun: completedRun,
        report: outcome.report,
        auditReportId,
        isIdempotentReplay: false,
      };
    } catch (persistErr: any) {
      console.error("[audits] persistence failure:", persistErr);
      await this.deps.auditStore.recordRunFailure(
        orgId,
        projectId,
        pageId,
        run.id,
        {
          code: "INTERNAL_ERROR",
          message: "Failed to persist audit report.",
          retryable: true,
        },
      );
      return {
        status: 500,
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to persist audit report.",
          retryable: true,
        },
      };
    }
  }
}
