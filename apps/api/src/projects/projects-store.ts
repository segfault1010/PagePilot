import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateMonitoredPageInput,
  CreateProjectInput,
  MonitoredPage,
  Project,
  UpdateMonitoredPageInput,
  UpdateProjectInput,
} from "@pagepilot/contracts";
import {
  createServerSupabaseClient,
  getServerAuthConfig,
} from "../auth/supabase-server.js";

export class DuplicateResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateResourceError";
  }
}

export interface ProjectsStore {
  createProject(
    orgId: string,
    userId: string,
    data: CreateProjectInput,
  ): Promise<Project>;

  listProjects(orgId: string): Promise<Project[]>;

  getProjectById(orgId: string, projectId: string): Promise<Project | null>;

  updateProject(
    orgId: string,
    projectId: string,
    data: UpdateProjectInput,
  ): Promise<Project | null>;

  deleteProject(orgId: string, projectId: string): Promise<boolean>;

  createMonitoredPage(
    orgId: string,
    projectId: string,
    userId: string,
    data: CreateMonitoredPageInput,
  ): Promise<MonitoredPage>;

  listMonitoredPages(orgId: string, projectId: string): Promise<MonitoredPage[]>;

  getMonitoredPageById(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<MonitoredPage | null>;

  updateMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
    data: UpdateMonitoredPageInput,
  ): Promise<MonitoredPage | null>;

  deleteMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<boolean>;

  checkMonitoredPageDuplicate(
    projectId: string,
    canonicalUrl: string,
    excludePageId?: string,
  ): Promise<boolean>;
}

function toNormalizedIsoDate(val: any): string {
  if (!val) return val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toISOString();
}

export function rowToProject(row: any): Project {
  return {
    id: row.id,
    organizationId: row.organization_id ?? row.organizationId,
    name: row.name,
    domain: row.domain ?? null,
    timezone: row.timezone ?? "UTC",
    goals: row.goals ?? null,
    createdBy: row.created_by ?? row.createdBy ?? null,
    createdAt: toNormalizedIsoDate(row.created_at ?? row.createdAt),
    updatedAt: toNormalizedIsoDate(row.updated_at ?? row.updatedAt),
  };
}

export function rowToMonitoredPage(row: any): MonitoredPage {
  return {
    id: row.id,
    projectId: row.project_id ?? row.projectId,
    organizationId: row.organization_id ?? row.organizationId,
    canonicalUrl: row.canonical_url ?? row.canonicalUrl,
    cadence: row.cadence ?? "weekly",
    status: row.status ?? "active",
    ownerId: row.owner_id ?? row.ownerId ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    latestAuditRunId: row.latest_audit_run_id ?? row.latestAuditRunId ?? null,
    latestSuccessfulAuditRunId: row.latest_successful_audit_run_id ?? row.latestSuccessfulAuditRunId ?? null,
    latestAnalyticsSnapshotId: row.latest_analytics_snapshot_id ?? row.latestAnalyticsSnapshotId ?? null,
    createdAt: toNormalizedIsoDate(row.created_at ?? row.createdAt),
    updatedAt: toNormalizedIsoDate(row.updated_at ?? row.updatedAt),
  };
}

export class SupabaseProjectsStore implements ProjectsStore {
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
      throw new Error("Supabase client is not configured for projects store.");
    }
    return db;
  }

  async createProject(
    orgId: string,
    userId: string,
    data: CreateProjectInput,
  ): Promise<Project> {
    const db = this.getClient();
    const { data: row, error } = await db
      .from("projects")
      .insert({
        organization_id: orgId,
        name: data.name,
        domain: data.domain ?? null,
        timezone: data.timezone ?? "UTC",
        goals: data.goals ?? null,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !row) {
      throw new Error(`Failed to create project: ${error?.message || "Unknown error"}`);
    }
    return rowToProject(row);
  }

  async listProjects(orgId: string): Promise<Project[]> {
    const db = this.getClient();
    const { data: rows, error } = await db
      .from("projects")
      .select()
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error || !rows) {
      throw new Error(`Failed to list projects: ${error?.message || "Unknown error"}`);
    }
    return rows.map(rowToProject);
  }

  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const db = this.getClient();
    const { data: row, error } = await db
      .from("projects")
      .select()
      .eq("id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get project: ${error.message}`);
    }
    return row ? rowToProject(row) : null;
  }

  async updateProject(
    orgId: string,
    projectId: string,
    data: UpdateProjectInput,
  ): Promise<Project | null> {
    const db = this.getClient();

    // First ensure project belongs to org
    const existing = await this.getProjectById(orgId, projectId);
    if (!existing) return null;

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (data.name !== undefined) updates.name = data.name;
    if (data.domain !== undefined) updates.domain = data.domain;
    if (data.timezone !== undefined) updates.timezone = data.timezone;
    if (data.goals !== undefined) updates.goals = data.goals;

    const { data: row, error } = await db
      .from("projects")
      .update(updates)
      .eq("id", projectId)
      .eq("organization_id", orgId)
      .select()
      .single();

    if (error || !row) {
      throw new Error(`Failed to update project: ${error?.message || "Unknown error"}`);
    }
    return rowToProject(row);
  }

  async deleteProject(orgId: string, projectId: string): Promise<boolean> {
    const db = this.getClient();

    // Verify existence in org first
    const existing = await this.getProjectById(orgId, projectId);
    if (!existing) return false;

    const { error } = await db
      .from("projects")
      .delete()
      .eq("id", projectId)
      .eq("organization_id", orgId);

    if (error) {
      throw new Error(`Failed to delete project: ${error.message}`);
    }
    return true;
  }

  async checkMonitoredPageDuplicate(
    projectId: string,
    canonicalUrl: string,
    excludePageId?: string,
  ): Promise<boolean> {
    const db = this.getClient();
    let query = db
      .from("monitored_pages")
      .select("id")
      .eq("project_id", projectId)
      .eq("canonical_url", canonicalUrl);

    if (excludePageId) {
      query = query.neq("id", excludePageId);
    }

    const { data, error } = await query.limit(1);
    if (error) {
      throw new Error(`Failed to check duplicate page: ${error.message}`);
    }
    return !!(data && data.length > 0);
  }

  async createMonitoredPage(
    orgId: string,
    projectId: string,
    userId: string,
    data: CreateMonitoredPageInput,
  ): Promise<MonitoredPage> {
    const db = this.getClient();

    // Verify project belongs to organization
    const project = await this.getProjectById(orgId, projectId);
    if (!project) {
      throw new Error("Target project not found in organization.");
    }

    const isDuplicate = await this.checkMonitoredPageDuplicate(
      projectId,
      data.canonicalUrl,
    );
    if (isDuplicate) {
      throw new DuplicateResourceError(
        "This URL is already monitored in this project.",
      );
    }

    const { data: row, error } = await db
      .from("monitored_pages")
      .insert({
        project_id: projectId,
        organization_id: orgId,
        canonical_url: data.canonicalUrl,
        cadence: data.cadence ?? "weekly",
        status: data.status ?? "active",
        owner_id: userId,
        tags: data.tags ?? [],
      })
      .select()
      .single();

    if (error) {
      if (
        error.code === "23505" ||
        error.message?.includes("uq_monitored_pages_project_url") ||
        error.message?.includes("duplicate key")
      ) {
        throw new DuplicateResourceError(
          "This URL is already monitored in this project.",
        );
      }
      throw new Error(`Failed to create monitored page: ${error.message}`);
    }

    return rowToMonitoredPage(row);
  }

  async listMonitoredPages(
    orgId: string,
    projectId: string,
  ): Promise<MonitoredPage[]> {
    const db = this.getClient();

    // Verify project belongs to organization
    const project = await this.getProjectById(orgId, projectId);
    if (!project) return [];

    const { data: rows, error } = await db
      .from("monitored_pages")
      .select()
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error || !rows) {
      throw new Error(`Failed to list monitored pages: ${error?.message || "Unknown error"}`);
    }
    return rows.map(rowToMonitoredPage);
  }

  async getMonitoredPageById(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<MonitoredPage | null> {
    const db = this.getClient();
    const { data: row, error } = await db
      .from("monitored_pages")
      .select()
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get monitored page: ${error.message}`);
    }
    return row ? rowToMonitoredPage(row) : null;
  }

  async updateMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
    data: UpdateMonitoredPageInput,
  ): Promise<MonitoredPage | null> {
    const db = this.getClient();

    // Verify page belongs to project and org
    const existing = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!existing) return null;

    if (data.canonicalUrl && data.canonicalUrl !== existing.canonicalUrl) {
      const isDuplicate = await this.checkMonitoredPageDuplicate(
        projectId,
        data.canonicalUrl,
        pageId,
      );
      if (isDuplicate) {
        throw new DuplicateResourceError(
          "This URL is already monitored in this project.",
        );
      }
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (data.canonicalUrl !== undefined) updates.canonical_url = data.canonicalUrl;
    if (data.cadence !== undefined) updates.cadence = data.cadence;
    if (data.status !== undefined) updates.status = data.status;
    if (data.tags !== undefined) updates.tags = data.tags;
    if (data.ownerId !== undefined) updates.owner_id = data.ownerId;

    const { data: row, error } = await db
      .from("monitored_pages")
      .update(updates)
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId)
      .select()
      .single();

    if (error) {
      if (
        error.code === "23505" ||
        error.message?.includes("uq_monitored_pages_project_url") ||
        error.message?.includes("duplicate key")
      ) {
        throw new DuplicateResourceError(
          "This URL is already monitored in this project.",
        );
      }
      throw new Error(`Failed to update monitored page: ${error.message}`);
    }

    return row ? rowToMonitoredPage(row) : null;
  }

  async deleteMonitoredPage(
    orgId: string,
    projectId: string,
    pageId: string,
  ): Promise<boolean> {
    const db = this.getClient();

    // Verify page belongs to project and org
    const existing = await this.getMonitoredPageById(orgId, projectId, pageId);
    if (!existing) return false;

    const { error } = await db
      .from("monitored_pages")
      .delete()
      .eq("id", pageId)
      .eq("project_id", projectId)
      .eq("organization_id", orgId);

    if (error) {
      throw new Error(`Failed to delete monitored page: ${error.message}`);
    }
    return true;
  }
}
