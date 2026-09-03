import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/http/app.js";
import type {
  CreateIntegrationInput,
  IntegrationConnection,
  TestIntegrationResponse,
  UpdateIntegrationInput,
  WorkspaceContext,
} from "@pagepilot/contracts";
import type { IntegrationsStore } from "../src/integrations/integrations-store.js";
import type { ProjectsStore } from "../src/projects/projects-store.js";
import type { Project } from "@pagepilot/contracts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_ID = "22222222-2222-2222-2222-222222222222";
const INTEGRATION_ID = "33333333-3333-3333-3333-333333333333";

function makeMockProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    organizationId: ORG_ID,
    name: "Production Landing Page",
    domain: "example.com",
    timezone: "UTC",
    goals: "Increase conversion",
    createdBy: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockIntegration(
  overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
  return {
    id: INTEGRATION_ID,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    provider: "slack",
    name: "Engineering Slack Alerts",
    status: "active",
    config: { channel: "#ux-alerts" },
    maskedTargetUrl: "https://hooks.slack.com/services/T01***/*****/********",
    hasSigningSecret: false,
    events: ["overall_score_drop", "new_high_severity_finding"],
    createdByUserId: "user-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockWorkspaceContext(
  role: "owner" | "admin" | "member" | "viewer" = "admin",
): WorkspaceContext {
  return {
    user: {
      id: "user-123",
      email: "team@example.com",
    },
    profile: null,
    organization: {
      id: ORG_ID,
      name: "Acme Corp",
      slug: "acme-corp",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    membership: {
      id: "mem-123",
      organizationId: ORG_ID,
      userId: "user-123",
      role,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    role,
  };
}

class MockProjectsStore implements Partial<ProjectsStore> {
  async getProjectById(
    orgId: string,
    projectId: string,
  ): Promise<Project | null> {
    if (orgId === ORG_ID && projectId === PROJECT_ID) {
      return makeMockProject();
    }
    return null;
  }
}

class MockIntegrationsStore implements IntegrationsStore {
  public integrations: IntegrationConnection[] = [makeMockIntegration()];

  async listIntegrations(
    orgId: string,
    projectId?: string,
  ): Promise<IntegrationConnection[]> {
    return this.integrations.filter(
      (i) =>
        i.organizationId === orgId &&
        (!projectId || i.projectId === projectId || i.projectId === null),
    );
  }

  async getIntegrationById(
    orgId: string,
    integrationId: string,
    projectId?: string,
  ): Promise<IntegrationConnection | null> {
    const item = this.integrations.find(
      (i) =>
        i.id === integrationId &&
        i.organizationId === orgId &&
        (!projectId || i.projectId === projectId || i.projectId === null),
    );
    return item ?? null;
  }

  async getIntegrationWithCredentials(
    orgId: string,
    integrationId: string,
  ): Promise<{
    integration: IntegrationConnection;
    targetUrl: string;
    signingSecret?: string;
  } | null> {
    const item = await this.getIntegrationById(orgId, integrationId);
    if (!item) return null;
    return {
      integration: item,
      targetUrl: "https://hooks.slack.com/services/T0123/B0123/REAL_SECRET",
    };
  }

  async createIntegration(
    orgId: string,
    userId: string,
    input: CreateIntegrationInput,
    projectId?: string,
  ): Promise<IntegrationConnection> {
    const created: IntegrationConnection = {
      id: `new-${Date.now()}`,
      organizationId: orgId,
      projectId: projectId || null,
      provider: input.provider,
      name: input.name,
      status: "active",
      config: input.config || {},
      maskedTargetUrl: "https://hooks.slack.com/services/T01***/*****/********",
      hasSigningSecret: Boolean(input.signingSecret),
      events: input.events || [
        "overall_score_drop",
        "new_high_severity_finding",
      ],
      createdByUserId: userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.integrations.push(created);
    return created;
  }

  async updateIntegration(
    orgId: string,
    integrationId: string,
    input: UpdateIntegrationInput,
    projectId?: string,
  ): Promise<IntegrationConnection | null> {
    const idx = this.integrations.findIndex(
      (i) =>
        i.id === integrationId &&
        i.organizationId === orgId &&
        (!projectId || i.projectId === projectId || i.projectId === null),
    );
    if (idx === -1) return null;

    const existing = this.integrations[idx]!;
    const updated: IntegrationConnection = {
      ...existing,
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
      events: input.events ?? existing.events,
      config: input.config ?? existing.config,
      updatedAt: new Date().toISOString(),
    };
    this.integrations[idx] = updated;
    return updated;
  }

  async deleteIntegration(
    orgId: string,
    integrationId: string,
    projectId?: string,
  ): Promise<boolean> {
    const initialLen = this.integrations.length;
    this.integrations = this.integrations.filter(
      (i) =>
        !(
          i.id === integrationId &&
          i.organizationId === orgId &&
          (!projectId || i.projectId === projectId || i.projectId === null)
        ),
    );
    return this.integrations.length < initialLen;
  }

  async testIntegration(
    orgId: string,
    integrationId: string,
  ): Promise<TestIntegrationResponse> {
    const item = await this.getIntegrationById(orgId, integrationId);
    if (!item) {
      return { success: false, latencyMs: 0, error: "Integration not found." };
    }
    return {
      success: true,
      statusCode: 200,
      latencyMs: 120,
    };
  }
}

describe("Integrations API (/api/projects/:projectId/integrations)", () => {
  function buildTestApp(
    role: "owner" | "admin" | "member" | "viewer" = "admin",
    mockStore = new MockIntegrationsStore(),
  ) {
    const mockWs = makeMockWorkspaceContext(role);
    const app = createApp({
      verifyToken: async (token: string) => {
        if (token.startsWith("token-") || token === "valid-token") {
          return { id: mockWs.user.id, email: mockWs.user.email };
        }
        return null;
      },
      resolveWorkspace: async () => mockWs,
      getProjectsStore: () => new MockProjectsStore() as any,
      getIntegrationsStore: () => mockStore,
      dnsResolver: async (hostname: string) => {
        if (
          hostname === "hooks.slack.com" ||
          hostname === "api.example.com" ||
          hostname === "example.com"
        ) {
          return [{ address: "93.184.216.34", family: 4 }];
        }
        return [];
      },
    });
    return { app, mockStore };
  }

  describe("GET /api/projects/:projectId/integrations", () => {
    it("allows all organization roles (owner, admin, member, viewer) to list integrations", async () => {
      for (const role of ["owner", "admin", "member", "viewer"] as const) {
        const { app } = buildTestApp(role);
        const res = await request(app)
          .get(`/api/projects/${PROJECT_ID}/integrations`)
          .set("Authorization", "Bearer valid-token");

        expect(res.status).toBe(200);
        expect(res.body.integrations).toHaveLength(1);
        expect(res.body.integrations[0].maskedTargetUrl).toContain("****");
        expect(res.body.integrations[0].encrypted_credentials).toBeUndefined();
      }
    });

    it("returns 404 when project does not exist", async () => {
      const { app } = buildTestApp("admin");
      const res = await request(app)
        .get(
          "/api/projects/99999999-9999-9999-9999-999999999999/integrations",
        )
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /api/projects/:projectId/integrations (Role Matrix & Validation)", () => {
    const validPayload = {
      name: "Slack Channel Alerts",
      provider: "slack",
      targetUrl: "https://hooks.slack.com/services/T001/B002/SECRETTOKEN",
      events: ["overall_score_drop", "new_high_severity_finding"],
    };

    it("permits admin and owner to create integrations", async () => {
      for (const role of ["admin", "owner"] as const) {
        const { app } = buildTestApp(role);
        const res = await request(app)
          .post(`/api/projects/${PROJECT_ID}/integrations`)
          .set("Authorization", "Bearer valid-token")
          .send(validPayload);

        expect(res.status).toBe(201);
        expect(res.body.integration.name).toBe("Slack Channel Alerts");
        expect(res.body.integration.maskedTargetUrl).toBeDefined();
        expect(res.body.integration.encrypted_credentials).toBeUndefined();
      }
    });

    it("forbids member and viewer from creating integrations (403 Forbidden)", async () => {
      for (const role of ["member", "viewer"] as const) {
        const { app } = buildTestApp(role);
        const res = await request(app)
          .post(`/api/projects/${PROJECT_ID}/integrations`)
          .set("Authorization", "Bearer valid-token")
          .send(validPayload);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      }
    });

    it("rejects invalid URLs violating URL policy", async () => {
      const { app } = buildTestApp("admin");
      const res = await request(app)
        .post(`/api/projects/${PROJECT_ID}/integrations`)
        .set("Authorization", "Bearer valid-token")
        .send({
          ...validPayload,
          targetUrl: "ftp://example.com/webhook",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Only http:// and https://");
    });

    it("blocks SSRF attempts targeting private or loopback destinations", async () => {
      const { app } = buildTestApp("admin");
      const blockedUrls = [
        "http://localhost/webhook",
        "http://127.0.0.1/webhook",
        "http://169.254.169.254/latest/meta-data",
        "http://10.0.0.1/webhook",
        "http://192.168.1.1/webhook",
      ];

      for (const url of blockedUrls) {
        const res = await request(app)
          .post(`/api/projects/${PROJECT_ID}/integrations`)
          .set("Authorization", "Bearer valid-token")
          .send({
            ...validPayload,
            targetUrl: url,
          });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("BLOCKED_DESTINATION");
      }
    });
  });

  describe("PATCH /api/projects/:projectId/integrations/:integrationId", () => {
    it("allows admin/owner to update integrations", async () => {
      const { app } = buildTestApp("admin");
      const res = await request(app)
        .patch(`/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}`)
        .set("Authorization", "Bearer valid-token")
        .send({
          name: "Updated Slack Integration",
          status: "disabled",
        });

      expect(res.status).toBe(200);
      expect(res.body.integration.name).toBe("Updated Slack Integration");
      expect(res.body.integration.status).toBe("disabled");
    });

    it("forbids member/viewer from updating integrations (403 Forbidden)", async () => {
      const { app } = buildTestApp("member");
      const res = await request(app)
        .patch(`/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}`)
        .set("Authorization", "Bearer valid-token")
        .send({ name: "Hacked" });

      expect(res.status).toBe(403);
    });

    it("enforces SSRF policy on targetUrl updates", async () => {
      const { app } = buildTestApp("admin");
      const res = await request(app)
        .patch(`/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}`)
        .set("Authorization", "Bearer valid-token")
        .send({
          targetUrl: "http://169.254.169.254/secret",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("BLOCKED_DESTINATION");
    });
  });

  describe("DELETE /api/projects/:projectId/integrations/:integrationId", () => {
    it("allows admin/owner to delete integrations", async () => {
      const { app } = buildTestApp("admin");
      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("forbids member/viewer from deleting integrations (403 Forbidden)", async () => {
      const { app } = buildTestApp("member");
      const res = await request(app)
        .delete(`/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}`)
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/projects/:projectId/integrations/:integrationId/test", () => {
    it("allows admin/owner to execute test ping", async () => {
      const { app } = buildTestApp("admin");
      const res = await request(app)
        .post(
          `/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}/test`,
        )
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("forbids member/viewer from running test pings (403 Forbidden)", async () => {
      const { app } = buildTestApp("member");
      const res = await request(app)
        .post(
          `/api/projects/${PROJECT_ID}/integrations/${INTEGRATION_ID}/test`,
        )
        .set("Authorization", "Bearer valid-token");

      expect(res.status).toBe(403);
    });
  });
});
