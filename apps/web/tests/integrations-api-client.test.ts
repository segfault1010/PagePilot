import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIntegration,
  deleteIntegration,
  getIntegration,
  listIntegrations,
  testIntegration,
  updateIntegration,
  IntegrationsApiClientError,
} from "../src/features/integrations/api.js";

// Mock Supabase client
vi.mock("../src/features/auth/supabase-client.js", () => ({
  getSupabaseClient: vi.fn(() => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: "auto-session-token",
          },
        },
      }),
    },
  })),
}));

describe("Web Integrations API Client", () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  const integrationId = "22222222-2222-4222-8222-222222222222";
  const orgId = "33333333-3333-4333-8333-333333333333";

  const sampleIntegration = {
    id: integrationId,
    organizationId: orgId,
    projectId,
    provider: "slack" as const,
    name: "Engineering Alerts",
    status: "active" as const,
    config: { channel: "#growth-alerts" },
    maskedTargetUrl: "https://hooks.slack.com/services/T01***/*****/********",
    hasSigningSecret: false,
    events: ["overall_score_drop", "new_high_severity_finding"] as const,
    createdByUserId: "44444444-4444-4444-8444-444444444444",
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists integrations and parses schema with auth token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integrations: [sampleIntegration],
        total: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await listIntegrations(projectId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(`/api/projects/${projectId}/integrations`);

    const authHeader = fetchMock.mock.calls[0][1].headers.get("Authorization");
    expect(authHeader).toBe("Bearer auto-session-token");

    expect(res.integrations).toHaveLength(1);
    expect(res.integrations[0].name).toBe("Engineering Alerts");
    expect(res.integrations[0].maskedTargetUrl).toContain("****");
  });

  it("gets integration details by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integration: sampleIntegration,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getIntegration(projectId, integrationId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/projects/${projectId}/integrations/${integrationId}`,
    );
    expect(res.integration.id).toBe(integrationId);
  });

  it("creates an integration with valid payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integration: sampleIntegration,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await createIntegration(projectId, {
      name: "Engineering Alerts",
      provider: "slack",
      targetUrl: "https://hooks.slack.com/services/T0123/B0123/SECRET",
      events: ["overall_score_drop", "new_high_severity_finding"],
      config: { channel: "#growth-alerts" },
      isOrganizationWide: false,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.name).toBe("Engineering Alerts");
    expect(body.provider).toBe("slack");
    expect(res.integration.name).toBe("Engineering Alerts");
  });

  it("updates an existing integration", async () => {
    const updated = {
      ...sampleIntegration,
      name: "Updated Slack Alerts",
      status: "disabled" as const,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        integration: updated,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await updateIntegration(projectId, integrationId, {
      name: "Updated Slack Alerts",
      status: "disabled",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(res.integration.status).toBe("disabled");
  });

  it("deletes an integration", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        deletedIntegrationId: integrationId,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await deleteIntegration(projectId, integrationId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(res.success).toBe(true);
    expect(res.deletedIntegrationId).toBe(integrationId);
  });

  it("dispatches test ping and parses result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        statusCode: 200,
        latencyMs: 142,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await testIntegration(projectId, integrationId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/projects/${projectId}/integrations/${integrationId}/test`,
    );
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(res.success).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.latencyMs).toBe(142);
  });

  it("maps error responses to IntegrationsApiClientError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: {
          code: "BLOCKED_DESTINATION",
          message: "Target URL points to a blocked destination.",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createIntegration(projectId, {
        name: "SSRF Attempt",
        provider: "webhook",
        targetUrl: "http://127.0.0.1/webhook",
      }),
    ).rejects.toThrowError(IntegrationsApiClientError);

    try {
      await createIntegration(projectId, {
        name: "SSRF Attempt",
        provider: "webhook",
        targetUrl: "http://127.0.0.1/webhook",
      });
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.code).toBe("BLOCKED_DESTINATION");
      expect(err.message).toBe("Target URL points to a blocked destination.");
    }
  });
});
