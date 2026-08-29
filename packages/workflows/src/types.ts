import type {
  AuditRun,
  MonitoredPage,
  Report,
} from "@pagepilot/contracts";
import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import type { Inngest } from "inngest";

/**
 * Result of attempting to claim an audit run for execution.
 * Prevents concurrent workers from executing the same auditRunId.
 */
export type ClaimRunResult =
  | { state: "claimed"; run: AuditRun }
  | { state: "already_running"; run: AuditRun }
  | { state: "already_completed"; run: AuditRun }
  | { state: "not_found" };

/**
 * Narrow persistence interface required for durable audit workflow execution.
 * Decoupled from direct database clients or Supabase SDKs.
 */
export interface WorkflowPersistenceStore {
  /**
   * Fetches an audit run by ID.
   */
  getAuditRun(runId: string): Promise<AuditRun | null>;

  /**
   * Fetches a monitored page within its tenant scope.
   */
  getMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<MonitoredPage | null>;

  /**
   * Atomically claims an audit run for execution:
   * - If status is 'requested' or 'queued', transitions to 'running' and returns { state: "claimed", run }.
   * - If status is already 'running', returns { state: "already_running", run } to prevent concurrent executions.
   * - If status is 'completed', returns { state: "already_completed", run }.
   * - If run not found, returns { state: "not_found" }.
   */
  claimRunForExecution(orgId: string, runId: string): Promise<ClaimRunResult>;

  /**
   * Atomically persists a completed audit report aggregate and updates
   * monitored_page latest pointers via database RPC.
   */
  persistCompletedAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    finalUrl: string,
    report: Report,
  ): Promise<{ auditReportId: string }>;

  /**
   * Records an audit run failure with safe error metadata while preserving
   * the last successful audit report pointer intact.
   */
  recordRunFailure(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void>;
}

/**
 * Dependencies injected into the durable workflow factory.
 */
export interface WorkflowDeps {
  auditStore: WorkflowPersistenceStore;
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
  client?: Inngest;
}
