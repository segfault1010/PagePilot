import type {
  AlertDeliveryEntity,
  AlertEntity,
  AlertStatus,
  AuditRun,
  MonitoredPage,
  Report,
  Role,
} from "@pagepilot/contracts";
import type { AnalysisOutcome } from "@pagepilot/audit-engine";
import type { Inngest } from "inngest";

/**
 * Monitored page entity enriched with project metadata (e.g. timezone).
 */
export type MonitoredPageWithProject = MonitoredPage & {
  timezone?: string;
  projectName?: string;
};

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
 * Narrow persistence interface required for durable audit workflow and scheduler execution.
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
   * Discovers all active monitored pages configured for weekly cadence.
   * Enriched with project timezone for deterministic weekly window derivation.
   */
  listEligibleWeeklyPages(
    limit?: number,
    offset?: number,
  ): Promise<MonitoredPageWithProject[]>;

  /**
   * Atomically creates a scheduled audit run with a deterministic idempotency key.
   * If a run already exists for (monitored_page_id, idempotency_key), returns { run, isExisting: true }.
   */
  createScheduledAuditRun(
    page: MonitoredPage,
    idempotencyKey: string,
  ): Promise<{ run: AuditRun; isExisting: boolean }>;

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

  /**
   * Fetches the previous successful audit report for a monitored page to perform diff comparison.
   * Excludes currentRunId if provided.
   */
  getPreviousSuccessfulAuditReport(
    orgId: string,
    projectId: string,
    pageId: string,
    currentRunId?: string,
  ): Promise<Report | null>;

  /**
   * Finds recent alerts for a monitored page with matching deduplication key within a time window (hours).
   */
  findRecentAlert(
    monitoredPageId: string,
    deduplicationKey: string,
    withinHours?: number,
  ): Promise<AlertEntity | null>;

  /**
   * Persists an evaluated alert decision.
   * Returns isSuppressed = true if suppressed by the 24-hour suppression window on ongoing identical regression,
   * or isExisting = true if a duplicate run/event was already persisted.
   */
  persistAlert(
    alert: Omit<AlertEntity, "id" | "createdAt" | "updatedAt">,
  ): Promise<{ alert: AlertEntity; isExisting: boolean; isSuppressed: boolean }>;

  /**
   * Fetches an alert by ID.
   */
  getAlert(alertId: string): Promise<AlertEntity | null>;

  /**
   * Updates an alert status (e.g. 'delivered' or 'failed').
   */
  updateAlertStatus(
    alertId: string,
    status: AlertStatus,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Resolves authorized notification recipients (owner and admin members) for an organization.
   */
  listOrganizationRecipients(
    orgId: string,
  ): Promise<Array<{ id: string; email: string; role: Role }>>;

  /**
   * Atomically claims or retrieves an alert delivery attempt using the deterministic deliveryKey.
   */
  getOrCreateDelivery(
    delivery: Omit<AlertDeliveryEntity, "id" | "createdAt" | "updatedAt">,
  ): Promise<{ delivery: AlertDeliveryEntity; isExisting: boolean }>;

  /**
   * Records successful delivery of an alert notification.
   */
  recordDeliverySuccess(
    deliveryId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Records failed delivery of an alert notification.
   */
  recordDeliveryFailure(
    deliveryId: string,
    errorMessage: string,
    isPermanent: boolean,
  ): Promise<void>;
}

/**
 * Dependencies injected into the durable audit workflow factory.
 */
export interface WorkflowDeps {
  auditStore: WorkflowPersistenceStore;
  analyzeUrl?: (url: string) => Promise<AnalysisOutcome>;
  client?: Inngest;
}

/**
 * Dependencies injected into the weekly scheduler workflow factory.
 */
export interface SchedulerDeps {
  schedulerStore: WorkflowPersistenceStore;
  client?: Inngest;
  now?: () => Date;
}

