import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUDIT_ENGINE_CHECK_VERSION,
  AUDIT_ENGINE_PROMPT_VERSION,
  AUDIT_ENGINE_SCORING_VERSION,
  REPORT_SCHEMA_VERSION,
} from "@pagepilot/contracts";
import type {
  AuditHistoryItem,
  AuditReport,
  AuditRun,
  FindingEntity,
  RecommendationEntity,
  Report,
  ScoreSnapshot,
} from "@pagepilot/contracts";
import {
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

export interface PersistedAuditReport {
  auditRun: AuditRun;
  report: AuditReport;
  scoreSnapshots: ScoreSnapshot[];
  findings: FindingEntity[];
  recommendations: RecommendationEntity[];
}

export interface AuditPersistenceStore {
  findRunByIdempotencyKey(
    orgId: string,
    pageId: string,
    key: string,
  ): Promise<AuditRun | null>;

  createAuditRun(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    targetUrl: string,
    idempotencyKey?: string,
  ): Promise<{ run: AuditRun; isExisting: boolean }>;

  recordRunFailure(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void>;

  persistCompletedAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    finalUrl: string,
    report: Report,
  ): Promise<{ auditReportId: string }>;

  listAuditHistory(
    orgId: string,
    projectId: string,
    pageId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ audits: AuditHistoryItem[]; total: number }>;

  getAuditReportByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
  ): Promise<PersistedAuditReport | null>;

  getLatestSuccessfulAudit(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<PersistedAuditReport | null>;
}

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

function mapAuditReportRow(row: any): AuditReport {
  return {
    id: row.id,
    auditRunId: row.audit_run_id,
    monitoredPageId: row.monitored_page_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    schemaVersion: row.schema_version ?? REPORT_SCHEMA_VERSION,
    modelIdentifier: row.model_identifier,
    checkVersion: row.check_version,
    scoringVersion: row.scoring_version,
    summary: row.summary,
    overallScore: row.overall_score,
    scoreConfidence: row.score_confidence,
    reportPayload: row.report_payload,
    createdAt: row.created_at,
  };
}

function mapScoreSnapshotRow(row: any): ScoreSnapshot {
  return {
    id: row.id,
    auditReportId: row.audit_report_id,
    auditRunId: row.audit_run_id,
    monitoredPageId: row.monitored_page_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    category: row.category,
    score: row.score,
    confidence: row.confidence,
    explanation: row.explanation,
    severity: row.severity,
    scoringVersion: row.scoring_version,
    createdAt: row.created_at,
  };
}

function mapFindingRow(row: any): FindingEntity {
  return {
    id: row.id,
    auditReportId: row.audit_report_id,
    auditRunId: row.audit_run_id,
    monitoredPageId: row.monitored_page_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    findingType: row.finding_type,
    category: row.category,
    title: row.title,
    severity: row.severity,
    evidence: row.evidence,
    basis: row.basis,
    signalIds: row.signal_ids ?? [],
    recommendation: row.recommendation,
    displayOrder: row.display_order ?? 0,
    workStatus: row.work_status ?? "open",
    resolvedAt: row.resolved_at ?? null,
    resolvedByUserId: row.resolved_by_user_id ?? null,
    createdAt: row.created_at,
  };
}

function mapRecommendationRow(row: any): RecommendationEntity {
  return {
    id: row.id,
    auditReportId: row.audit_report_id,
    auditRunId: row.audit_run_id,
    monitoredPageId: row.monitored_page_id,
    projectId: row.project_id,
    organizationId: row.organization_id,
    recommendationType: row.recommendation_type,
    category: row.category ?? null,
    title: row.title,
    detail: row.detail,
    displayOrder: row.display_order ?? 0,
    createdAt: row.created_at,
  };
}

export class SupabaseAuditPersistenceStore implements AuditPersistenceStore {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient, userJwt?: string) {
    if (client) {
      this.client = client;
    } else {
      const config = getServerAuthConfig();
      if (!config) {
        throw new Error("Supabase is not configured on server.");
      }
      const client = createServerSupabaseClient(config, userJwt);
      if (!client) {
        throw new Error("Failed to initialize Supabase client.");
      }
      this.client = client;
    }
  }

  async findRunByIdempotencyKey(
    orgId: string,
    pageId: string,
    key: string,
  ): Promise<AuditRun | null> {
    const { data, error } = await this.client
      .from("audit_runs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("monitored_page_id", pageId)
      .eq("idempotency_key", key)
      .maybeSingle();

    if (error || !data) return null;
    return mapAuditRunRow(data);
  }

  async createAuditRun(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    targetUrl: string,
    idempotencyKey?: string,
  ): Promise<{ run: AuditRun; isExisting: boolean }> {
    const now = new Date().toISOString();
    const modelVersion = process.env.GEMINI_MODEL || "gemini-3.6-flash";

    // 1. If idempotency key provided, check if run already exists
    if (idempotencyKey) {
      const existing = await this.findRunByIdempotencyKey(
        orgId,
        pageId,
        idempotencyKey,
      );
      if (existing) {
        return { run: existing, isExisting: true };
      }
    }

    // 2. Attempt INSERT
    const { data, error } = await this.client
      .from("audit_runs")
      .insert({
        monitored_page_id: pageId,
        project_id: projectId,
        organization_id: orgId,
        invocation_type: "manual",
        status: "running",
        target_url: targetUrl,
        triggered_by_user_id: userId,
        idempotency_key: idempotencyKey || null,
        started_at: now,
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

    if (error) {
      // Handle race condition: Postgres unique violation 23505 on (monitored_page_id, idempotency_key)
      if (error.code === "23505" && idempotencyKey) {
        const existing = await this.findRunByIdempotencyKey(
          orgId,
          pageId,
          idempotencyKey,
        );
        if (existing) {
          return { run: existing, isExisting: true };
        }
      }
      throw error;
    }

    // 3. Update monitored_pages latest_audit_run_id
    await this.client
      .from("monitored_pages")
      .update({
        latest_audit_run_id: data.id,
        updated_at: now,
      })
      .eq("id", pageId)
      .eq("organization_id", orgId);

    return { run: mapAuditRunRow(data), isExisting: false };
  }

  async recordRunFailure(
    orgId: string,
    _projectId: string,
    pageId: string,
    runId: string,
    error: { code: string; message: string; retryable: boolean },
  ): Promise<void> {
    const now = new Date().toISOString();

    // 1. Mark run failed with safe error metadata
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

    // 2. Update monitored_pages latest_audit_run_id ONLY
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

  async persistCompletedAudit(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
    finalUrl: string,
    report: Report,
  ): Promise<{ auditReportId: string }> {
    const modelVersion = process.env.GEMINI_MODEL || "gemini-3.6-flash";

    // Prepare JSON arrays for atomic batch inserts via database RPC
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

    // Execute atomic PostgreSQL RPC
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

  async listAuditHistory(
    orgId: string,
    _projectId: string,
    pageId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ audits: AuditHistoryItem[]; total: number }> {
    const { data: runs, error, count } = await this.client
      .from("audit_runs")
      .select(
        "*, audit_reports(id, overall_score, score_confidence, summary, report_payload)",
        {
          count: "exact",
        },
      )
      .eq("organization_id", orgId)
      .eq("monitored_page_id", pageId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !runs) {
      return { audits: [], total: 0 };
    }

    const items: AuditHistoryItem[] = runs.map((row: any) => {
      const report = Array.isArray(row.audit_reports)
        ? row.audit_reports[0]
        : row.audit_reports;

      let categoryScores: Record<string, number> | undefined;
      if (
        report?.report_payload?.categories &&
        Array.isArray(report.report_payload.categories)
      ) {
        categoryScores = {};
        for (const cat of report.report_payload.categories) {
          if (cat.category && typeof cat.score === "number") {
            categoryScores[cat.category] = cat.score;
          }
        }
      }

      return {
        id: row.id,
        monitoredPageId: row.monitored_page_id,
        projectId: row.project_id,
        organizationId: row.organization_id,
        invocationType: row.invocation_type,
        status: row.status,
        targetUrl: row.target_url,
        finalUrl: row.final_url ?? null,
        overallScore: report?.overall_score ?? null,
        scoreConfidence: report?.score_confidence ?? null,
        categoryScores: categoryScores as any,
        summary: report?.summary ?? null,
        auditReportId: report?.id ?? null,
        startedAt: row.started_at ?? null,
        completedAt: row.completed_at ?? null,
        failedAt: row.failed_at ?? null,
        errorCode: row.error_code ?? null,
        errorMessage: row.error_message ?? null,
        retryable: row.retryable ?? null,
        modelVersion: row.model_version,
        checkVersion: row.check_version,
        scoringVersion: row.scoring_version,
        createdAt: row.created_at,
      };
    });

    return { audits: items, total: count ?? items.length };
  }

  async getAuditReportByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    runId: string,
  ): Promise<PersistedAuditReport | null> {
    const { data: runData, error: runError } = await this.client
      .from("audit_runs")
      .select("*")
      .eq("id", runId)
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .eq("monitored_page_id", pageId)
      .maybeSingle();

    if (runError || !runData) return null;

    const { data: reportData, error: reportError } = await this.client
      .from("audit_reports")
      .select("*")
      .eq("audit_run_id", runId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (reportError || !reportData) return null;

    const { data: snapshots } = await this.client
      .from("score_snapshots")
      .select("*")
      .eq("audit_report_id", reportData.id)
      .eq("organization_id", orgId);

    const { data: findings } = await this.client
      .from("findings")
      .select("*")
      .eq("audit_report_id", reportData.id)
      .eq("organization_id", orgId)
      .order("display_order", { ascending: true });

    const { data: recommendations } = await this.client
      .from("recommendations")
      .select("*")
      .eq("audit_report_id", reportData.id)
      .eq("organization_id", orgId)
      .order("display_order", { ascending: true });

    return {
      auditRun: mapAuditRunRow(runData),
      report: mapAuditReportRow(reportData),
      scoreSnapshots: (snapshots || []).map(mapScoreSnapshotRow),
      findings: (findings || []).map(mapFindingRow),
      recommendations: (recommendations || []).map(mapRecommendationRow),
    };
  }

  async getLatestSuccessfulAudit(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<PersistedAuditReport | null> {
    // 1. Query monitored_pages to find latest_successful_audit_run_id
    const { data: pageData, error: pageError } = await this.client
      .from("monitored_pages")
      .select("latest_successful_audit_run_id")
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (
      pageError ||
      !pageData ||
      !pageData.latest_successful_audit_run_id
    ) {
      return null;
    }

    return this.getAuditReportByRunId(
      orgId,
      projectId,
      pageId,
      pageData.latest_successful_audit_run_id,
    );
  }
}
