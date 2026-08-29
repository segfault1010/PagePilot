import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUDIT_ENGINE_CHECK_VERSION,
  AUDIT_ENGINE_SCORING_VERSION,
  REPORT_SCHEMA_VERSION,
} from "@pagepilot/contracts";
import type {
  AuditRun,
  MonitoredPage,
  Report,
} from "@pagepilot/contracts";
import type {
  ClaimRunResult,
  WorkflowPersistenceStore,
} from "@pagepilot/workflows";
import {
  createPrivilegedSupabaseClient,
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

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

/**
 * Server-side PostgreSQL/Supabase persistence store implementing the narrow
 * WorkflowPersistenceStore interface for durable Inngest workflows.
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
}
