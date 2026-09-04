import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreatePageAnalyticsInput,
  PageAnalyticsSnapshot,
} from "@pagepilot/contracts";
import {
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

function toNormalizedIsoDate(val: any): string {
  if (!val) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toISOString();
}

export function rowToPageAnalyticsSnapshot(row: any): PageAnalyticsSnapshot {
  const prov = row.provenance ?? {};
  return {
    id: row.id,
    organizationId: row.organization_id ?? row.organizationId,
    projectId: row.project_id ?? row.projectId,
    monitoredPageId: row.monitored_page_id ?? row.monitoredPageId,
    sourceType: row.source_type ?? row.sourceType ?? "manual",
    sourceProviderName:
      row.source_provider_name ?? row.sourceProviderName ?? "Manual Entry",
    schemaVersion: row.schema_version ?? row.schemaVersion ?? "1.0.0",
    periodStart: toNormalizedIsoDate(row.period_start ?? row.periodStart),
    periodEnd: toNormalizedIsoDate(row.period_end ?? row.periodEnd),
    sessions: row.sessions != null ? Number(row.sessions) : null,
    uniqueVisitors:
      row.unique_visitors != null ? Number(row.unique_visitors) : null,
    conversions: row.conversions != null ? Number(row.conversions) : null,
    conversionRate:
      row.conversion_rate != null ? Number(row.conversion_rate) : null,
    bounceRate: row.bounce_rate != null ? Number(row.bounce_rate) : null,
    avgDurationSeconds:
      row.avg_duration_seconds != null ? Number(row.avg_duration_seconds) : null,
    currency: row.currency ?? "USD",
    customMetrics: row.custom_metrics ?? {},
    provenance: {
      label: "IMPORTED DATA",
      importedByUserId:
        prov.importedByUserId ?? prov.imported_by_user_id ?? null,
      importedByUserName:
        prov.importedByUserName ?? prov.imported_by_user_name ?? null,
      importedAt: toNormalizedIsoDate(
        prov.importedAt ?? prov.imported_at ?? row.created_at,
      ),
      integrationConnectionId:
        prov.integrationConnectionId ?? prov.integration_connection_id ?? null,
      externalPropertyId:
        prov.externalPropertyId ?? prov.external_property_id ?? null,
      notes: prov.notes ?? null,
    },
    isActive: row.is_active ?? true,
    createdByUserId:
      row.created_by_user_id ?? row.createdByUserId ?? null,
    createdAt: toNormalizedIsoDate(row.created_at ?? row.createdAt),
    updatedAt: toNormalizedIsoDate(row.updated_at ?? row.updatedAt),
  };
}

export interface AnalyticsStore {
  getActiveSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<PageAnalyticsSnapshot | null>;

  listSnapshots(
    orgId: string,
    projectId: string,
    pageId: string,
    limit?: number,
  ): Promise<PageAnalyticsSnapshot[]>;

  createSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    input: CreatePageAnalyticsInput,
    userName?: string,
  ): Promise<PageAnalyticsSnapshot>;

  deleteSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
    snapshotId: string,
  ): Promise<boolean>;
}

export class SupabaseAnalyticsStore implements AnalyticsStore {
  private client: SupabaseClient | null;
  private authToken?: string;

  constructor(client?: SupabaseClient | null, authToken?: string) {
    this.client = client ?? null;
    this.authToken = authToken;
  }

  private getClient(): SupabaseClient {
    const db =
      this.client ??
      createServerSupabaseClient(getServerAuthConfig(), this.authToken);
    if (!db) {
      throw new Error("Supabase client is not configured for analytics store.");
    }
    return db;
  }

  async getActiveSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<PageAnalyticsSnapshot | null> {
    const db = this.getClient();

    // Check page pointer first
    const { data: pageRow, error: pageErr } = await db
      .from("monitored_pages")
      .select("id, latest_analytics_snapshot_id")
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (pageErr) {
      throw new Error(`Failed to query monitored page: ${pageErr.message}`);
    }
    if (!pageRow) return null;

    if (pageRow.latest_analytics_snapshot_id) {
      const { data: snapRow, error: snapErr } = await db
        .from("page_analytics_snapshots")
        .select()
        .eq("id", pageRow.latest_analytics_snapshot_id)
        .eq("monitored_page_id", pageId)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (snapErr) {
        throw new Error(`Failed to query analytics snapshot: ${snapErr.message}`);
      }
      if (snapRow) return rowToPageAnalyticsSnapshot(snapRow);
    }

    // Fallback to most recent active snapshot if pointer was unset
    const { data: latestRow, error: latestErr } = await db
      .from("page_analytics_snapshots")
      .select()
      .eq("monitored_page_id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("period_end", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestErr) {
      throw new Error(`Failed to query latest analytics snapshot: ${latestErr.message}`);
    }

    return latestRow ? rowToPageAnalyticsSnapshot(latestRow) : null;
  }

  async listSnapshots(
    orgId: string,
    projectId: string,
    pageId: string,
    limit = 20,
  ): Promise<PageAnalyticsSnapshot[]> {
    const db = this.getClient();

    const { data: rows, error } = await db
      .from("page_analytics_snapshots")
      .select()
      .eq("monitored_page_id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .order("period_end", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to list analytics snapshots: ${error.message}`);
    }

    return (rows || []).map(rowToPageAnalyticsSnapshot);
  }

  async createSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
    userId: string,
    input: CreatePageAnalyticsInput,
    userName?: string,
  ): Promise<PageAnalyticsSnapshot> {
    const db = this.getClient();

    // 1. Verify monitored page exists and belongs to this project & org
    const { data: pageRow, error: pageErr } = await db
      .from("monitored_pages")
      .select("id")
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (pageErr) {
      throw new Error(`Failed to verify monitored page: ${pageErr.message}`);
    }
    if (!pageRow) {
      throw new Error("Monitored page not found.");
    }

    // 2. Prepare record
    const provenance = {
      label: "IMPORTED DATA",
      importedByUserId: userId,
      importedByUserName: userName ?? null,
      importedAt: new Date().toISOString(),
      notes: input.notes ?? null,
    };

    const insertPayload = {
      organization_id: orgId,
      project_id: projectId,
      monitored_page_id: pageId,
      source_type: input.sourceType ?? "manual",
      source_provider_name: input.sourceProviderName ?? "Manual Entry",
      schema_version: "1.0.0",
      period_start: input.periodStart,
      period_end: input.periodEnd,
      sessions: input.sessions ?? null,
      unique_visitors: input.uniqueVisitors ?? null,
      conversions: input.conversions ?? null,
      conversion_rate: input.conversionRate ?? null,
      bounce_rate: input.bounceRate ?? null,
      avg_duration_seconds: input.avgDurationSeconds ?? null,
      currency: input.currency ?? "USD",
      custom_metrics: input.customMetrics ?? {},
      provenance,
      is_active: true,
      created_by_user_id: userId,
    };

    const { data: newRow, error: insertErr } = await db
      .from("page_analytics_snapshots")
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr || !newRow) {
      throw new Error(
        `Failed to create analytics snapshot: ${insertErr?.message || "Unknown error"}`,
      );
    }

    // 3. Atomically update monitored page latest pointer
    const { error: updatePageErr } = await db
      .from("monitored_pages")
      .update({
        latest_analytics_snapshot_id: newRow.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId);

    if (updatePageErr) {
      console.error(
        `[analytics] Warning: failed to update latest_analytics_snapshot_id on monitored_pages: ${updatePageErr.message}`,
      );
    }

    return rowToPageAnalyticsSnapshot(newRow);
  }

  async deleteSnapshot(
    orgId: string,
    projectId: string,
    pageId: string,
    snapshotId: string,
  ): Promise<boolean> {
    const db = this.getClient();

    // Verify snapshot exists and belongs to page/project/org
    const { data: snapRow, error: snapErr } = await db
      .from("page_analytics_snapshots")
      .select("id")
      .eq("id", snapshotId)
      .eq("monitored_page_id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (snapErr || !snapRow) {
      return false;
    }

    // Check if it is the latest snapshot pointer
    const { data: pageRow } = await db
      .from("monitored_pages")
      .select("latest_analytics_snapshot_id")
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (pageRow?.latest_analytics_snapshot_id === snapshotId) {
      // Find the next most recent active snapshot
      const { data: nextRow } = await db
        .from("page_analytics_snapshots")
        .select("id")
        .eq("monitored_page_id", pageId)
        .eq("project_id", projectId)
        .eq("organization_id", orgId)
        .neq("id", snapshotId)
        .order("period_end", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      await db
        .from("monitored_pages")
        .update({
          latest_analytics_snapshot_id: nextRow ? nextRow.id : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pageId)
        .eq("project_id", projectId)
        .eq("organization_id", orgId);
    }

    // Delete the snapshot
    const { error: delErr } = await db
      .from("page_analytics_snapshots")
      .delete()
      .eq("id", snapshotId)
      .eq("monitored_page_id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId);

    if (delErr) {
      throw new Error(`Failed to delete analytics snapshot: ${delErr.message}`);
    }

    return true;
  }
}
