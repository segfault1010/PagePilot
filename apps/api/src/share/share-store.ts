import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reportShareLinkSchema,
  sharedAuditReportResponseSchema,
} from "@pagepilot/contracts";
import type {
  ReportShareLink,
  SharedAuditReportResponse,
} from "@pagepilot/contracts";
import {
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

/**
 * Interface defining operations on report share links.
 */
export interface SharePersistenceStore {
  createShareLink(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
    auditReportId: string,
    userId: string,
    data: {
      tokenHash: string;
      expiresAt?: string | null;
    },
  ): Promise<ReportShareLink>;

  getActiveShareLinkByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
  ): Promise<ReportShareLink | null>;

  getShareLinkById(
    orgId: string,
    projectId: string,
    shareId: string,
  ): Promise<ReportShareLink | null>;

  revokeShareLink(
    orgId: string,
    projectId: string,
    shareId: string,
  ): Promise<boolean>;

  resolvePublicSharedReport(
    tokenHash: string,
  ): Promise<SharedAuditReportResponse | null>;
}

/**
 * Supabase implementation of SharePersistenceStore.
 */
export class SupabaseSharePersistenceStore implements SharePersistenceStore {
  private db: SupabaseClient;

  constructor(client?: SupabaseClient, authToken?: string) {
    if (client) {
      this.db = client;
    } else {
      const config = getServerAuthConfig();
      if (!config) {
        throw new Error("Supabase is not configured on server.");
      }
      const client = createServerSupabaseClient(config, authToken);
      if (!client) {
        throw new Error("Failed to initialize Supabase client.");
      }
      this.db = client;
    }
  }

  async createShareLink(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
    auditReportId: string,
    userId: string,
    data: {
      tokenHash: string;
      expiresAt?: string | null;
    },
  ): Promise<ReportShareLink> {
    const { data: row, error } = await this.db
      .from("report_share_links")
      .insert({
        organization_id: orgId,
        project_id: projectId,
        monitored_page_id: pageId,
        audit_run_id: auditRunId,
        audit_report_id: auditReportId,
        token_hash: data.tokenHash,
        created_by_user_id: userId,
        expires_at: data.expiresAt ?? null,
      })
      .select()
      .single();

    if (error || !row) {
      throw new Error(`Failed to create report share link: ${error?.message || "Unknown error"}`);
    }

    return this.mapShareLinkRow(row);
  }

  async getActiveShareLinkByRunId(
    orgId: string,
    projectId: string,
    pageId: string,
    auditRunId: string,
  ): Promise<ReportShareLink | null> {
    const { data: rows, error } = await this.db
      .from("report_share_links")
      .select()
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .eq("monitored_page_id", pageId)
      .eq("audit_run_id", auditRunId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });

    if (error || !rows || rows.length === 0) {
      return null;
    }

    const now = new Date();
    // Find first non-expired active share
    const active = rows.find((r) => !r.expires_at || new Date(r.expires_at) > now);
    return active ? this.mapShareLinkRow(active) : null;
  }

  async getShareLinkById(
    orgId: string,
    projectId: string,
    shareId: string,
  ): Promise<ReportShareLink | null> {
    const { data: row, error } = await this.db
      .from("report_share_links")
      .select()
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .eq("id", shareId)
      .single();

    if (error || !row) {
      return null;
    }

    return this.mapShareLinkRow(row);
  }

  async revokeShareLink(
    orgId: string,
    projectId: string,
    shareId: string,
  ): Promise<boolean> {
    const { data: row, error } = await this.db
      .from("report_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .eq("id", shareId)
      .select()
      .single();

    if (error || !row) {
      return false;
    }

    return true;
  }

  async resolvePublicSharedReport(
    tokenHash: string,
  ): Promise<SharedAuditReportResponse | null> {
    const { data, error } = await this.db.rpc("get_shared_audit_report", {
      p_token_hash: tokenHash,
    });

    if (error || !data) {
      return null;
    }

    const parsed = sharedAuditReportResponseSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[share-store] RPC payload validation failed:", parsed.error);
      return null;
    }

    return parsed.data;
  }

  private mapShareLinkRow(row: any): ReportShareLink {
    return reportShareLinkSchema.parse({
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      monitoredPageId: row.monitored_page_id,
      auditRunId: row.audit_run_id,
      auditReportId: row.audit_report_id,
      tokenHash: row.token_hash,
      createdByUserId: row.created_by_user_id,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    });
  }
}
