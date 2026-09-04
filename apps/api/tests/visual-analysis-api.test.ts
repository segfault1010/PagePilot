import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  VISUAL_PROVENANCE_LABEL,
  type MonitoredPage,
  type Project,
  type Role,
  type VisualAnalysisReview,
} from "@pagepilot/contracts";
import { createApp } from "../src/http/app.js";
import type { VisualAnalysisStore } from "../src/visual-analysis/visual-analysis-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";

class InMemoryProjectsStore implements ProjectsStore {
  projects: Map<string, Project> = new Map();
  pages: Map<string, MonitoredPage> = new Map();

  async createProject(): Promise<any> {
    return null;
  }
  async listProjects(): Promise<any> {
    return [];
  }
  async getProjectById(
    orgId: string,
    projectId: string
  ): Promise<Project | null> {
    const p = this.projects.get(projectId);
    if (!p || p.organizationId !== orgId) return null;
    return p;
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
    return null;
  }
  async listMonitoredPages(): Promise<any> {
    return [];
  }
  async getMonitoredPageById(
    orgId: string,
    projectId: string,
    pageId: string
  ): Promise<MonitoredPage | null> {
    const page = this.pages.get(pageId);
    if (!page || page.projectId !== projectId || page.organizationId !== orgId) {
      return null;
    }
    return page;
  }
  async updateMonitoredPage(): Promise<any> {
    return null;
  }
  async deleteMonitoredPage(): Promise<any> {
    return true;
  }
}

class InMemoryVisualAnalysisStore implements VisualAnalysisStore {
  reviews: Map<string, VisualAnalysisReview> = new Map();

  async getVisualReview(auditRunId: string): Promise<VisualAnalysisReview | null> {
    return this.reviews.get(auditRunId) ?? null;
  }

  async getVisualReviewForAuditRun(params: {
    organizationId: string;
    projectId: string;
    pageId: string;
    auditRunId: string;
  }): Promise<VisualAnalysisReview | null> {
    const review = this.reviews.get(params.auditRunId);
    if (
      !review ||
      review.organizationId !== params.organizationId ||
      review.projectId !== params.projectId ||
      review.monitoredPageId !== params.pageId
    ) {
      return null;
    }
    return review;
  }

  async persistVisualReview(
    review: VisualAnalysisReview
  ): Promise<VisualAnalysisReview> {
    this.reviews.set(review.auditRunId, review);
    return review;
  }

  async recordVisualReviewFailure(): Promise<void> {}
}

describe("Visual Analysis Review API Endpoints", () => {
  const orgId = "550e8400-e29b-41d4-a716-446655440000";
  const foreignOrgId = "550e8400-e29b-41d4-a716-446655440099";
  const projectId = "550e8400-e29b-41d4-a716-446655440001";
  const pageId = "550e8400-e29b-41d4-a716-446655440002";
  const runId = "550e8400-e29b-41d4-a716-446655440003";

  const sampleProject: Project = {
    id: projectId,
    organizationId: orgId,
    name: "Alpha Project",
    domain: "example.com",
    timezone: "UTC",
    goals: "Improve conversion",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const samplePage: MonitoredPage = {
    id: pageId,
    organizationId: orgId,
    projectId,
    canonicalUrl: "https://example.com",
    status: "active",
    cadence: "weekly",
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const sampleReview: VisualAnalysisReview = {
    id: "550e8400-e29b-41d4-a716-446655440010",
    organizationId: orgId,
    projectId,
    monitoredPageId: pageId,
    auditRunId: runId,
    provenance: VISUAL_PROVENANCE_LABEL,
    schemaVersion: "1.0.0",
    promptVersion: "1.0.0",
    modelIdentifier: "gemini-3.6-flash",
    status: "completed",
    executiveSummary:
      "Clear desktop headline and focal point with ample whitespace, though hero action button suffers from low mobile visual isolation.",
    viewportsAnalyzed: ["desktop", "mobile"],
    dimensions: {
      visual_hierarchy: {
        rating: "strong",
        explanation: "Clear hierarchy guiding eye toward hero value prop.",
      },
      cta_prominence: {
        rating: "adequate",
        explanation: "Action button is visible above fold on desktop.",
        isAboveFoldCtaVisible: true,
      },
      visual_clutter: {
        rating: "strong",
        explanation: "Minimal clutter and clear spacing.",
      },
      contrast_legibility: {
        rating: "adequate",
        explanation: "Readable contrast across core typography.",
      },
      typography_hierarchy: {
        rating: "strong",
        explanation: "Good typographic size disparity.",
      },
      spacing_layout: {
        rating: "strong",
        explanation: "Balanced margins and layout grid.",
      },
      mobile_adaptation: {
        rating: "adequate",
        explanation: "Clean mobile view with responsive stacking.",
      },
    },
    findings: [
      {
        id: "vis-1",
        dimension: "cta_prominence",
        targetViewport: "mobile",
        visualZone: "above_the_fold",
        title: "Mobile Primary CTA Lacks Visual Isolation",
        severity: "medium",
        observation: "Primary button is tightly framed by secondary links on 375px.",
        impact: "Slows decision-making on mobile devices.",
        recommendation: "Increase padding and visual contrast on mobile CTA.",
        confidence: "high",
        basis: "visual_inference",
      },
    ],
    screenshotIds: ["550e8400-e29b-41d4-a716-446655440020"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function setupApp(userRole: Role = "member", activeOrgId: string = orgId) {
    const projectsStore = new InMemoryProjectsStore();
    projectsStore.projects.set(projectId, sampleProject);
    projectsStore.pages.set(pageId, samplePage);

    const visualStore = new InMemoryVisualAnalysisStore();
    visualStore.reviews.set(runId, sampleReview);

    const app = createApp({
      getProjectsStore: () => projectsStore,
      getVisualAnalysisStore: () => visualStore,
      verifyToken: async () => ({
        id: "user-123",
        email: "user@example.com",
      }),
      resolveWorkspace: async () => ({
        organization: {
          id: activeOrgId,
          name: "Test Org",
          slug: "test-org",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        role: userRole,
      } as any),
    });

    return { app, visualStore, projectsStore };
  }

  it("GET /api/projects/:projectId/pages/:pageId/audits/:auditRunId/visual-analysis returns 200 with review", async () => {
    const { app } = setupApp("member");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${runId}/visual-analysis`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("visualAnalysis");
    expect(res.body.visualAnalysis).not.toBeNull();
    expect(res.body.visualAnalysis.auditRunId).toBe(runId);
    expect(res.body.visualAnalysis.schemaVersion).toBe("1.0.0");
    expect(res.body.visualAnalysis.findings[0].basis).toBe("visual_inference");
  });

  it("viewer role can read visual analysis review (read-only allowed)", async () => {
    const { app } = setupApp("viewer");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${runId}/visual-analysis`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.visualAnalysis.modelIdentifier).toBe("gemini-3.6-flash");
  });

  it("returns { visualAnalysis: null } when no visual review was performed for this run", async () => {
    const { app, visualStore } = setupApp("member");
    visualStore.reviews.clear();

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${runId}/visual-analysis`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ visualAnalysis: null });
  });

  it("returns safe 404 when requested by a cross-tenant user", async () => {
    const { app } = setupApp("member", foreignOrgId);

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/${runId}/visual-analysis`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("returns safe 404 for invalid UUID parameters", async () => {
    const { app } = setupApp("member");

    const res = await request(app)
      .get(
        `/api/projects/${projectId}/pages/${pageId}/audits/invalid-uuid/visual-analysis`
      )
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
