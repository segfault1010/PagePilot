import type {
  AlertDeliveryEntity,
  AlertEntity,
  AlertRuleType,
  AlertStatus,
  AuditRun,
  MonitoredPage,
  Report,
  Role,
  AuditScreenshotMetadata,
  ScreenshotMimeType,
  VisualAnalysisReview,
  VisualDiffResult,
} from "@pagepilot/contracts";
import type {
  AnalysisOutcome,
  BrowserCaptureProvider,
  VisionAuditProvider,
  VisualDiffEngine,
} from "@pagepilot/audit-engine";
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
   * Resolves active integration subscriptions (Slack / Webhook) for an alert event.
   * Matches both project-scoped integrations (project_id = projectId) and organization-wide integrations (project_id IS NULL)
   * that are active and subscribed to the specified event type.
   */
  listSubscribedIntegrations(
    orgId: string,
    projectId: string,
    eventType: AlertRuleType,
  ): Promise<
    Array<{
      id: string;
      provider: "slack" | "webhook";
      name: string;
      targetUrl: string;
      signingSecret?: string;
      config?: Record<string, unknown>;
    }>
  >;

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
 * Screenshot storage and persistence interface for durable visual capture step.
 */
export interface WorkflowScreenshotStore {
  listScreenshots(auditRunId: string): Promise<AuditScreenshotMetadata[]>;
  uploadScreenshot(params: {
    storagePath: string;
    buffer: Buffer;
    mimeType: ScreenshotMimeType;
  }): Promise<{ storagePath: string }>;
  persistScreenshotMetadata(
    metadata: Omit<AuditScreenshotMetadata, "id" | "createdAt" | "signedUrl">
  ): Promise<AuditScreenshotMetadata>;
  downloadScreenshot?(storagePath: string): Promise<Buffer | null>;
}

/**
 * Visual Analysis storage and persistence interface for durable vision review step.
 */
export interface WorkflowVisualAnalysisStore {
  getVisualReview(auditRunId: string): Promise<VisualAnalysisReview | null>;
  persistVisualReview(review: VisualAnalysisReview): Promise<VisualAnalysisReview>;
  recordVisualReviewFailure?(params: {
    auditRunId: string;
    organizationId?: string;
    projectId?: string;
    monitoredPageId?: string;
    errorMessage: string;
  }): Promise<void>;
}

/**
 * Visual Regression storage and persistence interface for durable diff step.
 */
export interface WorkflowVisualDiffStore {
  getVisualDiffsForRun(auditRunId: string): Promise<VisualDiffResult[]>;
  persistVisualDiff(diff: VisualDiffResult): Promise<VisualDiffResult>;
  getPreviousAuditScreenshots(
    organizationId: string,
    monitoredPageId: string,
    currentRunId: string,
    compareRunId?: string
  ): Promise<AuditScreenshotMetadata[]>;
  recordVisualDiffFailure?(params: {
    auditRunId: string;
    organizationId?: string;
    projectId?: string;
    monitoredPageId?: string;
    errorMessage: string;
  }): Promise<void>;
}

/**
 * Dependencies injected into the durable audit workflow factory.
 */
export interface WorkflowDeps {
  auditStore: WorkflowPersistenceStore;
  screenshotStore?: WorkflowScreenshotStore;
  visualAnalysisStore?: WorkflowVisualAnalysisStore;
  visualDiffStore?: WorkflowVisualDiffStore;
  visualDiffEngine?: VisualDiffEngine;
  browserCapture?: BrowserCaptureProvider;
  visionAuditor?: VisionAuditProvider;
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

