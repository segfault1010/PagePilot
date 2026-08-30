import request from "supertest";
import { describe, expect, it } from "vitest";
import type {
  CreateWorkItemInput,
  FindingEntity,
  MonitoredPage,
  Project,
  RecommendationEntity,
  Role,
  UpdateWorkItemInput,
  WorkItem,
  WorkItemActivity,
  WorkItemFilters,
  WorkItemSourceType,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import {
  DuplicateResourceError,
  InvalidAssigneeError,
} from "../src/work-items/work-items-store.js";
import type {
  ValidatedSourceEntity,
  WorkItemsStore,
} from "../src/work-items/work-items-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";

/**
 * In-memory test store implementing ProjectsStore.
 */
class InMemoryProjectsStore implements ProjectsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();

  async createProject(orgId: string, userId: string, data: any): Promise<Project> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const project: Project = {
      id,
      organizationId: orgId,
      name: data.name,
      domain: data.domain ?? null,
      timezone: data.timezone ?? "UTC",
      goals: data.goals ?? null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(id, project);
    return project;
  }

  async listProjects(orgId: string): Promise<Project[]> {
    return Array.from(this.projects.values()).filter((p) => p.organizationId === orgId);
  }

  async getProjectById(orgId: string, projectId: string): Promise<Project | null> {
    const project = this.projects.get(projectId);
    if (!project || project.organizationId !== orgId) return null;
    return project;
  }

  async updateProject(): Promise<any> {
    return null;
  }
  async deleteProject(): Promise<any> {
    return true;
  }
  async checkMonitoredPageDuplicate(): Promise<any> {
    return false;
  }
  async createMonitoredPage(): Promise<any> {
    return {} as any;
  }
  async listMonitoredPages(): Promise<any> {
    return [];
  }
  async getMonitoredPageById(): Promise<any> {
    return null;
  }
  async updateMonitoredPage(): Promise<any> {
    return null;
  }
  async deleteMonitoredPage(): Promise<any> {
    return true;
  }
}

/**
 * In-memory test store implementing WorkItemsStore with simulated DB-level
 * assignee validation, partial uniqueness checks, and atomic activity trail logging.
 */
class InMemoryWorkItemsStore implements WorkItemsStore {
  workItems: Map<string, WorkItem> = new Map();
  activities: Map<string, WorkItemActivity[]> = new Map(); // workItemId -> activities
  findings: Map<string, FindingEntity> = new Map();
  recommendations: Map<string, RecommendationEntity> = new Map();
  orgMemberships: Map<string, Set<string>> = new Map(); // orgId -> Set of userIds

  private counter = 0;
  private nextTimestamp(): string {
    this.counter += 1;
    return new Date(Date.now() + this.counter * 1000).toISOString();
  }

  registerMembership(orgId: string, userId: string) {
    let set = this.orgMemberships.get(orgId);
    if (!set) {
      set = new Set();
      this.orgMemberships.set(orgId, set);
    }
    set.add(userId);
  }

  async validateAssigneeMembership(orgId: string, assigneeId: string): Promise<boolean> {
    const set = this.orgMemberships.get(orgId);
    return set ? set.has(assigneeId) : false;
  }

  async validateSourceEntity(
    orgId: string,
    projectId: string,
    sourceType: WorkItemSourceType,
    sourceId: string,
  ): Promise<ValidatedSourceEntity | null> {
    if (sourceType === "finding") {
      const finding = this.findings.get(sourceId);
      if (
        !finding ||
        finding.organizationId !== orgId ||
        finding.projectId !== projectId
      ) {
        return null;
      }
      return {
        monitoredPageId: finding.monitoredPageId,
        auditRunId: finding.auditRunId,
        auditReportId: finding.auditReportId,
        title: finding.title,
        description: finding.evidence
          ? `${finding.evidence}\n\nRecommendation: ${finding.recommendation}`
          : finding.recommendation,
        category: finding.category,
        severity: finding.severity,
      };
    }

    if (sourceType === "recommendation") {
      const rec = this.recommendations.get(sourceId);
      if (
        !rec ||
        rec.organizationId !== orgId ||
        rec.projectId !== projectId
      ) {
        return null;
      }
      return {
        monitoredPageId: rec.monitoredPageId,
        auditRunId: rec.auditRunId,
        auditReportId: rec.auditReportId,
        title: rec.title,
        description: rec.detail,
        category: rec.category,
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

    // 2. Source resolution
    let source = resolvedSource;
    if (!source) {
      const sourceId = input.sourceType === "finding" ? input.findingId! : input.recommendationId!;
      source = (await this.validateSourceEntity(orgId, projectId, input.sourceType, sourceId)) ?? undefined;
      if (!source) {
        throw new Error("Source entity not found in this project.");
      }
    }

    const pageId = input.monitoredPageId || source.monitoredPageId;

    // 3. Unique index simulation (uq_work_items_page_finding / uq_work_items_page_recommendation)
    const existingDuplicate = Array.from(this.workItems.values()).find((item) => {
      if (item.monitoredPageId !== pageId) return false;
      if (input.sourceType === "finding" && item.findingId === input.findingId) return true;
      if (input.sourceType === "recommendation" && item.recommendationId === input.recommendationId) return true;
      return false;
    });

    if (existingDuplicate) {
      throw new DuplicateResourceError("A work item already exists for this finding or recommendation.");
    }

    const id = crypto.randomUUID();
    const now = this.nextTimestamp();
    const initialStatus = input.status || "open";

    const isTerminal = initialStatus === "resolved" || initialStatus === "dismissed";

    const item: WorkItem = {
      id,
      organizationId: orgId,
      projectId,
      monitoredPageId: pageId,
      auditRunId: source.auditRunId ?? null,
      auditReportId: source.auditReportId ?? null,
      sourceType: input.sourceType,
      findingId: input.sourceType === "finding" ? input.findingId! : null,
      recommendationId: input.sourceType === "recommendation" ? input.recommendationId! : null,
      title: input.title || source.title,
      description: input.description !== undefined ? input.description : source.description,
      category: input.category !== undefined ? input.category : source.category,
      severity: input.severity !== undefined ? input.severity : source.severity,
      status: initialStatus,
      assigneeId: input.assigneeId ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      resolutionRationale: null,
      resolvedAt: isTerminal ? now : null,
      resolvedByUserId: isTerminal ? userId : null,
      createdByUserId: userId,
      lastModifiedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    };

    this.workItems.set(id, item);

    // Initial activity log
    const activity: WorkItemActivity = {
      id: crypto.randomUUID(),
      workItemId: id,
      organizationId: orgId,
      projectId,
      actorUserId: userId,
      action: "created",
      fromStatus: null,
      toStatus: initialStatus,
      details: {
        sourceType: input.sourceType,
        title: item.title,
        assigneeId: item.assigneeId,
      },
      createdAt: now,
    };

    this.activities.set(id, [activity]);

    return item;
  }

  async listWorkItems(
    orgId: string,
    projectId: string,
    filters: WorkItemFilters = {},
  ): Promise<{ workItems: WorkItem[]; total: number }> {
    let items = Array.from(this.workItems.values()).filter(
      (w) => w.organizationId === orgId && w.projectId === projectId,
    );

    if (filters.pageId) {
      items = items.filter((w) => w.monitoredPageId === filters.pageId);
    }
    if (filters.status) {
      items = items.filter((w) => w.status === filters.status);
    }
    if (filters.assigneeId) {
      items = items.filter((w) => w.assigneeId === filters.assigneeId);
    }
    if (filters.sourceType) {
      items = items.filter((w) => w.sourceType === filters.sourceType);
    }
    if (filters.category) {
      items = items.filter((w) => w.category === filters.category);
    }
    if (filters.severity) {
      items = items.filter((w) => w.severity === filters.severity);
    }

    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = items.length;
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;
    const paginated = items.slice(offset, offset + limit);

    return { workItems: paginated, total };
  }

  async getWorkItemById(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<WorkItem | null> {
    const item = this.workItems.get(workItemId);
    if (!item || item.organizationId !== orgId || item.projectId !== projectId) {
      return null;
    }
    return item;
  }

  async getWorkItemWithActivities(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<{ workItem: WorkItem; activities: WorkItemActivity[] } | null> {
    const item = await this.getWorkItemById(orgId, projectId, workItemId);
    if (!item) return null;

    const acts = this.activities.get(workItemId) ?? [];
    acts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { workItem: item, activities: acts };
  }

  async updateWorkItem(
    orgId: string,
    projectId: string,
    userId: string,
    workItemId: string,
    input: UpdateWorkItemInput,
  ): Promise<WorkItem | null> {
    const item = await this.getWorkItemById(orgId, projectId, workItemId);
    if (!item) return null;

    if (input.assigneeId) {
      const isMember = await this.validateAssigneeMembership(orgId, input.assigneeId);
      if (!isMember) {
        throw new InvalidAssigneeError("Assignee must be a member of the organization.");
      }
    }

    const now = this.nextTimestamp();
    const oldStatus = item.status;
    const newStatus = input.status ?? item.status;
    const statusChanged = input.status !== undefined && input.status !== oldStatus;

    let resolvedAt = item.resolvedAt;
    let resolvedByUserId = item.resolvedByUserId;

    if (statusChanged) {
      if (newStatus === "resolved" || newStatus === "dismissed") {
        resolvedAt = now;
        resolvedByUserId = userId;
      } else {
        resolvedAt = null;
        resolvedByUserId = null;
      }
    }

    const oldAssignee = item.assigneeId;
    const newAssignee = input.assigneeId !== undefined ? input.assigneeId : item.assigneeId;
    const assigneeChanged = input.assigneeId !== undefined && newAssignee !== oldAssignee;

    const updated: WorkItem = {
      ...item,
      status: newStatus,
      assigneeId: newAssignee,
      notes: input.notes !== undefined ? input.notes : item.notes,
      tags: input.tags !== undefined ? input.tags : item.tags,
      resolutionRationale:
        input.resolutionRationale !== undefined
          ? input.resolutionRationale
          : item.resolutionRationale,
      resolvedAt,
      resolvedByUserId,
      lastModifiedByUserId: userId,
      updatedAt: now,
    };

    this.workItems.set(workItemId, updated);

    // Record activity logs
    const acts = this.activities.get(workItemId) ?? [];

    if (statusChanged) {
      acts.push({
        id: crypto.randomUUID(),
        workItemId,
        organizationId: orgId,
        projectId,
        actorUserId: userId,
        action: "status_changed",
        fromStatus: oldStatus,
        toStatus: newStatus,
        details: { resolutionRationale: updated.resolutionRationale },
        createdAt: now,
      });
    }

    if (assigneeChanged) {
      acts.push({
        id: crypto.randomUUID(),
        workItemId,
        organizationId: orgId,
        projectId,
        actorUserId: userId,
        action: newAssignee ? "assigned" : "unassigned",
        fromStatus: updated.status,
        toStatus: updated.status,
        details: {
          previousAssigneeId: oldAssignee,
          newAssigneeId: newAssignee,
        },
        createdAt: now,
      });
    }

    if (
      (input.notes !== undefined && input.notes !== item.notes) ||
      (input.tags !== undefined && JSON.stringify(input.tags) !== JSON.stringify(item.tags))
    ) {
      acts.push({
        id: crypto.randomUUID(),
        workItemId,
        organizationId: orgId,
        projectId,
        actorUserId: userId,
        action: "updated",
        fromStatus: updated.status,
        toStatus: updated.status,
        details: {
          notesUpdated: input.notes !== undefined && input.notes !== item.notes,
          tagsUpdated: input.tags !== undefined && JSON.stringify(input.tags) !== JSON.stringify(item.tags),
        },
        createdAt: now,
      });
    }

    this.activities.set(workItemId, acts);

    return updated;
  }

  async deleteWorkItem(
    orgId: string,
    projectId: string,
    workItemId: string,
  ): Promise<boolean> {
    const item = await this.getWorkItemById(orgId, projectId, workItemId);
    if (!item) return false;

    this.workItems.delete(workItemId);
    this.activities.delete(workItemId);
    return true;
  }
}

describe("Work Items & Collaboration API Integration", () => {
  const orgAId = "11111111-1111-4111-8111-111111111111";
  const orgBId = "22222222-2222-4222-8222-222222222222";

  const userOwner = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "owner@acme.com",
    role: "owner" as Role,
    orgId: orgAId,
  };

  const userAdmin = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    email: "admin@acme.com",
    role: "admin" as Role,
    orgId: orgAId,
  };

  const userMember = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    email: "member@acme.com",
    role: "member" as Role,
    orgId: orgAId,
  };

  const userViewer = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    email: "viewer@acme.com",
    role: "viewer" as Role,
    orgId: orgAId,
  };

  const userOrgB = {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    email: "user@othercorp.com",
    role: "owner" as Role,
    orgId: orgBId,
  };

  function createTestApp(
    workItemsStore: InMemoryWorkItemsStore,
    projectsStore: InMemoryProjectsStore,
  ) {
    return createApp({
      verifyToken: async (token: string) => {
        if (token === "token-owner") return { id: userOwner.id, email: userOwner.email };
        if (token === "token-admin") return { id: userAdmin.id, email: userAdmin.email };
        if (token === "token-member") return { id: userMember.id, email: userMember.email };
        if (token === "token-viewer") return { id: userViewer.id, email: userViewer.email };
        if (token === "token-org-b") return { id: userOrgB.id, email: userOrgB.email };
        return null;
      },
      resolveWorkspace: async (user) => {
        let role: Role = "viewer";
        let orgId = orgAId;
        if (user.id === userOwner.id) {
          role = "owner";
          orgId = orgAId;
        } else if (user.id === userAdmin.id) {
          role = "admin";
          orgId = orgAId;
        } else if (user.id === userMember.id) {
          role = "member";
          orgId = orgAId;
        } else if (user.id === userViewer.id) {
          role = "viewer";
          orgId = orgAId;
        } else if (user.id === userOrgB.id) {
          role = "owner";
          orgId = orgBId;
        }

        return {
          user: { id: user.id, email: user.email },
          profile: null,
          organization: {
            id: orgId,
            name: orgId === orgAId ? "Acme Org" : "OtherCorp",
            slug: orgId === orgAId ? "acme-org" : "other-corp",
            createdBy: user.id,
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          membership: {
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: user.id,
            role,
            createdAt: "2026-08-27T12:00:00.000Z",
            updatedAt: "2026-08-27T12:00:00.000Z",
          },
          role,
        };
      },
      getProjectsStore: () => projectsStore,
      getWorkItemsStore: () => workItemsStore,
    });
  }

  // -------------------------------------------------------------------------
  // Helper to set up initial project, page, and historical finding/recommendation
  // -------------------------------------------------------------------------
  async function setupFixture(
    workItemsStore: InMemoryWorkItemsStore,
    projectsStore: InMemoryProjectsStore,
  ) {
    // Register memberships in Org A
    workItemsStore.registerMembership(orgAId, userOwner.id);
    workItemsStore.registerMembership(orgAId, userAdmin.id);
    workItemsStore.registerMembership(orgAId, userMember.id);
    workItemsStore.registerMembership(orgAId, userViewer.id);

    // Register membership in Org B
    workItemsStore.registerMembership(orgBId, userOrgB.id);

    const project = await projectsStore.createProject(orgAId, userOwner.id, {
      name: "Acme Landing Pages",
    });

    const pageId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const reportId = crypto.randomUUID();

    const findingId = crypto.randomUUID();
    const finding: FindingEntity = {
      id: findingId,
      auditReportId: reportId,
      auditRunId: runId,
      monitoredPageId: pageId,
      projectId: project.id,
      organizationId: orgAId,
      findingType: "top_problem",
      category: "ctaEffectiveness",
      title: "Hero CTA is buried below fold on mobile",
      severity: "high",
      evidence: "Button at y=950px requires extensive scrolling.",
      basis: "observed",
      signalIds: ["sig-cta-1"],
      recommendation: "Move primary action into initial viewport.",
      displayOrder: 0,
      workStatus: "open",
      createdAt: "2026-08-29T12:00:00.000Z",
    };
    workItemsStore.findings.set(findingId, finding);

    const recId = crypto.randomUUID();
    const recommendation: RecommendationEntity = {
      id: recId,
      auditReportId: reportId,
      auditRunId: runId,
      monitoredPageId: pageId,
      projectId: project.id,
      organizationId: orgAId,
      recommendationType: "quick_win",
      category: "trustCredibility",
      title: "Add security seal beside credit card fields",
      detail: "Increases trust and checkout completion rate.",
      displayOrder: 0,
      createdAt: "2026-08-29T12:00:00.000Z",
    };
    workItemsStore.recommendations.set(recId, recommendation);

    return { project, pageId, runId, reportId, finding, recommendation };
  }

  // -------------------------------------------------------------------------
  // 1. Work Item Creation & Validation
  // -------------------------------------------------------------------------
  describe("Work Item Creation & Source Linkage", () => {
    it("creates a work item from an audit finding and auto-populates metadata", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const res = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
          tags: ["hero", "mobile-ux"],
          notes: "Sprint 42 priority.",
        });

      expect(res.status).toBe(201);
      expect(res.body.workItem).toBeDefined();
      expect(res.body.workItem.title).toBe(finding.title);
      expect(res.body.workItem.category).toBe("ctaEffectiveness");
      expect(res.body.workItem.severity).toBe("high");
      expect(res.body.workItem.status).toBe("open");
      expect(res.body.workItem.sourceType).toBe("finding");
      expect(res.body.workItem.findingId).toBe(finding.id);
      expect(res.body.workItem.tags).toEqual(["hero", "mobile-ux"]);
      expect(res.body.workItem.notes).toBe("Sprint 42 priority.");
      expect(res.body.workItem.organizationId).toBe(orgAId);
      expect(res.body.workItem.projectId).toBe(project.id);
      expect(res.body.workItem.createdByUserId).toBe(userOwner.id);
    });

    it("creates a work item from an audit recommendation", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, recommendation } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const res = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-member")
        .send({
          sourceType: "recommendation",
          recommendationId: recommendation.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.workItem.title).toBe(recommendation.title);
      expect(res.body.workItem.sourceType).toBe("recommendation");
      expect(res.body.workItem.recommendationId).toBe(recommendation.id);
      expect(res.body.workItem.category).toBe("trustCredibility");
    });

    it("rejects duplicate work item for the same finding with 409 CONFLICT", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // First creation succeeds
      const res1 = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      expect(res1.status).toBe(201);

      // Duplicate attempt returns 409 CONFLICT
      const res2 = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe("CONFLICT");
      expect(res2.body.error.message).toContain("already exists");
    });

    it("assigns work item to a valid organization member", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const res = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
          assigneeId: userMember.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.workItem.assigneeId).toBe(userMember.id);
    });

    it("rejects assignment to a user outside the organization with 400 BAD_REQUEST", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const res = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
          assigneeId: userOrgB.id, // User belonging to Org B, not Org A
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Assignee must be a member of the organization");
    });

    it("returns 404 when referenced finding is missing or belongs to another project", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const res = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: "99999999-9999-4999-8999-999999999999",
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Status Transitions, Notes, Tags, and Activity Trail
  // -------------------------------------------------------------------------
  describe("Status Lifecycle & Activity Trail", () => {
    it("transitions status from open -> in_progress -> resolved and records activity trail", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // 1. Create work item
      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      const workItemId = createRes.body.workItem.id;

      // 2. Transition to in_progress
      const patch1 = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-member")
        .send({ status: "in_progress" });
      expect(patch1.status).toBe(200);
      expect(patch1.body.workItem.status).toBe("in_progress");
      expect(patch1.body.workItem.resolvedAt).toBeNull();

      // 3. Transition to resolved with resolution rationale
      const patch2 = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-admin")
        .send({
          status: "resolved",
          resolutionRationale: "CTA redesigned and moved above the fold in PR #104.",
        });
      expect(patch2.status).toBe(200);
      expect(patch2.body.workItem.status).toBe("resolved");
      expect(patch2.body.workItem.resolvedAt).toBeDefined();
      expect(patch2.body.workItem.resolvedByUserId).toBe(userAdmin.id);
      expect(patch2.body.workItem.resolutionRationale).toBe("CTA redesigned and moved above the fold in PR #104.");

      // 4. Retrieve detail with activities
      const getDetail = await request(app)
        .get(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-viewer");
      expect(getDetail.status).toBe(200);
      expect(getDetail.body.workItem.status).toBe("resolved");
      expect(getDetail.body.activities).toHaveLength(3); // created, status_changed (to in_progress), status_changed (to resolved)

      const actions = getDetail.body.activities.map((a: any) => a.action);
      expect(actions).toContain("created");
      expect(actions).toContain("status_changed");
    });

    it("clears resolution metadata when a resolved work item is reopened to open", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
          status: "resolved",
        });
      const workItemId = createRes.body.workItem.id;
      expect(createRes.body.workItem.resolvedAt).toBeDefined();

      // Reopen to open
      const reopenRes = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-owner")
        .send({ status: "open" });

      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.workItem.status).toBe("open");
      expect(reopenRes.body.workItem.resolvedAt).toBeNull();
      expect(reopenRes.body.workItem.resolvedByUserId).toBeNull();
    });

    it("updates assignee, notes, and tags and logs corresponding activities", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      const workItemId = createRes.body.workItem.id;

      // Assign to userMember
      const assignRes = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-owner")
        .send({
          assigneeId: userMember.id,
          notes: "Please investigate responsive CSS.",
          tags: ["css", "mobile"],
        });

      expect(assignRes.status).toBe(200);
      expect(assignRes.body.workItem.assigneeId).toBe(userMember.id);
      expect(assignRes.body.workItem.notes).toBe("Please investigate responsive CSS.");
      expect(assignRes.body.workItem.tags).toEqual(["css", "mobile"]);

      // Unassign
      const unassignRes = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-owner")
        .send({ assigneeId: null });

      expect(unassignRes.status).toBe(200);
      expect(unassignRes.body.workItem.assigneeId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Historical Immutability Guarantee
  // -------------------------------------------------------------------------
  describe("Historical Report & Finding Immutability", () => {
    it("guarantees underlying audit findings, recommendations, and reports are NEVER modified", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding, recommendation } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // Snapshot the original finding & recommendation objects
      const originalFindingJson = JSON.stringify(finding);
      const originalRecJson = JSON.stringify(recommendation);

      // 1. Create work items
      const w1 = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({ sourceType: "finding", findingId: finding.id });

      const w2 = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({ sourceType: "recommendation", recommendationId: recommendation.id });

      // 2. Mutate work item 1 to resolved and change notes
      await request(app)
        .patch(`/api/projects/${project.id}/work-items/${w1.body.workItem.id}`)
        .set("Authorization", "Bearer token-owner")
        .send({
          status: "resolved",
          resolutionRationale: "Fixed by growth team.",
          notes: "Some note.",
        });

      // 3. Delete work item 2
      await request(app)
        .delete(`/api/projects/${project.id}/work-items/${w2.body.workItem.id}`)
        .set("Authorization", "Bearer token-owner");

      // 4. Verify original finding is 100% UNCHANGED
      const currentFinding = workItemsStore.findings.get(finding.id);
      expect(JSON.stringify(currentFinding)).toBe(originalFindingJson);

      // 5. Verify original recommendation is 100% UNCHANGED
      const currentRec = workItemsStore.recommendations.get(recommendation.id);
      expect(JSON.stringify(currentRec)).toBe(originalRecJson);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Role Authorization Matrix
  // -------------------------------------------------------------------------
  describe("Role Authorization Matrix", () => {
    it("allows viewers to read work items but denies all mutations with 403 FORBIDDEN", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // Owner creates a work item first
      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      const workItemId = createRes.body.workItem.id;

      // Viewer GET list -> 200
      const listRes = await request(app)
        .get(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-viewer");
      expect(listRes.status).toBe(200);
      expect(listRes.body.workItems).toHaveLength(1);

      // Viewer GET detail -> 200
      const getRes = await request(app)
        .get(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-viewer");
      expect(getRes.status).toBe(200);

      // Viewer POST -> 403
      const postRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-viewer")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      expect(postRes.status).toBe(403);
      expect(postRes.body.error.code).toBe("FORBIDDEN");

      // Viewer PATCH -> 403
      const patchRes = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-viewer")
        .send({ status: "in_progress" });
      expect(patchRes.status).toBe(403);

      // Viewer DELETE -> 403
      const delRes = await request(app)
        .delete(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-viewer");
      expect(delRes.status).toBe(403);
    });

    it("allows member, admin, and owner to perform full CRUD on work items", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // Member creates
      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-member")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      expect(createRes.status).toBe(201);
      const workItemId = createRes.body.workItem.id;

      // Member updates
      const patchRes = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-member")
        .send({ status: "in_progress" });
      expect(patchRes.status).toBe(200);

      // Member deletes
      const delRes = await request(app)
        .delete(`/api/projects/${project.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-member");
      expect(delRes.status).toBe(200);
      expect(delRes.body.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Tenant Isolation & Manipulated IDs
  // -------------------------------------------------------------------------
  describe("Tenant Isolation & Manipulated ID Protection", () => {
    it("returns 404 and blocks cross-organization work item access and mutation", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // Org A work item created
      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      const orgAWorkItemId = createRes.body.workItem.id;

      // User from Org B tries to GET Org A work items
      const getListRes = await request(app)
        .get(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-org-b");
      expect(getListRes.status).toBe(404);

      // User from Org B tries to GET Org A work item detail
      const getDetailRes = await request(app)
        .get(`/api/projects/${project.id}/work-items/${orgAWorkItemId}`)
        .set("Authorization", "Bearer token-org-b");
      expect(getDetailRes.status).toBe(404);

      // User from Org B tries to PATCH Org A work item
      const patchRes = await request(app)
        .patch(`/api/projects/${project.id}/work-items/${orgAWorkItemId}`)
        .set("Authorization", "Bearer token-org-b")
        .send({ status: "resolved" });
      expect(patchRes.status).toBe(404);

      // User from Org B tries to DELETE Org A work item
      const delRes = await request(app)
        .delete(`/api/projects/${project.id}/work-items/${orgAWorkItemId}`)
        .set("Authorization", "Bearer token-org-b");
      expect(delRes.status).toBe(404);

      // Verify Org A work item remains open and untouched
      const untouched = await workItemsStore.getWorkItemById(orgAId, project.id, orgAWorkItemId);
      expect(untouched?.status).toBe("open");
    });

    it("returns 404 when projectId in route does not match the work item project", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding } = await setupFixture(workItemsStore, projectsStore);
      const otherProject = await projectsStore.createProject(orgAId, userOwner.id, {
        name: "Other Project in Org A",
      });
      const app = createTestApp(workItemsStore, projectsStore);

      const createRes = await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
        });
      const workItemId = createRes.body.workItem.id;

      // Accessing with mismatched otherProject.id
      const res = await request(app)
        .get(`/api/projects/${otherProject.id}/work-items/${workItemId}`)
        .set("Authorization", "Bearer token-owner");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------------------------------------------------------------
  // 6. List Filtering & Pagination
  // -------------------------------------------------------------------------
  describe("List Filtering & Pagination", () => {
    it("filters work items by status, assignee, and source type", async () => {
      const workItemsStore = new InMemoryWorkItemsStore();
      const projectsStore = new InMemoryProjectsStore();
      const { project, finding, recommendation } = await setupFixture(workItemsStore, projectsStore);
      const app = createTestApp(workItemsStore, projectsStore);

      // Create finding item (open, assignee: userMember)
      await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "finding",
          findingId: finding.id,
          assigneeId: userMember.id,
          status: "open",
        });

      // Create recommendation item (resolved, no assignee)
      await request(app)
        .post(`/api/projects/${project.id}/work-items`)
        .set("Authorization", "Bearer token-owner")
        .send({
          sourceType: "recommendation",
          recommendationId: recommendation.id,
          status: "resolved",
        });

      // Filter by status=open
      const openRes = await request(app)
        .get(`/api/projects/${project.id}/work-items?status=open`)
        .set("Authorization", "Bearer token-owner");
      expect(openRes.status).toBe(200);
      expect(openRes.body.workItems).toHaveLength(1);
      expect(openRes.body.workItems[0].status).toBe("open");

      // Filter by status=resolved
      const resolvedRes = await request(app)
        .get(`/api/projects/${project.id}/work-items?status=resolved`)
        .set("Authorization", "Bearer token-owner");
      expect(resolvedRes.status).toBe(200);
      expect(resolvedRes.body.workItems).toHaveLength(1);
      expect(resolvedRes.body.workItems[0].status).toBe("resolved");

      // Filter by assigneeId=userMember.id
      const memberRes = await request(app)
        .get(`/api/projects/${project.id}/work-items?assigneeId=${userMember.id}`)
        .set("Authorization", "Bearer token-owner");
      expect(memberRes.status).toBe(200);
      expect(memberRes.body.workItems).toHaveLength(1);
      expect(memberRes.body.workItems[0].assigneeId).toBe(userMember.id);

      // Filter by sourceType=recommendation
      const recRes = await request(app)
        .get(`/api/projects/${project.id}/work-items?sourceType=recommendation`)
        .set("Authorization", "Bearer token-owner");
      expect(recRes.status).toBe(200);
      expect(recRes.body.workItems).toHaveLength(1);
      expect(recRes.body.workItems[0].sourceType).toBe("recommendation");
    });
  });
});
