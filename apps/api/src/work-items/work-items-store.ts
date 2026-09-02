import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuditCategory,
  CreateWorkItemInput,
  OrganizationMember,
  Role,
  Severity,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemActivity,
  WorkItemFilters,
  WorkItemSourceType,
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

export class InvalidAssigneeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAssigneeError";
  }
}

export interface ValidatedSourceEntity {
  monitoredPageId: string;
  auditRunId?: string | null;
  auditReportId?: string | null;
  title: string;
  description?: string | null;
  category?: AuditCategory | null;
  severity?: Severity | null;
}

export interface WorkItemsStore {
  createWorkItem(
    orgId: string,
    projectId: string,
    userId: string,
    input: CreateWorkItemInput,
    resolvedSource?: ValidatedSourceEntity,
  ): Promise<WorkItem>;

  listWorkItems(
    orgId: string,
    projectId: string,
    filters?: WorkItemFilters,
  ): Promise<{ workItems: WorkItem[]; total: number }>;

  getWorkItemById(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | null>;

  getWorkItemWithActivities(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<{ workItem: WorkItem; activities: WorkItemActivity[] } | null>;

  updateWorkItem(
    orgId: string,
    projectId: string,
    userId: string,
    workItemId: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem | null>;

  deleteWorkItem(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<boolean>;

  validateSourceEntity(
    orgId: string,
    projectId: string,
    sourceType: WorkItemSourceType,
    sourceId: string,
  ): Promise<ValidatedSourceEntity | null>;

  validateAssigneeMembership(
    orgId: string,
    assigneeId: string,
  ): Promise<boolean>;

  listOrganizationMembers(orgId: string): Promise<OrganizationMember[]>;
}

function toNormalizedIsoDate(val: any): string | null {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? String(val) : d.toISOString();
}

export function mapWorkItemRow(row: any): WorkItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    monitoredPageId: row.monitored_page_id ?? null,
    auditRunId: row.audit_run_id ?? null,
    auditReportId: row.audit_report_id ?? null,
    sourceType: row.source_type,
    findingId: row.finding_id ?? null,
    recommendationId: row.recommendation_id ?? null,
    title: row.title,
    description: row.description ?? null,
    category: row.category ?? null,
    severity: row.severity ?? null,
    status: row.status,
    assigneeId: row.assignee_id ?? null,
    notes: row.notes ?? null,
    tags: row.tags ?? [],
    resolutionRationale: row.resolution_rationale ?? null,
    resolvedAt: toNormalizedIsoDate(row.resolved_at),
    resolvedByUserId: row.resolved_by_user_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    lastModifiedByUserId: row.last_modified_by_user_id ?? null,
    createdAt: toNormalizedIsoDate(row.created_at)!,
    updatedAt: toNormalizedIsoDate(row.updated_at)!,
  };
}

export function mapWorkItemActivityRow(row: any): WorkItemActivity {
  return {
    id: row.id,
    workItemId: row.work_item_id,
    organizationId: row.organization_id,
    projectId: row.project_id,
    actorUserId: row.actor_user_id ?? null,
    action: row.action,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status ?? null,
    details: row.details ?? {},
    createdAt: toNormalizedIsoDate(row.created_at)!,
  };
}

export class SupabaseWorkItemsStore implements WorkItemsStore {
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

  async validateAssigneeMembership(
    orgId: string,
    assigneeId: string,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("memberships")
      .select("id")
      .eq("organization_id", orgId)
      .eq("user_id", assigneeId)
      .maybeSingle();

    if (error || !data) return false;
    return true;
  }

  async validateSourceEntity(
    orgId: string,
    projectId: string,
    sourceType: WorkItemSourceType,
    sourceId: string,
  ): Promise<ValidatedSourceEntity | null> {
    if (sourceType === "finding") {
      const { data, error } = await this.client
        .from("findings")
        .select("id, monitored_page_id, audit_run_id, audit_report_id, title, evidence, recommendation, category, severity")
        .eq("id", sourceId)
        .eq("organization_id", orgId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (error || !data) return null;

      return {
        monitoredPageId: data.monitored_page_id,
        auditRunId: data.audit_run_id,
        auditReportId: data.audit_report_id,
        title: data.title,
        description: data.evidence ? `${data.evidence}\n\nRecommendation: ${data.recommendation}` : data.recommendation,
        category: data.category as AuditCategory,
        severity: data.severity as Severity,
      };
    }

    if (sourceType === "recommendation") {
      const { data, error } = await this.client
        .from("recommendations")
        .select("id, monitored_page_id, audit_run_id, audit_report_id, title, detail, category")
        .eq("id", sourceId)
        .eq("organization_id", orgId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (error || !data) return null;

      return {
        monitoredPageId: data.monitored_page_id,
        auditRunId: data.audit_run_id,
        auditReportId: data.audit_report_id,
        title: data.title,
        description: data.detail,
        category: data.category as AuditCategory,
        severity: null,
      };
    }

    return null;
  }

  async createWorkItem(
    orgId: string,
    projectId: string,
    userId: string,
    input: CreateWorkItemInput,
    resolvedSource?: ValidatedSourceEntity,
  ): Promise<WorkItem> {
    // 1. Assignee validation
    if (input.assigneeId) {
      const isMember = await this.validateAssigneeMembership(orgId, input.assigneeId);
      if (!isMember) {
        throw new InvalidAssigneeError("Assignee must be a member of the organization.");
      }
    }

    // 2. Resolve source entity if not passed
    let source = resolvedSource;
    if (!source) {
      const sourceId = input.sourceType === "finding" ? input.findingId! : input.recommendationId!;
      source = (await this.validateSourceEntity(orgId, projectId, input.sourceType, sourceId)) ?? undefined;
      if (!source) {
        throw new Error("Source entity not found in this project.");
      }
    }

    const title = input.title || source.title;
    const description = input.description !== undefined ? input.description : source.description;
    const category = input.category !== undefined ? input.category : source.category;
    const severity = input.severity !== undefined ? input.severity : source.severity;
    const pageId = input.monitoredPageId || source.monitoredPageId;

    // 3. Execute atomic PostgreSQL RPC
    const { data, error } = await this.client.rpc("create_work_item_atomic", {
      p_org_id: orgId,
      p_project_id: projectId,
      p_page_id: pageId,
      p_user_id: userId,
      p_source_type: input.sourceType,
      p_finding_id: input.sourceType === "finding" ? input.findingId! : null,
      p_recommendation_id: input.sourceType === "recommendation" ? input.recommendationId! : null,
      p_title: title,
      p_description: description,
      p_category: category,
      p_severity: severity,
      p_status: input.status || "open",
      p_assignee_id: input.assigneeId || null,
      p_notes: input.notes || null,
      p_tags: input.tags || [],
      p_audit_run_id: source.auditRunId || null,
      p_audit_report_id: source.auditReportId || null,
    });

    if (error) {
      if (
        error.code === "23505" ||
        error.message?.includes("uq_work_items_page_finding") ||
        error.message?.includes("uq_work_items_page_recommendation") ||
        error.message?.includes("duplicate key")
      ) {
        throw new DuplicateResourceError("A work item already exists for this finding or recommendation.");
      }
      if (error.message?.includes("Assignee must be a member")) {
        throw new InvalidAssigneeError("Assignee must be a member of the organization.");
      }
      throw error;
    }

    return mapWorkItemRow(data);
  }

  async listWorkItems(
    orgId: string,
    projectId: string,
    filters: WorkItemFilters = {},
  ): Promise<{ workItems: WorkItem[]; total: number }> {
    let query = this.client
      .from("work_items")
      .select("*", { count: "exact" })
      .eq("organization_id", orgId)
      .eq("project_id", projectId);

    if (filters.pageId) {
      query = query.eq("monitored_page_id", filters.pageId);
    }
    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.assigneeId) {
      query = query.eq("assignee_id", filters.assigneeId);
    }
    if (filters.sourceType) {
      query = query.eq("source_type", filters.sourceType);
    }
    if (filters.category) {
      query = query.eq("category", filters.category);
    }
    if (filters.severity) {
      query = query.eq("severity", filters.severity);
    }

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error || !data) {
      return { workItems: [], total: 0 };
    }

    return {
      workItems: data.map(mapWorkItemRow),
      total: count ?? data.length,
    };
  }

  async getWorkItemById(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | null> {
    const { data, error } = await this.client
      .from("work_items")
      .select("*")
      .eq("id", workItemId)
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (error || !data) return null;
    return mapWorkItemRow(data);
  }

  async getWorkItemWithActivities(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<{ workItem: WorkItem; activities: WorkItemActivity[] } | null> {
    const workItem = await this.getWorkItemById(orgId, projectId, workItemId);
    if (!workItem) return null;

    const { data: activities, error } = await this.client
      .from("work_item_activities")
      .select("*")
      .eq("work_item_id", workItemId)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    return {
      workItem,
      activities: error || !activities ? [] : activities.map(mapWorkItemActivityRow),
    };
  }

  async updateWorkItem(
    orgId: string,
    projectId: string,
    userId: string,
    workItemId: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem | null> {
    if (input.assigneeId) {
      const isMember = await this.validateAssigneeMembership(orgId, input.assigneeId);
      if (!isMember) {
        throw new InvalidAssigneeError("Assignee must be a member of the organization.");
      }
    }

    const hasStatus = input.status !== undefined;
    const hasAssignee = input.assigneeId !== undefined;
    const hasNotes = input.notes !== undefined;
    const hasTags = input.tags !== undefined;
    const hasRationale = input.resolutionRationale !== undefined;

    const { data, error } = await this.client.rpc("update_work_item_atomic", {
      p_org_id: orgId,
      p_project_id: projectId,
      p_work_item_id: workItemId,
      p_user_id: userId,
      p_status: input.status || null,
      p_has_status_update: hasStatus,
      p_assignee_id: input.assigneeId || null,
      p_has_assignee_update: hasAssignee,
      p_notes: input.notes !== undefined ? input.notes : null,
      p_has_notes_update: hasNotes,
      p_tags: input.tags || null,
      p_has_tags_update: hasTags,
      p_resolution_rationale: input.resolutionRationale !== undefined ? input.resolutionRationale : null,
      p_has_rationale_update: hasRationale,
    });

    if (error) {
      if (error.message?.includes("Assignee must be a member")) {
        throw new InvalidAssigneeError("Assignee must be a member of the organization.");
      }
      throw error;
    }

    if (!data) return null;
    return mapWorkItemRow(data);
  }

  async deleteWorkItem(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("work_items")
      .delete()
      .eq("id", workItemId)
      .eq("organization_id", orgId)
      .eq("project_id", projectId)
      .select("id");

    if (error || !data || data.length === 0) return false;
    return true;
  }

  async listOrganizationMembers(orgId: string): Promise<OrganizationMember[]> {
    const { data, error } = await this.client
      .from("memberships")
      .select(
        `
        id,
        organization_id,
        user_id,
        role,
        created_at,
        updated_at,
        profile:profiles (
          id,
          email,
          full_name,
          avatar_url
        )
      `
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map((row: any) => {
      const p = Array.isArray(row.profile) ? row.profile[0] : row.profile;
      return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        role: row.role as Role,
        email: p?.email || "unknown@user.com",
        fullName: p?.full_name || null,
        avatarUrl: p?.avatar_url || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }
}
