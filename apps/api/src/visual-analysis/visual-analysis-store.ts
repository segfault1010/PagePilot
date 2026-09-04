import type { SupabaseClient } from "@supabase/supabase-js";
import {
  VISUAL_PROVENANCE_LABEL,
  type VisualAnalysisReview,
} from "@pagepilot/contracts";
import type { WorkflowVisualAnalysisStore } from "@pagepilot/workflows";
import {
  createPrivilegedSupabaseClient,
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

function mapVisualReviewRow(row: any): VisualAnalysisReview {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    monitoredPageId: row.monitored_page_id,
    auditRunId: row.audit_run_id,
    auditReportId: row.audit_report_id ?? null,
    provenance: row.provenance ?? VISUAL_PROVENANCE_LABEL,
    schemaVersion: row.schema_version ?? "1.0.0",
    promptVersion: row.prompt_version ?? "1.0.0",
    modelIdentifier: row.model_identifier,
    status: row.status,
    executiveSummary: row.executive_summary ?? null,
    viewportsAnalyzed: row.viewports_analyzed ?? [],
    dimensions: row.dimensions ?? {},
    findings: row.findings ?? [],
    screenshotIds: row.screenshot_ids ?? [],
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface VisualAnalysisStore extends WorkflowVisualAnalysisStore {
  getVisualReviewForAuditRun(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
  }): Promise<VisualAnalysisReview | null>;
}

export class SupabaseVisualAnalysisStore implements VisualAnalysisStore {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient, authToken?: string) {
    if (client) {
      this.client = client;
    } else {
      const created = authToken
        ? createServerSupabaseClient(getServerAuthConfig(), authToken)
        : createPrivilegedSupabaseClient(getServerAuthConfig());

      if (!created) {
        throw new Error(
          "Failed to initialize Supabase client for visual analysis store: missing environment credentials."
        );
      }
      this.client = created;
    }
  }

  async getVisualReview(auditRunId: string): Promise<VisualAnalysisReview | null> {
    const { data, error } = await this.client
      .from("visual_analysis_reviews")
      .select("*")
      .eq("audit_run_id", auditRunId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to query visual analysis review: ${error.message}`);
    }

    return data ? mapVisualReviewRow(data) : null;
  }

  async getVisualReviewForAuditRun(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
  }): Promise<VisualAnalysisReview | null> {
    const { data, error } = await this.client
      .from("visual_analysis_reviews")
      .select("*")
      .eq("audit_run_id", params.auditRunId)
      .eq("organization_id", params.organizationId)
      .eq("project_id", params.projectId)
      .eq("monitored_page_id", params.pageId)
      .maybeSingle();

    if (error) {
      throw new Error(
        `Failed to query visual analysis review for page: ${error.message}`
      );
    }

    return data ? mapVisualReviewRow(data) : null;
  }

  async persistVisualReview(
    review: VisualAnalysisReview
  ): Promise<VisualAnalysisReview> {
    const { data, error } = await this.client
      .from("visual_analysis_reviews")
      .upsert(
        {
          organization_id: review.organizationId,
          project_id: review.projectId,
          monitored_page_id: review.monitoredPageId,
          audit_run_id: review.auditRunId,
          audit_report_id: review.auditReportId ?? null,
          provenance: review.provenance ?? VISUAL_PROVENANCE_LABEL,
          schema_version: review.schemaVersion,
          prompt_version: review.promptVersion,
          model_identifier: review.modelIdentifier,
          status: review.status,
          executive_summary: review.executiveSummary ?? null,
          viewports_analyzed: review.viewportsAnalyzed,
          dimensions: review.dimensions,
          findings: review.findings,
          screenshot_ids: review.screenshotIds,
          error_message: review.errorMessage ?? null,
        },
        { onConflict: "audit_run_id" }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(
        `Failed to persist visual analysis review: ${error?.message || "No data returned"}`
      );
    }

    return mapVisualReviewRow(data);
  }

  async recordVisualReviewFailure(params: {
    auditRunId: string;
    organizationId?: string;
    projectId?: string;
    monitoredPageId?: string;
    errorMessage: string;
  }): Promise<void> {
    const { error } = await this.client
      .from("visual_analysis_reviews")
      .upsert(
        {
          organization_id: params.organizationId,
          project_id: params.projectId,
          monitored_page_id: params.monitoredPageId,
          audit_run_id: params.auditRunId,
          schema_version: "1.0.0",
          prompt_version: "1.0.0",
          model_identifier: "failed",
          status: "failed",
          error_message: params.errorMessage,
        },
        { onConflict: "audit_run_id" }
      );

    if (error) {
      console.warn(
        `[visual-analysis-store] failed to record visual review failure: ${error.message}`
      );
    }
  }
}
