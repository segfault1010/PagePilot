import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUDIT_ENGINE_CHECK_VERSION,
  AUDIT_ENGINE_PROMPT_VERSION,
  AUDIT_ENGINE_SCORING_VERSION,
  REPORT_SCHEMA_VERSION,
} from "@pagepilot/contracts";
import type {
  AlertDeliveryEntity,
  AlertEntity,
  AlertRuleType,
  AlertStatus,
  AuditRun,
  MonitoredPage,
  Report,
  Role,
} from "@pagepilot/contracts";
import type {
  ClaimRunResult,
  MonitoredPageWithProject,
  WorkflowPersistenceStore,
} from "@pagepilot/workflows";
import {
  createPrivilegedSupabaseClient,
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";
import { decryptCredentials } from "../integrations/crypto.js";

function mapAuditRunRow(row: any): AuditRun {
  return {
    id: row.id,
    monitoredPageId: row.monitored_page_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    invocationType: row.invocation_type,
    status: row.status,
    targetUrl: row.target_url,
    finalUrl: row.final_url ?? null,
    triggeredByUserId: row.triggered_by_user_id ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    failedAt: row.failed_at ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    retryable: row.retryable ?? null,
    modelVersion: row.model_version,
    checkVersion: row.check_version,
    promptVersion: row.prompt_version,
    scoringVersion: row.scoring_version,
    retryCount: row.retry_count ?? 0,
    maxRetries: row.max_retries ?? 3,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMonitoredPageRow(row: any): MonitoredPage {
  return {
    id: row.id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    canonicalUrl: row.canonical_url,
    cadence: row.cadence ?? "weekly",
    status: row.status ?? "active",
    ownerId: row.owner_id ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    latestAuditRunId: row.latest_audit_run_id ?? null,
    latestSuccessfulAuditRunId: row.latest_successful_audit_run_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAlertRow(row: any): AlertEntity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    monitoredPageId: row.monitored_page_id,
    auditRunId: row.audit_run_id ?? null,
    ruleType: row.rule_type,
    severity: row.severity,
    title: row.title,
    reasonCode: row.reason_code,
    reasonSummary: row.reason_summary,
    reasonDetails: row.reason_details ?? null,
    category: row.category ?? null,
    targetId: row.target_id ?? null,
    scoreDelta:
      row.score_delta !== null && row.score_delta !== undefined
        ? Number(row.score_delta)
        : null,
    previousValue: row.previous_value ?? null,
    currentValue: row.current_value ?? null,
    deduplicationKey: row.deduplication_key,
    schemaVersion: row.schema_version ?? "1.0.0",
    status: row.status ?? "created",
    metadata:
      typeof row.metadata === "object" && row.metadata !== null
        ? row.metadata
        : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeliveryRow(row: any): AlertDeliveryEntity {
  return {
    id: row.id,
    alertId: row.alert_id,
    organizationId: row.organization_id,
    channel: row.channel ?? "email",
    recipient: row.recipient,
    integrationConnectionId: row.integration_connection_id ?? null,
    deliveryKey: row.delivery_key,
    status: row.status ?? "pending",
    attempts: row.attempts ?? 0,
    lastAttemptedAt: row.last_attempted_at ?? null,
    deliveredAt: row.delivered_at ?? null,
    errorMessage: row.error_message ?? null,
    metadata:
      typeof row.metadata === "object" && row.metadata !== null
        ? row.metadata
        : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Server-side PostgreSQL/Supabase persistence store implementing the narrow
 * WorkflowPersistenceStore interface for durable Inngest workflows and schedulers.
 */
export class SupabaseWorkflowPersistenceStore implements WorkflowPersistenceStore {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    if (client) {
      this.client = client;
    } else {
      const config = getServerAuthConfig();
      if (!config) {
        throw new Error("Supabase is not configured on server.");
      }
      // For background workflows, use service-role privileged client if available,
      // or server client with service-role fallback.
      const clientInstance =
        createPrivilegedSupabaseClient(config) ??
        createServerSupabaseClient(config);
      if (!clientInstance) {
        throw new Error("Failed to initialize Supabase client for workflow store.");
      }
      this.client = clientInstance;
    }
  }

  async getAuditRun(runId: string): Promise<AuditRun | null> {
    const { data, error } = await this.client
      .from("audit_runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();

    if (error || !data) return null;
    return mapAuditRunRow(data);
  }

  async getMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<MonitoredPage | null> {
    const { data, error } = await this.client
      .from("monitored_pages")
      .select("*")
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error || !data) return null;
    return mapMonitoredPageRow(data);
  }

  async listEligibleWeeklyPages(
    limit = 100,
    offset = 0,
  ): Promise<MonitoredPageWithProject[]> {
    const { data, error } = await this.client
      .from("monitored_pages")
      .select("*, projects(timezone, name)")
      .eq("status", "active")
      .eq("cadence", "weekly")
      .range(offset, offset + limit - 1);

    if (error || !data) return [];

    return data.map((row: any) => {
      const page = mapMonitoredPageRow(row);
      return {
        ...page,
        timezone: row.projects?.timezone || "UTC",
        projectName: row.projects?.name,
      };
    });
  }

  async createScheduledAuditRun(
    page: MonitoredPage,
    idempotencyKey: string,
  ): Promise<{ run: AuditRun; isExisting: boolean }> {
    const modelVersion = process.env.GEMINI_MODEL || "gemini-3.6-flash";
    const now = new Date().toISOString();

    // 1. Check for existing run by idempotencyKey
    const { data: existing, error: findError } = await this.client
      .from("audit_runs")
      .select("*")
      .eq("monitored_page_id", page.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing && !findError) {
      return {
        run: mapAuditRunRow(existing),
        isExisting: true,
      };
    }

    // 2. Insert new scheduled audit run
    const { data: inserted, error: insertError } = await this.client
      .from("audit_runs")
      .insert({
        monitored_page_id: page.id,
        project_id: page.projectId,
        organization_id: page.organizationId,
        invocation_type: "scheduled",
        status: "requested",
        target_url: page.canonicalUrl,
        triggered_by_user_id: null,
        idempotency_key: idempotencyKey,
        model_version: modelVersion,
        check_version: AUDIT_ENGINE_CHECK_VERSION,
        prompt_version: AUDIT_ENGINE_PROMPT_VERSION,
        scoring_version: AUDIT_ENGINE_SCORING_VERSION,
        retry_count: 0,
        max_retries: 3,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError) {
      // Check for unique constraint violation (code 23505 on uq_audit_runs_idempotency)
      if (
        insertError.code === "23505" ||
        insertError.message?.includes("uq_audit_runs_idempotency")
      ) {
        const { data: conflictRun } = await this.client
          .from("audit_runs")
          .select("*")
          .eq("monitored_page_id", page.id)
          .eq("idempotency_key", idempotencyKey)
          .single();

        if (conflictRun) {
          return {
            run: mapAuditRunRow(conflictRun),
            isExisting: true,
          };
        }
      }
      throw insertError;
    }

    // 3. Update monitored_pages latest_audit_run_id (preserve latest_successful_audit_run_id)
    await this.client
      .from("monitored_pages")
      .update({
        latest_audit_run_id: inserted.id,
        updated_at: now,
      })
      .eq("id", page.id)
      .eq("organization_id", page.organizationId);

    return {
      run: mapAuditRunRow(inserted),
      isExisting: false,
    };
  }

  async claimRunForExecution(
    orgId: string,
    runId: string,
  ): Promise<ClaimRunResult> {
    const now = new Date().toISOString();

    // 1. Check current status
    const { data: current, error: readError } = await this.client
      .from("audit_runs")
      .select("*")
      .eq("id", runId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (readError || !current) {
      return { state: "not_found" };
    }

    if (current.status === "completed") {
      return { state: "already_completed", run: mapAuditRunRow(current) };
    }

    if (current.status === "running") {
      return { state: "already_running", run: mapAuditRunRow(current) };
    }

    // 2. Atomically transition requested/queued -> running in database
    const { data: updated, error: updateError } = await this.client
      .from("audit_runs")
      .update({
        status: "running",
        started_at: current.started_at || now,
        updated_at: now,
      })
      .eq("id", runId)
      .eq("organization_id", orgId)
      .in("status", ["requested", "queued"])
      .select()
      .maybeSingle();

    if (updateError || !updated) {
      // Race condition: another worker updated the status concurrently
      const latest = await this.getAuditRun(runId);
      if (!latest) return { state: "not_found" };
      if (latest.status === "completed") {
        return { state: "already_completed", run: latest };
      }
      if (latest.status === "running") {
        return { state: "already_running", run: latest };
      }
      return { state: "already_running", run: latest };
    }

    return { state: "claimed", run: mapAuditRunRow(updated) };
  }

  async persistCompletedAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    finalUrl: string,
    report: Report,
  ): Promise<{ auditReportId: string }> {
    const modelVersion = process.env.GEMINI_MODEL || "gemini-3.6-flash";

    const scoreSnapshotsJson = report.categories.map((c) => ({
      category: c.category,
      score: c.score,
      confidence: c.confidence,
      explanation: c.explanation,
      severity: c.severity,
    }));

    const findingsJson: any[] = [];
    report.topProblems.forEach((tp, idx) => {
      findingsJson.push({
        findingType: "top_problem",
        category: tp.category || "clarity",
        title: tp.title,
        severity: tp.severity,
        evidence: tp.evidence,
        basis: tp.basis,
        signalIds: tp.signalIds,
        recommendation: tp.recommendation,
        displayOrder: idx,
      });
    });

    report.categories.forEach((cat) => {
      cat.findings.forEach((f, idx) => {
        findingsJson.push({
          findingType: "category_finding",
          category: cat.category,
          title: f.title,
          severity: f.severity,
          evidence: f.evidence,
          basis: f.basis,
          signalIds: f.signalIds,
          recommendation: f.recommendation,
          displayOrder: idx,
        });
      });
    });

    const recommendationsJson: any[] = [];
    report.quickWins.forEach((qw, idx) => {
      recommendationsJson.push({
        recommendationType: "quick_win",
        category: qw.category || null,
        title: qw.title,
        detail: qw.detail,
        displayOrder: idx,
      });
    });

    report.detailedRecommendations.forEach((dr, idx) => {
      recommendationsJson.push({
        recommendationType: "detailed",
        category: dr.category || null,
        title: dr.title,
        detail: dr.detail,
        displayOrder: idx,
        created_at: new Date().toISOString(),
      });
    });

    const { data: reportId, error } = await this.client.rpc(
      "persist_completed_audit_report",
      {
        p_org_id: orgId,
        p_project_id: projectId,
        p_page_id: pageId,
        p_run_id: runId,
        p_final_url: finalUrl,
        p_schema_version: REPORT_SCHEMA_VERSION,
        p_model_identifier: modelVersion,
        p_check_version: AUDIT_ENGINE_CHECK_VERSION,
        p_scoring_version: AUDIT_ENGINE_SCORING_VERSION,
        p_summary: report.summary,
        p_overall_score: report.overallScore,
        p_score_confidence: report.scoreConfidence,
        p_report_payload: report,
        p_score_snapshots: scoreSnapshotsJson,
        p_findings: findingsJson,
        p_recommendations: recommendationsJson,
      },
    );

    if (error) {
      throw error;
    }

    return { auditReportId: reportId };
  }

  async recordRunFailure(
    orgId: string,
    _projectId: string,
    pageId: string,
    runId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.client
      .from("audit_runs")
      .update({
        status: "failed",
        failed_at: now,
        error_code: error.code,
        error_message: error.message,
        retryable: error.retryable,
        updated_at: now,
      })
      .eq("id", runId)
      .eq("organization_id", orgId);

    // Update monitored_pages latest_audit_run_id ONLY
    // Crucial: latest_successful_audit_run_id remains untouched!
    await this.client
      .from("monitored_pages")
      .update({
        latest_audit_run_id: runId,
        updated_at: now,
      })
      .eq("id", pageId)
      .eq("organization_id", orgId);
  }

  async getPreviousSuccessfulAuditReport(
    orgId: string,
    _projectId: string,
    pageId: string,
    currentRunId?: string,
  ): Promise<Report | null> {
    let query = this.client
      .from("audit_reports")
      .select("report_payload, created_at, audit_run_id")
      .eq("organization_id", orgId)
      .eq("monitored_page_id", pageId)
      .order("created_at", { ascending: false });

    if (currentRunId) {
      query = query.neq("audit_run_id", currentRunId);
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error || !data) return null;
    return data.report_payload as Report;
  }

  async findRecentAlert(
    monitoredPageId: string,
    deduplicationKey: string,
    withinHours = 24,
  ): Promise<AlertEntity | null> {
    const cutoff = new Date(
      Date.now() - withinHours * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.client
      .from("alerts")
      .select("*")
      .eq("monitored_page_id", monitoredPageId)
      .eq("deduplication_key", deduplicationKey)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) return null;
    return mapAlertRow(data);
  }

  async persistAlert(
    alert: Omit<AlertEntity, "id" | "createdAt" | "updatedAt">,
  ): Promise<{ alert: AlertEntity; isExisting: boolean; isSuppressed: boolean }> {
    const now = new Date().toISOString();

    // 1. State-aware 24-hour suppression check
    const recent = await this.findRecentAlert(
      alert.monitoredPageId,
      alert.deduplicationKey,
      24,
    );

    if (recent) {
      // If the identical ongoing regression was already alerted within 24h, suppress noise
      const isIdenticalOngoing =
        String(recent.currentValue ?? "") ===
          String(alert.currentValue ?? "") &&
        String(recent.previousValue ?? "") ===
          String(alert.previousValue ?? "") &&
        Number(recent.scoreDelta ?? 0) === Number(alert.scoreDelta ?? 0);

      if (isIdenticalOngoing) {
        return {
          alert: recent,
          isExisting: false,
          isSuppressed: true,
        };
      }
    }

    // 2. Insert new alert into PostgreSQL
    const { data: inserted, error: insertError } = await this.client
      .from("alerts")
      .insert({
        organization_id: alert.organizationId,
        project_id: alert.projectId,
        monitored_page_id: alert.monitoredPageId,
        audit_run_id: alert.auditRunId ?? null,
        rule_type: alert.ruleType,
        severity: alert.severity,
        title: alert.title,
        reason_code: alert.reasonCode,
        reason_summary: alert.reasonSummary,
        reason_details: alert.reasonDetails ?? null,
        category: alert.category ?? null,
        target_id: alert.targetId ?? null,
        score_delta: alert.scoreDelta ?? null,
        previous_value:
          alert.previousValue !== undefined && alert.previousValue !== null
            ? String(alert.previousValue)
            : null,
        current_value:
          alert.currentValue !== undefined && alert.currentValue !== null
            ? String(alert.currentValue)
            : null,
        deduplication_key: alert.deduplicationKey,
        schema_version: alert.schemaVersion ?? "1.0.0",
        status: alert.status ?? "created",
        metadata: alert.metadata ?? {},
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError) {
      // Check for unique constraint violation on (audit_run_id, deduplication_key)
      if (
        (insertError.code === "23505" ||
          insertError.message?.includes("uq_alerts_run_dedup")) &&
        alert.auditRunId
      ) {
        const { data: existing } = await this.client
          .from("alerts")
          .select("*")
          .eq("audit_run_id", alert.auditRunId)
          .eq("deduplication_key", alert.deduplicationKey)
          .single();

        if (existing) {
          return {
            alert: mapAlertRow(existing),
            isExisting: true,
            isSuppressed: false,
          };
        }
      }
      throw insertError;
    }

    return {
      alert: mapAlertRow(inserted),
      isExisting: false,
      isSuppressed: false,
    };
  }

  async getAlert(alertId: string): Promise<AlertEntity | null> {
    const { data, error } = await this.client
      .from("alerts")
      .select("*")
      .eq("id", alertId)
      .maybeSingle();

    if (error || !data) return null;
    return mapAlertRow(data);
  }

  async updateAlertStatus(
    alertId: string,
    status: AlertStatus,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatePayload: any = {
      status,
      updated_at: now,
    };
    if (metadata) {
      updatePayload.metadata = metadata;
    }

    await this.client.from("alerts").update(updatePayload).eq("id", alertId);
  }

  async listOrganizationRecipients(
    orgId: string,
  ): Promise<Array<{ id: string; email: string; role: Role }>> {
    const { data, error } = await this.client
      .from("memberships")
      .select("user_id, role, profiles(email)")
      .eq("organization_id", orgId)
      .in("role", ["owner", "admin"]);

    if (error || !data) return [];

    return data
      .filter((row: any) => row.profiles?.email)
      .map((row: any) => ({
        id: row.user_id,
        email: row.profiles.email,
        role: row.role as Role,
      }));
  }

  async listSubscribedIntegrations(
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
  > {
    const { data, error } = await this.client
      .from("integration_connections")
      .select("*")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .or(`project_id.eq.${projectId},project_id.is.null`);

    if (error || !data) return [];

    const results: Array<{
      id: string;
      provider: "slack" | "webhook";
      name: string;
      targetUrl: string;
      signingSecret?: string;
      config?: Record<string, unknown>;
    }> = [];

    for (const row of data) {
      const events: string[] = row.events || [];
      if (!events.includes(eventType)) {
        continue;
      }

      try {
        const decrypted = decryptCredentials(row.encrypted_credentials);
        if (decrypted.targetUrl) {
          results.push({
            id: row.id,
            provider: row.provider,
            name: row.name,
            targetUrl: decrypted.targetUrl,
            signingSecret: decrypted.signingSecret || undefined,
            config: row.config || {},
          });
        }
      } catch (err) {
        console.error(
          `[workflow-store] failed to decrypt credentials for integration ${row.id}:`,
          err,
        );
      }
    }

    return results;
  }

  async getOrCreateDelivery(
    delivery: Omit<AlertDeliveryEntity, "id" | "createdAt" | "updatedAt">,
  ): Promise<{ delivery: AlertDeliveryEntity; isExisting: boolean }> {
    const now = new Date().toISOString();

    // 1. Check existing by delivery_key
    const { data: existing, error: findError } = await this.client
      .from("alert_deliveries")
      .select("*")
      .eq("delivery_key", delivery.deliveryKey)
      .maybeSingle();

    if (existing && !findError) {
      return {
        delivery: mapDeliveryRow(existing),
        isExisting: true,
      };
    }

    // 2. Insert delivery record
    const { data: inserted, error: insertError } = await this.client
      .from("alert_deliveries")
      .insert({
        alert_id: delivery.alertId,
        organization_id: delivery.organizationId,
        channel: delivery.channel ?? "email",
        recipient: delivery.recipient,
        integration_connection_id:
          (delivery as any).integrationConnectionId ?? null,
        delivery_key: delivery.deliveryKey,
        status: delivery.status ?? "pending",
        attempts: delivery.attempts ?? 0,
        metadata: delivery.metadata ?? {},
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertError) {
      if (
        insertError.code === "23505" ||
        insertError.message?.includes("uq_alert_deliveries_key")
      ) {
        const { data: conflictRecord } = await this.client
          .from("alert_deliveries")
          .select("*")
          .eq("delivery_key", delivery.deliveryKey)
          .single();

        if (conflictRecord) {
          return {
            delivery: mapDeliveryRow(conflictRecord),
            isExisting: true,
          };
        }
      }
      throw insertError;
    }

    return {
      delivery: mapDeliveryRow(inserted),
      isExisting: false,
    };
  }

  async recordDeliverySuccess(
    deliveryId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const updatePayload: any = {
      status: "delivered",
      delivered_at: now,
      last_attempted_at: now,
      updated_at: now,
    };
    if (metadata) {
      updatePayload.metadata = metadata;
    }

    await this.client
      .from("alert_deliveries")
      .update(updatePayload)
      .eq("id", deliveryId);
  }

  async recordDeliveryFailure(
    deliveryId: string,
    errorMessage: string,
    isPermanent: boolean,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { data: current } = await this.client
      .from("alert_deliveries")
      .select("attempts")
      .eq("id", deliveryId)
      .maybeSingle();

    const attempts = (current?.attempts ?? 0) + 1;

    await this.client
      .from("alert_deliveries")
      .update({
        status: isPermanent ? "failed" : "pending",
        error_message: errorMessage,
        attempts,
        last_attempted_at: now,
        updated_at: now,
      })
      .eq("id", deliveryId);
  }
}

